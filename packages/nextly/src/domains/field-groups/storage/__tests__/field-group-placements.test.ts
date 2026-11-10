/**
 * Where a field list places field groups, at any depth.
 *
 * Each case is built so a plausible broken walk answers it differently: one that does not descend
 * misses the nested placements, one that skips presentational groups misses the field inside one,
 * one that descends into a field-group field reports what belongs to that field group's own list,
 * and one that reads only the current reference keys misses a migrated definition.
 */
import { describe, expect, it } from "vitest";

import { fieldGroupPlacements } from "../field-group-placements";

describe("fieldGroupPlacements", () => {
  it("finds a single slot at the top level as direct", () => {
    expect(
      fieldGroupPlacements([
        { name: "title", type: "text" },
        { name: "hero", type: "component", component: "hero" },
      ])
    ).toEqual([{ path: "hero", slugs: ["hero"], direct: true }]);
  });

  it("lists every field group a zone allows", () => {
    expect(
      fieldGroupPlacements([
        { name: "body", type: "component", components: ["quote", "gallery"] },
      ])
    ).toEqual([{ path: "body", slugs: ["quote", "gallery"], direct: true }]);
  });

  it("reads the migrated type and reference keys", () => {
    expect(
      fieldGroupPlacements([
        { name: "hero", type: "fieldGroup", fieldGroup: "hero" },
        { name: "body", type: "fieldGroup", fieldGroups: ["quote"] },
      ])
    ).toEqual([
      { path: "hero", slugs: ["hero"], direct: true },
      { path: "body", slugs: ["quote"], direct: true },
    ]);
  });

  it("descends named groups and repeaters, dotting the path and marking it not direct", () => {
    expect(
      fieldGroupPlacements([
        {
          name: "seo",
          type: "group",
          fields: [{ name: "card", type: "component", component: "card" }],
        },
        {
          name: "items",
          type: "repeater",
          fields: [{ name: "cta", type: "component", component: "cta" }],
        },
      ])
    ).toEqual([
      { path: "seo.card", slugs: ["card"], direct: false },
      { path: "items.cta", slugs: ["cta"], direct: false },
    ]);
  });

  it("follows containers at any depth", () => {
    expect(
      fieldGroupPlacements([
        {
          name: "a",
          type: "group",
          fields: [
            {
              name: "b",
              type: "repeater",
              fields: [
                {
                  name: "c",
                  type: "group",
                  fields: [
                    { name: "deep", type: "component", component: "deep" },
                  ],
                },
              ],
            },
          ],
        },
      ])
    ).toEqual([{ path: "a.b.c.deep", slugs: ["deep"], direct: false }]);
  });

  it("looks through a presentational group, keeping the field at the level it sits in", () => {
    expect(
      fieldGroupPlacements([
        {
          type: "group",
          label: "Layout",
          fields: [{ name: "hero", type: "component", component: "hero" }],
        },
      ])
    ).toEqual([{ path: "hero", slugs: ["hero"], direct: true }]);
  });

  it("treats a field-group field as a leaf, whatever it carries", () => {
    expect(
      fieldGroupPlacements([
        {
          name: "hero",
          type: "component",
          component: "hero",
          fields: [{ name: "inner", type: "component", component: "inner" }],
        },
      ])
    ).toEqual([{ path: "hero", slugs: ["hero"], direct: true }]);
  });

  it("leaves out a field-group field that names no field group, and fields of other types", () => {
    expect(
      fieldGroupPlacements([
        { name: "empty", type: "component" },
        { name: "author", type: "relationship", relationTo: "users" },
        { name: "notAGroup", type: "text", component: "hero" },
      ])
    ).toEqual([]);
  });

  it("ends at a named container that holds itself", () => {
    const loop: Record<string, unknown> = { name: "loop", type: "group" };
    loop.fields = [
      loop,
      { name: "hero", type: "component", component: "hero" },
    ];
    expect(fieldGroupPlacements([loop])).toEqual([
      { path: "loop.hero", slugs: ["hero"], direct: false },
    ]);
  });

  it("walks one container object at every place it is put", () => {
    const shared = {
      name: "box",
      type: "group",
      fields: [{ name: "hero", type: "component", component: "hero" }],
    };
    expect(
      fieldGroupPlacements([
        { name: "left", type: "group", fields: [shared] },
        { name: "right", type: "group", fields: [shared] },
      ])
    ).toEqual([
      { path: "left.box.hero", slugs: ["hero"], direct: false },
      { path: "right.box.hero", slugs: ["hero"], direct: false },
    ]);
  });

  it("does not read a contributed field's own `fields` option as a field list", () => {
    expect(
      fieldGroupPlacements([
        {
          name: "picker",
          type: "my-plugin-field",
          fields: [{ name: "hero", type: "component", component: "hero" }],
        },
      ])
    ).toEqual([]);
  });

  it("reaches a placement under thousands of nested groups", () => {
    // Deep enough that one stack frame per level would overflow.
    let level: Record<string, unknown> = {
      name: "hero",
      type: "component",
      component: "hero",
    };
    for (let i = 0; i < 20_000; i++) {
      level = { name: "g", type: "group", fields: [level] };
    }
    const placements = fieldGroupPlacements([level]);
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({ slugs: ["hero"], direct: false });
  });

  it("answers nothing for a value that is not a list", () => {
    expect(fieldGroupPlacements(undefined)).toEqual([]);
    expect(fieldGroupPlacements({ name: "hero" })).toEqual([]);
  });
});
