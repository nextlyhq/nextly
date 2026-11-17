/**
 * What the seed records about the starter header and footer it made: each
 * component's id and a fingerprint of what it held when seeded.
 *
 * ## One row, and the row is the claim
 *
 * Kept as ONE row of the plugin's own options table, not on the settings
 * Single: a Single's columns are each site's own schema, so a new field there
 * would ask every existing site for a migration, while this table ships with
 * the plugin. One row rather than one per area, because the row's unique name
 * is what decides between two processes seeding a fresh site at the same
 * moment: the run whose insert lands made the site's one starter, and the
 * other removes what it made and stops (`ensure-default`).
 *
 * The row also says the starter was made, once and for good: a later repair
 * that re-seeds a lost default finds it and creates an empty set instead, so
 * a site that deleted its starter on purpose never gets it back.
 *
 * ## The fingerprint
 *
 * A hash of the component's document with its node ids and timestamps left
 * out, so the same content stored again under new ids still matches. "The
 * starter is untouched" means the component's PUBLISHED document still
 * hashes to what was recorded: a draft nobody published changes nothing a
 * visitor sees.
 *
 * @module default-layout/starter-record
 */
import { createHash } from "node:crypto";

import { and, eq } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
} from "@nextlyhq/plugin-sdk/schema";

import { siteOptions } from "../schema/tables";
import { readSiteOption } from "../site-option-read";

import type { StarterArea } from "./seed-names";

/** The options-table row the starter is recorded under. */
export const STARTER_OPTION = "starter";

/** One starter component, as recorded. */
export interface StarterPart {
  readonly id: string;
  readonly fingerprint: string;
}

/** The starter header and footer the seed made. */
export type StarterRecord = { readonly [A in StarterArea]: StarterPart };

/**
 * How many hex digits of the hash are kept: 128 bits, far past any chance of
 * an edited document matching by accident, and short enough that both parts
 * fit the options table's value column with room to spare.
 */
const FINGERPRINT_DIGITS = 32;

/** Keys a document's fingerprint leaves out: node ids and timestamps. */
const UNCOUNTED_KEYS: ReadonlySet<string> = new Set([
  "id",
  "createdAt",
  "updatedAt",
]);

/** `value` as JSON with its keys sorted, without the uncounted keys. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([key, entry]) => !UNCOUNTED_KEYS.has(key) && entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The fingerprint of a component's document, by the rule above. */
export function starterFingerprint(document: unknown): string {
  return createHash("sha256")
    .update(canonical(document))
    .digest("hex")
    .slice(0, FINGERPRINT_DIGITS);
}

/** The record as the row stores it: four words, header first. */
export function encodeStarterRecord(record: StarterRecord): string {
  return [
    record.header.id,
    record.header.fingerprint,
    record.footer.id,
    record.footer.fingerprint,
  ].join(" ");
}

/** The row's value as a record, or null for one this code did not write. */
export function decodeStarterRecord(value: string): StarterRecord | null {
  const words = value.split(" ");
  if (words.length !== 4 || words.some(word => word === "")) return null;
  const [headerId, headerPrint, footerId, footerPrint] = words as [
    string,
    string,
    string,
    string,
  ];
  return {
    header: { id: headerId, fingerprint: headerPrint },
    footer: { id: footerId, fingerprint: footerPrint },
  };
}

/** Which area of the record, if any, `componentId` and `document` are untouched in. */
export function untouchedStarterArea(
  record: StarterRecord | null,
  componentId: string,
  publishedDocument: unknown
): StarterArea | null {
  if (record === null || publishedDocument === undefined) return null;
  for (const area of ["header", "footer"] as const) {
    const part = record[area];
    if (
      part.id === componentId &&
      starterFingerprint(publishedDocument) === part.fingerprint
    ) {
      return area;
    }
  }
  return null;
}

/** Where the record is kept. */
export interface StarterRecordStore {
  /**
   * Whether a starter was ever recorded: the record, or `"made"` for a row
   * this code cannot read (it still means the starter was made), or null.
   */
  read(): Promise<StarterRecord | "made" | null>;
  /**
   * Record `record` as the site's one starter. False, writing nothing, when a
   * starter is already recorded: another run made it first.
   */
  claim(record: StarterRecord): Promise<boolean>;
  /** Remove `record`, only while it is the one recorded. */
  release(record: StarterRecord): Promise<void>;
}

/** Which database, so a lost race to insert the row is recognised. */
type Dialect = Parameters<typeof isUniqueViolation>[0];

/** The record, as one row of the plugin's own options table. */
export function starterRecordStore(
  db: Pick<PluginDatabase, "select" | "insert" | "delete" | "table">,
  dialect: Dialect
): StarterRecordStore {
  return {
    read: async () => {
      const value = await readSiteOption(db, STARTER_OPTION);
      if (value === null) return null;
      return decodeStarterRecord(value) ?? "made";
    },
    claim: async record => {
      try {
        await db.insert(siteOptions, {
          name: STARTER_OPTION,
          value: encodeStarterRecord(record),
        });
        return true;
      } catch (error) {
        if (isUniqueViolation(dialect, error)) return false;
        throw error;
      }
    },
    release: async record => {
      const t = db.table(siteOptions);
      const named = eq(t.name, STARTER_OPTION);
      // Only this run's own record, by its value in the same statement: one
      // another run made is never removed.
      await db
        .delete(siteOptions)
        .where(and(named, eq(t.value, encodeStarterRecord(record))) ?? named);
    },
  };
}
