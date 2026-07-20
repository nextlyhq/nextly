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
import { sensitiveFieldPaths } from "../sensitive-fields";

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
    expect(sensitiveFieldPaths(expanded)).toContain("profile.note");
    expect(sensitiveFieldPaths(expanded)).not.toContain("profile.heading");
  });

  it("reads the stored `componentSlug` key as well as config's `component`", async () => {
    const expanded = await expandComponentFields(
      [{ name: "bio", type: "component", componentSlug: "bio" }],
      resolver({ bio: [{ name: "secretNote", type: "password" }] })
    );

    expect(sensitiveFieldPaths(expanded)).toContain("bio.secretNote");
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

    const names = sensitiveFieldPaths(expanded);
    expect(names).toContain("a.aSecret");
    expect(names).toContain("a.toB.bSecret");
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

  it("expands every member of a dynamic zone, not just a single component", async () => {
    // A dynamic zone lists the component types an editor may pick from, and an
    // instance of ANY of them can be stored in the field. Reading only the
    // singular `component` key leaves all of them unexpanded, so their hidden
    // fields ship in cleartext.
    const expanded = await expandComponentFields(
      [{ name: "zone", type: "component", components: ["hero", "cta"] }],
      resolver({
        hero: [
          { name: "headline", type: "text" },
          { name: "heroToken", type: "password" },
        ],
        cta: [{ name: "ctaSecret", type: "text", admin: { hidden: true } }],
      })
    );

    const names = sensitiveFieldPaths(expanded);
    expect(names).toContain("zone.#hero.heroToken");
    expect(names).toContain("zone.#cta.ctaSecret");
    expect(names).not.toContain("zone.#hero.headline");
  });

  it("keeps expanding a dynamic zone's other members when one is self-referential", async () => {
    // The cycle guard is per-slug, so a member that embeds itself must not stop
    // its siblings from being expanded.
    const expanded = await expandComponentFields(
      [{ name: "zone", type: "component", components: ["loop", "safe"] }],
      resolver({
        loop: [
          { name: "loopSecret", type: "password" },
          { name: "again", type: "component", component: "loop" },
        ],
        safe: [{ name: "safeSecret", type: "password" }],
      })
    );

    const names = sensitiveFieldPaths(expanded);
    expect(names).toContain("zone.#loop.loopSecret");
    expect(names).toContain("zone.#safe.safeSecret");
  });

  it("keeps a dynamic zone's members apart when they share a field name", async () => {
    // `hero.title` is visible, `cta.title` is hidden. Merging both members into
    // one list collapses them onto a single `zone.title` path, which would strip
    // the visible title from every hero instance too.
    const expanded = await expandComponentFields(
      [{ name: "zone", type: "component", components: ["hero", "cta"] }],
      resolver({
        hero: [{ name: "title", type: "text" }],
        cta: [{ name: "title", type: "text", admin: { hidden: true } }],
      })
    );

    const paths = sensitiveFieldPaths(expanded);
    expect(paths).toEqual(["zone.#cta.title"]);
    // The unqualified path would apply to every member.
    expect(paths).not.toContain("zone.title");
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

    expect(sensitiveFieldPaths(expanded)).toContain("group.inner.innerSecret");
  });
});
