/**
 * Whether the two class surfaces answer from one set of rules, and whether
 * those answers match what a page actually renders.
 *
 * Every case here is a way an author is shown something the renderer disagrees
 * with: a precedence the sheet does not apply, a class the compiler omitted,
 * a name that reaches a selector it cannot be written into, or a count read as
 * a measurement when it is a bound.
 *
 * The set of listed classes is asserted against `compilePageCss` rather than
 * against a second copy of the bounding rules. Two derivations of one belief
 * agree with each other whichever of them is wrong; the stylesheet is the only
 * thing that says what a browser will see.
 *
 * @module class-library.test
 */
import {
  BASE_BREAKPOINT,
  compileStyleValues,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";

/** A site that really does define `md`, so a stored `md` key emits a rule. */
const WITH_MD: StyleCompileContext = {
  breakpoints: {
    viewport: [
      { id: BASE_BREAKPOINT, label: "Base" },
      { id: "md", label: "Medium", maxWidth: 768 },
    ],
    container: [],
  },
};
import {
  MAX_CLASSES_PER_NODE,
  MAX_NAMED_CLASSES,
  compilePageCss,
  type BlockDocument,
  type BreakpointSet,
  type NamedClass,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  appliedClasses,
  applicableClasses,
  classRows,
  deletionWarning,
  filterClassRows,
  MAX_SELECTOR_OPTIONS,
  newClassName,
  renamedClassName,
  unappliedNodeClassCount,
  selectorOptions,
  siteClasses,
  withClassApplied,
  withClassRemoved,
  classDeclarations,
  usableSiteClasses,
} from "./class-library";

/** A library entry, with the styles envelope left empty where it is not read. */
const cls = (id: string, slug: string, orderIndex: number): NamedClass => ({
  id,
  slug,
  orderIndex,
  styles: {},
});

/** Stored out of order, so nothing can pass by reading the array as given. */
const LIBRARY: NamedClass[] = [
  cls("id-card", "card", 2),
  cls("id-hero", "hero", 0),
  cls("id-badge", "badge", 1),
];

describe("what the manager lists", () => {
  it("orders by the library's precedence, not by name or by storage", () => {
    // The order decides which of two classes on one node wins. Sorting
    // alphabetically for display would show an override relationship the page
    // does not apply, and reading the array as stored would show none at all.
    expect(classRows(LIBRARY, {}, []).map(r => r.slug)).toEqual([
      "hero",
      "badge",
      "card",
    ]);
  });

  it("carries the emitted class name, which is what appears in the markup", () => {
    // An author searching a page's source finds the prefixed name, not the
    // slug, so the manager has to be able to show the thing they will see.
    const [hero] = classRows(LIBRARY, {}, []);
    expect(hero?.className).toBe("nx-c-hero");
    expect(hero?.slug).toBe("hero");
  });

  it("reads an absent count as nothing known, not as unknown", () => {
    // A class no document references has no row in the index. Treating that as
    // unknown would leave every newly created class out of the evidence filter
    // — the one place it most needs to appear.
    const rows = classRows(LIBRARY, { "id-hero": 3 }, []);
    expect(rows.map(r => r.indexedDocuments)).toEqual([3, 0, 0]);
  });

  it("marks what the open document applies, separately from the count", () => {
    const rows = classRows(LIBRARY, {}, ["id-card"]);
    expect(rows.find(r => r.slug === "card")?.onThisPage).toBe(true);
    expect(rows.find(r => r.slug === "hero")?.onThisPage).toBe(false);
  });
});

describe("a count keyed by a name Object.prototype already answers", () => {
  // A class id is any string the library accepted, and the library's only
  // constraints are a length and a character grammar that `constructor` and
  // `toString` both satisfy. An ordinary record answers those from its
  // prototype, so a plain `usage[id]` returns a FUNCTION for a class with no
  // recorded usage.
  const INHERITED: NamedClass[] = [
    cls("constructor", "ctor", 0),
    cls("toString", "to-string", 1),
  ];

  it("reads an inherited member as nothing known rather than as a count", () => {
    const rows = classRows(INHERITED, {}, []);
    expect(rows.map(r => r.indexedDocuments)).toEqual([0, 0]);
  });

  it("still lists such a class under the no-known-usage filter", () => {
    // The failure this guards is silent: a function is not `=== 0`, so the
    // class would vanish from the one filter that exists to surface it.
    const rows = classRows(INHERITED, {}, []);
    expect(filterClassRows(rows, "not-in-index").map(r => r.slug)).toEqual([
      "ctor",
      "to-string",
    ]);
  });

  it("still reads an own count for such an id", () => {
    // The control for the case above: shadowing the prototype must not be
    // treated as absence, or the guard would have fixed one bug with another.
    const rows = classRows(INHERITED, { constructor: 5 }, []);
    expect(rows.find(r => r.slug === "ctor")?.indexedDocuments).toBe(5);
  });

  it("reads only OWN counts, not one reached through the prototype", () => {
    /*
     * The case that separates the two guards. Every member of
     * `Object.prototype` is a function or an object, so refusing a value that
     * is not a number already covers `constructor` and `toString` — this is the
     * only input for which reading an own property is what decides the answer.
     * A counts record assembled as overrides over a defaults object reaches
     * exactly this shape.
     */
    const inherited: Record<string, number> = Object.create({
      "id-hero": 7,
    }) as Record<string, number>;
    inherited["id-card"] = 2;

    const rows = classRows(LIBRARY, inherited, []);
    expect(rows.find(r => r.slug === "hero")?.indexedDocuments).toBe(0);
    // The control: an own count on the same record is still read.
    expect(rows.find(r => r.slug === "card")?.indexedDocuments).toBe(2);
  });

  it("refuses a fractional count, which cannot describe documents", () => {
    // A finite, non-negative fraction passed every earlier check and would have
    // put "0.5 known" on screen — a number no count of documents can produce.
    const rows = classRows(
      LIBRARY,
      { "id-hero": 0.5 } as unknown as Record<string, number>,
      []
    );
    expect(rows.find(r => r.slug === "hero")?.indexedDocuments).toBe(0);
  });

  it("refuses a stored value that is not a usable count", () => {
    // The index is persisted data and arrives whether or not anything validated
    // it. A negative or non-finite count compares false against every threshold,
    // which would hide the class the same way the inherited member does.
    const rows = classRows(
      LIBRARY,
      { "id-hero": -2, "id-badge": Number.NaN } as unknown as Record<
        string,
        number
      >,
      []
    );
    expect(rows.find(r => r.slug === "hero")?.indexedDocuments).toBe(0);
    expect(rows.find(r => r.slug === "badge")?.indexedDocuments).toBe(0);
  });
});

describe("the three filters, which are three different questions", () => {
  // "No known usage" asks the index; "on this page" asks the open document. A
  // class an unpublished draft applies is referenced and yet on no page the
  // author has open, so collapsing them would make the manager contradict the
  // canvas.
  const rows = classRows(LIBRARY, { "id-hero": 2 }, ["id-card"]);

  it("shows everything by default", () => {
    expect(filterClassRows(rows, "all")).toHaveLength(3);
  });

  it("shows only classes the index knows of no document for", () => {
    expect(filterClassRows(rows, "not-in-index").map(r => r.slug)).toEqual([
      "badge",
      "card",
    ]);
  });

  it("shows only what the open document applies", () => {
    expect(filterClassRows(rows, "on-this-page").map(r => r.slug)).toEqual([
      "card",
    ]);
  });

  it("keeps them distinct: referenced site-wide is not on this page", () => {
    // `card` is on this page and referenced by no document the index knows;
    // `hero` is referenced twice and on no open page. If either filter were
    // derived from the other, one of these would be wrong.
    const noKnown = filterClassRows(rows, "not-in-index").map(r => r.slug);
    const here = filterClassRows(rows, "on-this-page").map(r => r.slug);
    expect(noKnown).toContain("card");
    expect(here).toContain("card");
    expect(noKnown).not.toContain("hero");
    expect(here).not.toContain("hero");
  });
});

describe("the classes on the selected node", () => {
  it("shows them in library order, not the order the node stored them", () => {
    // Two nodes listing the same classes differently resolve identically, so
    // showing the stored order would imply a precedence the renderer ignores.
    expect(
      appliedClasses(LIBRARY, ["id-card", "id-hero"]).map(r => r.slug)
    ).toEqual(["hero", "card"]);
  });

  it("drops an id the library does not know", () => {
    // The engine omits such a class from the stylesheet, so a chip for it would
    // offer to edit something no page can display.
    expect(
      appliedClasses(LIBRARY, ["id-hero", "id-gone"]).map(r => r.slug)
    ).toEqual(["hero"]);
  });

  it("carries NO usage fields, rather than a zero it was never given", () => {
    // These callers are handed no index at all. A shape that still had a count
    // would report every applied class as referenced by nothing, and the
    // selector would then contradict the manager about the same class.
    const [choice] = appliedClasses(LIBRARY, ["id-hero"]);
    expect(Object.keys(choice ?? {}).sort()).toEqual([
      "className",
      "id",
      "slug",
    ]);
  });
});

describe("what the selector offers next", () => {
  it("excludes what the node already carries", () => {
    expect(
      applicableClasses(LIBRARY, ["id-hero"], "").map(r => r.slug)
    ).toEqual(["badge", "card"]);
  });

  it("narrows on the SLUG rather than the emitted name", () => {
    // Every emitted name starts with the same prefix, so matching against it
    // would make an author's first keystrokes match everything.
    expect(applicableClasses(LIBRARY, [], "car").map(r => r.slug)).toEqual([
      "card",
    ]);
    expect(applicableClasses(LIBRARY, [], "nx-c-").map(r => r.slug)).toEqual(
      []
    );
  });

  it("keeps library order among SEVERAL matches, not the order it filtered", () => {
    // A query returning one row cannot see this: the ordering and the filtering
    // are separate steps and a single result satisfies either. `a` matches two
    // classes whose library order (badge, card) differs from both their storage
    // order (card, badge) and any lexical tie they could be sorted by.
    expect(applicableClasses(LIBRARY, [], "a").map(r => r.slug)).toEqual([
      "badge",
      "card",
    ]);
  });

  it("ignores case and surrounding space, which a typed query carries", () => {
    expect(applicableClasses(LIBRARY, [], "  HERO ").map(r => r.slug)).toEqual([
      "hero",
    ]);
  });

  it("carries NO usage fields either", () => {
    const [choice] = applicableClasses(LIBRARY, [], "");
    expect(Object.keys(choice ?? {}).sort()).toEqual([
      "className",
      "id",
      "slug",
    ]);
  });
});

describe("what one keystroke resolves to", () => {
  it("offers the matches first and the new name last", () => {
    // Enter has to resolve to exactly one action. Create sitting last is what
    // makes a partially typed name apply the match rather than create a
    // near-duplicate beside it.
    const { options } = selectorOptions(LIBRARY, [], "ca");
    expect(options.map(o => o.kind)).toEqual(["apply", "create"]);
    expect(options[0]).toEqual({
      kind: "apply",
      choice: expect.objectContaining({ slug: "card" }),
    });
    expect(options[1]).toEqual({ kind: "create", slug: "ca" });
  });

  it("does not offer to create a name the library already holds", () => {
    // A second class under one slug is dropped by the compiler, so offering it
    // would be offering an entry that styles nothing.
    const { options } = selectorOptions(LIBRARY, [], "hero");
    expect(options.map(o => o.kind)).toEqual(["apply"]);
  });

  it("offers nothing for a class the node already carries", () => {
    // Neither action is available: applying is a no-op and creating collides.
    expect(selectorOptions(LIBRARY, ["id-hero"], "hero").options).toEqual([]);
  });

  it("offers no creation for a name the engine's grammar rejects", () => {
    const { options } = selectorOptions(LIBRARY, [], "Not A Slug");
    expect(options.every(o => o.kind === "apply")).toBe(true);
  });

  it("offers every applicable class and no creation for an empty query", () => {
    // The opened-but-untyped state. An empty name cannot be created, so the
    // list is exactly what the node could still be given.
    const { options } = selectorOptions(LIBRARY, ["id-hero"], "");
    expect(options.map(o => o.kind)).toEqual(["apply", "apply"]);
  });

  it("carries the CREATE slug normalized, not as typed", () => {
    expect(selectorOptions(LIBRARY, [], "  new-thing ").options).toContainEqual(
      {
        kind: "create",
        slug: "new-thing",
      }
    );
  });
});

describe("a library too long to put in front of an author", () => {
  const many = Array.from({ length: MAX_SELECTOR_OPTIONS + 20 }, (_, index) =>
    cls(`id-many-${index}`, `many-${String(index).padStart(3, "0")}`, index)
  );

  it("offers at most the cap, and REPORTS what it withheld", () => {
    // A truncated list that says nothing reads as "these are all of them",
    // which is the one thing it is not.
    const { options, hidden } = selectorOptions(many, [], "many");
    expect(options.filter(o => o.kind === "apply")).toHaveLength(
      MAX_SELECTOR_OPTIONS
    );
    expect(hidden).toBe(20);
  });

  it("reports nothing hidden when everything fits", () => {
    // The control: `hidden` must distinguish a capped list from a short one,
    // or the surface would warn about a list it showed in full.
    expect(selectorOptions(LIBRARY, [], "").hidden).toBe(0);
  });

  it("keeps the CREATE row even when the matches are capped", () => {
    // It is the one row the author's own typing produced; dropping it would
    // make a full library unable to gain a class through this surface.
    const { options } = selectorOptions(many, [], "brand-new");
    expect(options.at(-1)).toEqual({ kind: "create", slug: "brand-new" });
  });
});

describe("a node storing more references than the page applies", () => {
  it("counts the ones that style nothing", () => {
    const over = Array.from(
      { length: MAX_CLASSES_PER_NODE + 3 },
      (_, index) => `id-${index}`
    );
    expect(unappliedNodeClassCount(over)).toBe(3);
  });

  it("counts none for a node within the limit", () => {
    expect(unappliedNodeClassCount(["a", "b"])).toBe(0);
  });
});

describe("whether a name can become a class", () => {
  it("accepts a slug the engine can write into a selector", () => {
    expect(newClassName("call-to-action", LIBRARY)).toEqual({
      ok: true,
      slug: "call-to-action",
    });
  });

  it("returns the slug to STORE, not the text that was typed", () => {
    // Validation runs on the trimmed value, so a caller told "acceptable" that
    // then stored the raw text would persist a name failing the engine's own
    // grammar — a library entry no selector ever matches.
    const outcome = newClassName("  call-to-action  ", LIBRARY);
    expect(outcome).toEqual({ ok: true, slug: "call-to-action" });
  });

  it("refuses a name that is not a slug, rather than rewriting it", () => {
    // A rewritten name would be stored as a class no renderer puts on an
    // element, because the grammar here is the compiler's own.
    expect(newClassName("Call To Action", LIBRARY)).toEqual({
      ok: false,
      refusal: "not-a-slug",
    });
    expect(newClassName("-leading", LIBRARY)).toEqual({
      ok: false,
      refusal: "not-a-slug",
    });
  });

  it("refuses an empty name", () => {
    expect(newClassName("   ", LIBRARY)).toEqual({
      ok: false,
      refusal: "empty",
    });
  });

  it("refuses a duplicate rather than merging it", () => {
    // Two classes with one slug emit the same selector, so the compiler drops
    // the later one and the author is left with an entry that styles nothing.
    expect(newClassName("hero", LIBRARY)).toEqual({
      ok: false,
      refusal: "already-taken",
    });
  });

  it("refuses a new name once the library is full", () => {
    /*
     * A class added past `MAX_NAMED_CLASSES` becomes the first entry outside
     * the compiler's stored-order prefix, so it emits no rule — and
     * `checkStoredClasses` refuses the save rather than storing it quietly.
     * Reporting the name as acceptable would offer something that can neither
     * be saved nor rendered.
     */
    const full = Array.from({ length: MAX_NAMED_CLASSES }, (_, index) =>
      cls(`id-fill-${index}`, `fill-${index}`, index)
    );
    expect(newClassName("call-to-action", full)).toEqual({
      ok: false,
      refusal: "library-full",
    });
  });

  it("reports the fixable problem first when a name is BOTH bad and late", () => {
    // Capacity is about the library; a malformed name is about the input the
    // author just typed, and that is the one they can act on.
    const full = Array.from({ length: MAX_NAMED_CLASSES }, (_, index) =>
      cls(`id-fill-${index}`, `fill-${index}`, index)
    );
    expect(newClassName("Not A Slug", full)).toEqual({
      ok: false,
      refusal: "not-a-slug",
    });
  });

  it("still accepts one BELOW the cap, which is where the boundary is", () => {
    const nearly = Array.from({ length: MAX_NAMED_CLASSES - 1 }, (_, index) =>
      cls(`id-fill-${index}`, `fill-${index}`, index)
    );
    expect(newClassName("call-to-action", nearly)).toEqual({
      ok: true,
      slug: "call-to-action",
    });
  });

  it("lets a rename keep its own name, which is not a collision", () => {
    expect(renamedClassName("hero", "id-hero", LIBRARY)).toEqual({
      ok: true,
      slug: "hero",
    });
    expect(renamedClassName("hero", "id-card", LIBRARY)).toEqual({
      ok: false,
      refusal: "already-taken",
    });
  });
});

describe("applying and removing on a node", () => {
  it("appends rather than reordering to library position", () => {
    // Stored order does not decide precedence, so rewriting it would produce a
    // document change that renders identically — a diff nobody can explain.
    expect(withClassApplied(["id-card"], "id-hero")).toEqual({
      ok: true,
      classIds: ["id-card", "id-hero"],
    });
  });

  it("is a no-op when the node already carries it", () => {
    expect(withClassApplied(["id-hero"], "id-hero")).toEqual({
      ok: true,
      classIds: ["id-hero"],
    });
  });

  it("removes without touching the rest", () => {
    expect(withClassRemoved(["id-hero", "id-card"], "id-hero")).toEqual([
      "id-card",
    ]);
  });

  it("returns a new array rather than mutating the node's", () => {
    // The caller lifts this to whoever owns the document; mutating in place
    // would change a value the host may still be comparing against.
    const stored = ["id-hero"];
    const outcome = withClassApplied(stored, "id-card");
    expect(outcome.ok && outcome.classIds).not.toBe(stored);
    expect(stored).toEqual(["id-hero"]);
  });

  it("REFUSES once the node holds as many as the compiler reads", () => {
    /*
     * The compiler applies the first `MAX_CLASSES_PER_NODE` and strict
     * validation rejects a document holding more, so appending here would
     * record an application that neither renders nor can be published — and
     * the editor would draw it as done.
     */
    const full = Array.from(
      { length: MAX_CLASSES_PER_NODE },
      (_, index) => `id-${index}`
    );
    expect(withClassApplied(full, "id-hero")).toEqual({
      ok: false,
      refusal: "node-full",
    });
  });

  it("still accepts one BELOW the limit, which is where the boundary is", () => {
    const nearly = Array.from(
      { length: MAX_CLASSES_PER_NODE - 1 },
      (_, index) => `id-${index}`
    );
    const outcome = withClassApplied(nearly, "id-hero");
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.classIds).toHaveLength(MAX_CLASSES_PER_NODE);
  });

  it("does not refuse a class an over-full node already carries", () => {
    // Nothing is being added, so there is nothing to refuse — and reporting a
    // refusal would make a no-op look like a failure the author must resolve.
    const over = Array.from(
      { length: MAX_CLASSES_PER_NODE + 2 },
      (_, index) => `id-${index}`
    );
    expect(withClassApplied(over, "id-0")).toEqual({
      ok: true,
      classIds: over,
    });
  });
});

