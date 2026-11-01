/**
 * The earlier addresses of media items whose files a Replace kept, and the
 * one way an address is looked up among them.
 *
 * A Replace gives an item a new address, but content that named the item by
 * its old address (rich text, a JSON value's `src`, an email template's
 * image) goes on naming the old one, and its file is kept for it. The usage
 * record must still count those uses as the item's when such a document is
 * saved again, or the item would read as unused while a page shows its old
 * file. So each kept address is one `nextly_meta` row, `media.address:<hash>`,
 * naming the item; the record's writer asks for an address here when no item
 * has it now (`media-usage-store`). The rows go with the item's kept files
 * when it is deleted (`address-uses`).
 *
 * The key holds a hash of the address rather than the address, which may be
 * longer than the key column takes.
 *
 * @module domains/media/usage/kept-addresses
 */

import { createHash } from "node:crypto";

import { z } from "zod";

/** The `nextly_meta` key of one kept address. */
export function keptAddressKey(address: string): string {
  return `media.address:${createHash("sha256").update(address).digest("hex")}`;
}

/** What a kept address's row holds: the item, and the address itself. */
const keptAddressSchema = z.object({
  mediaId: z.string().min(1),
  url: z.string().min(1),
});
export type KeptAddress = z.infer<typeof keptAddressSchema>;

/**
 * A kept address's row value as the dialect returned it, or `null` when it
 * is not one: parsed on PostgreSQL and MySQL, a string on SQLite.
 */
function keptAddressOf(value: unknown): KeptAddress | null {
  let read: unknown = value;
  if (typeof value === "string") {
    try {
      read = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const parsed = keptAddressSchema.safeParse(read);
  return parsed.success ? parsed.data : null;
}

/** The statement a lookup runs: a transaction's, or the adapter's own. */
interface KeptAddressReader {
  select<T = Record<string, unknown>>(
    table: string,
    options: {
      columns: string[];
      where: { and: Array<{ column: string; op: "IN"; value: string[] }> };
    }
  ): Promise<T[]>;
}

/**
 * The kept addresses among `addresses`, each under the address it was asked
 * by, read in runs of at most `maxParams` keys.
 */
export async function findKeptAddresses(
  db: KeptAddressReader,
  addresses: readonly string[],
  maxParams: number
): Promise<Map<string, KeptAddress>> {
  const byKey = new Map(
    addresses.map(address => [keptAddressKey(address), address])
  );
  const keys = [...byKey.keys()];
  const found = new Map<string, KeptAddress>();
  const run = Number.isFinite(maxParams)
    ? Math.max(1, Math.floor(maxParams))
    : 1;
  for (let start = 0; start < keys.length; start += run) {
    const rows = await db.select<Record<string, unknown>>("nextly_meta", {
      columns: ["key", "value"],
      where: {
        and: [
          { column: "key", op: "IN", value: keys.slice(start, start + run) },
        ],
      },
    });
    for (const row of rows) {
      const asked =
        typeof row.key === "string" ? byKey.get(row.key) : undefined;
      const kept = keptAddressOf(row.value);
      // The row names the address it was kept for, so an address is only
      // ever given the item kept under that very address.
      if (asked !== undefined && kept !== null && kept.url === asked) {
        found.set(asked, kept);
      }
    }
  }
  return found;
}
