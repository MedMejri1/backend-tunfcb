export const PRODUCT_CATEGORIES = ["maillots", "accessoires", "autres"] as const
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]

export const PRODUCT_STATUSES = ["draft", "published", "archived"] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

export const ORDER_STATUSES = ["pending", "confirmed", "preparing", "shipped", "delivered", "cancelled"] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

/** Statuses an admin can move an order to from each status. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["shipped", "cancelled"],
  // A parcel refused at the door is cancelled (stock goes back).
  shipped: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
}

/** Orders still holding stock: cancelling them puts the items back. */
export const OPEN_ORDER_STATUSES: OrderStatus[] = ["pending", "confirmed", "preparing", "shipped"]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "reçue",
  confirmed: "confirmée",
  preparing: "en préparation",
  shipped: "expédiée",
  delivered: "livrée",
  cancelled: "annulée",
}

export const GOVERNORATES = [
  "Ariana",
  "Béja",
  "Ben Arous",
  "Bizerte",
  "Gabès",
  "Gafsa",
  "Jendouba",
  "Kairouan",
  "Kasserine",
  "Kébili",
  "Le Kef",
  "Mahdia",
  "La Manouba",
  "Médenine",
  "Monastir",
  "Nabeul",
  "Sfax",
  "Sidi Bouzid",
  "Siliana",
  "Sousse",
  "Tataouine",
  "Tozeur",
  "Tunis",
  "Zaghouan",
] as const

export const PAYMENT_METHODS = ["cash_on_delivery"] as const
