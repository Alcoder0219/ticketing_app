import { randomUUID } from 'node:crypto';
import { Schema, SchemaOptions } from 'mongoose';

/** Generate a UUID string id (matches the old Supabase uuid primary keys). */
export const uuid = () => randomUUID();

/** A string primary key field defaulting to a UUID. */
export const idField = { type: String, default: uuid };

/**
 * Shared schema options: keep string `_id`, expose it as `id`, drop `__v`,
 * and serialize Date fields to ISO strings so the frontend (which was written
 * against Supabase/Postgres timestamptz strings) keeps working unchanged.
 */
export const baseOptions: SchemaOptions = {
  _id: false, // we declare our own string _id on every schema
  versionKey: false,
  minimize: false, // keep empty objects (e.g. permissions: {})
  toJSON: {
    virtuals: false,
    transform(_doc, ret: Record<string, unknown>) {
      if (ret._id !== undefined) {
        ret.id = ret._id;
        delete ret._id;
      }
      for (const k of Object.keys(ret)) {
        if (ret[k] instanceof Date) ret[k] = (ret[k] as Date).toISOString();
      }
      return ret;
    },
  },
};

/** Apply created_at / updated_at (snake_case, ISO strings on output). */
export function withTimestamps(schema: Schema): Schema {
  schema.set('timestamps', { createdAt: 'created_at', updatedAt: 'updated_at' });
  return schema;
}
