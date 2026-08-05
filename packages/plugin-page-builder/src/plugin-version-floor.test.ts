/**
 * The declared core floor has to be satisfiable by the core in this workspace.
 *
 * A floor naming a version that has not been released yet passes review and
 * type-checking and then fails every boot: `validatePluginVersions` compares it
 * against the running core, which in the source tree is the CURRENT version, so
 * each `createTestNextly({ plugins: [pageBuilder()] })` throws `core-incompatible`
 * before any assertion runs. The APIs a plugin needs land in the same release as
 * the plugin build that first calls them, so the version to name is never known
 * while the change is being written — which is why the floor is derived from
 * this package's own version rather than written out.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { pageBuilder } from "./plugin";

const here = dirname(fileURLToPath(import.meta.url));

function manifestVersion(pkg: string): string {
  const path = join(here, "..", "..", pkg, "package.json");
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    typeof parsed.version !== "string"
  ) {
    throw new Error(`${pkg}/package.json has no string version`);
  }
  return parsed.version;
}

describe("the declared core floor", () => {
  it("is derived from this package's version, not a literal", () => {
    // A literal is what breaks: it can only name a released version, and the
    // release carrying the APIs is the one this build ships in.
    expect(pageBuilder().nextly).toBe(
      `>=${manifestVersion("plugin-page-builder")}`
    );
  });

  it("is satisfied by the core this workspace builds against", () => {
    // Every published package versions in lockstep, so the derived floor and
    // the running core are the same version and the comparison holds. Asserted
    // rather than assumed: if that ever drifts, the floor stops being
    // satisfiable and every boot of this plugin fails at once.
    expect(manifestVersion("nextly")).toBe(
      manifestVersion("plugin-page-builder")
    );
  });
});
