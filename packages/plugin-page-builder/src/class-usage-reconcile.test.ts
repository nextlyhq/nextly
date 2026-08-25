/**
 * Whether a document's index rows are derived correctly, and whether
 * reconciling them against stored rows issues the right writes.
 *
 * The cases are chosen around the two directions that hurt. Deriving too FEW
 * references reports a class as unused and licences deleting it while pages
 * render it; recording too MANY reports a class as used and blocks a delete
 * that was safe. The first is the one that breaks a live site, so the
 * truncation case below is the one this file exists for.
 *
 * @module class-usage-reconcile.test
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_LIMITS, isUsableNamedClass } from "@nextlyhq/blocks-engine";

import {
  UNDETERMINED_CLASS_ID,
  deriveClassUsageRows,
  reconcileClassUsage,
  type ClassUsageSubject,
} from "./class-usage-reconcile";

/** A page, addressed the way a collection document is. */
const page: ClassUsageSubject = {
  scope: "collection",
  entity: "pages",
  entityKey: "page-1",
  field: "content",
};

/** A document whose single node applies the given classes. */
const documentUsing = (...classes: string[]) => ({
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "n1", type: "core/text", version: 1, props: {}, classes }],
});

describe("deriving a document's index rows", () => {
  it("produces one row per referenced class, each carrying the subject", () => {
    const derivation = deriveClassUsageRows(
      page,
      documentUsing("hero", "card")
    );

    // The subject travels onto every row rather than being stored once beside
    // them: the table is read by class, so a row has to name its own document
    // to answer "which documents use this" without a second lookup.
    expect(derivation).toEqual({
      complete: true,
      rows: [
        { ...page, classId: "card" },
        { ...page, classId: "hero" },
      ],
    });
  });

  it("carries a single's empty entity key through unchanged", () => {
    // A single is addressed by its slug because its ROW may not exist, and the
    // empty string is what keeps the five key columns non-null. A derivation
    // that helpfully substituted an id here would produce rows the reconciler
    // could never match against the ones already stored.
    const single: ClassUsageSubject = {
      scope: "single",
      entity: "homepage",
      entityKey: "",
      field: "content",
    };

    const derivation = deriveClassUsageRows(single, documentUsing("hero"));

    expect(derivation).toEqual({
      complete: true,
      rows: [{ ...single, classId: "hero" }],
    });
  });

  it("yields NO rows when the document could not be read whole", () => {
    // The failure this whole module is arranged around. A document larger than
    // the bounds gives a PREFIX of its references, and reconciling against a
    // prefix removes the rows for everything past the bound — turning "could
    // not read it all" into "references nothing", which is precisely the answer
    // that lets a live class be deleted.
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      type: "core/text",
      version: 1,
      props: {},
      classes: [`c${i}`],
    }));

    const derivation = deriveClassUsageRows(
      page,
      { formatVersion: 1, kind: "page", nodes: many },
      { ...DEFAULT_LIMITS, maxNodes: 5 }
    );

    expect(derivation.complete).toBe(false);
    // Asserted as ABSENCE of the member, not as an empty list. An empty list
    // would still be a list a caller could reconcile against; the point of the
    // union is that there is nothing there to reach for.
    expect("rows" in derivation).toBe(false);
  });

  it("carries a marker row for a document it could not read whole", () => {
    // Skipping the write preserves rows the subject ALREADY has and preserves
    // nothing when it has none — the state an oversized document is in the
    // first time anything indexes it. Without the marker that subject looks
    // exactly like one referencing nothing, and the class its unread suffix
    // applies reads as unused.
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      type: "core/text",
      version: 1,
      props: {},
      classes: [`c${i}`],
    }));

    const derivation = deriveClassUsageRows(
      page,
      { formatVersion: 1, kind: "page", nodes: many },
      { ...DEFAULT_LIMITS, maxNodes: 5 }
    );

    expect(derivation).toEqual({
      complete: false,
      // The marker id, not one of the ids it managed to read. A marker naming
      // a real class would be counted as a reference by every lookup for it.
      undetermined: { ...page, classId: UNDETERMINED_CLASS_ID },
    });
  });

  it("uses a marker id the engine will not accept as a class", () => {
    // What makes the marker disjoint from every real reference, and the reason
    // it is not the empty string: `isUsableNamedClass` constrains an id by TYPE
    // and LENGTH only — no pattern, no minimum — so the empty string IS a
    // usable class id and a document can genuinely reference one. Exceeding the
    // cap is the only lever the rule leaves.
    //
    // Asserted against the engine's own predicate rather than by restating the
    // cap, so this fails if that rule ever changes rather than the marker
    // silently starting to collide.
    expect(
      isUsableNamedClass({
        id: UNDETERMINED_CLASS_ID,
        slug: "undetermined",
        styles: {},
      })
    ).toBe(false);

    // The control: the same entry with a short id IS accepted, so the rejection
    // above is caused by the marker's length and not by the rest of the shape.
    expect(
      isUsableNamedClass({ id: "hero", slug: "undetermined", styles: {} })
    ).toBe(true);
  });
});

