/**
 * The plugin's own manifest: what a site installing it gets with it.
 */
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const manifest = require("../../package.json") as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe("the plugin's manifest", () => {
  it("installs the plugin SDK with the plugin, rather than asking the site for it", () => {
    // Every module of the plugin imports the SDK at run time. As a peer, a
    // site that listed it among its devDependencies started without it in
    // production; as a dependency, it is installed wherever the plugin is.
    expect(manifest.dependencies?.["@nextlyhq/plugin-sdk"]).toBe("workspace:*");
    expect(manifest.peerDependencies?.["@nextlyhq/plugin-sdk"]).toBeUndefined();
    expect(manifest.devDependencies?.["@nextlyhq/plugin-sdk"]).toBeUndefined();
  });
});
