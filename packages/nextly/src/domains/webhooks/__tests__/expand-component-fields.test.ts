/**
 * Expanding component references before the secret walk.
 *
 * The deny-list walk only sees inline children, so a component's own fields must
 * be grafted onto the reference or its secrets never reach the deny list.
 */
import { describe, expect, it } from "vitest";

import {
  expandComponentFields,
  type ComponentFieldResolver,
} from "../expand-component-fields";
import { sensitiveFieldNames } from "../sensitive-fields";

const resolver =
  (map: Record<string, unknown[]>): ComponentFieldResolver =>
  async slug =>
    (map[slug] as never) ?? null;

describe("expandComponentFields", () => {
  it("grafts a component's fields onto the reference so secrets are found", async () => {
    const expanded = await expandComponentFields(
      [
        { name: "title", type: "text" },
        { name: "profile", type: "component", component: "profile" },
      ],
      resolver({
        profile: [
          { name: "heading", type: "text" },
          { name: "note", type: "text", admin: { hidden: true } },
        ],
      })
    );

    // The hidden field is only discoverable after expansion.
    expect(sensitiveFieldNames(expanded)).toContain("note");
    expect(sensitiveFieldNames(expanded)).not.toContain("heading");
  });

  it("reads the stored `componentSlug` key as well as config's `component`", async () => {
    const expanded = await expandComponentFields(
      [{ name: "bio", type: "component", componentSlug: "bio" }],
      resolver({ bio: [{ name: "secretNote", type: "password" }] })
    );

    expect(sensitiveFieldNames(expanded)).toContain("secretNote");
  });

  it("terminates on a component cycle instead of recursing forever", async () => {
    // `a` embeds `b`, and `b` embeds `a` again.
    const expanded = await expandComponentFields(
      [{ name: "a", type: "component", component: "a" }],
      resolver({
        a: [
          { name: "aSecret", type: "password" },
          { name: "toB", type: "component", component: "b" },
        ],
        b: [
          { name: "bSecret", type: "password" },
          { name: "backToA", type: "component", component: "a" },
        ],
      })
    );

    const names = sensitiveFieldNames(expanded);
    expect(names).toContain("aSecret");
    expect(names).toContain("bSecret");
  });

  it("resolves each component once even when several branches reference it", async () => {
    // Resolution hits the component registry, so a repeated lookup is a repeated
    // read on the write path.
    const calls: string[] = [];
    const counting: ComponentFieldResolver = async slug => {
      calls.push(slug);
      return [{ name: `${slug}Secret`, type: "password" }];
    };

    await expandComponentFields(
      [
        { name: "a", type: "component", component: "shared" },
        { name: "b", type: "component", component: "shared" },
        {
          name: "group",
          type: "group",
          fields: [{ name: "c", type: "component", component: "shared" }],
        },
      ],
      counting
    );

    expect(calls).toEqual(["shared"]);
  });

  it("caches an unresolvable slug so it is not re-fetched", async () => {
    const calls: string[] = [];
    const missing: ComponentFieldResolver = async slug => {
      calls.push(slug);
      return null;
    };

    await expandComponentFields(
      [
        { name: "a", type: "component", component: "ghost" },
        { name: "b", type: "component", component: "ghost" },
      ],
      missing
    );

    expect(calls).toEqual(["ghost"]);
  });

  it("leaves an unresolvable reference intact rather than throwing", async () => {
    // A write must not fail because a component record is missing.
    await expect(
      expandComponentFields(
        [{ name: "ghost", type: "component", component: "missing" }],
        resolver({})
      )
    ).resolves.toHaveLength(1);
  });

  it("descends into nested containers to reach a component reference", async () => {
    const expanded = await expandComponentFields(
      [
        {
          name: "group",
          type: "group",
          fields: [{ name: "inner", type: "component", component: "inner" }],
        },
      ],
      resolver({ inner: [{ name: "innerSecret", type: "password" }] })
    );

    expect(sensitiveFieldNames(expanded)).toContain("innerSecret");
  });
});
