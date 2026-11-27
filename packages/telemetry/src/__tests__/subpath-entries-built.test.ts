/**
 * The light subpaths (`@nextlyhq/telemetry/ci` and
 * `@nextlyhq/telemetry/settings-folder`) as a consumer reaches them: through
 * the package's exports map, from what the package's own build writes.
 *
 * `ci-entry.test.ts` and `settings-folder.test.ts` check the source modules.
 * This builds the package once with its real `tsdown.config.ts` into a
 * scratch `node_modules`, beside a copy of its `package.json`, and then
 * (1) imports each subpath by name in a separate Node process, so a missing
 * exports entry or build entry fails here, and (2) walks every file each
 * built entry imports, so a build that routes an entry through the bundled
 * client (posthog-node) fails here too. Package tests run after their
 * dependencies' builds but not their own, which is why the test builds
 * instead of reading `dist`.
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

import { CONF_PROJECT_NAME, CONF_PROJECT_SUFFIX } from "../constants.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The client library names itself so in the bundle, as its library id. */
const CLIENT = "posthog-node";

let scratch = "";
let installed = "";

beforeAll(async () => {
  // In the package's `.turbo`, which git and every scan of the tree ignore.
  const parent = join(packageRoot, ".turbo");
  mkdirSync(parent, { recursive: true });
  scratch = mkdtempSync(join(parent, "subpath-entries-built-"));
  // A consumer package of its own: inside this package's folder, Node would
  // otherwise resolve `@nextlyhq/telemetry` to the package itself (a
  // package may import itself by name) and test the real `dist` instead.
  writeFileSync(
    join(scratch, "package.json"),
    JSON.stringify({
      name: "subpath-entries-consumer",
      private: true,
      type: "module",
    })
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

/** Runs an ES module snippet in a separate Node process from the scratch consumer. */
function runInConsumer(code: string, env: NodeJS.ProcessEnv = process.env) {
  return execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: scratch,
    encoding: "utf8",
    env,
  });
}

/**
 * A relative import in every form a build can write: `... from "./x"`, a
 * side-effect `import "./x"`, and a dynamic `import("./x")`.
 */
const RELATIVE_IMPORT = /\b(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g;

/** Every file a built module imports, followed through relative imports. */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(RELATIVE_IMPORT)) {
      const specifier = match[1];
      if (specifier) visit(resolve(dirname(file), specifier));
    }
  };
  visit(entry);
  return [...seen];
}

/** Fails when a built entry's import graph reaches the root or the client. */
function expectLight(entryFile: string) {
  const graph = importGraph(join(installed, "dist", entryFile));
  for (const file of graph) {
    expect(file.endsWith("index.mjs")).toBe(false);
    expect(readFileSync(file, "utf8")).not.toContain(CLIENT);
  }
  return graph;
}

describe("the import walker", () => {
  it("follows every form of relative import a build can write", () => {
    const dir = join(scratch, "walker");
    mkdirSync(dir, { recursive: true });
    const files: Record<string, string> = {
      "entry.mjs": [
        'import "./side-effect.mjs";',
        'export { a } from "./re-export.mjs";',
        'const later = () => import("./dynamic.mjs");',
      ].join("\n"),
      "side-effect.mjs": "",
      "re-export.mjs": 'import { b } from "./nested.mjs";\nexport const a = b;',
      "nested.mjs": "export const b = 1;",
      "dynamic.mjs": "",
    };
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(dir, name), text);
    }
    expect(
      importGraph(join(dir, "entry.mjs"))
        .map(file => file.slice(dir.length + 1))
        .sort()
    ).toEqual(Object.keys(files).sort());
  });
});

describe("the built package root", () => {
  it("carries the client, so the searches below can find it", () => {
    expect(
      readFileSync(join(installed, "dist", "index.mjs"), "utf8")
    ).toContain(CLIENT);
  });
});

describe("the built ci entry", () => {
  it("imports by name through the exports map and answers", () => {
    const out = runInConsumer(
      `const m = await import("@nextlyhq/telemetry/ci");
       console.log(JSON.stringify({ keys: Object.keys(m),
         ci: m.detectIsCi({ CI: "1" }), local: m.detectIsCi({}) }));`
    );
    expect(JSON.parse(out)).toEqual({
      keys: ["detectIsCi"],
      ci: true,
      local: false,
    });
  });

  it("reaches neither the package root nor the client", () => {
    // The walk is live: it follows the entry into the shared chunk.
    expect(expectLight("ci.mjs").length).toBeGreaterThan(1);
  });
});

describe("the built settings-folder entry", () => {
  it("names the folder a conf store for the consent file actually uses", () => {
    // A home of its own, so neither call reads or creates anything in the
    // real one: conf creates its folder when it first reads its file.
    const home = join(scratch, "home");
    mkdirSync(home, { recursive: true });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, "AppData", "Roaming"),
      LOCALAPPDATA: join(home, "AppData", "Local"),
      XDG_CONFIG_HOME: join(home, ".config"),
    };
    const out = runInConsumer(
      `const m = await import("@nextlyhq/telemetry/settings-folder");
       const { default: Conf } = await import("conf");
       const { dirname } = await import("node:path");
       const store = new Conf({ projectName: ${JSON.stringify(CONF_PROJECT_NAME)},
         projectSuffix: ${JSON.stringify(CONF_PROJECT_SUFFIX)} });
       console.log(JSON.stringify({ keys: Object.keys(m),
         folder: m.nextlySettingsFolder(), conf: dirname(store.path) }));`,
      env
    );
    const result = JSON.parse(out) as {
      keys: string[];
      folder: string;
      conf: string;
    };
    expect(result.keys).toEqual(["nextlySettingsFolder"]);
    expect(result.folder).toBe(result.conf);
    // The isolation held: the folder is under the test's own home.
    expect(result.folder.startsWith(home)).toBe(true);
    expect(result.folder).toContain("nextly-nodejs");
  });

  it("reaches neither the package root nor the client", () => {
    // The walk is live: it follows the entry into its shared chunks.
    expect(expectLight("settings-folder.mjs").length).toBeGreaterThan(1);
  });
});
