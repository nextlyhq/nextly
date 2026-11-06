/**
 * The sibling-field rule: which pairs of fields in one container clash, which
 * of them a change creates, and which ones configuration in code refused before
 * the rule (and so cannot already exist).
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { defineCollection } from "../../../collections/config/define-collection";
import { defineSingle } from "../../../singles/config/define-single";
import { judgeMigrationSiblingFields } from "../migrate-create/sibling-fields";
import {
  assertNoNewSiblingClashes,
  configuredSiblingClashes,
  judgeSiblingFields,
  newSiblingClashes,
  refusedConfiguredSiblingFields,
  type SiblingClash,
  siblingClashes,
  siblingClashesError,
  siblingClashWarning,
} from "../sibling-fields";

const text = (name: string) => ({ name, type: "text" });
const group = (name: string, fields: unknown[]) => ({
  name,
  type: "group",
  fields,
});
const repeater = (name: string, fields: unknown[]) => ({
  name,
  type: "repeater",
  fields,
});
const component = (name: string) => ({
  name,
  type: "component",
  component: "seo",
});
// A layout container: no name, its children stored on the level that holds it.
const row = (fields: unknown[]) => ({ type: "row", fields });

/** The clash each pair of names gives, at each kind of level. */
const PAIRS: Array<{
  a: string;
  b: string;
  kind: SiblingClash["kind"];
  column: string | null;
}> = [
  { a: "title", b: "title", kind: "same-name", column: "title" },
  { a: "Title", b: "title", kind: "same-name-ignoring-case", column: "title" },
  { a: "FOO", b: "foo", kind: "same-name-ignoring-case", column: null },
  { a: "fooBar", b: "foo_bar", kind: "same-column", column: "foo_bar" },
];

/** Each container, holding the two fields, and how a refusal names it. */
const CONTAINERS: Array<{
  label: string;
  wrap: (a: unknown, b: unknown) => unknown[];
  container: string;
  path: string[];
  topLevel: boolean;
}> = [
  {
    label: "the top level",
    wrap: (a, b) => [a, text("other"), b],
    container: "the top level",
    path: [],
    topLevel: true,
  },
  {
    label: "a group",
    wrap: (a, b) => [text("other"), group("seo", [a, b])],
    container: "group 'seo'",
    path: ["seo"],
    topLevel: false,
  },
  {
    label: "a repeater",
    wrap: (a, b) => [repeater("items", [a, text("other"), b])],
    container: "repeater 'items'",
    path: ["items"],
    topLevel: false,
  },
  {
    label: "a repeater inside a group",
    wrap: (a, b) => [group("seo", [repeater("links", [a, b])])],
    container: "repeater 'seo.links'",
    path: ["seo", "links"],
    topLevel: false,
  },
  {
    label: "a layout container beside its parent's fields",
    wrap: (a, b) => [a, row([text("other"), b])],
    container: "the top level",
    path: [],
    topLevel: true,
  },
];

describe("siblingClashes", () => {
  for (const c of CONTAINERS) {
    for (const p of PAIRS) {
      it(`finds '${p.a}' and '${p.b}' in ${c.label} (${p.kind})`, () => {
        expect(siblingClashes(c.wrap(text(p.a), text(p.b)))).toEqual([
          {
            container: c.container,
            path: c.path,
            first: p.a,
            second: p.b,
            kind: p.kind,
            // At the top level two names of one column share it; inside a
            // group or repeater the value is a key, shared only by one name.
            shared: c.topLevel
              ? p.column === null
                ? null
                : { column: p.column }
              : p.kind === "same-name"
                ? { key: p.a }
                : null,
          },
        ]);
      });
    }
  }

  it("names every pair of three clashing siblings once", () => {
    const clashes = siblingClashes([
      text("title"),
      text("Title"),
      text("TITLE"),
    ]);
    expect(clashes.map(c => [c.first, c.second])).toEqual([
      ["title", "Title"],
      ["title", "TITLE"],
      ["Title", "TITLE"],
    ]);
  });

  it("accepts one name in different containers", () => {
    const apart = [
      text("title"),
      group("seo", [text("title")]),
      repeater("a", [text("title")]),
      repeater("b", [text("title"), group("meta", [text("title")])]),
    ];
    expect(siblingClashes(apart)).toEqual([]);
    // The walk does reach each of those containers.
    expect(
      siblingClashes([...apart, text("Title")]).map(c => c.container)
    ).toEqual(["the top level"]);
    expect(
      siblingClashes([
        repeater("b", [
          text("title"),
          group("meta", [text("title"), text("title")]),
        ]),
      ]).map(c => c.container)
    ).toEqual(["group 'b.meta'"]);
  });

  it("does not take a column-less pair at the top level for one column", () => {
    expect(siblingClashes([component("fooBar"), component("foo_bar")])).toEqual(
      [
        {
          container: "the top level",
          path: [],
          first: "fooBar",
          second: "foo_bar",
          kind: "same-column",
          shared: null,
        },
      ]
    );
  });

  it("reads past a field it cannot judge", () => {
    expect(
      siblingClashes([null, 7, { type: "text" }, text("a"), text("a")])
    ).toHaveLength(1);
  });
});