describe("a node holding more classes than the page applies", () => {
  // The compiler reads the first `MAX_CLASSES_PER_NODE` and warns about the
  // rest, so a stored tail styles nothing. Both surfaces have to agree with
  // that rather than with the array.
  const overFull = [
    ...Array.from({ length: MAX_CLASSES_PER_NODE }, () => "id-badge"),
    "id-hero",
  ];

  it("shows only the classes the page actually applies", () => {
    // `id-hero` is stored past the cap, so the element does not carry it and a
    // chip for it would disagree with what the browser renders.
    expect(appliedClasses(LIBRARY, overFull).map(r => r.slug)).toEqual([
      "badge",
    ]);
  });

  it("still refuses to OFFER a class stored past the cap", () => {
    /*
     * Deliberately not symmetric with the rule above, and the asymmetry is the
     * point: that one asks what the page renders, this one asks what applying
     * would ADD. `id-hero` renders nothing and is still on the node, so
     * offering it would append a second copy of an id already stored.
     */
    expect(
      applicableClasses(LIBRARY, overFull, "").map(r => r.slug)
    ).not.toContain("hero");
  });
});

describe("what deleting a class costs", () => {
  it("names the count when the index knows of documents", () => {
    expect(deletionWarning({ indexedDocuments: 4 })).toEqual({
      indexedDocuments: 4,
      hasIndexedUsage: true,
      requiresConfirmation: true,
    });
  });

  it("STILL confirms when the index knows of nothing", () => {
    // The index can under-count to zero: two saves to one document can each
    // remove the other's row, leaving a class that renders on the live site
    // with no row to say so. Zero is the one value it produces wrongly in the
    // direction that destroys data, so it is the last one to wave through.
    expect(deletionWarning({ indexedDocuments: 0 })).toEqual({
      indexedDocuments: 0,
      hasIndexedUsage: false,
      requiresConfirmation: true,
    });
  });

  it("confirms on ONE reference, the boundary a threshold would sit at", () => {
    expect(deletionWarning({ indexedDocuments: 1 }).requiresConfirmation).toBe(
      true
    );
  });
});

