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

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

  it("gives an ES module config `require` after its imports, and it loads", async () => {
    await write(
      "next.config.mjs",
      'import path from "node:path";\n\nexport default {\n  basePath: path.posix.join("/", "site"),\n  cacheComponents: false,\n};\n'
    );

    const result = await turnOnCacheComponents(dir);

    expect(result).toMatchObject({ kind: "turned-on", handlers: "added" });
    const text = await read("next.config.mjs");
    expect(text).toMatch(
      /^import path from "node:path";\nimport \{ createRequire \} from "node:module";\n\n\/\/ .*\nconst require = createRequire\(import\.meta\.url\);\n\nexport default \{/
    );
    const config = await load("next.config.mjs");
    expect(config.basePath).toBe("/site");
    expect(config.cacheComponents).toBe(true);
    expect(config.partialPrefetching).toBe(true);
    expectNextlyHandlers(config);
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
    expect(files.skipped[0]?.why).toMatch(/already sets cacheHandler/);
    expect(files.skipped[0]?.toAdd).toBe(HANDLERS.trimEnd());
  });

  it("does not define `require` in an ES module that already names it", async () => {
    const config =
      'import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\nexport default { sassOptions: { implementation: load.resolve("sass") } };\n';
    await write("next.config.mjs", config);

    const patch = await turnOnCacheComponents(dir);

    expect(patch).toMatchObject({
      kind: "turned-on",
      turnedOn: ["cacheComponents", "partialPrefetching"],
      handlers: { skipped: expect.stringMatching(/createRequire/) },
    });
    expect(await read("next.config.mjs")).not.toMatch(/nextly\/cache-handler/);
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
        `  cacheComponents: true,\n  partialPrefetching: true,\n${HANDLERS.trimEnd()}`
      );
    }
  );
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
