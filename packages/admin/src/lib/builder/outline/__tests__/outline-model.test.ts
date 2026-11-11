import { describe, expect, it } from "vitest";

import {
  nestedFixtureFieldGroups,
  nestedFixtureFields,
} from "@admin/components/features/schema-builder/__fixtures__/nested-fixture";
import type { BuilderField } from "@admin/components/features/schema-builder/types";
import type { FieldDefinition } from "@admin/types/collection";

import { convertToBuilderField } from "../../field-transformers";

import {
  buildOutline,
  containerPaths,
  describeReadOnly,
  flattenOutline,
  placementReadOnlyReason,
  visibleRows,
  type OutlineNode,
} from "../outline-model";

const typeLabel = (type: string) =>
  ({ checkbox: "Checkbox", text: "Text", textarea: "Long text" })[type] ?? type;

function outline(entityReadOnly = false): OutlineNode[] {
  return buildOutline(nestedFixtureFields(), {
    entityReadOnly,
    fieldGroups: nestedFixtureFieldGroups(),
  });
}

function byPath(nodes: OutlineNode[]): Map<string, OutlineNode> {
  return new Map(flattenOutline(nodes).map(node => [node.path, node]));
}

describe("the outline of the nested fixture", () => {
  it("has a row for every field at every depth, a field group's fields included", () => {
    const paths = flattenOutline(outline()).map(node => node.path);
    expect(paths).toEqual([
      "title",
      "summary_a",
      "summary_b",
      "internal_note",
      "show_banner",
      "banner_text",
      "legacy_code",
      "meta",
      "meta/title",
      "meta/rating",
      "sections",
      "sections/heading",
      "sections/items",
      "sections/items/cta",
      "sections/items/cta/label",
      "sections/items/cta/kind",
      "body",
      "seo",
      "seo/meta_title",
      "seo/social",
      "seo/social/handle",
    ]);
  });

  it("places the deepest field four levels down", () => {
    expect(byPath(outline()).get("sections/items/cta/label")?.level).toBe(4);
  });

  it("keeps a hidden field", () => {
    expect(byPath(outline()).get("internal_note")?.field.admin?.hidden).toBe(
      true
    );
  });

  it("says where each read-only row is defined", () => {
    const rows = byPath(outline());
    const reason = (path: string) => {
      const r = rows.get(path)?.readOnly;
      return r ? describeReadOnly(r) : null;
    };
    expect(reason("title")).toBeNull();
    expect(reason("meta/rating")).toBe("Defined by @acme/reviews");
    expect(reason("legacy_code")).toBe("Defined in code");
    expect(reason("seo")).toBeNull();
    expect(reason("seo/meta_title")).toBe("Defined in the field group SEO");
    // A field group used inside a field group names the one that defines it.
    expect(reason("seo/social/handle")).toBe(
      "Defined in the field group Social"
    );
  });

  it("makes every row of a read-only entity read-only", () => {
    const rows = flattenOutline(outline(true));
    expect(rows.every(node => node.readOnly !== null)).toBe(true);
    expect(byPath(outline(true)).get("title")?.readOnly).toEqual({
      kind: "entity",
    });
  });

  it("shows a blocks field with the number of blocks it accepts", () => {
    expect(byPath(outline()).get("body")?.blocks).toEqual({ accepted: 2 });
  });

  it("keeps two same-named fields in different containers apart", () => {
    const rows = byPath(outline());
    expect(rows.get("title")?.id).toBe("f-title");
    expect(rows.get("meta/title")?.id).toBe("f-meta-title");
  });
});

describe("a field group the outline cannot show", () => {
  const usesSelf: BuilderField = {
    id: "f-loop",
    name: "loop",
    label: "Loop",
    type: "component",
    component: "loop",
  };

  it("stops at a field group that uses itself", () => {
    const [node] = buildOutline([usesSelf], {
      entityReadOnly: false,
      fieldGroups: new Map([
        [
          "loop",
          {
            slug: "loop",
            label: "Loop",
            fields: [
              {
                name: "again",
                label: "Again",
                type: "component",
                component: "loop",
              },
            ],
          },
        ],
      ]),
    });
    const again = node.children[0];
    expect(again.path).toBe("loop/again");
    expect(again.children).toEqual([]);
    expect(again.fieldGroup?.cycle).toBe(true);
  });

  it("names a field group it has not loaded", () => {
    const [node] = buildOutline([usesSelf], {
      entityReadOnly: false,
      fieldGroups: new Map(),
    });
    expect(node.children).toEqual([]);
    expect(node.fieldGroup?.missing).toEqual(["loop"]);
  });

  it("shows each field group a field accepts, with its fields", () => {
    const [node] = buildOutline(
      [
        {
          id: "f-zone",
          name: "zone",
          label: "Zone",
          type: "component",
          components: ["seo", "social"],
        },
      ],
      { entityReadOnly: false, fieldGroups: nestedFixtureFieldGroups() }
    );
    expect(node.children.map(child => child.path)).toEqual([
      "zone/@seo",
      "zone/@social",
    ]);
    expect(node.children[1].children.map(child => child.path)).toEqual([
      "zone/@social/handle",
    ]);
  });
});

