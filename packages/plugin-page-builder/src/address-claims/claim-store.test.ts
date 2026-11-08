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
 * And a list's later pages held, from before a list was paged only with its
 * own address, by a holder that waits for that address: asked again, it
 * gives them up through the hand-over, so a document waiting among them is
 * served, and waits for them behind the address.
 *
 * What a release does against a real database is proved on every dialect by
 * `__tests__/address-claims.integration.test.ts`.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import {
  claimKey,
  servedAddress,
  spaceWaitingKey,
  waitingKey,
  type ServedAddress,
} from "./claim-key";
import {
  claimSpaceOrWait,
  releaseClaims,
  storedKey,
  type Claims,
  type Holder,
} from "./claim-store";

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
  let made = 0;
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
        // One row per stored key, as the unique index keeps it.
        createEntryInTransaction: async (
          _tx: unknown,
          _slug: string,
          data: Row
        ) => {
          if (rows.some(row => row.claimKey === data.claimKey)) {
            throw NextlyError.duplicate({ logContext: { key: data.claimKey } });
          }
          made += 1;
          const row = {
            id: `made-${made}`,
            space: null,
            blockedBy: null,
            ...data,
          };
          rows.push(row);
          return row;
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

const LIST: Holder = { collection: "pages", id: "list" };
const AT_NEWS: Holder = { collection: "posts", id: "e1" };
const AMONG: Holder = { collection: "posts", id: "e2" };

/** A row of `kind` for `holder` at `path`, with the columns given. */
function claimRow(
  id: string,
  kind: "address" | "space" | "waiting",
  path: string,
  holder: Holder,
  columns: { key?: string; space?: string; blockedBy?: string } = {}
): Row {
  return {
    id,
    claimKey: storedKey(
      columns.key ?? claimKey(kind === "waiting" ? "address" : kind, at(path))
    ),
    kind,
    locale: "en",
    path,
    holderCollection: holder.collection,
    holderId: holder.id,
    space: columns.space ?? null,
    blockedBy: columns.blockedBy ?? null,
  };
}

/**
 * As a store paged a list before its later pages went only with its own
 * address: `/news` is another document's, the list holds `/news`'s later
 * pages while it waits for `/news`, and a document waits for
 * `/news/page/2` behind the list's space.
 */
function heldBeforeTheRule(): Row[] {
  const atNews = storedKey(claimKey("address", at("/news")));
  const space = storedKey(claimKey("space", at("/news")));
  return [
    claimRow("d-address", "address", "/news", AT_NEWS),
    claimRow("p-space", "space", "/news", LIST),
    claimRow("p-waits", "waiting", "/news", LIST, {
      key: waitingKey(LIST, at("/news"), atNews),
      blockedBy: atNews,
    }),
    claimRow("q-waits", "waiting", "/news/page/2", AMONG, {
      key: waitingKey(AMONG, at("/news/page/2"), space),
      blockedBy: space,
    }),
    stored("l-news", "lock", "/news"),
    stored("l-news-2", "lock", "/news/page/2"),
  ];
}

/** Each claim and wait stored, as kind, path, holder and what it waits on. */
function claimsHeld(rows: readonly Row[]): string[] {
  return rows
    .filter(row => row.kind !== "lock")
    .map(
      row =>
        `${String(row.kind)} ${String(row.path)} ${String(row.holderId)}` +
        (row.blockedBy === null ? "" : ` behind ${String(row.blockedBy)}`) +
        (row.kind === "waiting" && row.space !== null ? " (later pages)" : "")
    )
    .sort();
}

describe("claimSpaceOrWait", () => {
  it("gives up a list's later pages its holder kept while waiting for the list's address, serving the document waiting among them", async () => {
    const rows = heldBeforeTheRule();
    const { claims, locked, removed } = mysqlClaims(rows);
    const atNews = storedKey(claimKey("address", at("/news")));

    const answer = await claimSpaceOrWait(claims, {} as never, {
      list: at("/news"),
      holder: LIST,
    });

    expect(answer).toBe("waiting");
    expect(removed).toEqual(expect.arrayContaining(["p-space", "q-waits"]));
    expect(claimsHeld(rows)).toEqual(
      [
        "address /news e1",
        // Served at once: the later pages it waited behind are no one's now.
        "address /news/page/2 e2",
        // The list waits for its address and, behind the same claim, for
        // its later pages.
        `waiting /news list behind ${atNews}`,
        `waiting /news list behind ${atNews} (later pages)`,
      ].sort()
    );
    expect(
      rows.some(
        row =>
          row.claimKey === storedKey(spaceWaitingKey(LIST, at("/news"), atNews))
      )
    ).toBe(true);
    // Only the list's lock is taken before the release, and it is taken
    // first: serving the waiting document then takes its page's locks, in
    // key order.
    expect(locked[0]).toBe(lockKeyOf("/news"));
    expect(new Set(locked)).toEqual(
      new Set([lockKeyOf("/news"), lockKeyOf("/news/page/2")])
    );
  });

  it("gives up such later pages where no one holds the list's address either", async () => {
    const rows = heldBeforeTheRule().filter(
      row => row.id !== "d-address" && row.id !== "p-waits"
    );
    const { claims } = mysqlClaims(rows);

    const answer = await claimSpaceOrWait(claims, {} as never, {
      list: at("/news"),
      holder: LIST,
    });

    expect(answer).toBe("waiting");
    expect(claimsHeld(rows)).toEqual(["address /news/page/2 e2"]);
  });
});