describe("the listed set is the set the stylesheet carries", () => {
  const BREAKPOINTS: BreakpointSet = {
    viewport: [{ id: "base", label: "Base" }],
    container: [],
  };

  /** A declaration, so each class emits a rule that can be looked for. */
  const paint = (colour: string): NodeStyles =>
    ({ base: { base: { color: colour } } }) as unknown as NodeStyles;

  const page: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "n1", type: "core/box", version: 1, props: {} }],
  } as unknown as BlockDocument;

  /** Which class selectors the compiler actually wrote, as slugs. */
  const emittedSlugs = (library: NamedClass[]): string[] => {
    const { css } = compilePageCss(page, {
      breakpoints: BREAKPOINTS,
      namedClasses: library,
    } as never);
    return [...css.matchAll(/\.nx-c-([a-z0-9-]+)/g)].map(match => match[1]!);
  };

  it("drops the entries past the cap, and drops them by STORED position", () => {
    /*
     * The compiler slices the stored array BEFORE it sorts, so the classes it
     * keeps are not the first `MAX_NAMED_CLASSES` by precedence. These two tail
     * entries are given the lowest `orderIndex` in the library for that reason:
     * an implementation that ordered first and sliced second would keep exactly
     * these and drop two fillers instead, so the fixture separates the two
     * rules rather than being satisfied by either.
     */
    const library: NamedClass[] = [
      ...Array.from({ length: MAX_NAMED_CLASSES }, (_, index) => ({
        ...cls(`id-fill-${index}`, `fill-${index}`, index + 10),
        styles: paint("red"),
      })),
      { ...cls("id-tail-a", "tail-a", 0), styles: paint("blue") },
      { ...cls("id-tail-b", "tail-b", 1), styles: paint("blue") },
    ];

    const listed = new Set(siteClasses(library).map(choice => choice.slug));
    const emitted = new Set(emittedSlugs(library));

    expect(listed.has("tail-a")).toBe(false);
    expect(listed.has("tail-b")).toBe(false);
    // The control: the entries that survived the cap ARE listed, so the
    // assertion above is about the boundary and not about an empty list.
    expect(listed.has("fill-0")).toBe(true);
    expect(listed.size).toBe(MAX_NAMED_CLASSES);
    expect([...listed].sort()).toEqual([...emitted].sort());
  });

  it("drops an entry whose slug an earlier one already claimed", () => {
    // The compiler emits one rule per selector and declines the later claim, so
    // listing both would offer a class whose styles never reach an element.
    const library: NamedClass[] = [
      { ...cls("id-first", "shared", 0), styles: paint("red") },
      { ...cls("id-second", "shared", 1), styles: paint("blue") },
      { ...cls("id-other", "other", 2), styles: paint("green") },
    ];

    expect(siteClasses(library).map(choice => choice.id)).toEqual([
      "id-first",
      "id-other",
    ]);
    expect(emittedSlugs(library)).toEqual(["shared", "other"]);
  });

  it("drops a malformed entry the compiler will not read", () => {
    const library = [
      { ...cls("id-good", "good", 0), styles: paint("red") },
      { id: "id-bad", slug: "Not A Slug", orderIndex: 1, styles: {} },
    ] as NamedClass[];

    expect(siteClasses(library).map(choice => choice.slug)).toEqual(["good"]);
    expect(emittedSlugs(library)).toEqual(["good"]);
  });
});

