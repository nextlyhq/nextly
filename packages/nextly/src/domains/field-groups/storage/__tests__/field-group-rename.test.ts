/**
 * Which field-group fields a change removed and added, as every rename detector pairs them.
 *
 * The case that separates a name-only comparison from a correct one: a field group renamed while
 * a different field takes its old name in the same change. A site moving its own `seo` field group
 * to `legacySeo` and installing the SEO plugin, whose `seo` group lands on the same types, is that
 * change. Compared by name alone, `seo` is on both sides, so the old field group reads as kept, no
 * rename is offered, and its stored rows stay keyed `seo` where nothing reads them while
 * `legacySeo` starts empty.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { planFieldGroupRenames } from "../../../schema/migrate-create/field-group-renames";
import type { RecordedEntitySettings } from "../../../schema/migrate-create/entity-settings";
import {
  keepsFieldGroupRows,
  removedAndAddedFieldGroups,
  type RenamedFieldShape,
} from "../field-group-rename";

const oldSeo = { name: "seo", type: "component", component: "seo" };
const legacySeo = { name: "legacySeo", type: "component", component: "seo" };
// The SEO plugin's own field, as its `extend` adds it: a group stored on the parent row.
const pluginSeo = {
  name: "seo",
  type: "group",
  fields: [{ name: "title", type: "text" }],
};
const title = { name: "title", type: "text" };

const names = (fields: RenamedFieldShape[]) => fields.map(f => f.name);

describe("removedAndAddedFieldGroups", () => {
  it("counts a field group as removed when its name now holds a field of another kind", () => {
    const { oldOnly, newOnly } = removedAndAddedFieldGroups(
      [title, oldSeo],
      [title, legacySeo, pluginSeo]
    );
    expect(oldOnly).toEqual([oldSeo]);
    // The plugin's group is not a field group, so it holds no rows to pair.
    expect(newOnly).toEqual([legacySeo]);
  });

  it("counts both sides when the name now holds a field group of another group", () => {
    const otherGroup = { name: "seo", type: "component", component: "seo_v2" };
    const { oldOnly, newOnly } = removedAndAddedFieldGroups(
      [oldSeo],
      [legacySeo, otherGroup]
    );
    expect(oldOnly).toEqual([oldSeo]);
    expect(newOnly).toEqual([legacySeo, otherGroup]);
    // The same-name pair itself never keeps its rows, so no detector offers it.
    expect(keepsFieldGroupRows(oldSeo, otherGroup)).toBe(false);
  });

  it("counts both sides when the name changes cardinality", () => {
    const repeated = { ...oldSeo, repeatable: true };
    const { oldOnly, newOnly } = removedAndAddedFieldGroups(
      [oldSeo],
      [repeated]
    );
    expect(oldOnly).toEqual([oldSeo]);
    expect(newOnly).toEqual([repeated]);
  });

  it("leaves out a field group kept under its name, a reordered zone list included", () => {
    const zone = {
      name: "layout",
      type: "component",
      components: ["hero", "cta"],
      repeatable: true,
    };
    const reordered = { ...zone, components: ["cta", "hero"] };
    const { oldOnly, newOnly } = removedAndAddedFieldGroups(
      [oldSeo, zone, title],
      [{ ...oldSeo, label: "SEO" }, reordered, title]
    );
    expect(oldOnly).toEqual([]);
    expect(newOnly).toEqual([]);
  });

  it("adds a field group that takes the name of a field of another kind", () => {
    const { oldOnly, newOnly } = removedAndAddedFieldGroups(
      [{ name: "bio", type: "text" }],
      [{ name: "bio", type: "component", component: "seo" }]
    );
    expect(oldOnly).toEqual([]);
    expect(names(newOnly)).toEqual(["bio"]);
  });
});

describe("migrate:create's field-group renames", () => {
  const record = (fields: object[]): RecordedEntitySettings => ({
    source: "code",
    settings: { slug: "posts", fields } as never,
  });

  async function plan(before: object[], after: object[]) {
    const asked: string[] = [];
    const result = await planFieldGroupRenames({
      entities: [
        {
          kind: "collection",
          entity: {
            slug: "posts",
            tableName: "dc_posts",
            settings: record(after),
          },
        },
      ],
      previous: {
        collections: { posts: record(before) },
        singles: {},
        fieldGroups: {},
      },
      groupTables: new Map([
        ["seo", "comp_seo"],
        ["seo_v2", "comp_seo_v2"],
      ]),
      dialect: "postgresql",
      decide: async candidates => {
        asked.push(...candidates.map(c => `${c.fromColumn}->${c.toColumn}`));
        return candidates.map(candidate => ({ candidate, accepted: true }));
      },
    });
    return { asked, result };
  }

  it("offers the rename when the plugin's group takes the old name", async () => {
    const { asked, result } = await plan(
      [title, oldSeo],
      [title, legacySeo, pluginSeo]
    );
    expect(asked).toEqual(["seo->legacySeo"]);
    expect(result.up).toHaveLength(1);
    expect(result.up[0]).toContain(`SET "_parent_field" = 'legacySeo'`);
    expect(result.up[0]).toContain(`WHERE "_parent_field" = 'seo'`);
    expect(result.down[0]).toContain(`SET "_parent_field" = 'seo'`);
  });

  it("never offers a field renamed to its own name", async () => {
    const otherGroup = { name: "seo", type: "component", component: "seo_v2" };
    const { asked } = await plan([oldSeo], [legacySeo, otherGroup]);
    expect(asked).toEqual(["seo->legacySeo"]);
  });
});

describe("the Schema Builder's field-group rename", () => {
  const service = new DynamicCollectionSchemaService(undefined, "postgresql");
  const asFields = (fields: object[]) => fields as unknown as FieldDefinition[];

  it("pairs the renamed field group when the plugin's group takes the old name", () => {
    const rename = service.detectFieldGroupAssociationRename(
      asFields([title, oldSeo]),
      asFields([title, legacySeo, pluginSeo])
    );
    expect(rename?.from.name).toBe("seo");
    expect(rename?.to.name).toBe("legacySeo");
  });

  it("pairs the renamed field group when a field group of another group takes the old name", () => {
    const otherGroup = { name: "seo", type: "component", component: "seo_v2" };
    const rename = service.detectFieldGroupAssociationRename(
      asFields([oldSeo]),
      asFields([legacySeo, otherGroup])
    );
    expect(rename?.from).toEqual(oldSeo);
    expect(rename?.to).toEqual(legacySeo);
  });

  it("finds no rename in a field group that only changed its group", () => {
    const otherGroup = { name: "seo", type: "component", component: "seo_v2" };
    expect(
      service.detectFieldGroupAssociationRename(
        asFields([oldSeo]),
        asFields([otherGroup])
      )
    ).toBeNull();
  });
});
