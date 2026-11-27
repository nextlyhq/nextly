import { readFileSync } from "node:fs";

import { checkPluginPackageDeclaration } from "@nextlyhq/plugin-sdk";
import { getConfiguredTestDialects } from "@nextlyhq/plugin-sdk/testing";
import { expect, it } from "vitest";

import { myPlugin } from "./index";

// package.json's `nextly` key says what this plugin needs, read as data
// without running its code. This test keeps it in step with
// what the plugin's code does: change a collection, a capability or the
// Nextly range in `plugin.ts` and the declaration must change with it.
const manifest: unknown = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

it("declares in package.json what the plugin does", () => {
  // Each difference is a sentence naming what to change. The databases this
  // suite runs on must be among the ones the declaration lists.
  expect(
    checkPluginPackageDeclaration(manifest, myPlugin(), {
      databases: getConfiguredTestDialects(),
    })
  ).toEqual([]);
});