describe("what a class writes", () => {
  it("reports the properties the ENGINE compiles, not a second formatter", () => {
    /*
     * Asserted against `compileStyleValues` itself rather than a hand-written
     * list. The panel's job is to show what the stylesheet will carry, so the
     * compiler is the oracle; a literal expectation here would agree today and
     * describe a different stylesheet the first time the catalog changed.
     */
    const values = { color: "#112233", paddingBlockStart: "1rem" };
    const summary = classDeclarations(
      { base: { [BASE_BREAKPOINT]: values } },
      "hero"
    );
    expect(summary.shown.map(d => d.property)).toEqual(
      compileStyleValues(values, "class:hero").declarations.map(d => d.property)
    );
    // The must-be-found control: the compiler really did produce something, so
    // the equality above is not two empty lists agreeing.
    expect(summary.shown.length).toBeGreaterThan(0);
    expect(summary.elsewhere).toBe(0);
  });

  it("COUNTS what it is not showing, rather than showing the base silently", () => {
    /*
     * `NodeStyles` is states by breakpoints and a row has space for neither the
     * product nor a fair sample. Showing only the base without saying so would
     * misdescribe a class whose real behaviour is responsive.
     */
    const styles = {
      base: {
        [BASE_BREAKPOINT]: { color: "#112233" },
        md: { color: "#445566" },
      },
      hover: { [BASE_BREAKPOINT]: { color: "#778899" } },
    };
    const summary = classDeclarations(styles, "hero", WITH_MD);
    expect(summary.shown.map(d => d.property)).toEqual(["color"]);
    // Two places this class also behaves differently: one other breakpoint the
    // site DEFINES, and one other state.
    expect(summary.elsewhere).toBe(2);

    /*
     * Must-differ, and the point of taking a context at all: on a site that
     * does NOT define `md`, the compiler emits no rule for it, so the class
     * behaves no differently there and the count must not claim it does.
     */
    const withoutMd = classDeclarations(styles, "hero", undefined);
    expect(withoutMd.elsewhere).toBe(1);
  });

  it("counts a state that sets nothing as nothing", () => {
    // An empty map is a shape the document can hold and is not a place the
    // class behaves differently, so counting it would inflate the caveat.
    const summary = classDeclarations(
      { base: { [BASE_BREAKPOINT]: { color: "#112233" }, md: {} } },
      "hero",
      WITH_MD
    );
    expect(summary.elsewhere).toBe(0);
  });

  it("says nothing at all for a class that writes nothing", () => {
    const summary = classDeclarations({}, "hero");
    expect(summary.shown).toEqual([]);
    expect(summary.elsewhere).toBe(0);
  });

  it("counts a context whose values COMPILE to nothing as nothing", () => {
    /*
     * A stored key is not a declaration. A property the catalog does not define
     * is dropped by the compiler rather than passed through, so counting keys
     * claimed "1 more elsewhere" for styling no visitor can see — the same class
     * of lie as counting a breakpoint the site has since deleted, which the case
     * above already refuses.
     *
     * `md` here holds a key of the right SHAPE and no meaning, so a count of
     * stored keys says 1 and the compiled answer says 0.
     */
    const summary = classDeclarations(
      {
        base: {
          [BASE_BREAKPOINT]: { color: "#112233" },
          md: { notARealProperty: "1rem" },
        },
      } as never,
      "hero",
      WITH_MD
    );

    expect(summary.elsewhere).toBe(0);
    // Must-be-found control: the base still compiled, so the zero above is a
    // judgement about `md` and not a walk that found nothing anywhere.
    expect(summary.shown.map(d => d.property)).toEqual(["color"]);
  });
});

