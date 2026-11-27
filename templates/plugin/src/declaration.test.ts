import { readFileSync } from "node:fs";

import { checkPluginPackageDeclaration } from "@nextlyhq/plugin-sdk";
import { getConfiguredTestDialects } from "@nextlyhq/plugin-sdk/testing";
import { expect, it } from "vitest";

import * as entry from "./index";

// package.json's `nextly` key says what this plugin needs, read as data
// without running its code. This test keeps it in step with what the code
// does: change a collection, a capability, the Nextly range or the export in
// `plugin.ts` and `index.ts`, and the declaration must change with it.
const manifest: unknown = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

it("declares in package.json what the plugin does", () => {
  // Each difference is a sentence naming what to change. `databases` are the
  // ones `plugin.test.ts` boots the plugin on, which the declaration must
  // list; `exports` lets the check find the export the registration names.
  expect(
    checkPluginPackageDeclaration(manifest, entry.myPlugin(), {
      databases: getConfiguredTestDialects(),
      exports: entry,
    })
  ).toEqual([]);
});
