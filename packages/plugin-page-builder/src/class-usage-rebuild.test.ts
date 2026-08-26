/**
 * Whether the rebuild repairs what disagrees and leaves alone what does not.
 *
 * The two failures are not symmetric, and the tests are weighted accordingly. A
 * rebuild that MISSES a stale record leaves the class library counting wrong,
 * which is the defect it exists to fix. A rebuild that writes to a page whose
 * record was already correct moves that page's `updatedAt` and fires whatever
 * watches for edits — for every page on the site, in one burst. So the writes
 * it does NOT make are asserted as carefully as the ones it does.
 *
 * @module class-usage-rebuild.test
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";

import { rebuildClassUsage, type PageUsageStore } from "./class-usage-rebuild";

/** One node carrying the class ids given. */
function nodeWith(id: string, classes: string[]) {
  return { id, type: "text", classes };
}

/** A page row as the store would return it. */
function page(id: string, classes: string[], stored?: unknown) {
  return {
    id,
    content: { nodes: [nodeWith(`n-${id}`, classes)] },
    ...(stored === undefined ? {} : { usedClasses: stored }),
  };
}

/** Records every write, and serves the pages given one query at a time. */
function storeOf(pages: unknown[][]): {
  store: PageUsageStore;
  writes: { id: string; data: Record<string, unknown> }[];
  queries: { page: number; sort: string }[];
} {
  const writes: { id: string; data: Record<string, unknown> }[] = [];
  const queries: { page: number; sort: string }[] = [];
  const store: PageUsageStore = {
    find: args => {
      queries.push({ page: args.page, sort: args.sort });
      const items = pages[args.page - 1] ?? [];
      return Promise.resolve({
        items,
        meta: { hasNext: args.page < pages.length },
      });
    },
    update: args => {
      writes.push({ id: args.id, data: args.data });
      return Promise.resolve({});
    },
  };
  return { store, writes, queries };
}

