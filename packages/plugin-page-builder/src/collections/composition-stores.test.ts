/**
 * What the three composition stores are made of, and that the plugin serves
 * them.
 *
 * Every assertion here is written against the failure it is meant to catch
 * rather than against the happy shape, because the plausible broken versions
 * of these collections all LOAD. A blocks field with no `kinds` option accepts
 * page documents and refuses the pattern it exists to hold; a collection that
 * declares `status` without `versions` publishes on save; a collection built
 * and never contributed is simply absent at boot. None of those throws, and a
 * test that only asserted a field list would pass on all three.
 */
import { describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";

import { LAYOUT_AREAS } from "./areas";
import { COMPONENTS_SLUG, componentsCollection } from "./components";
import { LAYOUTS_SLUG, layoutsCollection } from "./layouts";
import { PATTERNS_SLUG, patternsCollection } from "./patterns";

/** A field as the collection config carries it, before any narrowing. */
interface DeclaredField {
  name?: string;
  type?: string;
  required?: boolean;
  unique?: boolean;
  options?: { value?: string }[];
  relationTo?: string | string[];
  fields?: DeclaredField[];
  blocks?: { kinds?: string[] };
  validate?: (
    value: unknown,
    args: { data: Record<string, unknown>; req: unknown }
  ) => string | true;
}

/** Every collection the plugin contributes, by slug. */
function contributedBySlug(): Map<string, { slug: string }> {
  const contributed = (pageBuilder().contributes?.collections ?? []) as {
    slug: string;
  }[];
  return new Map(contributed.map(collection => [collection.slug, collection]));
}

const fieldsOf = (collection: { fields: unknown }): DeclaredField[] =>
  collection.fields as DeclaredField[];

const named = (
  fields: DeclaredField[],
  name: string
): DeclaredField | undefined => fields.find(field => field.name === name);

describe("the composition stores reach a running site", () => {
  it("contributes patterns, components and layouts", () => {
    const bySlug = contributedBySlug();

    // The control: `pages` has always been contributed, so the three
    // assertions below are about these collections rather than about a
    // contributions list that is empty or unreadable.
    expect(bySlug.has("pages")).toBe(true);

    expect(bySlug.has(PATTERNS_SLUG)).toBe(true);
    expect(bySlug.has(COMPONENTS_SLUG)).toBe(true);
    expect(bySlug.has(LAYOUTS_SLUG)).toBe(true);
  });

  it("names the collection each entry points at, rather than spelling it", () => {
    const menu = (pageBuilder().contributes?.admin?.menu ?? []) as {
      label?: string;
      collection?: string;
    }[];
    const entry = (label: string) => menu.find(item => item.label === label);

    // Naming the collection is what makes the destination and the read gate
    // follow a host's `.rename()`. An entry that spelled the slug into `to`
    // and into `requiredPermission` would look identical on an installation
    // that renamed nothing, and would send readers to a list that does not
    // exist on one that did. Core resolves both; asserted there.
    expect(entry("Patterns")?.collection).toBe(PATTERNS_SLUG);
    expect(entry("Components")?.collection).toBe(COMPONENTS_SLUG);
    expect(entry("Layouts")?.collection).toBe(LAYOUTS_SLUG);

    // The control, and the reason the three above are not simply "every entry
    // names a collection": Pages deliberately names none, so it keeps the
    // ungated front door it has always had.
    expect(entry("Pages")?.collection).toBeUndefined();
  });
});

describe("each document store accepts only its own kind", () => {
  // The failure this catches is silent at declaration time and loud much
  // later: the blocks field defaults its `kinds` to `["page"]`, so a store
  // that forgot to name its kind refuses the first document written to it —
  // at the field validator, on a save the author has no reason to expect to
  // fail.
  // The kind comes before the factory so the two `%s` in the title take the
  // two strings. Positional interpolation reads the arguments in order, so a
  // factory in second place puts its whole source into the test's name — which
  // still passes and still fails, unreadably, and is only visible when
  // something reports a failure BY NAME.
  it.each([
    ["patterns", "pattern", patternsCollection],
    ["components", "component", componentsCollection],
  ])("%s stores %s documents", (_label, kind, build) => {
    const content = named(fieldsOf(build()), "content");

    // The control for the kinds assertion: a `content` field of the wrong
    // type, or none at all, would satisfy an assertion about `kinds` being
    // absent just as well as a correct field would.
    expect(content?.type).toBe("blocks");
    expect(content?.blocks?.kinds).toEqual([kind]);
  });

  it("layouts holds references rather than a document", () => {
    // A Layout is a set of pointers, so offering it a canvas would offer an
    // editor for content it does not have.
    expect(
      fieldsOf(layoutsCollection()).map(field => field.type)
    ).not.toContain("blocks");
  });
});

describe("every store separates saving from publishing", () => {
  // `status: true` alone resolves to a history-only collection: a save to a
  // published row goes live immediately. That is a defensible shape and it is
  // not this one — a component edit reaches every page carrying it, so the
  // draft split is what lets an author rework a header without shipping the
  // work in progress.
  it.each([
    ["patterns", patternsCollection],
    ["components", componentsCollection],
    ["layouts", layoutsCollection],
  ])("%s carries a working draft", (_label, build) => {
    const collection = build() as {
      status?: boolean;
      versions?: { drafts?: boolean };
    };

    expect(collection.status).toBe(true);
    expect(collection.versions?.drafts).toBe(true);
  });
});

describe("a Layout points at real components", () => {
  const areasField = () => named(fieldsOf(layoutsCollection()), "areas");

  it("names each area's component as a relationship to the components store", () => {
    const rowFields = areasField()?.fields ?? [];

    // Derived from the components collection rather than compared against the
    // string "components": a relationship pointing at a slug nothing declares
    // resolves to nothing, and a hand-written literal here would keep agreeing
    // with itself after the collection was renamed.
    expect(named(rowFields, "component")?.relationTo).toBe(
      componentsCollection().slug
    );
    expect(named(rowFields, "component")?.required).toBe(true);
  });

  it("holds areas as rows, so a new area costs no column", () => {
    // The shape is the claim: a `header` field beside a `footer` field would
    // pass every other assertion in this file and make the third area a
    // migration.
    expect(areasField()?.type).toBe("repeater");
    expect(
      fieldsOf(layoutsCollection()).map(field => field.name)
    ).not.toContain("header");
  });
});

describe("the area vocabulary is declared once", () => {
  const optionValues = (field: DeclaredField | undefined) =>
    (field?.options ?? []).map(option => option.value);

  it("offers the same areas on a Layout row and on a component", () => {
    const rowArea = named(
      named(fieldsOf(layoutsCollection()), "areas")?.fields ?? [],
      "area"
    );
    const componentArea = named(fieldsOf(componentsCollection()), "area");

    // Both are compared against the shared list rather than against each
    // other. Two fields that agree prove they were written together; agreeing
    // with the declaration is what survives one of them being edited alone,
    // which is the divergence that empties a picker with nothing reporting it.
    expect(optionValues(rowArea)).toEqual([...LAYOUT_AREAS]);
    expect(optionValues(componentArea)).toEqual([...LAYOUT_AREAS]);
  });
});

describe("a name identifies one row", () => {
  it.each([
    ["patterns", patternsCollection],
    ["components", componentsCollection],
    ["layouts", layoutsCollection],
  ])("%s requires a unique slug", (_label, build) => {
    const slug = named(fieldsOf(build()), "slug");

    expect(slug?.required).toBe(true);
    expect(slug?.unique).toBe(true);
  });
});

describe("a Layout fills each area once", () => {
  const validateAreas = () => {
    const areas = named(fieldsOf(layoutsCollection()), "areas");
    return areas?.validate;
  };

  it("refuses two rows claiming the same area", () => {
    // Not a cosmetic rule. An area is a POSITION, and the resolver reads the
    // rows to decide what wraps a page: two `header` rows leave it picking
    // whichever it reaches first, so the same Layout renders a different page
    // depending on iteration order. The refusal has to happen at the write —
    // once stored, nothing downstream can tell which row the author meant.
    expect(
      validateAreas()?.(
        [
          { area: "header", component: "a" },
          { area: "header", component: "b" },
        ],
        { data: {}, req: {} }
      )
    ).toBe("Two rows both fill the header area");
  });

  it("accepts one row per area", () => {
    // The control. A validator that refused everything would satisfy the
    // assertion above while making every Layout unsaveable.
    expect(
      validateAreas()?.(
        [
          { area: "header", component: "a" },
          { area: "footer", component: "b" },
        ],
        { data: {}, req: {} }
      )
    ).toBe(true);
  });

  it("says nothing about rows whose area is still unset", () => {
    // Mid-edit: a row added and not yet filled in. Two of them are not two
    // claims on one area, and reporting a collision here would refuse a save
    // for a reason the author cannot act on. The `required` on that select is
    // what speaks to an empty area.
    expect(
      validateAreas()?.([{ component: "a" }, { component: "b" }], {
        data: {},
        req: {},
      })
    ).toBe(true);
  });
});

describe("a published pattern can always be classified", () => {
  it("requires a granularity", () => {
    // The browser reads granularity to decide whether a pattern is offered as
    // something to insert or as a way to start a page. Optional, it saves and
    // publishes as null, and the row is then valid, offered nowhere, and
    // indistinguishable from one whose author simply has not answered.
    expect(named(fieldsOf(patternsCollection()), "granularity")?.required).toBe(
      true
    );
  });
});

describe("each store is listed once in the sidebar", () => {
  it.each([
    ["patterns", patternsCollection],
    ["components", componentsCollection],
    ["layouts", layoutsCollection],
  ])("%s claims plugin ownership", (_label, build) => {
    // The Collections section lists every collection claiming neither a
    // sidebar group nor plugin ownership, and this plugin's own menu lists
    // these three as well. Without the claim each store appears twice, and
    // following the plugin link lights up Collections — the sidebar
    // disagreeing with itself about where the author is.
    const collection = build() as { admin?: { isPlugin?: boolean } };

    expect(collection.admin?.isPlugin).toBe(true);
  });
});

describe("a Layout row names no variant", () => {
  it("offers no variant field", () => {
    // A component has no variants: nothing declares them, no registry lists
    // them, and the components collection carries no such field. A free-text
    // `variant` would accept every string and validate against none, and a
    // resolver could not tell one that was never built from a typo.
    const rowFields =
      named(fieldsOf(layoutsCollection()), "areas")?.fields ?? [];

    // The control: the row does carry the fields it is supposed to, so this
    // is an assertion about `variant` rather than about an empty row.
    expect(rowFields.map(field => field.name)).toEqual(["area", "component"]);
  });
});
