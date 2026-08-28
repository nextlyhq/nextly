/**
 * Whether the two class surfaces answer from one set of rules, and whether
 * those answers match what a page actually renders.
 *
 * Every case here is a way an author is shown something the renderer disagrees
 * with: a precedence the sheet does not apply, a class the compiler omitted,
 * a name that reaches a selector it cannot be written into, or a count read as
 * a measurement when it is a bound.
 *
 * @module class-library.test
 */
import { describe, expect, it } from "vitest";

import type { NamedClass } from "@nextlyhq/blocks-engine";

import {
  appliedClasses,
  applicableClasses,
  classRows,
  deletionWarning,
  filterClassRows,
  newClassRefusal,
  renameRefusal,
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

  it("reads an absent count as zero, not as unknown", () => {
    // A class no document references has no row in the index. Treating that as
    // unknown would leave every newly created class out of the unused filter —
    // the one place it most needs to appear.
    const rows = classRows(LIBRARY, { "id-hero": 3 }, []);
    expect(rows.map(r => r.documents)).toEqual([3, 0, 0]);
  });

  it("marks what the open document applies, separately from the count", () => {
    const rows = classRows(LIBRARY, {}, ["id-card"]);
    expect(rows.find(r => r.slug === "card")?.onThisPage).toBe(true);
    expect(rows.find(r => r.slug === "hero")?.onThisPage).toBe(false);
  });
});

describe("the three filters, which are three different questions", () => {
  // "Unused" asks the index; "on this page" asks the open document. A class an
  // unpublished draft applies is used and yet on no page the author has open,
  // so collapsing them would make the manager contradict the canvas.
  const rows = classRows(LIBRARY, { "id-hero": 2 }, ["id-card"]);

  it("shows everything by default", () => {
    expect(filterClassRows(rows, "all")).toHaveLength(3);
  });

  it("shows only classes no document references", () => {
    expect(filterClassRows(rows, "unused").map(r => r.slug)).toEqual([
      "badge",
      "card",
    ]);
  });

  it("shows only what the open document applies", () => {
    expect(filterClassRows(rows, "on-this-page").map(r => r.slug)).toEqual([
      "card",
    ]);
  });

  it("keeps them distinct: used site-wide is not the same as on this page", () => {
    // `card` is on this page and referenced by no document the index knows;
    // `hero` is referenced twice and on no open page. If either filter were
    // derived from the other, one of these would be wrong.
    const unused = filterClassRows(rows, "unused").map(r => r.slug);
    const here = filterClassRows(rows, "on-this-page").map(r => r.slug);
    expect(unused).toContain("card");
    expect(here).toContain("card");
    expect(unused).not.toContain("hero");
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

  it("ignores case and surrounding space, which a typed query carries", () => {
    expect(applicableClasses(LIBRARY, [], "  HERO ").map(r => r.slug)).toEqual([
      "hero",
    ]);
  });
});

describe("whether a name can become a class", () => {
  it("accepts a slug the engine can write into a selector", () => {
    expect(newClassRefusal("call-to-action", LIBRARY)).toBeNull();
  });

  it("refuses a name that is not a slug, rather than rewriting it", () => {
    // A rewritten name would be stored as a class no renderer puts on an
    // element, because the grammar here is the compiler's own.
    expect(newClassRefusal("Call To Action", LIBRARY)).toBe("not-a-slug");
    expect(newClassRefusal("-leading", LIBRARY)).toBe("not-a-slug");
  });

  it("refuses an empty name", () => {
    expect(newClassRefusal("   ", LIBRARY)).toBe("empty");
  });

  it("refuses a duplicate rather than merging it", () => {
    // Two classes with one slug emit the same selector, so the later silently
    // overrides the earlier for every node carrying it.
    expect(newClassRefusal("hero", LIBRARY)).toBe("already-taken");
  });

  it("lets a rename keep its own name, which is not a collision", () => {
    expect(renameRefusal("hero", "id-hero", LIBRARY)).toBeNull();
    expect(renameRefusal("hero", "id-card", LIBRARY)).toBe("already-taken");
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
  it("requires a confirmation naming the count when documents reference it", () => {
    expect(deletionWarning({ documents: 4 })).toEqual({
      documents: 4,
      requiresConfirmation: true,
    });
  });

  it("asks for no confirmation when nothing references it", () => {
    expect(deletionWarning({ documents: 0 })).toEqual({
      documents: 0,
      requiresConfirmation: false,
    });
  });

  it("confirms on ONE reference, since a count biased upward still warns", () => {
    // The boundary is where an over-counted class would be waved through if
    // this asked for more than one.
    expect(deletionWarning({ documents: 1 }).requiresConfirmation).toBe(true);
  });
});
