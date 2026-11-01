/**
 * Cache Components and Partial Prefetching on in every app this CLI touches,
 * with Nextly's cache handlers beside them: Nextly runs with both on.
 *
 * A new project's config says so outright. An existing app it adds Nextly to
 * is changed the same way, with a notice, whether the options were off,
 * missing, or turned off by an earlier Nextly release. A config it cannot
 * read or change safely is left exactly as it was, with the lines to add.
 * Each case writes a real config into a temporary directory and reads back
 * what was left there; the JavaScript ones are also loaded, as Next.js loads
 * them, so `require` is shown to resolve the handlers.
 */
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildNextConfigTemplate,
  CACHE_COMPONENTS_DOCS_URL,
  cacheComponentsFiles,
  patchNextConfig,
  turnOnCacheComponents,
} from "../generators/next-config";
import type { DatabaseConfig } from "../types";

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

/** The handler lines, as every config Nextly writes or extends carries them. */
const HANDLERS = `  cacheHandler: require.resolve("nextly/cache-handler"),
  cacheMaxMemorySize: 0,
  cacheHandlers: { default: require.resolve("nextly/cache-handlers") },
`;

/** What an ES module config is told to put at its top, before the config lines. */
const REQUIRE_SETUP = `// At the top of the file:
import { createRequire } from "node:module";
// Resolves Nextly's cache handlers from this app's node_modules.
const require = createRequire(import.meta.url);

// In the config object:
`;

/** `create-next-app` 16.4's TypeScript config with its defaults, both on. */
const CREATE_NEXT_APP_CONFIG = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
`;

/** The config an earlier Nextly release left: Cache Components turned off, Partial Prefetching removed. */
const TURNED_OFF_CONFIG = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Off by default in a Nextly app. Turning it on takes a "use cache" read
  // function of the app's own and Nextly's cache handlers:
  // https://nextlyhq.com/docs/getting-started/installation#cache-components
  cacheComponents: false,
  serverExternalPackages: ["nextly"],
};

export default nextConfig;
`;

let dir: string;
beforeEach(async () => {
  // Real, as Node's resolver answers with it: macOS links the temp folder.
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "cache-components-")));
  // A stand-in `nextly` with the two handler subpaths, so a loaded config's
  // `require.resolve` finds them where an app's node_modules would.
  const nextly = path.join(dir, "node_modules/nextly");
  await mkdir(nextly, { recursive: true });
  await writeFile(
    path.join(nextly, "package.json"),
    JSON.stringify({
      name: "nextly",
      exports: {
        "./cache-handler": { default: "./cache-handler.mjs" },
        "./cache-handlers": { default: "./cache-handlers.mjs" },
      },
    }),
    "utf-8"
  );
  await writeFile(path.join(nextly, "cache-handler.mjs"), "export {};\n");
  await writeFile(path.join(nextly, "cache-handlers.mjs"), "export {};\n");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const write = (name: string, text: string) =>
  writeFile(path.join(dir, name), text, "utf-8");
const read = (name: string) => readFile(path.join(dir, name), "utf-8");

/** The config a JavaScript file exports, loaded the way Next.js loads it. */
async function load(name: string): Promise<Record<string, unknown>> {
  const module = (await import(pathToFileURL(path.join(dir, name)).href)) as {
    default: Record<string, unknown>;
  };
  return module.default;
}

/** Whether a loaded config installs the stand-in's handlers by absolute path. */
function expectNextlyHandlers(config: Record<string, unknown>) {
  expect(config.cacheHandler).toBe(
    path.join(dir, "node_modules/nextly/cache-handler.mjs")
  );
  expect(config.cacheMaxMemorySize).toBe(0);
  expect(config.cacheHandlers).toEqual({
    default: path.join(dir, "node_modules/nextly/cache-handlers.mjs"),
  });
}

