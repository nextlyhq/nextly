/**
 * The check a template meets when it is picked: every field it would add,
 * judged as a typed name is (the save's own name rule, a clash between
 * siblings in letter case or column, a name the entity's built-in fields hold)
 * and against what the Builder offers (a type the kind's picker offers, a
 * plugin's type only while the plugin is installed, a unique field only where
 * a unique value can be kept). What a template needs is read from its fields.
 */
import type { FieldTypeCatalogEntry } from "nextly/field-catalog";
import { describe, expect, it } from "vitest";

import type { BuilderConfig } from "@admin/components/features/schema-builder/builder-config";

import { COLLECTION_BUILDER_CONFIG } from "@admin/pages/dashboard/collections/builder/builder-config";
import { FIELD_GROUP_BUILDER_CONFIG } from "@admin/pages/dashboard/field-group/builder/builder-config";
import { SINGLE_BUILDER_CONFIG } from "@admin/pages/dashboard/singles/builder/builder-config";

import { BUILT_IN_TEMPLATES } from "../builtin-templates";
import { builderOfferedTypes } from "../offered-field-types";
import type {
  SchemaTemplate,
  SchemaTemplateField,
  SchemaTemplateKind,
} from "../schema-templates";
import { checkTemplate, type TemplateCheckContext } from "../template-check";

const CONFIGS = {
  collection: COLLECTION_BUILDER_CONFIG,
  single: SINGLE_BUILDER_CONFIG,
  fieldGroup: FIELD_GROUP_BUILDER_CONFIG,
} as const;

/** A plugin's field type as the admin receives it, for the picker. */
const pluginRow = (type: string): FieldTypeCatalogEntry<string> => ({
  type,
  label: type,
  category: "Advanced",
  hint: "",
  icon: "Star",
});

/** What the Builder offers a kind, with the plugin types installed. */
function offered(
  kind: SchemaTemplateKind,
  pluginTypes: readonly string[] = [],
  config: BuilderConfig = CONFIGS[kind]
): TemplateCheckContext {
  return {
    offeredTypes: builderOfferedTypes(config, pluginTypes.map(pluginRow)),
    installedTypes: new Set(pluginTypes),
  };
}

function template(
  fields: SchemaTemplateField[],
  kind: SchemaTemplateKind = "collection"
): SchemaTemplate {
  return {
    id: "t",
    kind,
    category: "Test",
    name: "Test",
    description: "",
    fields,
  };
}

const text = (name: string, extra: Partial<SchemaTemplateField> = {}) => ({
  name,
  label: name,
  type: "text",
  ...extra,
});

/** Each failure as "path rule". */
function failures(
  fields: SchemaTemplateField[],
  ctx: TemplateCheckContext = offered("collection"),
  kind: SchemaTemplateKind = "collection"
): string[] {
  return checkTemplate(template(fields, kind), ctx).failures.map(
    each => `${each.path} ${each.rule}`
  );
}

describe("the built-in templates", () => {
  it("every built-in template passes for its kind", () => {
    for (const each of BUILT_IN_TEMPLATES) {
      for (const lifecycleEnabled of [false, true]) {
        const result = checkTemplate(each, {
          ...offered(each.kind),
          lifecycleEnabled,
        });
        expect(
          result.failures,
          `${each.id} with drafts ${lifecycleEnabled ? "on" : "off"}`
        ).toEqual([]);
      }
    }
  });
});

describe("a template's names", () => {
  it("two siblings whose names differ only in letter case: each named", () => {
    // Each rule a field breaks is named: a capital is also not a name the
    // Builder's save takes.
    expect(failures([text("summary"), text("Summary")])).toEqual([
      "summary name-clash",
      "Summary invalid-name",
      "Summary name-clash",
    ]);
  });

  it("two siblings whose names become the same column", () => {
    expect(failures([text("fooBar"), text("foo_bar")])).toContain(
      "foo_bar name-clash"
    );
  });

  it("a name the entity's built-in Title already holds, at the top level only", () => {
    expect(failures([text("title")])).toEqual(["title name-clash"]);
    expect(
      failures([{ name: "meta", type: "group", fields: [text("title")] }])
    ).toEqual([]);
  });

  it("a reserved name, at any depth", () => {
    expect(failures([text("created_at")])).toEqual([
      "created_at reserved-name",
    ]);
    expect(
      failures([{ name: "meta", type: "group", fields: [text("id")] }])
    ).toEqual(["meta.id reserved-name"]);
  });

  it("a name the lifecycle holds, only while drafts are on", () => {
    expect(
      failures([text("status")], {
        ...offered("collection"),
        lifecycleEnabled: true,
      })
    ).toEqual(["status reserved-name"]);
    expect(failures([text("status")])).toEqual([]);
  });

  it("a name that is not valid", () => {
    expect(failures([text("Has Space")])).toEqual(["Has Space invalid-name"]);
  });
});

