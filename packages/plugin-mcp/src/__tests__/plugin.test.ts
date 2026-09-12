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
      // A contract field, not a contribution: it says whether this plugin
      // runs, not what it adds.
      "enabled",
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
    // Asserted on `enabled` itself. Reading the name instead passes for a
    // definition that resolved the option and dropped it, and core reads an
    // OMITTED `enabled` as ENABLED — so the assertion that looks like it
    // covers the default is the one that cannot see it being wrong.
    expect(mcpPlugin().enabled).toBe(false);
    expect(mcpPlugin({}).enabled).toBe(false);
    expect(mcpPlugin({ enabled: false }).enabled).toBe(false);
  });

  it("is on when an operator asks for it, which is what makes off a choice", () => {
    // The control. `enabled: false` on every path satisfies the case above and
    // would leave the option inert once the transport lands.
    expect(mcpPlugin({ enabled: true }).enabled).toBe(true);
  });

  it("reports as disabled through the rule core actually applies", () => {
    // Core decides with `plugin.enabled !== false`, so a definition that omits
    // the field reports as ENABLED. That is the shape this package must not
    // ship, and asserting the boolean alone does not say so.
    const asCoreReads = (p: { enabled?: boolean }) => p.enabled !== false;

    expect(asCoreReads(mcpPlugin())).toBe(false);
    expect(asCoreReads(mcpPlugin({ enabled: true }))).toBe(true);
  });
});
