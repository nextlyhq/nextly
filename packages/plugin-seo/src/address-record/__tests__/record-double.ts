/**
 * A stand-in for the address record's store (`address-record/store`), for
 * unit tests that read the record without a database. Each context's rows
 * and notes are kept here, and every read of who holds an address is
 * counted. A test replaces the store's readers with these:
 *
 *   vi.mock("../store", async importOriginal => ({
 *     ...(await importOriginal()),
 *     ...(await import("./record-double")).recordDouble,
 *   }));
 */
import type { AddressHolder, PluginContext } from "@nextlyhq/plugin-sdk";

import { claimKey, type RecordRow, type RowKind } from "../rows";

/** An address or range a page holds, as a test states it. */
export interface DoubleRow {
  kind?: Exclude<RowKind, "lock">;
  locale: string;
  path: string;
  holderCollection: string;
  holderId: string;
  holderLabel?: string;
}

/** What the double keeps for one context. */
interface Kept {
  rows: DoubleRow[];
  /** Each read of who holds an address: the keys it asked for. */
  reads: string[][];
  /** Answers a note's value, or none where it is not kept. */
  note: (key: string) => Promise<string | undefined>;
  notes: Map<string, string>;
}

const kept = new WeakMap<object, Kept>();

/**
 * Keep `rows` as the record of `ctx`, and `note` as how its notes are read
 * (by default from the notes the double keeps). Answers what is kept, its
 * reads included.
 */
export function keepRecord(
  ctx: PluginContext,
  rows: DoubleRow[] = [],
  note?: (key: string) => Promise<string | undefined>
): Kept {
  const notes = new Map<string, string>();
  const each: Kept = {
    rows,
    reads: [],
    notes,
    note: note ?? (async key => notes.get(key)),
  };
  kept.set(ctx, each);
  return each;
}

function of(ctx: PluginContext): Kept {
  return kept.get(ctx) ?? keepRecord(ctx);
}

/** The store's readers, answered from what the double keeps. */
export const recordDouble = {
  recordReady: async (): Promise<void> => undefined,

  async holdersByKey(
    ctx: PluginContext,
    keys: readonly string[]
  ): Promise<Map<string, AddressHolder>> {
    const record = of(ctx);
    record.reads.push([...keys]);
    const held = new Map<string, AddressHolder>();
    for (const row of record.rows) {
      const key = claimKey(row.kind ?? "address", row.locale, row.path);
      if (keys.includes(key)) {
        held.set(key, {
          collection: row.holderCollection,
          id: row.holderId,
          ...(row.holderLabel ? { label: row.holderLabel } : {}),
        });
      }
    }
    return held;
  },

  async addressesOf(
    ctx: PluginContext,
    collection: string,
    ids: readonly string[]
  ): Promise<RecordRow[]> {
    return of(ctx).rows.flatMap(row =>
      (row.kind ?? "address") === "address" &&
      row.holderCollection === collection &&
      ids.includes(row.holderId)
        ? [
            {
              id: `${row.locale}|${row.path}`,
              claimKey: claimKey("address", row.locale, row.path),
              kind: "address" as const,
              address: { locale: row.locale, path: row.path },
              holder: { collection: row.holderCollection, id: row.holderId },
            },
          ]
        : []
    );
  },

  async readNotes(
    ctx: PluginContext,
    keys: readonly string[]
  ): Promise<{ notes: Map<string, string | null>; pending: boolean }> {
    const record = of(ctx);
    const notes = new Map<string, string | null>();
    for (const key of keys) {
      const value = await record.note(key);
      if (value !== undefined) notes.set(key, value);
    }
    return { notes, pending: false };
  },

  async putNote(ctx: PluginContext, key: string, value: string): Promise<void> {
    of(ctx).notes.set(key, value);
  },

  async addNoteOnce(
    ctx: PluginContext,
    key: string,
    value: string
  ): Promise<string> {
    const record = of(ctx);
    const before = await record.note(key);
    if (before !== undefined) return before;
    record.notes.set(key, value);
    return value;
  },
};