describe("newSiblingClashes", () => {
  const pair = [text("fooBar"), text("foo_bar")];

  it("finds every pair new for an entity with no previous definition", () => {
    expect(newSiblingClashes(pair, null)).toEqual(siblingClashes(pair));
    expect(newSiblingClashes(pair, null)).toHaveLength(1);
  });

  it("keeps a pair the previous definition already holds", () => {
    // The pair is there; it is just not new.
    expect(siblingClashes([...pair, text("x")])).toHaveLength(1);
    expect(newSiblingClashes([...pair, text("x")], pair)).toEqual([]);
  });

  it("keeps a pair whose fields changed type", () => {
    const next = [{ name: "fooBar", type: "number" }, text("foo_bar")];
    expect(siblingClashes(next)).toHaveLength(1);
    expect(
      newSiblingClashes(
        [{ name: "fooBar", type: "number" }, text("foo_bar")],
        pair
      )
    ).toEqual([]);
  });

  it("finds the pair a field added, renamed or moved into a container creates", () => {
    const before = [text("fooBar"), text("other"), group("g", [text("a")])];
    const added = [...before, text("foo_bar")];
    const renamed = [text("fooBar"), text("foo_bar"), group("g", [text("a")])];
    const moved = [
      text("other"),
      group("g", [text("a"), text("fooBar"), text("foo_bar")]),
    ];
    for (const next of [added, renamed, moved]) {
      expect(newSiblingClashes(next, before)).toEqual(siblingClashes(next));
      expect(newSiblingClashes(next, before)).toHaveLength(1);
    }
  });

  it("finds a pair moved from one container to another new", () => {
    expect(
      newSiblingClashes(
        [group("b", [text("x"), text("x")])],
        [group("a", [text("x"), text("x")])]
      )
    ).toHaveLength(1);
  });

  it("finds a third field joining an existing pair new, for each pair it makes", () => {
    const next = [text("title"), text("Title"), text("TITLE")];
    expect(
      newSiblingClashes(next, [text("title"), text("Title")]).map(c => [
        c.first,
        c.second,
      ])
    ).toEqual([
      ["title", "TITLE"],
      ["Title", "TITLE"],
    ]);
  });
});

