/**
 * Whether claiming a subject actually serialises two writers.
 *
 * The store is observed rather than reimplemented: the cases assert the calls
 * the code made, including the predicates, so a claim that stopped comparing
 * against the observed value cannot go on passing.
 *
 * @module class-usage-generation.test
 */
import { describe, expect, it } from "vitest";

import {
  claimSubjectGeneration,
  type SubjectGenerationStore,
} from "./class-usage-generation";
import type { ClassUsageSubject } from "./class-usage-reconcile";

const page: ClassUsageSubject = {
  scope: "collection",
  entity: "pages",
  entityKey: "page-1",
  field: "content",
  locale: "",
  variant: "published",
};

/** A store answering fixed rows and recording every call in order. */
function store(rows: unknown[], successCount = 1) {
  const calls: string[] = [];
  const api: SubjectGenerationStore = {
    find: async args => {
      calls.push(
        `find:sort=${args.sort}:where=${Object.keys(args.where).sort().join(",")}`
      );
      return { items: rows, meta: { hasNext: false } };
    },
    create: async args => {
      calls.push(`create:generation=${String(args.data.generation)}`);
      return {};
    },
    update: async args => {
      const w = args.where;
      calls.push(
        `update:id=${String(w.id?.equals)}:ifGeneration=${String(w.generation?.equals)}:to=${String(args.data.generation)}`
      );
      return { successCount };
    },
  };
  return { api, calls };
}

describe("a subject nothing has reconciled yet", () => {
  it("creates the row and claims the first generation", async () => {
    const s = store([]);

    const claim = await claimSubjectGeneration({
      store: s.api,
      collection: "nx_pb_class_usage_gen",
      subject: page,
    });

    expect(claim).toEqual({ claimed: true, generation: 1 });
    expect(s.calls).toEqual([
      "find:sort=id:where=entity,entityKey,field,locale,scope,variant",
      "create:generation=1",
    ]);
  });

  it("keys the lookup by EVERY member of the subject", async () => {
    // A generation keyed by less than the whole subject serialises unrelated
    // documents against each other — one page's save would block another's —
    // and one keyed by more could never be found again, so every claim would
    // create a new row and serialise nothing at all.
    const s = store([]);

    await claimSubjectGeneration({
      store: s.api,
      collection: "nx_pb_class_usage_gen",
      subject: page,
    });

    expect(s.calls[0]).toContain(
      "where=entity,entityKey,field,locale,scope,variant"
    );
  });
});

describe("a subject another writer is already reconciling", () => {
  it("advances the generation, comparing against the value it READ", async () => {
    const s = store([{ id: "g1", generation: 4 }]);

    const claim = await claimSubjectGeneration({
      store: s.api,
      collection: "nx_pb_class_usage_gen",
      subject: page,
    });

    expect(claim).toEqual({ claimed: true, generation: 5 });
    // The predicate is the mechanism. Updating by id alone would apply
    // whatever the row now holds, which is the overwrite this exists to refuse.
    expect(s.calls[1]).toBe("update:id=g1:ifGeneration=4:to=5");
  });

  it("does NOT claim when the compare-and-set matched nothing", async () => {
    // Another writer advanced the generation between the read and the write.
    // Reporting a claim here would let two callers reconcile one subject
    // against different documents, and the loser's removals would delete rows
    // the winner still needs.
    const s = store([{ id: "g1", generation: 4 }], 0);

    const claim = await claimSubjectGeneration({
      store: s.api,
      collection: "nx_pb_class_usage_gen",
      subject: page,
    });

    expect(claim).toEqual({ claimed: false });
  });
});

describe("two writers racing the same subject", () => {
  it("lets exactly ONE of them through", async () => {
    // The property the whole module exists for, driven from one fixture so the
    // two outcomes cannot be produced by anything except the compare-and-set
    // discriminating between them. A claim that ignored `successCount` would
    // return claimed for both, and the assertion below could not hold.
    const rows = [{ id: "g1", generation: 7 }];
    let matched = 1;
    const api: SubjectGenerationStore = {
      find: async () => ({ items: rows, meta: { hasNext: false } }),
      create: async () => ({}),
      update: async () => {
        // The first caller matches the row; the second finds it advanced.
        const successCount = matched;
        matched = 0;
        return { successCount };
      },
    };

    const first = await claimSubjectGeneration({
      store: api,
      collection: "gen",
      subject: page,
    });
    const second = await claimSubjectGeneration({
      store: api,
      collection: "gen",
      subject: page,
    });

    expect([first.claimed, second.claimed]).toEqual([true, false]);
  });
});

describe("rows that cannot be read as a generation", () => {
  it("treats a non-numeric generation as absent rather than as zero", async () => {
    // Coercing would hand every caller the same claim, which is the
    // serialisation failing OPEN — the one direction it must not fail in.
    // Creating a fresh row instead is the same answer as for a subject nothing
    // has touched, which is the safe reading of an unusable one.
    const s = store([{ id: "g1", generation: "four" }]);

    const claim = await claimSubjectGeneration({
      store: s.api,
      collection: "gen",
      subject: page,
    });

    expect(claim).toEqual({ claimed: true, generation: 1 });
    expect(s.calls[1]).toBe("create:generation=1");
  });
});

describe("duplicate generation rows", () => {
  it("serialises on the LOWEST id, so a duplicate is harmless", async () => {
    // Two callers can create concurrently: the composite key this table
    // describes cannot be enforced, because a collection's declared indexes
    // never reach the schema pipeline, so no unique constraint exists to
    // reject the second insert. Duplicates are made harmless rather than
    // prevented — every caller picking the same row is what keeps them
    // serialised whatever else is present.
    const s = store([
      { id: "g1", generation: 2 },
      { id: "g2", generation: 9 },
    ]);

    const claim = await claimSubjectGeneration({
      store: s.api,
      collection: "gen",
      subject: page,
    });

    // g1, not the one with the higher generation.
    expect(claim).toEqual({ claimed: true, generation: 3 });
    expect(s.calls[1]).toBe("update:id=g1:ifGeneration=2:to=3");
  });

  it("asks the store for a STABLE ordering rather than assuming one", async () => {
    // "Lowest id" is only agreed if the query says so. Without a sort the
    // query service emits no ORDER BY, so two callers can receive the same
    // rows in different orders and pick different ones — and then neither is
    // serialised against the other, silently.
    const s = store([{ id: "g1", generation: 1 }]);

    await claimSubjectGeneration({
      store: s.api,
      collection: "gen",
      subject: page,
    });

    expect(s.calls[0]).toContain("sort=id");
  });
});
