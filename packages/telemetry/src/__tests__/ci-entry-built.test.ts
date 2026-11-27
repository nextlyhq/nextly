/**
 * `@nextlyhq/telemetry/ci` as a consumer reaches it: through the package's
 * exports map, from what the package's own build writes.
 *
 * `ci-entry.test.ts` checks the source module. This builds the package with
 * its real `tsdown.config.ts` into a scratch `node_modules`, beside a copy of
 * its `package.json`, and then (1) imports the subpath by name in a separate
 * Node process, so a missing exports entry or build entry fails here, and
 * (2) walks every file the built entry imports, so a build that routes the
 * entry through the bundled client (posthog-node) fails here too. Package
 * tests run after their dependencies' builds but not their own, which is why
 * the test builds instead of reading `dist`.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "tsdown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The client library names itself so in the bundle, as its library id. */
const CLIENT = "posthog-node";

let scratch = "";
let installed = "";

beforeAll(async () => {
  // In the package's `.turbo`, which git and every scan of the tree ignore.
  const parent = join(packageRoot, ".turbo");
  mkdirSync(parent, { recursive: true });
  scratch = mkdtempSync(join(parent, "ci-entry-built-"));
  // A consumer package of its own: inside this package's folder, Node would
  // otherwise resolve `@nextlyhq/telemetry` to the package itself (a
  // package may import itself by name) and test the real `dist` instead.
  writeFileSync(
    join(scratch, "package.json"),
    JSON.stringify({ name: "ci-entry-consumer", private: true, type: "module" })
  );
  installed = join(scratch, "node_modules", "@nextlyhq", "telemetry");
  mkdirSync(installed, { recursive: true });
  copyFileSync(
    join(packageRoot, "package.json"),
    join(installed, "package.json")
  );
  await build({
    config: join(packageRoot, "tsdown.config.ts"),
    cwd: packageRoot,
    outDir: join(installed, "dist"),
    logLevel: "silent",
  });
}, 120_000);

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

/** Every file a built module imports, followed through relative imports. */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\bfrom\s*["'](\.[^"']+)["']/g)) {
      const specifier = match[1];
      if (specifier) visit(resolve(dirname(file), specifier));
    }
  };
  visit(entry);
  return [...seen];
}

describe("the built ci entry", () => {
  it("imports by name through the exports map and answers", () => {
    const out = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const m = await import("@nextlyhq/telemetry/ci");
         console.log(JSON.stringify({ keys: Object.keys(m),
           ci: m.detectIsCi({ CI: "1" }), local: m.detectIsCi({}) }));`,
      ],
      { cwd: scratch, encoding: "utf8" }
    );
    expect(JSON.parse(out)).toEqual({
      keys: ["detectIsCi"],
      ci: true,
      local: false,
    });
  });

  it("reaches neither the package root nor the client", () => {
    const graph = importGraph(join(installed, "dist", "ci.mjs"));
    // The walk is live: it follows the entry into the shared chunk.
    expect(graph.length).toBeGreaterThan(1);
    for (const file of graph) {
      expect(file.endsWith("index.mjs")).toBe(false);
      expect(readFileSync(file, "utf8")).not.toContain(CLIENT);
    }
    // And the root bundle does carry the client, so the search can find it.
    expect(
      readFileSync(join(installed, "dist", "index.mjs"), "utf8")
    ).toContain(CLIENT);
  });
});