describe("judgeSiblingFields", () => {
  const names = (list: SiblingClash[]) =>
    list.map(c => `${c.container}: ${c.first}/${c.second}`);

  it("keeps a held pair only as often as it was held", () => {
    const judged = judgeSiblingFields(
      [group("seo", [text("title"), text("title"), text("title")])],
      [group("seo", [text("title"), text("title")])]
    );
    expect(names(judged.existing)).toEqual(["group 'seo': title/title"]);
    expect(names(judged.refused)).toEqual([
      "group 'seo': title/title",
      "group 'seo': title/title",
    ]);
  });

  it("finds a held pair new once a type change makes both fields one column", () => {
    const before = [component("fooBar"), text("foo_bar")];
    const after = [text("fooBar"), text("foo_bar")];
    expect(siblingClashes(before)[0].shared).toBeNull();
    expect(names(judgeSiblingFields(after, before).refused)).toEqual([
      "the top level: fooBar/foo_bar",
    ]);
    // The other way round the two stop sharing a column: still the pair held.
    expect(judgeSiblingFields(before, after)).toEqual({
      refused: [],
      existing: siblingClashes(before),
    });
  });

  // `define*` adds `title` and `slug` to a collection's or a Single's top level
  // only when no declared field takes their column, so one beside a sibling it
  // shares no stored value with is not a pair the author wrote.
  it("leaves a system field standing aside for a sibling that shares no value with it", () => {
    const declared = [text("title"), text("slug"), component("Title")];
    const spelled = [
      text("title"),
      text("TITLE"),
      component("Slug"),
      text("slug"),
    ];
    for (const kind of ["collection", "single"] as const) {
      expect(
        judgeSiblingFields(declared, null, { definedInCode: kind })
      ).toEqual({
        refused: [],
        existing: [],
      });
      expect(
        judgeSiblingFields(spelled, null, { definedInCode: kind }).refused
      ).toEqual([]);
    }
    // A field group has no system fields, and without `definedInCode` nothing stands aside.
    expect(
      names(
        judgeSiblingFields(declared, null, { definedInCode: "fieldGroup" })
          .refused
      )
    ).toEqual(["the top level: title/Title"]);
    expect(judgeSiblingFields(declared, null).refused).toHaveLength(1);
    // Only at the top level, and only while no stored value is shared.
    expect(
      names(
        judgeSiblingFields(
          [group("seo", [text("title"), component("Title")])],
          null,
          { definedInCode: "collection" }
        ).refused
      )
    ).toEqual(["group 'seo': title/Title"]);
    expect(
      names(
        judgeSiblingFields([text("title"), text("Title")], null, {
          definedInCode: "collection",
        }).refused
      )
    ).toEqual(["the top level: title/Title"]);
    // Only the system field `define*` adds stands aside, which has a column:
    // two column-less fields of one system name are an authored pair.
    for (const kind of ["collection", "single"] as const) {
      expect(
        names(
          judgeSiblingFields([component("title"), component("title")], null, {
            definedInCode: kind,
          }).refused
        )
      ).toEqual(["the top level: title/title"]);
      expect(
        names(
          judgeSiblingFields([component("slug"), component("Slug")], null, {
            definedInCode: kind,
          }).refused
        )
      ).toEqual(["the top level: slug/Slug"]);
    }
    // `define*` adds its text `title` beside a declared column-less `title`:
    // it stands aside there, as before the rule.
    for (const kind of ["collection", "single"] as const) {
      expect(
        judgeSiblingFields([text("title"), component("title")], null, {
          definedInCode: kind,
        })
      ).toEqual({ refused: [], existing: [] });
    }
    // Written by the author, `define*` still refuses it.
    expect(configuredSiblingClashes("collection", declared)).toHaveLength(1);
  });

  // Only a road that judges `define*` output adds no field of its own to what
  // it judges; every other road, and the default, judges a system name like
  // any other, so a sent text `title` beside a sent column-less `title` or
  // `Title` is refused there.
  it("lets no system field stand aside by default", () => {
    for (const fields of [
      [text("title"), component("title")],
      [text("title"), component("Title")],
      [text("slug"), text("SLUG")],
    ]) {
      expect(judgeSiblingFields(fields, null).refused).toHaveLength(1);
      expect(newSiblingClashes(fields, null)).toHaveLength(1);
      expect(() =>
        assertNoNewSiblingClashes(
          { kind: "collection", slug: "posts" },
          fields,
          null
        )
      ).toThrow(NextlyError);
    }
  });

  // The configuration roads judge `define*` output, which adds a text `title`
  // and `slug` beside declared fields that take neither column.
  it("accepts on the configuration roads what define* adds beside a declared column-less system name", async () => {
    const posts = defineCollection({
      slug: "posts",
      fields: [{ name: "slug", type: "text", virtual: true } as never],
    });
    const home = defineSingle({
      slug: "home",
      fields: [{ name: "title", type: "text", virtual: true } as never],
    });
    expect(siblingClashes(posts.fields).map(c => [c.first, c.second])).toEqual([
      ["slug", "slug"],
    ]);
    expect(
      await refusedConfiguredSiblingFields(
        { collections: [posts], singles: [home] },
        { collections: [], singles: [], components: [] },
        async () => false
      )
    ).toEqual([]);
    expect(
      judgeMigrationSiblingFields(
        {
          collections: [
            {
              slug: "posts",
              tableName: "dc_posts",
              fields: posts.fields,
              settings: { source: "code" },
            },
          ],
          singles: [],
          components: [],
        },
        null
      )
    ).toEqual({ refused: [], existing: [] });
    // The same fields from the Builder's manifest are not `define*` output.
    expect(
      judgeMigrationSiblingFields(
        {
          collections: [
            {
              slug: "posts",
              tableName: "dc_posts",
              fields: posts.fields,
              settings: { source: "builder" },
            },
          ],
          singles: [],
          components: [],
        },
        null
      ).refused
    ).toHaveLength(1);
  });
});