describe("rebuildClassUsage", () => {
  it("writes the derived list for a page that has no record", () => {
    // The population the rebuild exists for: pages written before the field
    // existed carry nothing, and nothing is what an empty document also
    // produces, so the absent case has to be repaired rather than skipped.
    const { store, writes } = storeOf([[page("a", ["hero", "card"])]]);

    return rebuildClassUsage({ store, limits: DEFAULT_LIMITS }).then(report => {
      expect(report).toEqual({ scanned: 1, repaired: 1, undetermined: 0 });
      expect(writes).toEqual([
        { id: "a", data: { usedClasses: ["card", "hero"] } },
      ]);
    });
  });

  it("does not write when the stored record already matches", () => {
    // The expensive half. Writing here would move `updatedAt` on a page nobody
    // edited, and a rebuild over a whole site would do it to every page at
    // once — so "no write" is the assertion, not "the value ends up right".
    const { store, writes } = storeOf([
      [page("a", ["hero", "card"], ["card", "hero"])],
    ]);

    return rebuildClassUsage({ store, limits: DEFAULT_LIMITS }).then(report => {
      expect(report).toEqual({ scanned: 1, repaired: 0, undetermined: 0 });
      expect(writes).toEqual([]);
    });
  });

  it("does not write when a MATCHING record arrived as a JSON string", () => {
    // Which shape a `json` column comes back in is a property of the dialect:
    // Postgres and MySQL parse it, SQLite stores it as text and does not. A
    // comparison that read only the parsed shape would find no array here,
    // call every record absent, and rewrite EVERY page on every rebuild — the
    // site-wide `updatedAt` jump this comparison exists to prevent, happening
    // on exactly one of the three supported databases.
    const { store, writes } = storeOf([
      [page("a", ["hero", "card"], JSON.stringify(["card", "hero"]))],
    ]);

    return rebuildClassUsage({ store, limits: DEFAULT_LIMITS }).then(report => {
      expect(report).toEqual({ scanned: 1, repaired: 0, undetermined: 0 });
      expect(writes).toEqual([]);
    });
  });

  it("repairs a page whose DOCUMENT arrived as a JSON string", () => {
    // The same column shape on the other field. Reading only the parsed form
    // would derive an empty list for every page on that dialect and record
    // that the whole site references nothing — the under-count direction that
    // gets a live class deleted.
    const { store, writes } = storeOf([
      [
        {
          id: "a",
          content: JSON.stringify({ nodes: [{ id: "n", classes: ["hero"] }] }),
        },
      ],
    ]);

    return rebuildClassUsage({ store, limits: DEFAULT_LIMITS }).then(report => {
      expect(report).toEqual({ scanned: 1, repaired: 1, undetermined: 0 });
      expect(writes).toEqual([{ id: "a", data: { usedClasses: ["hero"] } }]);
    });
  });

  it("repairs a record that disagrees with the document", () => {
    const { store, writes } = storeOf([[page("a", ["hero"], ["stale"])]]);

    return rebuildClassUsage({ store, limits: DEFAULT_LIMITS }).then(report => {
      expect(report).toEqual({ scanned: 1, repaired: 1, undetermined: 0 });
      expect(writes).toEqual([{ id: "a", data: { usedClasses: ["hero"] } }]);
    });
  });

  it("treats a same-length record with a different member as stale", () => {
    // Length equality is the cheap half of the comparison and on its own it
    // answers yes for two lists of the same size that share no members. Both
    // lists here hold exactly one id.
    const { store, writes } = storeOf([[page("a", ["hero"], ["card"])]]);

    return rebuildClassUsage({ store, limits: DEFAULT_LIMITS }).then(report => {
      expect(report.repaired).toBe(1);
      expect(writes).toEqual([{ id: "a", data: { usedClasses: ["hero"] } }]);
    });
  });

  it.each([["hero"], [7], [{ hero: true }], [null]])(
    "treats the non-array record %j as absent rather than comparing it",
    stored => {
      // The field is `json`, so anything can be sitting in it. A string, a
      // number or an object is not a disagreement to compare against — it is a
      // record that was never written by the hook, and the rebuild is what
      // replaces it.
      //
      // One case per stored shape rather than a loop inside one test, so a
      // shape that stops being repaired names itself in the failure instead of
      // stopping the run at the first one.
      const { store, writes } = storeOf([[page("a", ["hero"], stored)]]);

      return rebuildClassUsage({ store, limits: DEFAULT_LIMITS }).then(
        report => {
          expect(report.repaired).toBe(1);
          expect(writes).toEqual([
            { id: "a", data: { usedClasses: ["hero"] } },
          ]);
        }
      );
    }
  );

  it("writes only the derived field, never the rest of the row", () => {
    // A rebuild that sent the whole row back would rewrite the page from what
    // this walk happened to read, discarding an edit made in between.
    const { store, writes } = storeOf([[page("a", ["hero"])]]);

    return rebuildClassUsage({ store, limits: DEFAULT_LIMITS }).then(() => {
      expect(Object.keys(writes[0]?.data ?? {})).toEqual(["usedClasses"]);
    });
  });

  it("follows pagination to the end and orders by a key it does not write", () => {
    // Offset paging reads position N of an ORDERED set, so ordering by a key
    // the walk itself moves — `updatedAt` being the obvious one for a
    // maintenance pass — reshuffles rows between queries and skips some. The
    // sort is asserted because nothing else observes it.
    const { store, writes, queries } = storeOf([
      [page("a", ["hero"]), page("b", ["card"])],
      [page("c", ["hero"])],
    ]);

    return rebuildClassUsage({ store, limits: DEFAULT_LIMITS }).then(report => {
      expect(report).toEqual({ scanned: 3, repaired: 3, undetermined: 0 });
      expect(writes.map(write => write.id)).toEqual(["a", "b", "c"]);
      expect(queries).toEqual([
        { page: 1, sort: "id" },
        { page: 2, sort: "id" },
      ]);
    });
  });

  it("reports scanned separately from repaired", () => {
    // The two numbers answer different questions and one cannot stand in for
    // the other: a run that read nothing and a run that found nothing to fix
    // both report zero repairs, and only the scan count separates them.
    const { store } = storeOf([[]]);

    return rebuildClassUsage({ store, limits: DEFAULT_LIMITS }).then(report => {
      expect(report).toEqual({ scanned: 0, repaired: 0, undetermined: 0 });
    });
  });

  it("skips a row it cannot read an id out of, and keeps going", () => {
    // Persisted data reaches here unvalidated. Losing the whole rebuild over
    // one unreadable row would leave every later page stale, and the later
    // pages are the ones nobody knows to look at.
    const { store, writes } = storeOf([
      [null, { content: {} }, page("b", ["hero"])],
    ]);

    return rebuildClassUsage({ store, limits: DEFAULT_LIMITS }).then(report => {
      expect(report).toEqual({ scanned: 1, repaired: 1, undetermined: 0 });
      expect(writes.map(write => write.id)).toEqual(["b"]);
    });
  });

  it("refuses to report a rebuild that ran out of pages before the store ran out", () => {
    // Exhausting the page guard and reaching the end are different outcomes
    // that produced the same `RebuildReport`, and the numbers on it are the
    // same numbers a complete run would carry — so a caller would record a
    // successful rebuild over a site it had only partly scanned, and go on to
    // trust records for pages nothing ever read.
    //
    // A store that always claims another page is what a malformed `hasNext`
    // looks like, and it is also what a site larger than the guard looks like.
    // Neither is a rebuild that finished.
    const endless: PageUsageStore = {
      find: () => Promise.resolve({ items: [], meta: { hasNext: true } }),
      update: () => Promise.resolve({}),
    };

    return expect(
      rebuildClassUsage({ store: endless, limits: DEFAULT_LIMITS })
    ).rejects.toThrow(/were not read/);
  });

  it("reports normally when the store DOES report an end, so the refusal is not unconditional", () => {
    // The control. A rebuild that threw whenever it finished would satisfy the
    // case above while never completing for anyone.
    const { store } = storeOf([[page("a", ["hero"])]]);

    return rebuildClassUsage({ store, limits: DEFAULT_LIMITS }).then(report => {
      expect(report).toEqual({ scanned: 1, repaired: 1, undetermined: 0 });
    });
  });

  it("does not write a record for a page it could not read to the end", () => {
    // The list would be a PREFIX of the answer, and the record exists so a
    // class can be deleted safely — so writing it would licence exactly the
    // deletion it is there to prevent. Counted as undetermined instead, which
    // is what stops the run reading as a clean sweep over pages it could not
    // determine.
    const wide = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      type: "text",
      classes: [`c${i}`],
    }));
    const { store, writes } = storeOf([
      [{ id: "a", content: { nodes: wide } }],
    ]);

    return rebuildClassUsage({
      store,
      limits: { maxDepth: 12, maxNodes: 5, maxBytes: 2_097_152 },
    }).then(report => {
      expect(report).toEqual({ scanned: 1, repaired: 0, undetermined: 1 });
      expect(writes).toEqual([]);
    });
  });

  it("still repairs a page it CAN read whole, so the refusal is not blanket", () => {
    // The control. A rebuild that declined every page would satisfy the case
    // above while repairing nothing for anyone.
    const { store, writes } = storeOf([[page("a", ["hero"])]]);

    return rebuildClassUsage({ store, limits: DEFAULT_LIMITS }).then(report => {
      expect(report).toEqual({ scanned: 1, repaired: 1, undetermined: 0 });
      expect(writes).toHaveLength(1);
    });
  });

  it("writes by ID and field only, leaving HOW to reach the live row to the store", () => {
    // The rebuild cannot route its own write: on a drafts-enabled collection an
    // update that omits `status` is stored as a working draft and the published
    // row is untouched, so a store forwarding straight to a collection update
    // would repair an author's pending edit and leave the stale live record.
    //
    // That requirement belongs to the port, and this pins the half the rebuild
    // owns: it names the row and the field, and adds nothing that would make
    // the write mean something else. A `status` smuggled in here would publish
    // a draft nobody asked to publish.
    const { store, writes } = storeOf([[page("a", ["hero"])]]);

    return rebuildClassUsage({ store, limits: DEFAULT_LIMITS }).then(() => {
      expect(writes).toHaveLength(1);
      expect(Object.keys(writes[0]?.data ?? {})).toEqual(["usedClasses"]);
      expect(writes[0]?.id).toBe("a");
    });
  });

  it("lets a store failure propagate rather than reporting a clean rebuild", () => {
    // `classIdsUsedBy` is total, so a failure here is the store being
    // unreachable or refusing the write. Reporting a completed rebuild that
    // repaired nothing is the answer that stops anyone looking, and rerunning
    // costs nothing because the record is idempotent.
    const failing: PageUsageStore = {
      find: () =>
        Promise.resolve({
          items: [page("a", ["hero"])],
          meta: { hasNext: false },
        }),
      update: () => Promise.reject(new Error("connection lost")),
    };

    return expect(
      rebuildClassUsage({ store: failing, limits: DEFAULT_LIMITS })
    ).rejects.toThrow("connection lost");
  });
});
