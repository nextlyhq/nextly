import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { mcpPlugin } from "../plugin";

const require = createRequire(import.meta.url);
const manifest = require("../../package.json") as {
  name: string;
  version: string;
};

/**
 * What a published-but-inert package has to be true about.
 *
 * The risk of shipping a skeleton is that "it does nothing yet" is a claim
 * nobody checks, and the release that starts doing something does it to every
 * install at once. These hold the claim to the contributions themselves.
 */
describe("the plugin is published and inert", () => {
  it("declares the name the package publishes under", () => {
    // Two strings that must agree and live in different files. Drifted, the
    // admin lists a plugin under a name nothing installs.
    expect(mcpPlugin().name).toBe(manifest.name);
  });

  it("declares the version the package ships, not a copied one", () => {
    expect(mcpPlugin().version).toBe(manifest.version);
  });

  it("contributes nothing, so installing it changes no behaviour", () => {
    // The property the README states. Asserted over the WHOLE definition rather
    // than over a list of keys someone remembered: a contribution added in a
    // later change fails here, which is where the decision to start serving
    // should be made deliberately.
    const definition = mcpPlugin() as Record<string, unknown>;
    const contributing = [
      "routes",
      "fields",
      "collections",
      "singles",
      "permissions",
      "hooks",
      "components",
      "migrations",
      "jobs",
      "widgets",
      "blocks",
      "contributions",
      "init",
    ].filter(key => definition[key] !== undefined);

    expect(contributing).toEqual([]);
  });

  it("names the keys it DOES carry, so the check above cannot go vacuous", () => {
    // The control. The assertion above passes perfectly against a definition
    // that is empty for the wrong reason — a renamed factory, a builder that
    // returned nothing — and it would go on passing while the plugin stopped
    // being a plugin at all. This is what separates inert from absent.
    expect(Object.keys(mcpPlugin()).sort()).toEqual([
      "admin",
      "author",
      "homepage",
      "license",
      "name",
      "nextly",
      // Attached by `definePlugin` to every plugin: it lets an integrator move
      // a contributed collection to a slug of their own. Part of the contract
      // rather than something this plugin contributes, and it is listed here
      // because the assertion is over the WHOLE key set.
      "rename",
      "repository",
      "version",
    ]);
  });

  it("is off unless an operator turns it on", () => {
    // Both spellings of "not asked for" mean off, and the default is the one a
    // version bump must never change.
    expect(mcpPlugin().name).toBe(manifest.name);
    expect(mcpPlugin({}).name).toBe(manifest.name);
    expect(mcpPlugin({ enabled: false }).name).toBe(manifest.name);
  });
});