describe("configuredSiblingClashes", () => {
  // Configuration in code refused, before this rule, two names at one level
  // that differ only in case, and two column fields of a collection's or a
  // Single's top level that share a column. Only those are refused where
  // nothing says whether the entity exists yet.
  it("refuses at definition what configuration refused before", () => {
    for (const kind of ["collection", "single", "fieldGroup"] as const) {
      expect(
        configuredSiblingClashes(kind, [
          text("Title"),
          text("title"),
          group("g", [text("a"), text("A")]),
        ])
      ).toHaveLength(2);
    }
    for (const kind of ["collection", "single"] as const) {
      expect(
        configuredSiblingClashes(kind, [text("fooBar"), text("foo_bar")])
      ).toHaveLength(1);
    }
  });

  it("leaves to the roads that know the previous definition what configuration accepted", () => {
    const accepted = [
      component("fooBar"),
      component("foo_bar"),
      group("g", [text("fooBar"), text("foo_bar")]),
      repeater("r", [text("fooBar"), text("foo_bar")]),
    ];
    expect(siblingClashes(accepted)).toHaveLength(3);
    for (const kind of ["collection", "single", "fieldGroup"] as const) {
      expect(configuredSiblingClashes(kind, accepted)).toEqual([]);
    }
    expect(
      configuredSiblingClashes("fieldGroup", [text("fooBar"), text("foo_bar")])
    ).toEqual([]);
  });
});

describe("refusal and warning", () => {
  it("names the entity, the container and both fields in a refusal", () => {
    const err = siblingClashesError(
      { kind: "collection", slug: "posts" },
      siblingClashes([group("seo", [text("fooBar"), text("foo_bar")])])
    );
    expect(err).toBeInstanceOf(NextlyError);
    expect(err.publicData).toEqual({
      errors: [
        {
          path: "fields",
          code: "FIELD_NAME_DUPLICATE",
          message:
            "Collection 'posts': fields 'fooBar' and 'foo_bar' in group 'seo' would both become the column 'foo_bar'. Rename one of them.",
        },
      ],
    });
  });

  it("says why each kind of pair clashes", () => {
    const messages = (fields: unknown[]) =>
      siblingClashesError(
        { kind: "single", slug: "home" },
        siblingClashes(fields)
      ).publicData;
    expect(messages([text("a"), text("a")])).toEqual({
      errors: [
        {
          path: "fields",
          code: "FIELD_NAME_DUPLICATE",
          message:
            "Single 'home': fields 'a' and 'a' at the top level have the same name. Rename one of them.",
        },
      ],
    });
    expect(messages([text("Ab"), text("aB")])).toEqual({
      errors: [
        {
          path: "fields",
          code: "FIELD_NAME_DUPLICATE",
          message:
            "Single 'home': fields 'Ab' and 'aB' at the top level differ only in letter case. Rename one of them.",
        },
      ],
    });
  });

  it("warns about an existing pair, naming the value it shares and saying to rename one", () => {
    const [top] = siblingClashes([text("fooBar"), text("foo_bar")]);
    const [nested] = siblingClashes([group("seo", [text("x"), text("x")])]);
    const [apart] = siblingClashes([group("seo", [text("Ab"), text("aB")])]);
    const entity = { kind: "fieldGroup", slug: "hero" } as const;
    expect(siblingClashWarning(entity, top)).toBe(
      "Field group 'hero': fields 'fooBar' and 'foo_bar' at the top level already share the column 'foo_bar'. They keep working; rename one of them so each keeps its own value."
    );
    expect(siblingClashWarning(entity, nested)).toBe(
      "Field group 'hero': fields 'x' and 'x' in group 'seo' already share the key 'x'. They keep working; rename one of them so each keeps its own value."
    );
    expect(siblingClashWarning(entity, apart)).toBe(
      "Field group 'hero': fields 'Ab' and 'aB' in group 'seo' differ only in letter case. They keep working; rename one of them."
    );
  });
});
