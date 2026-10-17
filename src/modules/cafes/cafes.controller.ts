import type { RequestHandler } from "express"
import type { Types } from "mongoose"
import { z } from "zod"
import { HttpError } from "../../middlewares/errorHandler.js"
import { escapeRegex, paginated, paginationSchema } from "../../utils/pagination.js"
import { NotificationModel } from "../notifications/notification.model.js"
import { pushToUsers } from "../push/push.service.js"
import { CAFE_AMENITIES, CAFE_STATUSES, CafeModel, type Cafe, type CafeStatus } from "./cafe.model.js"
import { getGovernorates, resolveLocation } from "./locations.service.js"

type CafeDoc = Cafe & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date }
type Submitter = { _id: Types.ObjectId; firstName: string; lastName: string; email: string }
// submittedBy populated with the supporter's name (or a bare id / nothing).
type AdminCafeSource = Omit<CafeDoc, "submittedBy"> & { submittedBy?: Submitter | Types.ObjectId | null }

// Anti-spam: requests waiting for review per supporter.
const MAX_PENDING_PER_USER = 3

/** What every app user sees (the phone only if the manager agreed). */
const presentCafe = (c: Omit<CafeDoc, "submittedBy">) => ({
  id: String(c._id),
  name: c.name,
  governorate: c.governorate,
  governorateName: c.governorateName,
  delegation: c.delegation,
  delegationName: c.delegationName,
  address: c.address,
  mapsUrl: c.mapsUrl ?? "",
  screens: c.screens ?? null,
  amenities: c.amenities ?? [],
  description: c.description ?? "",
  phone: c.showPhone ? c.phone : null,
})

const presentAdminCafe = (c: AdminCafeSource) => ({
  ...presentCafe(c),
  phone: c.phone,
  showPhone: c.showPhone,
  managerName: c.managerName,
  status: c.status,
  rejectionReason: c.rejectionReason ?? "",
  createdAt: c.createdAt,
  reviewedAt: c.reviewedAt ?? null,
  submittedBy:
    c.submittedBy && "firstName" in c.submittedBy
      ? {
          id: String(c.submittedBy._id),
          name: `${c.submittedBy.firstName} ${c.submittedBy.lastName}`.trim(),
          email: c.submittedBy.email,
        }
      : null,
})

/** Tunisian number: 8 digits, typed with or without +216 / 00216 and spaces. */
const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s.-]/g, "").replace(/^(\+|00)216/, ""))
  .pipe(z.string().regex(/^[2-9]\d{7}$/, "Numéro tunisien à 8 chiffres"))

const cafeFields = {
  name: z.string().trim().min(2, "Indique le nom du café").max(80),
  governorate: z.string().trim().min(1, "Choisis le gouvernorat"),
  delegation: z.string().trim().min(1, "Choisis la délégation"),
  address: z.string().trim().min(5, "Indique l’adresse").max(160),
  mapsUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "Lien invalide"),
  screens: z.number().int().min(1).max(50).nullable(),
  amenities: z.array(z.enum(CAFE_AMENITIES)).max(CAFE_AMENITIES.length),
  description: z.string().trim().max(300),
  managerName: z.string().trim().min(2, "Indique ton nom").max(80),
  phone: phoneSchema,
  showPhone: z.boolean(),
}

const cafeSchema = z.object({
  ...cafeFields,
  mapsUrl: cafeFields.mapsUrl.default(""),
  screens: cafeFields.screens.default(null),
  amenities: cafeFields.amenities.default([]),
  description: cafeFields.description.default(""),
  showPhone: cafeFields.showPhone.default(true),
})

// No defaults here: with zod 4 a default still fills a missing key under .partial().
const cafeUpdateSchema = z.object(cafeFields).partial()

const filtersSchema = z.object({
  governorate: z.string().trim().optional(),
  delegation: z.string().trim().optional(),
  search: z.string().trim().max(80).optional(),
})

const searchFilter = (search?: string) => {
  if (!search) return {}
  const rx = { $regex: escapeRegex(search), $options: "i" }
  return { $or: [{ name: rx }, { address: rx }, { delegationName: rx }, { governorateName: rx }] }
}

// ------------------------------------------------------------ Mobile (open to guests)

export const cafeLocations: RequestHandler = async (_req, res) => {
  res.json({ governorates: await getGovernorates() })
}

/** Approved cafés, filtered by governorate / delegation, with the count per governorate for the filter. */
export const listCafes: RequestHandler = async (req, res) => {
  const { governorate, delegation, search } = filtersSchema.parse(req.query)
  const filter = {
    status: "approved" as const,
    ...(governorate ? { governorate } : {}),
    ...(governorate && delegation ? { delegation } : {}),
    ...searchFilter(search),
  }

  const [items, counts] = await Promise.all([
    CafeModel.find(filter).sort({ governorateName: 1, delegationName: 1, name: 1 }).limit(300).lean<CafeDoc[]>(),
    CafeModel.aggregate<{ _id: string; count: number }>([
      { $match: { status: "approved" } },
      { $group: { _id: "$governorate", count: { $sum: 1 } } },
    ]),
  ])

  res.json({
    items: items.map(presentCafe),
    governorates: counts.map((c) => ({ value: c._id, count: c.count })),
  })
}

