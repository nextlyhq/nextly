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
  newClassName,
  renamedClassName,
  siteClasses,
  withClassApplied,
  withClassRemoved,
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
    expect(rows.map(r => r.knownDocuments)).toEqual([3, 0, 0]);
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
    expect(rows.map(r => r.knownDocuments)).toEqual([0, 0]);
  });

  it("still lists such a class under the no-known-usage filter", () => {
    // The failure this guards is silent: a function is not `=== 0`, so the
    // class would vanish from the one filter that exists to surface it.
    const rows = classRows(INHERITED, {}, []);
    expect(filterClassRows(rows, "no-known-usage").map(r => r.slug)).toEqual([
      "ctor",
      "to-string",
    ]);
  });

  it("still reads an own count for such an id", () => {
    // The control for the case above: shadowing the prototype must not be
    // treated as absence, or the guard would have fixed one bug with another.
    const rows = classRows(INHERITED, { constructor: 5 }, []);
    expect(rows.find(r => r.slug === "ctor")?.knownDocuments).toBe(5);
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
    expect(rows.find(r => r.slug === "hero")?.knownDocuments).toBe(0);
    // The control: an own count on the same record is still read.
    expect(rows.find(r => r.slug === "card")?.knownDocuments).toBe(2);
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
    expect(rows.find(r => r.slug === "hero")?.knownDocuments).toBe(0);
    expect(rows.find(r => r.slug === "badge")?.knownDocuments).toBe(0);
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
    expect(filterClassRows(rows, "no-known-usage").map(r => r.slug)).toEqual([
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
    const noKnown = filterClassRows(rows, "no-known-usage").map(r => r.slug);
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
    expect(withClassApplied(["id-card"], "id-hero")).toEqual([
      "id-card",
      "id-hero",
    ]);
  });

  it("is a no-op when the node already carries it", () => {
    expect(withClassApplied(["id-hero"], "id-hero")).toEqual(["id-hero"]);
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
    expect(withClassApplied(stored, "id-card")).not.toBe(stored);
    expect(stored).toEqual(["id-hero"]);
  });
});

describe("what deleting a class costs", () => {
  it("names the count when the index knows of documents", () => {
    expect(deletionWarning({ knownDocuments: 4 })).toEqual({
      knownDocuments: 4,
      hasKnownUsage: true,
      requiresConfirmation: true,
    });
  });

  it("STILL confirms when the index knows of nothing", () => {
    // The index can under-count to zero: two saves to one document can each
    // remove the other's row, leaving a class that renders on the live site
    // with no row to say so. Zero is the one value it produces wrongly in the
    // direction that destroys data, so it is the last one to wave through.
    expect(deletionWarning({ knownDocuments: 0 })).toEqual({
      knownDocuments: 0,
      hasKnownUsage: false,
      requiresConfirmation: true,
    });
  });

  it("confirms on ONE reference, the boundary a threshold would sit at", () => {
    expect(deletionWarning({ knownDocuments: 1 }).requiresConfirmation).toBe(
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
