// Server-side normalization of a row a device pushed to /api/sync/push, so it matches what
// Prisma will actually accept for that model. A phone's local database is SQLite, where booleans
// are stored as 0/1 and dates as whatever string was written — but Prisma validates every scalar
// strictly ("Expected Boolean, provided Int"), and an unconvertible row used to be rejected
// silently, which is how nearly every table quietly failed to sync from the Android app.
//
// Driven by Prisma's own runtime data model rather than a hand-kept list of column names, so
// adding a Boolean/DateTime column to any model never requires touching this file.
import { Prisma } from "@prisma/client";
import { toBoolean, toIsoDate } from "@/lib/syncNormalize";

interface FieldInfo {
  type: string;
  isRequired: boolean;
}

const INT32_MAX = 2_147_483_647;

const fieldsByModel = new Map<string, Map<string, FieldInfo>>();

function fieldsFor(model: string): Map<string, FieldInfo> | null {
  const cached = fieldsByModel.get(model);
  if (cached) return cached;
  const info = Prisma.dmmf.datamodel.models.find((m) => m.name.toLowerCase() === model.toLowerCase());
  if (!info) return null;
  const map = new Map<string, FieldInfo>();
  for (const f of info.fields) {
    if (f.kind === "scalar") map.set(f.name, { type: f.type, isRequired: f.isRequired });
  }
  fieldsByModel.set(model, map);
  return map;
}

export interface CoercedRow {
  data: Record<string, unknown>;
  /** Keys the server model has no scalar column for (e.g. a newer app build's extra column) — dropped, not fatal. */
  dropped: string[];
  /** Set when a value can't be represented at all; the row must be rejected with this reason. */
  error?: string;
}

/** `model` is the Prisma accessor name (SYNC_TABLES[].model), e.g. "habitCheckIn". */
export function coerceSyncRow(model: string, row: Record<string, unknown>): CoercedRow {
  const fields = fieldsFor(model);
  if (!fields) return { data: { ...row }, dropped: [] };

  const data: Record<string, unknown> = {};
  const dropped: string[] = [];

  for (const [key, raw] of Object.entries(row)) {
    const field = fields.get(key);
    if (!field) {
      dropped.push(key);
      continue;
    }

    if (raw === null || raw === undefined) {
      if (field.isRequired) return { data, dropped, error: `${key}: required value is missing` };
      data[key] = null;
      continue;
    }

    switch (field.type) {
      case "Boolean": {
        const b = toBoolean(raw);
        if (b === null) return { data, dropped, error: `${key}: not a boolean (${JSON.stringify(raw)})` };
        data[key] = b;
        break;
      }
      case "DateTime": {
        const iso = toIsoDate(raw);
        if (!iso) return { data, dropped, error: `${key}: not a valid date (${JSON.stringify(raw)})` };
        data[key] = iso;
        break;
      }
      case "Int": {
        const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
        if (typeof n !== "number" || !Number.isInteger(n)) return { data, dropped, error: `${key}: not an integer (${JSON.stringify(raw)})` };
        // Postgres INTEGER is 32-bit; the phone's SQLite happily stores more. Say so plainly
        // instead of letting the database throw an opaque error mid-batch.
        if (Math.abs(n) > INT32_MAX) return { data, dropped, error: `${key}: ${n} is larger than the server allows (max ${INT32_MAX})` };
        data[key] = n;
        break;
      }
      case "Float": {
        const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
        if (typeof n !== "number" || !Number.isFinite(n)) return { data, dropped, error: `${key}: not a number (${JSON.stringify(raw)})` };
        data[key] = n;
        break;
      }
      case "String": {
        data[key] = typeof raw === "string" ? raw : String(raw);
        break;
      }
      default:
        data[key] = raw;
    }
  }

  return { data, dropped };
}