describe("the rows drawn", () => {
  it("hides what a folded container holds, and nothing else", () => {
    const rows = visibleRows(outline(), new Set(["sections"]), "", typeLabel);
    const paths = rows.map(row => row.node.path);
    expect(paths).toContain("sections");
    expect(paths).not.toContain("sections/heading");
    expect(paths).toContain("meta/rating");
    expect(rows.find(row => row.node.path === "sections")?.expanded).toBe(
      false
    );
    expect(rows.find(row => row.node.path === "meta")?.expanded).toBe(true);
    expect(
      rows.find(row => row.node.path === "title")?.expanded
    ).toBeUndefined();
  });

  it("folds every container with fold all", () => {
    const nodes = outline();
    const rows = visibleRows(
      nodes,
      new Set(containerPaths(nodes)),
      "",
      typeLabel
    );
    expect(rows.every(row => row.level === 1)).toBe(true);
  });

  it("numbers each row among its siblings", () => {
    const rows = visibleRows(outline(), new Set(), "", typeLabel);
    const rating = rows.find(row => row.node.path === "meta/rating");
    expect([rating?.posinset, rating?.setsize]).toEqual([2, 2]);
  });

  it("finds a match inside each kind of container, its ancestors unfolded", () => {
    const nodes = outline();
    const everythingFolded = new Set(containerPaths(nodes));
    const found = (query: string) =>
      visibleRows(nodes, everythingFolded, query, typeLabel)
        .filter(row => row.match)
        .map(row => row.node.path);

    // By label, inside a group inside repeating rows inside repeating rows.
    expect(found("button label")).toEqual(["sections/items/cta/label"]);
    // By name, inside a group.
    expect(found("rating")).toEqual(["meta/rating"]);
    // By name, inside a field group used inside a field group.
    expect(found("handle")).toEqual(["seo/social/handle"]);
    // By the type's plain name.
    expect(found("checkbox")).toEqual(["show_banner"]);

    const rows = visibleRows(
      nodes,
      everythingFolded,
      "button label",
      typeLabel
    );
    expect(rows.map(row => [row.node.path, row.expanded])).toEqual([
      ["sections", true],
      ["sections/items", true],
      ["sections/items/cta", true],
      ["sections/items/cta/label", undefined],
    ]);
  });
});

describe("the panel's read-only question", () => {
  it("is the outline's answer for a field inside an owned container", () => {
    const owned: BuilderField = {
      id: "f-owned",
      name: "owned",
      label: "Owned",
      type: "group",
      source: "plugin",
      owner: "@acme/x",
      fields: [],
    };
    const child: BuilderField = {
      id: "f-child",
      name: "child",
      label: "Child",
      type: "text",
    };
    expect(placementReadOnlyReason(child, [owned], false)).toEqual({
      kind: "plugin",
      owner: "@acme/x",
    });
    expect(placementReadOnlyReason(child, [], false)).toBeNull();
    expect(placementReadOnlyReason(child, [], true)).toEqual({
      kind: "entity",
    });
  });
});

describe("a field named like a built-in field", () => {
  // Loaded as the Builder loads an entity: definitions through the converter.
  const loaded = (definitions: FieldDefinition[]) =>
    definitions.map((definition, index) =>
      convertToBuilderField(definition, index)
    );

  it("shows a group's own `title`, which is not the entity's", () => {
    const nodes = buildOutline(
      loaded([
        {
          name: "meta",
          type: "group",
          label: "Meta",
          fields: [{ name: "title", type: "text", label: "Meta title" }],
        },
      ]),
      { entityReadOnly: false, fieldGroups: new Map() }
    );
    expect(flattenOutline(nodes).map(node => node.path)).toEqual([
      "meta",
      "meta/title",
    ]);
  });

  it("shows a field group's own `slug`", () => {
    const nodes = buildOutline(
      [
        {
          id: "f-ref",
          name: "ref",
          label: "Ref",
          type: "component",
          component: "card",
        },
      ],
      {
        entityReadOnly: false,
        fieldGroups: new Map([
          [
            "card",
            {
              slug: "card",
              label: "Card",
              fields: [{ name: "slug", type: "text", label: "Card slug" }],
            },
          ],
        ]),
      }
    );
    expect(flattenOutline(nodes).map(node => node.path)).toEqual([
      "ref",
      "ref/slug",
    ]);
  });

  it("leaves the entity's own top-level `title` out, as a built-in field", () => {
    const nodes = buildOutline(
      loaded([
        { name: "title", type: "text", label: "Title" },
        { name: "body", type: "text", label: "Body" },
      ]),
      { entityReadOnly: false, fieldGroups: new Map() }
    );
    expect(flattenOutline(nodes).map(node => node.path)).toEqual(["body"]);
  });
});
