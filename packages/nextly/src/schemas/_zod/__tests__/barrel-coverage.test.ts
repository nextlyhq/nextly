/**
 * Barrel coverage guard for the Zod schema modules.
 *
 * `nextly/schemas` is the only entry point that exposes these validators, and
 * it reaches them solely through `_zod/index.ts`. A module that is not
 * re-exported there is unreachable from outside the package while still
 * compiling, passing its own unit tests and looking finished in review — the
 * failure only surfaces when route code tries to import it.
 *
 * The check is structural rather than a hand-written list, so adding a module
 * cannot pass by forgetting to update the list too.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ZOD_DIR = join(__dirname, "..");

/** Every schema module in the directory, by import specifier. */
function schemaModules(): string[] {
  return readdirSync(ZOD_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(
      name =>
        name.endsWith(".ts") &&
        name !== "index.ts" &&
        // Colocated runtime and type tests are not part of the public surface.
        !name.endsWith(".test.ts") &&
        !name.endsWith(".test-d.ts")
    )
    .map(name => name.slice(0, -".ts".length));
}

describe("_zod barrel coverage", () => {
  it("re-exports every schema module", () => {
    const barrel = readFileSync(join(ZOD_DIR, "index.ts"), "utf-8");
    const modules = schemaModules();

    // A directory that reads as empty would make every assertion below vacuous.
    expect(modules.length).toBeGreaterThan(0);

    const missing = modules.filter(
      name => !new RegExp(`export \\* from "\\./${name}"`).test(barrel)
    );

    expect(missing).toEqual([]);
  });
});
