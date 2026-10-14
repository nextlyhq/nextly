/**
 * The migration modules commerce ships are in order and sealed: versions
 * rise one module at a time to the plugin's own, and no module was edited by
 * hand. Whether they carry the whole declared schema is asked of core's own
 * generator, in `migrations-current.integration.test.ts`.
 */
import { migrationChecksum } from "@nextlyhq/plugin-sdk/schema";
import { describe, expect, it } from "vitest";

import { migrations } from "./migrations";
import { SCHEMA_VERSION } from "./tables";

function newest() {
  const last = migrations.at(-1);
  if (!last) throw new Error("commerce ships no migration module");
  return last;
}

describe("commerce's migration modules", () => {
  it("end at the schema version commerce declares, rising one module at a time", () => {
    expect(newest().schemaVersion).toBe(SCHEMA_VERSION);
    const versions = migrations.map(m => m.schemaVersion);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("are each sealed by their own checksum, so none was edited by hand", () => {
    for (const module of migrations) {
      const { checksum, ...content } = module;
      expect(migrationChecksum(content), module.name).toBe(checksum);
    }
  });
});