describe("a new project's Next config", () => {
  it("turns both options on, installs Nextly's cache handlers, and says why", () => {
    const text = buildNextConfigTemplate(sqlite);
    expect(text).toContain(
      `  cacheComponents: true,\n  partialPrefetching: true,\n${HANDLERS}`
    );
    expect(text).toMatch(
      /Nextly runs with Cache Components and Partial Prefetching on/
    );
    expect(text).not.toMatch(/cacheComponents: false/);
  });

  it("installs exactly the settings nextly's warning tells an app without them to add", async () => {
    // The settings a new project gets, as the generator writes them.
    const written = buildNextConfigTemplate(sqlite)
      .split("\n")
      .map(line => line.trim().replace(/,$/, ""))
      .filter(line => /^cache(Handler|MaxMemorySize|Handlers):/.test(line));
    expect(written).toHaveLength(3);

    // nextly's warning, as nextly says it in production without the handlers.
    const nextly = path.join(__dirname, "../../../nextly/src");
    const logger = await import(path.join(nextly, "observability/logger.ts"));
    const shared = await import(
      path.join(nextly, "runtime/cache/shared-handlers.ts")
    );
    const warn = vi.fn();
    const ignore = () => undefined;
    logger.setNextlyLogger({
      warn,
      error: ignore,
      info: ignore,
      debug: ignore,
    });
    vi.stubEnv("NODE_ENV", "production");
    const global = globalThis as Record<string, unknown>;
    delete global.__nextly_unshared_reads_warned;
    delete global.__nextly_incremental_handler_in_use;
    try {
      shared.noteCachedRead(false);
      const message = String(warn.mock.calls[0]?.[0]?.message);
      for (const line of written) expect(message).toContain(line);
      expect(message).toContain(CACHE_COMPONENTS_DOCS_URL);
    } finally {
      vi.unstubAllEnvs();
      logger.setNextlyLogger(undefined);
      delete global.__nextly_unshared_reads_warned;
    }
  });

  it("is what an existing app with no config gets too, and loads without TypeScript", async () => {
    await patchNextConfig(dir, sqlite);
    const text = await read("next.config.mjs");
    expect(text).toContain(
      `  cacheComponents: true,\n  partialPrefetching: true,\n${HANDLERS}`
    );
    // An ES module has no `require` of its own: the file defines it.
    const config = await load("next.config.mjs");
    expect(config.cacheComponents).toBe(true);
    expect(config.partialPrefetching).toBe(true);
    expectNextlyHandlers(config);
  });

  it("leaves nothing for the existing-app step to change", async () => {
    await write("tsconfig.json", "{}\n");
    await patchNextConfig(dir, sqlite);
    const before = await read("next.config.ts");

    const result = await turnOnCacheComponents(dir);

    expect(result).toEqual({
      kind: "unchanged",
      file: "next.config.ts",
      handlers: "present",
    });
    expect(await read("next.config.ts")).toBe(before);
  });
});

describe("an existing app with both options on", () => {
  it("adds Nextly's cache handlers and keeps the rest of the config", async () => {
    await write("next.config.ts", CREATE_NEXT_APP_CONFIG);

    const result = await turnOnCacheComponents(dir);

    expect(result).toEqual({
      kind: "turned-on",
      file: "next.config.ts",
      turnedOn: [],
      handlers: "added",
    });
    expect(await read("next.config.ts"))
      .toBe(`import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
${HANDLERS}};

export default nextConfig;
`);
  });

  it("changes nothing a second time", async () => {
    await write("next.config.ts", CREATE_NEXT_APP_CONFIG);
    await turnOnCacheComponents(dir);
    const once = await read("next.config.ts");

    expect((await turnOnCacheComponents(dir)).kind).toBe("unchanged");
    expect(await read("next.config.ts")).toBe(once);
  });
});

