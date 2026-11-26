/**
 * The modules most commands share load no dialect's drizzle core of their own.
 *
 * A process runs on one dialect, and loading that dialect's tables loads its
 * core (`database/dialect-tables`). A module that imports a core itself brings
 * it into every process that loads the module, whichever dialect that runs on:
 * the five here, and the registry every connection installs, once brought all
 * three into nearly every command.
 *
 * What would separate a light module from a heavy one:
 * - an import of a core, however many modules away;
 * - the registry left out, so what a command does not load before it connects
 *   it loads straight after;
 * - a walk that reads nothing, which the control on a dialect's own table shows.
 */
import { describe, expect, it } from "vitest";

import { runtimeImportsOf } from "./helpers/runtime-imports";

/** The dialect cores importing `entry` loads, each with the modules that lead to it. */
async function coresOf(entry: string): Promise<Record<string, string>> {
  const { packages } = await runtimeImportsOf(entry);
  return Object.fromEntries(
    [...packages]
      .filter(([name]) => /^drizzle-orm\/(pg|mysql|sqlite)-core/.test(name))
      .map(([name, chain]) => [name, chain.join(" > ")])
  );
}

describe("a module most commands share", () => {
  it.each([
    "database/dialect-tables.ts",
    "database/schema-registry.ts",
    "domains/i18n/runtime/companion-stamp-table.ts",
    "domains/schema/services/runtime-schema-generator.ts",
    "init/retired-accounts-erasure.ts",
    "schemas/field-group-lock/index.ts",
  ])("loads no dialect's core: %s", async entry => {
    expect(await coresOf(entry)).toEqual({});
  });

  it("nor does what a connection installs, once it is open", async () => {
    expect(await coresOf("cli/utils/registry-resolver.ts")).toEqual({});
  });
});

describe("a command that needs no dialect before it connects", () => {
  it.each([
    "add",
    "clear-plaintext-passwords",
    "create-admin",
    "events",
    "generate-manifest",
    "generate-types",
    "generate-widget",
    "i18n-restore",
    "init",
    "media",
    "migrate-field-groups",
    "permissions-cleanup",
    "plugins",
    "repair-columns",
    "setup-token",
    "upgrade",
    "webhooks-prune",
    "workflow-stranded",
  ])("loads none: %s", async name => {
    expect(await coresOf(`cli/commands/${name}.ts`)).toEqual({});
  });
});

it("finds the core of a module that is one dialect's own", async () => {
  expect(Object.keys(await coresOf("schemas/users/sqlite.ts"))).toEqual([
    "drizzle-orm/sqlite-core",
  ]);
});