describe("a template's types", () => {
  it("a type the Builder does not offer here", () => {
    const ctx: TemplateCheckContext = {
      offeredTypes: new Set(
        [...offered("collection").offeredTypes].filter(t => t !== "json")
      ),
    };
    expect(failures([{ name: "data", type: "json" }], ctx)).toEqual([
      "data type-not-offered",
    ]);
  });

  it("a plugin's type, named while the plugin is not installed", () => {
    const rating = { name: "rating", type: "acme-rating" };
    expect(failures([rating])).toEqual(["rating plugin-type-missing"]);
    expect(failures([rating], offered("collection", ["acme-rating"]))).toEqual(
      []
    );
  });

  it("a plugin's type the kind's picker leaves out, though installed", () => {
    const config: BuilderConfig = {
      ...COLLECTION_BUILDER_CONFIG,
      picker: { excludedTypes: ["acme-rating"] },
    };
    expect(
      failures(
        [{ name: "rating", type: "acme-rating" }],
        offered("collection", ["acme-rating"], config)
      )
    ).toEqual(["rating type-not-offered"]);
  });

  it("a field the Builder's save would refuse as unfinished", () => {
    // The Builder's own preflight, which a field typed into it meets too.
    expect(
      failures([
        { name: "size", type: "select", options: [] },
        { name: "seo", type: "component" },
      ])
    ).toEqual(["size incomplete", "seo incomplete"]);
    expect(
      failures([
        { name: "size", type: "select", options: [{ label: "S", value: "s" }] },
      ])
    ).toEqual([]);
  });

  it("a unique field inside a group or repeating rows, not at the top level", () => {
    expect(failures([text("sku", { unique: true })])).toEqual([]);
    expect(
      failures([
        {
          name: "variants",
          type: "repeater",
          fields: [text("sku", { unique: true })],
        },
      ])
    ).toEqual(["variants.sku unique-in-container"]);
  });
});

describe("leaving a field out", () => {
  it("clears its failures, and those of every field inside it", () => {
    const fields: SchemaTemplateField[] = [
      text("summary"),
      text("Summary"),
      { name: "meta", type: "group", fields: [text("id")] },
    ];
    const ctx = offered("collection");
    expect(
      checkTemplate(template(fields), {
        ...ctx,
        // By each field's key, its position: Summary is second, meta third.
        leftOut: new Set(["1", "2"]),
      }).failures
    ).toEqual([]);
  });
});

describe("leaving out one of two fields of the very same name", () => {
  it("keeps the other, which then clashes with nothing", () => {
    const fields: SchemaTemplateField[] = [text("summary"), text("summary")];
    const result = checkTemplate(template(fields), offered("collection"));
    expect(result.failures.map(each => each.key)).toEqual(["0", "1"]);
    expect(
      checkTemplate(template(fields), {
        ...offered("collection"),
        leftOut: new Set(["1"]),
      }).failures
    ).toEqual([]);
  });
});

describe("what a template needs", () => {
  it("every collection a link may point at, and every field group a field may use", () => {
    const fields: SchemaTemplateField[] = [
      { name: "related", type: "relationship", relationTo: ["posts", "pages"] },
      { name: "sections", type: "component", components: ["hero", "cta"] },
    ];
    expect(
      checkTemplate(template(fields), offered("collection")).needs.map(
        need => `${need.kind} ${need.slug} ${need.path}`
      )
    ).toEqual([
      "collection posts related",
      "collection pages related",
      "fieldGroup hero sections",
      "fieldGroup cta sections",
    ]);
  });

  it("each collection a link points at and each field group a field uses", () => {
    const fields: SchemaTemplateField[] = [
      { name: "author", type: "relationship", relationTo: "authors" },
      { name: "seo", type: "component", component: "seo" },
      {
        name: "credits",
        type: "repeater",
        fields: [
          { name: "person", type: "relationship", relationTo: "people" },
        ],
      },
    ];
    const result = checkTemplate(template(fields), offered("collection"));
    expect(result.needs).toEqual([
      { kind: "collection", slug: "authors", path: "author", key: "0" },
      { kind: "fieldGroup", slug: "seo", path: "seo", key: "1" },
      {
        kind: "collection",
        slug: "people",
        path: "credits.person",
        key: "2.0",
      },
    ]);
    // A field left out needs nothing.
    expect(
      checkTemplate(template(fields), {
        ...offered("collection"),
        leftOut: new Set(["1", "2"]),
      }).needs
    ).toEqual([
      { kind: "collection", slug: "authors", path: "author", key: "0" },
    ]);
  });
});
