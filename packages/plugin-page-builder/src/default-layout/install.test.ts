/**
 * Which sites the installed plugin seeds a starter header and footer for:
 * only those whose header and footer it draws, from its own component store.
 *
 * A host's own store (`componentReadiness.collection`) holds the site's
 * fields, not the plugin's, so nothing is written there and the seed is an
 * empty set; the starter-seed integration test shows what each answer seeds.
 */
import { describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { DEFAULT_COMPONENT_STORE } from "../library-route";

import { installDefaultLayout } from "./install";

/** A plugin context that registers hooks and reads nothing. */
function context() {
  return {
    self: { collections: {}, singles: {} },
    hooks: { on: () => {} },
    logger: { warn: () => {} },
    db: {} as never,
    dialect: "sqlite" as const,
    services: { collections: { rewriteField: async () => ({}) as never } },
  };
}

describe("the starter the installed plugin seeds with", () => {
  it("is there for a site whose header and footer the plugin draws, from its own store", () => {
    for (const componentStore of [
      DEFAULT_COMPONENT_STORE,
      { collection: COMPONENTS_SLUG, field: "content" },
    ]) {
      const setup = installDefaultLayout(context(), {
        siteHeaderFooter: "page-builder",
        componentStore,
      });
      expect(setup.starter?.components).toBe(COMPONENTS_SLUG);
    }
  });

  it("is not there for a site that draws its own, or keeps its components in a collection of its own", () => {
    expect(
      installDefaultLayout(context(), {
        siteHeaderFooter: "code",
        componentStore: DEFAULT_COMPONENT_STORE,
      }).starter
    ).toBeUndefined();
    expect(
      installDefaultLayout(context(), {
        siteHeaderFooter: "page-builder",
        componentStore: { collection: "site_components", field: "blocks" },
      }).starter
    ).toBeUndefined();
  });
});

describe("the first-header fill the installed plugin wires", () => {
  /** The `phase collection` pairs an install registers. */
  function wired(
    siteHeaderFooter: "page-builder" | "code",
    componentStore: { collection?: string; field: string }
  ): string[] {
    const on: string[] = [];
    installDefaultLayout(
      {
        ...context(),
        hooks: {
          on: (phase: string, collection: string) =>
            on.push(`${phase} ${collection}`),
        },
      },
      { siteHeaderFooter, componentStore }
    );
    return on;
  }

  it("listens to the components the plugin stores, on the sites that get the starter", () => {
    const pairs = wired("page-builder", DEFAULT_COMPONENT_STORE);
    expect(pairs).toContain(`afterCreate ${COMPONENTS_SLUG}`);
    expect(pairs).toContain(`afterUpdate ${COMPONENTS_SLUG}`);
  });

  it("is not wired where the site draws its own, or keeps its components elsewhere", () => {
    for (const pairs of [
      wired("code", DEFAULT_COMPONENT_STORE),
      wired("page-builder", { collection: "site_components", field: "blocks" }),
    ]) {
      expect(pairs.filter(pair => pair.includes(COMPONENTS_SLUG))).toEqual([]);
      expect(pairs.filter(pair => pair.includes("site_components"))).toEqual(
        []
      );
    }
  });
});