describe("an existing app with an option off or missing", () => {
  it("turns an app an earlier Nextly release turned off back on", async () => {
    await write("next.config.ts", TURNED_OFF_CONFIG);

    const result = await turnOnCacheComponents(dir);

    expect(result).toMatchObject({
      kind: "turned-on",
      turnedOn: ["cacheComponents", "partialPrefetching"],
      handlers: "added",
    });
    const text = await read("next.config.ts");
    expect(text).toMatch(/^ {2}cacheComponents: true,$/m);
    expect(text).toContain(
      `  serverExternalPackages: ["nextly"],\n  partialPrefetching: true,\n${HANDLERS}};`
    );
    expect(text).not.toMatch(/cacheComponents: false/);
  });

  it("puts a comma after a last property written without one", async () => {
    await write(
      "next.config.js",
      "module.exports = {\n  reactStrictMode: true\n};\n"
    );

    await turnOnCacheComponents(dir);

    expect(await read("next.config.js")).toBe(
      `module.exports = {\n  reactStrictMode: true,\n  cacheComponents: true,\n  partialPrefetching: true,\n${HANDLERS}};\n`
    );
  });

  it("turns on only the option that is off", async () => {
    await write(
      "next.config.mjs",
      "export default {\n  cacheComponents: true,\n  partialPrefetching: false,\n};\n"
    );

    const result = await turnOnCacheComponents(dir);

    expect(result).toMatchObject({
      kind: "turned-on",
      turnedOn: ["partialPrefetching"],
    });
    const config = await load("next.config.mjs");
    expect(config.cacheComponents).toBe(true);
    expect(config.partialPrefetching).toBe(true);
  });

  it("adds both to a config that sets neither, written on one line", async () => {
    await write(
      "next.config.js",
      "module.exports = { reactStrictMode: true };\n"
    );

    const result = await turnOnCacheComponents(dir);

    expect(result).toMatchObject({
      kind: "turned-on",
      turnedOn: ["cacheComponents", "partialPrefetching"],
      handlers: "added",
    });
    // CommonJS has `require`, so nothing defines it again.
    const text = await read("next.config.js");
    expect(text).not.toMatch(/createRequire/);
    expect(text).toBe(
      'module.exports = { reactStrictMode: true, cacheComponents: true, partialPrefetching: true, cacheHandler: require.resolve("nextly/cache-handler"), cacheMaxMemorySize: 0, cacheHandlers: { default: require.resolve("nextly/cache-handlers") } };\n'
    );
    const config = await load("next.config.js");
    expect(config.reactStrictMode).toBe(true);
    expectNextlyHandlers(config);
  });

  it("gives an ES module config `require` before the config, and it loads", async () => {
    await write(
      "next.config.mjs",
      'import path from "node:path";\n\nexport default {\n  basePath: path.posix.join("/", "site"),\n  cacheComponents: false,\n};\n'
    );

    const result = await turnOnCacheComponents(dir);

    expect(result).toMatchObject({ kind: "turned-on", handlers: "added" });
    const text = await read("next.config.mjs");
    expect(text).toMatch(
      /^import path from "node:path";\n\nimport \{ createRequire \} from "node:module";\n\n\/\/ .*\nconst require = createRequire\(import\.meta\.url\);\n\nexport default \{/
    );
    const config = await load("next.config.mjs");
    expect(config.basePath).toBe("/site");
    expect(config.cacheComponents).toBe(true);
    expect(config.partialPrefetching).toBe(true);
    expectNextlyHandlers(config);
  });

  // Imports are hoisted and the declaration is not: placed after an import
  // written below the config, `require.resolve` would run before it exists.
  it("defines `require` above the config when an import comes after it, keeping the config's annotation", async () => {
    await write(
      "next.config.mjs",
      '/** @type {import("next").NextConfig} */\nconst nextConfig = { cacheComponents: true };\n\nexport default nextConfig;\n\nimport "node:path";\n'
    );

    await turnOnCacheComponents(dir);

    // Loaded first: placed wrongly, this is what throws.
    const config = await load("next.config.mjs");
    expect(config.partialPrefetching).toBe(true);
    expectNextlyHandlers(config);
    const text = await read("next.config.mjs");
    expect(text).toMatch(
      /^import \{ createRequire \} from "node:module";\n\n\/\/ .*\nconst require = createRequire\(import\.meta\.url\);\n\n\/\*\* @type \{import\("next"\)\.NextConfig\} \*\/\nconst nextConfig = \{/
    );
  });

  it("says what it changed, why, and where it is explained", async () => {
    await write("next.config.ts", TURNED_OFF_CONFIG);

    const files = cacheComponentsFiles(await turnOnCacheComponents(dir));

    expect(files.changed).toEqual([
      {
        path: "next.config.ts",
        added: [
          "cacheComponents: true",
          "partialPrefetching: true",
          "cacheHandler",
          "cacheMaxMemorySize",
          "cacheHandlers",
        ],
      },
    ]);
    expect(files.skipped).toEqual([]);
    expect(files.notices?.join("\n")).toMatch(
      /In next\.config\.ts, turned cacheComponents and partialPrefetching on and installed Nextly's cache handlers: Nextly runs with Cache Components and Partial Prefetching on\..*nextlyhq\.com\/docs\/getting-started\/installation#cache-components/s
    );
  });
});

describe("an existing app with a cache of its own", () => {
  it("turns the options on, keeps its handler, and says what Nextly's would add", async () => {
    const config = 'export default {\n  cacheHandler: "./my-cache.mjs",\n};\n';
    await write("next.config.mjs", config);

    const patch = await turnOnCacheComponents(dir);
    const files = cacheComponentsFiles(patch);

    const text = await read("next.config.mjs");
    expect(text).toContain('cacheHandler: "./my-cache.mjs"');
    expect(text).toMatch(/cacheComponents: true/);
    expect(text).not.toMatch(/nextly\/cache-handler/);
    expect(files.skipped).toHaveLength(1);
    expect(files.skipped[0]?.why).toMatch(
      /has cache handlers of its own \(cacheHandler\)/
    );
    expect(files.skipped[0]?.why).toMatch(/in place of the config's own/);
    // An ES module: the lines need `require`, so the report says how to define it.
    expect(files.skipped[0]?.toAdd).toBe(REQUIRE_SETUP + HANDLERS.trimEnd());
  });

  // Next.js documents `cacheMaxMemorySize: 0` as the step before adding a
  // handler, so on its own it is no cache of the app's own.
  it("adds the handlers beside a `cacheMaxMemorySize: 0` already there, without repeating it", async () => {
    await write(
      "next.config.js",
      "module.exports = {\n  cacheMaxMemorySize: 0,\n};\n"
    );

    const patch = await turnOnCacheComponents(dir);

    expect(patch).toMatchObject({ kind: "turned-on", handlers: "added" });
    const text = await read("next.config.js");
    expect(text.match(/cacheMaxMemorySize/g)).toHaveLength(1);
    expectNextlyHandlers(await load("next.config.js"));
  });

  it.each([
    [
      "a cacheMaxMemorySize other than 0",
      "module.exports = {\n  cacheMaxMemorySize: 52428800,\n};\n",
      /cacheMaxMemorySize to a value other than 0/,
    ],
    [
      "a handler written as undefined",
      "module.exports = {\n  cacheHandler: undefined,\n  cacheMaxMemorySize: 0,\n  cacheHandlers: undefined,\n};\n",
      /sets cacheHandler, cacheHandlers to undefined/,
    ],
  ])(
    "leaves the handlers out of a config with %s, and prints them",
    async (_, config, reason) => {
      await write("next.config.js", config);

      const patch = await turnOnCacheComponents(dir);
      const files = cacheComponentsFiles(patch);

      expect(patch).toMatchObject({ kind: "turned-on" });
      expect(await read("next.config.js")).not.toMatch(/nextly\/cache-handler/);
      expect(files.skipped).toHaveLength(1);
      expect(files.skipped[0]?.why).toMatch(reason);
      // CommonJS has `require`: only the config lines are printed.
      expect(files.skipped[0]?.toAdd).toBe(HANDLERS.trimEnd());
    }
  );

  // Under any name it was imported by: only the declaration is added, so the
  // file never imports `createRequire` twice.
  it.each([
    ['import { createRequire } from "node:module";', "createRequire"],
    [
      'import { createRequire as makeRequire } from "node:module";',
      "makeRequire",
    ],
  ])(
    "uses the file's own `createRequire` (%s) to define `require`, and it loads",
    async (imported, name) => {
      await write(
        "next.config.mjs",
        `${imported}\nconst load = ${name}(import.meta.url);\nexport default { env: { HANDLER: load.resolve("nextly/cache-handler") } };\n`
      );

      const patch = await turnOnCacheComponents(dir);

      expect(patch).toMatchObject({ kind: "turned-on", handlers: "added" });
      const text = await read("next.config.mjs");
      expect(text.match(/from "node:module"/g)).toHaveLength(1);
      expect(text).toContain(`const require = ${name}(import.meta.url);`);
      expectNextlyHandlers(await load("next.config.mjs"));
    }
  );

  it("prints the handlers rather than writing them where `require` is declared after the config object", async () => {
    // Written into the object, `require.resolve` would run while the
    // declaration below it is still in its temporal dead zone, and the config
    // would throw as Next.js loads it.
    await write(
      "next.config.mjs",
      'import { createRequire } from "node:module";\nconst nextConfig = { reactStrictMode: true };\nconst require = createRequire(import.meta.url);\nexport default nextConfig;\n'
    );

    const patch = await turnOnCacheComponents(dir);
    const files = cacheComponentsFiles(patch);

    expect(await read("next.config.mjs")).not.toMatch(/nextly\/cache-handler/);
    expect(files.skipped).toHaveLength(1);
    expect(files.skipped[0]?.why).toMatch(
      /declares require after its config object.*move that declaration above the object/
    );
    const config = await load("next.config.mjs");
    expect(config.reactStrictMode).toBe(true);
    expect(config.cacheComponents).toBe(true);
  });

  it("adds no definition to an ES module that binds `require` already", async () => {
    await write(
      "next.config.mjs",
      'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nexport default {};\n'
    );

    await turnOnCacheComponents(dir);

    const text = await read("next.config.mjs");
    expect(text.match(/const require/g)).toHaveLength(1);
    expectNextlyHandlers(await load("next.config.mjs"));
  });

  it("leaves the handlers out of an ES module that uses `require` without binding it, and prints its setup", async () => {
    await write(
      "next.config.mjs",
      "export default { env: { CJS: String(typeof require) } };\n"
    );

    const files = cacheComponentsFiles(await turnOnCacheComponents(dir));

    expect(await read("next.config.mjs")).not.toMatch(/nextly\/cache-handler/);
    expect(files.skipped).toHaveLength(1);
    expect(files.skipped[0]?.why).toMatch(/uses require/);
    expect(files.skipped[0]?.toAdd).toBe(REQUIRE_SETUP + HANDLERS.trimEnd());
  });

  // All three set, to values that are not Nextly's: kept, and said.
  it("keeps a full cache of the app's own, and says Nextly's lines", async () => {
    const config =
      'module.exports = {\n  cacheHandler: require.resolve("./my-cache.js"),\n  cacheMaxMemorySize: 52428800,\n  cacheHandlers: {},\n};\n';
    await write("next.config.js", config);

    const patch = await turnOnCacheComponents(dir);
    const files = cacheComponentsFiles(patch);

    expect(patch).toMatchObject({ kind: "turned-on" });
    expect(await read("next.config.js")).not.toMatch(/nextly\/cache-handler/);
    expect(files.skipped).toHaveLength(1);
    expect(files.skipped[0]?.why).toMatch(
      /has cache handlers of its own \(cacheHandler, cacheHandlers\), which were kept/
    );
    // What keeping them costs: the bound nextly applies without its handlers.
    expect(files.skipped[0]?.why).toMatch(
      /every cached public read refreshes within a minute of a visit/
    );
    expect(files.skipped[0]?.toAdd).toBe(HANDLERS.trimEnd());
  });
});

describe("a config whose settings it cannot read or change safely", () => {
  // Each is left byte for byte, with every line to add printed.
  it.each([
    [
      "a computed value",
      `export default { cacheComponents: process.env.CC === "1" };\n`,
      /cacheComponents is not true or false written in place/,
    ],
    [
      "a wrapper call, whose result may set the option again",
      'import withPlugin from "some-plugin";\nexport default withPlugin({ cacheComponents: false });\n',
      /result of a call/,
    ],
    [
      "a spread, though it never names the option",
      'import base from "./base.mjs";\nexport default { ...base };\n',
      /spreads another object/,
    ],
    ["a file that does not parse", "export default {\n", /could not be parsed/],
  ])(
    "leaves %s alone, and prints the exact lines",
    async (_, config, reason) => {
      await write("next.config.mjs", config);

      const patch = await turnOnCacheComponents(dir);
      const files = cacheComponentsFiles(patch);

      expect(patch.kind).toBe("manual");
      expect(await read("next.config.mjs")).toBe(config);
      expect(files.changed).toEqual([]);
      expect(files.skipped).toHaveLength(1);
      expect(files.skipped[0]?.why).toMatch(reason);
      expect(files.skipped[0]?.toAdd).toBe(
        `${REQUIRE_SETUP}  cacheComponents: true,\n  partialPrefetching: true,\n${HANDLERS.trimEnd()}`
      );
    }
  );

  it("prints no `require` setup for a TypeScript config, which Next.js compiles to CommonJS", async () => {
    await write("next.config.ts", "export default { ...{} };\n");

    const files = cacheComponentsFiles(await turnOnCacheComponents(dir));

    expect(files.skipped[0]?.toAdd).toBe(
      `  cacheComponents: true,\n  partialPrefetching: true,\n${HANDLERS.trimEnd()}`
    );
  });
});

describe("the page the notice links", () => {
  it("has the section it names, and that section lists every setting", async () => {
    // The docs site serves docs/<path>.mdx at /docs/<path>, and a heading at
    // its slug.
    const url = new URL(CACHE_COMPONENTS_DOCS_URL);
    const page = await readFile(
      new URL(`../../../..${url.pathname}.mdx`, import.meta.url),
      "utf-8"
    );
    expect(url.hash).toBe("#cache-components");
    const section = page.split(/^### Cache Components$/m)[1];
    expect(section, "the Cache Components heading").toBeDefined();
    const body = section?.split(/^#{2,3} /m)[0] ?? "";
    for (const line of HANDLERS.trim().split("\n")) {
      expect(body).toContain(line.trim());
    }
    expect(body).toContain("cacheComponents: true,");
    expect(body).toContain("partialPrefetching: true,");
  });
});
