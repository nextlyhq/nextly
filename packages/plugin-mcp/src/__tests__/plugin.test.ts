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

  it("contributes nothing while it is off, so installing it changes nothing", () => {
    // The property the README states. Asserted over the WHOLE definition rather
    // than over a list of keys someone remembered: a contribution added in a
    // later change fails here, which is where the decision to start serving
    // should be made deliberately.
    const definition = mcpPlugin() as Record<string, unknown>;
    const contributing = [
      // The key every contribution actually travels under. Listing only the
      // individual kinds leaves the one that carries them, so a plugin that
      // began serving an endpoint would satisfy the whole list.
      "contributes",
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

  it("serves the endpoint only once an operator turns it on", () => {
    // The other half of the case above, and the one that matters now that
    // there is something to serve. `enabled` reads as a flag either way; what
    // decides whether an install answers on the protocol is whether the route
    // exists at all.
    expect(mcpPlugin().contributes).toBeUndefined();
    expect(mcpPlugin({ enabled: true }).contributes?.routes).toHaveLength(3);
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

/**
 * Which paths may name the endpoint, decided while the config is being written.
 *
 * The refusal exists to catch a path that addresses more than one URL, because
 * an endpoint reachable at many addresses is not the one address an operator
 * published. What decides that is the matcher's grammar, so what this suite
 * really holds is that the two agree: a rule stricter than the matcher refuses
 * a path that would have worked, and a rule looser than it mounts a pattern.
 */
describe("the endpoint path names one address", () => {
  const pathsOf = (path?: string) =>
    (mcpPlugin({ enabled: true, path }).contributes?.routes ?? []).map(
      route => route.path
    );

  it("serves the path it was given, so accepting one is not accepting nothing", () => {
    // Without this every acceptance below is equally satisfied by a validation
    // that returns and a plugin that then routes somewhere else entirely.
    expect(pathsOf("/agents/mcp")).toEqual([
      "/agents/mcp",
      "/agents/mcp",
      "/agents/mcp",
    ]);
  });

  it("defaults to `/mcp` when an operator names none", () => {
    expect(pathsOf()).toEqual(["/mcp", "/mcp", "/mcp"]);
  });

  it("accepts a colon inside a segment, which addresses one URL", () => {
    // A capture is a SEGMENT beginning with `:`, so `mcp:v1` is a literal and
    // the matcher will route exactly one request to it. Refusing the character
    // wherever it appeared made this validation stricter than the matcher it
    // validates for, which refuses a path that works.
    expect(pathsOf("/mcp:v1")).toEqual(["/mcp:v1", "/mcp:v1", "/mcp:v1"]);
  });

  it("still refuses a segment that IS a capture", () => {
    // The control on the case above, and the reason the check exists. Both
    // strings contain a colon; only these two make the endpoint answer at every
    // path of that shape, which is the misconfiguration worth catching early.
    expect(() => mcpPlugin({ path: "/mcp/:id" })).toThrow(/:param/);
    expect(() => mcpPlugin({ path: "/:mcp" })).toThrow(/:param/);
  });

  it("refuses a path that is not one under the mount", () => {
    // The remaining shapes, each named by what it is rather than by a shared
    // "invalid": the message is the whole remedy for an error raised while the
    // developer's own config is being evaluated.
    expect(() => mcpPlugin({ path: "mcp" })).toThrow(/must start with/);
    expect(() => mcpPlugin({ path: "/mcp/" })).toThrow(/must not end with/);
    expect(() => mcpPlugin({ path: "/" })).toThrow(/not the mount itself/);
  });

  it("refuses before the plugin exists, not when a request arrives", () => {
    // Where the refusal lands is the point of doing it here at all. Raised on
    // construction, an operator sees it on the first boot; deferred, they see a
    // 404 and have nothing to connect it to.
    expect(() => mcpPlugin({ enabled: false, path: "/mcp/:id" })).toThrow();
  });
});