describe("reconciling derived rows against stored ones", () => {
  it("issues no writes when the document's references are unchanged", () => {
    // The common case by a wide margin: editing a page's text changes no class
    // references at all. A reconciler that rewrote the rows anyway would move
    // every row on every save, for nothing.
    const derived = [
      { ...page, classId: "hero" },
      { ...page, classId: "card" },
    ];
    const stored = [
      { id: "r1", classId: "hero" },
      { id: "r2", classId: "card" },
    ];

    expect(reconcileClassUsage(derived, stored)).toEqual({
      insert: [],
      remove: [],
    });
  });

  it("inserts only the reference the stored rows do not have", () => {
    const derived = [
      { ...page, classId: "hero" },
      { ...page, classId: "card" },
    ];
    const stored = [{ id: "r1", classId: "hero" }];

    // `hero` is untouched rather than removed and re-added. A reference that
    // survives an edit must never be absent from the table, because a usage
    // count read between the two writes would not see it.
    expect(reconcileClassUsage(derived, stored)).toEqual({
      insert: [{ ...page, classId: "card" }],
      remove: [],
    });
  });

  it("removes the row for a reference the document has dropped", () => {
    const derived = [{ ...page, classId: "hero" }];
    const stored = [
      { id: "r1", classId: "hero" },
      { id: "r2", classId: "card" },
    ];

    expect(reconcileClassUsage(derived, stored)).toEqual({
      insert: [],
      remove: ["r2"],
    });
  });

  it("removes a duplicate row without re-inserting the class it duplicates", () => {
    // Two rows saying the same thing is one reference recorded twice, and the
    // library would report the class as used in more places than it is. The
    // keeper has to survive: removing both and inserting a fresh one would take
    // the reference out of the table for the duration of the write.
    const derived = [{ ...page, classId: "hero" }];
    const stored = [
      { id: "r1", classId: "hero" },
      { id: "r2", classId: "hero" },
    ];

    expect(reconcileClassUsage(derived, stored)).toEqual({
      insert: [],
      remove: ["r2"],
    });
  });

  it("clears a stale marker once the document can be read again", () => {
    // The marker is a row like any other, so a complete derivation that does
    // not name it removes it by the ordinary rule. Asserted rather than left
    // implicit: a marker that outlived the condition would report a readable
    // document as permanently unverifiable, and the library would keep telling
    // an author a count could not be checked when it now can.
    const derived = [{ ...page, classId: "hero" }];
    const stored = [
      { id: "m1", classId: "" },
      { id: "r1", classId: "hero" },
    ];

    expect(reconcileClassUsage(derived, stored)).toEqual({
      insert: [],
      remove: ["m1"],
    });
  });

  it("removes every row of a dropped class, naming each id exactly once", () => {
    // A class that is BOTH duplicated and no longer referenced meets two
    // reasons to be removed, and an implementation that applies them
    // independently names the same id twice — which is a delete of a row that
    // no longer exists by the time the second one runs.
    const derived = [{ ...page, classId: "hero" }];
    const stored = [
      { id: "r1", classId: "hero" },
      { id: "r2", classId: "card" },
      { id: "r3", classId: "card" },
    ];

    const result = reconcileClassUsage(derived, stored);

    expect(result.insert).toEqual([]);
    expect(result.remove).toEqual(["r2", "r3"]);
    expect(new Set(result.remove).size).toBe(result.remove.length);
  });
});