describe("persisted class styles that are not the shape the type promises", () => {
  /*
   * The type says states map to breakpoints map to values. The stored document
   * only promises to be JSON, and `usableSiteClasses` admits a class whose
   * `styles` is a plain record without walking into it — so a malformed nested
   * value reached the projection and threw, taking down the WHOLE class manager
   * rather than hiding one row.
   *
   * Each shape below is a separate throw site, which is why they are separate
   * cases rather than one loop: two threw inside this module's own walk and one
   * got as far as `compileStyleValues` and threw inside the engine.
   */
  const cases: [string, unknown][] = [
    ["a null base, which reached the compiler", { base: { base: null } }],
    ["a null state map", { base: null }],
    ["a null values map under a non-base state", { hover: { base: null } }],
    ["a state map that is an array", { base: [] }],
    ["values that are a string", { base: { base: "red" } }],
  ];

  it.each(cases)("survives %s", (_label, styles) => {
    expect(() => classDeclarations(styles as never, "hero")).not.toThrow();
  });

  it("treats a malformed context as styling NOTHING, not as behaviour", () => {
    /*
     * Not throwing is half the answer. The other half is what it then says: a
     * context the compiler writes no rule for is not a place the class behaves
     * differently, so it must not be counted — otherwise the row trades a crash
     * for a caveat that misdescribes the page.
     */
    const summary = classDeclarations(
      {
        base: { [BASE_BREAKPOINT]: { color: "#112233" }, md: null },
        hover: null,
      } as never,
      "hero",
      WITH_MD
    );

    expect(summary.elsewhere).toBe(0);
    // Must-be-found: the well-formed base still came through, so this is a
    // judgement about the malformed contexts beside it.
    expect(summary.shown.map(d => d.property)).toEqual(["color"]);
  });

  it("still admits the class, because repair is not this module's job", () => {
    // The guard makes the projection survive the shape; it does not make the
    // class disappear. Hiding it would lose the author the only row from which
    // they could delete or rename it.
    expect(
      usableSiteClasses([
        { id: "c1", slug: "hero", styles: { base: { base: null } } },
      ] as never)
    ).toHaveLength(1);
  });
});
