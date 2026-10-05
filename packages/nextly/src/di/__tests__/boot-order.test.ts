/**
 * Pending migrations run before any plugin initialises.
 *
 * This is an ORDERING property, so it is asserted by watching the sequence
 * rather than by reading the code: a comment saying "before" is exactly what
 * was there while the opposite was true.
 *
 * `record-settings-activity.ts` documented the hazard for core columns — an
 * upgraded database whose `activity_log` had not migrated, and a plugin `init`
 * inserting into a column that did not exist yet. With plugin-owned tables it
 * stops being a hazard and becomes fatal: `init` and `onReady` would query
 * tables no migration has created.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Read with node rather than through a `?raw` import: that is a bundler
// feature with no type, and `check-types` compiles this file with plain tsc.
const registerSource = readFileSync(
  fileURLToPath(new URL("../register.ts", import.meta.url)),
  "utf8"
);

describe("the boot sequence in registerServices", () => {
  /**
   * Read from the source rather than by booting a container.
   *
   * Booting one here would need a database, an adapter and a plugin set, and
   * would assert the same single fact through far more machinery. The risk of
   * a source read — that it matches a comment rather than the code — is
   * answered by anchoring on the CALL, not on the layer banner.
   */
  const migrationCall = registerSource.indexOf(
    "await runProdMigrationsIfEnabled("
  );
  const pluginCall = registerSource.indexOf("await initializePlugins(");

  it("calls both, so the comparison below has something to compare", () => {
    // The population check: two -1s would satisfy "before" perfectly.
    expect(migrationCall).toBeGreaterThan(-1);
    expect(pluginCall).toBeGreaterThan(-1);
  });

  it("runs migrations before plugins initialise", () => {
    expect(migrationCall).toBeLessThan(pluginCall);
  });

  /**
   * First-run setup runs inside `initializeSchemaRegistry` and decides what to
   * create by introspecting the ACTIVE PostgreSQL schema. Published after it,
   * a boot into a new schema introspected `public` instead — and when `public`
   * already held another installation, found its core tables there and
   * created nothing in the schema the adapter writes to.
   */
  const schemaPublication = registerSource.indexOf("setActivePostgresSchema(");
  const schemaRegistryInit = registerSource.indexOf(
    "await initializeSchemaRegistry("
  );

  it("publishes the PostgreSQL schema exactly once", () => {
    // Once, so a later second publication cannot quietly replace the value
    // first-run already acted on — and present at all, so the ordering below
    // is not satisfied by a -1.
    expect(schemaPublication).toBeGreaterThan(-1);
    expect(
      registerSource.indexOf("setActivePostgresSchema(", schemaPublication + 1)
    ).toBe(-1);
    expect(schemaRegistryInit).toBeGreaterThan(-1);
  });

  it("publishes the PostgreSQL schema before first-run setup can run", () => {
    expect(schemaPublication).toBeLessThan(schemaRegistryInit);
  });
});
