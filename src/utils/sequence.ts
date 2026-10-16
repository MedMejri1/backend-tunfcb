import { Schema, model } from "mongoose"

// Sequential, human-friendly numbers (TF-00001, SUP-00001…).
const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } })
const CounterModel = model("Counter", counterSchema)

export async function nextSequence(key: string, prefix: string): Promise<string> {
  const counter = await CounterModel.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  )
  return `${prefix}-${String(counter.seq).padStart(5, "0")}`
}
