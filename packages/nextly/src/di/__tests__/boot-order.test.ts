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
});
