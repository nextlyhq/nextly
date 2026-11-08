/**
 * Releasing a holder's claims when the read that finds which locks to take
 * and the locking read after it disagree, with the claims collection kept
 * in memory: on MySQL the first read can answer from an older snapshot than
 * the second, which a real instance shows only by racing two transactions.
 *
 * A claim the locking read finds and the first read missed needs a lock the
 * release has not taken. Taking it then would wait in the order the first
 * read was there to avoid, so the release is refused as a conflict, and
 * nothing is removed. When the two reads agree, the release takes the first
 * read's locks, in key order, and removes the claims.
 *
 * What a release does against a real database is proved on every dialect by
 * `__tests__/address-claims.integration.test.ts`.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { claimKey, servedAddress, type ServedAddress } from "./claim-key";
import { releaseClaims, storedKey, type Claims } from "./claim-store";

type Row = Record<string, unknown>;
type Where = Record<string, { equals?: unknown; in?: unknown[] }>;
type Read = { where?: Where; pagination: { limit: number; page?: number } };

const HOLDER = { collection: "pages", id: "p1" };

function at(path: string): ServedAddress {
  const address = servedAddress("en", path);
  if (address === null) throw new Error(`no address at ${path}`);
  return address;
}

const lockKeyOf = (path: string) => storedKey(claimKey("lock", at(path)));

/** A claim row as stored: an address held by {@link HOLDER}, or its lock. */
function stored(id: string, kind: "address" | "lock", path: string): Row {
  return {
    id,
    claimKey: storedKey(claimKey(kind, at(path))),
    kind,
    locale: "en",
    path,
    holderCollection: kind === "lock" ? null : HOLDER.collection,
    holderId: kind === "lock" ? null : HOLDER.id,
    space: null,
    blockedBy: null,
  };
}

/**
 * A MySQL claims collection over `rows`. A read holding nothing leaves out
 * the rows `unseen` names, as an older snapshot would; every locking read
 * returns them.
 */
function mysqlClaims(rows: Row[], unseen: readonly string[] = []) {
  /** The stored keys of the lock rows held, in the order they were held. */
  const locked: string[] = [];
  /** The ids of the rows deleted. */
  const removed: string[] = [];
  const read = (options: Read, lock: string) => {
    const where = options.where ?? {};
    const found = rows.filter(
      row =>
        !(lock === "none" && unseen.includes(String(row.id))) &&
        Object.entries(where).every(([field, test]) =>
          test.in !== undefined
            ? test.in.includes(row[field])
            : test.equals === undefined || row[field] === test.equals
        )
    );
    const { limit, page = 1 } = options.pagination;
    return {
      data: found.slice((page - 1) * limit, page * limit),
      pagination: { total: found.length },
    };
  };
  const claims = {
    slug: "address-claims",
    dialect: "mysql",
    services: {
      ownCollections: {
        listEntries: async (_slug: string, options: Read) =>
          read(options, "none"),
        listEntriesInTransaction: async (
          _tx: unknown,
          _slug: string,
          options: Read,
          { lock }: { lock: string }
        ) => read(options, lock),
      },
      collections: {
        createEntryInTransaction: async () => {
          throw new Error("no claim is created by a release here");
        },
        updateEntryInTransaction: async (
          _tx: unknown,
          _slug: string,
          id: string
        ) => {
          const row = rows.find(each => each.id === id);
          if (row?.kind !== "lock") throw new Error(`updated ${id}`);
          locked.push(String(row.claimKey));
          return { item: row };
        },
        deleteEntryInTransaction: async (
          _tx: unknown,
          _slug: string,
          id: string
        ) => {
          const index = rows.findIndex(row => row.id === id);
          if (index < 0) {
            throw NextlyError.notFound({ logContext: { id } });
          }
          rows.splice(index, 1);
          removed.push(id);
          return {};
        },
      },
    },
  } as unknown as Claims;
  return { claims, locked, removed };
}

/** {@link HOLDER} holding `/about` and `/contact`, with both addresses' locks. */
function holding(): Row[] {
  return [
    stored("a-about", "address", "/about"),
    stored("a-contact", "address", "/contact"),
    stored("l-about", "lock", "/about"),
    stored("l-contact", "lock", "/contact"),
  ];
}

describe("releaseClaims", () => {
  it("refuses, changing nothing, when the locking read finds a claim the first read missed", async () => {
    const rows = holding();
    const { claims, locked, removed } = mysqlClaims(rows, ["a-contact"]);
    const release = releaseClaims(claims, {} as never, HOLDER);
    await expect(release).rejects.toMatchObject({
      logContext: { reason: "address-claim-release-raced" },
    });
    const error: unknown = await release.catch((caught: unknown) => caught);
    expect(NextlyError.isCode(error, "CONFLICT")).toBe(true);
    // Only the lock of the claim the first read saw was held; the late
    // claim's was not taken after the locking read.
    expect(locked).toEqual([lockKeyOf("/about")]);
    expect(locked).not.toContain(lockKeyOf("/contact"));
    expect(removed).toEqual([]);
    expect(rows.map(row => row.id)).toEqual([
      "a-about",
      "a-contact",
      "l-about",
      "l-contact",
    ]);
  });

  it("takes the first read's locks in key order and removes the claims when both reads agree", async () => {
    const rows = holding();
    const { claims, locked, removed } = mysqlClaims(rows);
    await releaseClaims(claims, {} as never, HOLDER);
    expect(locked).toEqual([lockKeyOf("/about"), lockKeyOf("/contact")]);
    expect(removed.sort()).toEqual(["a-about", "a-contact"]);
    expect(rows.map(row => row.id)).toEqual(["l-about", "l-contact"]);
  });
});