/** "Tu es gérant d'un café ?" form: the café waits for the team's check. */
export const submitCafe: RequestHandler = async (req, res) => {
  const input = cafeSchema.parse(req.body)
  const location = await resolveLocation(input.governorate, input.delegation)

  const duplicate = await CafeModel.exists({
    phone: input.phone,
    name: { $regex: `^${escapeRegex(input.name)}$`, $options: "i" },
    status: { $ne: "rejected" },
  })
  if (duplicate) throw new HttpError(409, "Ce café est déjà inscrit ou en cours de vérification")

  const userId = req.appUser?._id
  if (userId && (await CafeModel.countDocuments({ submittedBy: userId, status: "pending" })) >= MAX_PENDING_PER_USER) {
    throw new HttpError(429, "Tu as déjà plusieurs demandes en attente : l’équipe les vérifie au plus vite")
  }

  const cafe = await CafeModel.create({ ...input, ...location, status: "pending", submittedBy: userId })
  res.status(201).json({ cafe: { id: String(cafe._id), status: cafe.status } })
}

// ------------------------------------------------------------ Admin

/** Sidebar badge: requests waiting for a check. */
export const adminCafesSummary: RequestHandler = async (_req, res) => {
  res.json({ pending: await CafeModel.countDocuments({ status: "pending" }) })
}

export const adminListCafes: RequestHandler = async (req, res) => {
  const { page, limit } = paginationSchema.parse(req.query)
  const { status, governorate, search } = filtersSchema
    .extend({ status: z.enum(CAFE_STATUSES).optional() })
    .parse(req.query)

  const rx = search ? { $regex: escapeRegex(search), $options: "i" } : null
  const filter = {
    ...(status ? { status } : {}),
    ...(governorate ? { governorate } : {}),
    ...(rx ? { $or: [{ name: rx }, { managerName: rx }, { phone: rx }, { address: rx }, { delegationName: rx }] } : {}),
  }

  const [items, total, counts] = await Promise.all([
    CafeModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("submittedBy", "firstName lastName email")
      .lean<AdminCafeSource[]>(),
    CafeModel.countDocuments(filter),
    CafeModel.aggregate<{ _id: CafeStatus; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
  ])

  res.json({
    ...paginated(
      items.map(presentAdminCafe),
      total,
      page,
      limit,
    ),
    counts: Object.fromEntries(CAFE_STATUSES.map((s) => [s, counts.find((c) => c._id === s)?.count ?? 0])),
  })
}

/** A café added by the team is published straight away. */
export const adminCreateCafe: RequestHandler = async (req, res) => {
  const input = cafeSchema.parse(req.body)
  const location = await resolveLocation(input.governorate, input.delegation)
  const cafe = await CafeModel.create({
    ...input,
    ...location,
    status: "approved",
    reviewedBy: req.admin!._id,
    reviewedAt: new Date(),
  })
  res.status(201).json({ cafe: presentAdminCafe(cafe.toObject()) })
}

export const adminUpdateCafe: RequestHandler = async (req, res) => {
  const input = cafeUpdateSchema.parse(req.body)
  const cafe = await CafeModel.findById(req.params.id)
  if (!cafe) throw new HttpError(404, "Café introuvable")

  const location =
    input.governorate || input.delegation
      ? await resolveLocation(input.governorate ?? cafe.governorate, input.delegation ?? cafe.delegation)
      : {}
  cafe.set({ ...input, ...location })
  await cafe.save()
  await cafe.populate("submittedBy", "firstName lastName email")
  res.json({ cafe: presentAdminCafe(cafe.toObject()) })
}

const statusSchema = z.object({
  status: z.enum(CAFE_STATUSES),
  reason: z.string().trim().max(300).default(""),
})

/** Accept / refuse (or take back) a café; whoever sent it from the app is told. */
export const adminSetCafeStatus: RequestHandler = async (req, res) => {
  const { status, reason } = statusSchema.parse(req.body)
  const cafe = await CafeModel.findById(req.params.id)
  if (!cafe) throw new HttpError(404, "Café introuvable")

  const changed = cafe.status !== status
  cafe.set({
    status,
    rejectionReason: status === "rejected" ? reason : "",
    reviewedBy: req.admin!._id,
    reviewedAt: new Date(),
  })
  await cafe.save()

  if (changed && cafe.submittedBy && status !== "pending") {
    const title = status === "approved" ? "Ton café est en ligne" : "Ton café n’a pas été publié"
    const message =
      status === "approved"
        ? `${cafe.name} apparaît maintenant dans « Où regarder le match » (${cafe.delegationName}, ${cafe.governorateName}).`
        : `${cafe.name} : ${reason || "les informations n’ont pas pu être vérifiées."} Tu peux envoyer une nouvelle demande depuis l’app.`
    await NotificationModel.create({ user: cafe.submittedBy, category: "system", title, message, ref: String(cafe._id) })
    await pushToUsers({ userIds: [cafe.submittedBy] }, () => ({
      title,
      body: message,
      channel: "announcements",
      data: { type: "notification" },
    }))
  }

  await cafe.populate("submittedBy", "firstName lastName email")
  res.json({ cafe: presentAdminCafe(cafe.toObject()) })
}

export const adminDeleteCafe: RequestHandler = async (req, res) => {
  const deleted = await CafeModel.findByIdAndDelete(req.params.id)
  if (!deleted) throw new HttpError(404, "Café introuvable")
  res.json({ ok: true })
}
