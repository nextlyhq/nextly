/**
 * `loadConfig()`'s `projectRoot` is the project the config was found in,
 * fixed before the config's own code runs. A config that changes the
 * process's directory while it loads must not move the project a later boot
 * judges, which is what resolving a relative `cwd` after the load did.
 *
 * The config file is real and found the real way; only its evaluation is
 * stood in for, since bundling it needs a dynamic import this environment
 * does not provide. The stand-in does what the config's code would: change
 * the process's directory, then hand back an empty config.
 */
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { clearConfigCache, loadConfig } from "../config-loader";

// Where the stand-in for the config's code moves the process to.
const moveTo = vi.hoisted(() => ({ dir: "" }));

vi.mock("../config-bundler", () => ({
  bundleAndRequire: async () => {
    process.chdir(moveTo.dir);
    return { mod: { default: {} }, dependencies: [] };
  },
}));

const startedIn = process.cwd();
const made: string[] = [];

afterEach(() => {
  process.chdir(startedIn);
  clearConfigCache();
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("the project root loadConfig reports", () => {
  it("is where the config was found, though the config changes the process's directory", async () => {
    // A monorepo root the CLI runs in, an app beneath it, and somewhere else
    // the config's code moves the process to.
    const root = realpathSync(mkdtempSync(join(tmpdir(), "nextly-root-")));
    const elsewhere = realpathSync(
      mkdtempSync(join(tmpdir(), "nextly-elsewhere-"))
    );
    made.push(root, elsewhere);
    const project = join(root, "apps", "site");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "nextly.config.mjs"), "export default {};\n");
    moveTo.dir = elsewhere;
    process.chdir(root);

    // Relative, as `nextly --cwd apps/site` hands it over.
    const result = await loadConfig({ cwd: "apps/site" });

    expect(process.cwd()).toBe(elsewhere);
    expect(result.projectRoot).toBe(project);
  });
});
