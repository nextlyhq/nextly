/**
 * Cache Components off in every app this CLI touches, until Nextly supports it.
 *
 * A new project's config says so outright. An existing app it adds Nextly to
 * is changed the same way, with a notice: `create-next-app` 16.4 turns Cache
 * Components on by default, writing `cacheComponents: true` together with
 * `partialPrefetching: true`, and Next.js refuses `partialPrefetching` once
 * Cache Components is off, so both go. Each case writes a real config into a
 * temporary directory and reads back what was left there.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildNextConfigTemplate,
  CACHE_COMPONENTS_DOCS_URL,
  cacheComponentsFiles,
  patchNextConfig,
  turnOffCacheComponents,
} from "../generators/next-config";
import type { DatabaseConfig } from "../types";

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

/** `create-next-app` 16.4's TypeScript config with its default, Cache Components on. */
const CREATE_NEXT_APP_CONFIG = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
`;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "cache-components-"));
  await mkdir(path.join(dir, "node_modules/next"), { recursive: true });
  await writeFile(
    path.join(dir, "node_modules/next/package.json"),
    JSON.stringify({ name: "next", version: "16.4.2" }),
    "utf-8"
  );
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const write = (name: string, text: string) =>
  writeFile(path.join(dir, name), text, "utf-8");
const read = (name: string) => readFile(path.join(dir, name), "utf-8");

describe("a new project's Next config", () => {
  it("turns Cache Components off outright, and says why", () => {
    const text = buildNextConfigTemplate(sqlite);
    expect(text).toMatch(/^\s*cacheComponents: false,$/m);
    expect(text).toMatch(/Nextly does not support Cache Components yet/);
  });

  it("is what an existing app with no config gets too", async () => {
    await write("tsconfig.json", "{}\n");
    await patchNextConfig(dir, sqlite);
    expect(await read("next.config.ts")).toMatch(
      /^\s*cacheComponents: false,$/m
    );
  });
});

describe("an existing app with Cache Components on", () => {
  it("turns it off, drops partialPrefetching, and keeps the rest of the config", async () => {
    await write("next.config.ts", CREATE_NEXT_APP_CONFIG);

    const result = await turnOffCacheComponents(dir);

    expect(result).toEqual({
      kind: "turned-off",
      file: "next.config.ts",
      removed: ["partialPrefetching"],
    });
    expect(await read("next.config.ts"))
      .toBe(`import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: false,
};

export default nextConfig;
`);
  });

  // A later duplicate wins in JavaScript, and it may be spelled as a quoted key,
  // so every definition goes and the result is read back as parsed code.
  it("removes every partialPrefetching it defines, under any spelling", async () => {
    await write(
      "next.config.mjs",
      'export default {\n  cacheComponents: true,\n  partialPrefetching: false,\n  "partialPrefetching": true,\n};\n'
    );

    const result = await turnOffCacheComponents(dir);

    expect(result).toMatchObject({
      kind: "turned-off",
      removed: ["partialPrefetching"],
    });
    expect(await read("next.config.mjs")).toBe(
      "export default {\n  cacheComponents: false,\n};\n"
    );
  });

  it("turns it off on a config written on one line", async () => {
    await write(
      "next.config.mjs",
      "export default { cacheComponents: true, partialPrefetching: true, reactStrictMode: true };\n"
    );

    await turnOffCacheComponents(dir);

    expect(await read("next.config.mjs")).toBe(
      "export default { cacheComponents: false, reactStrictMode: true };\n"
    );
  });

  it("says what it changed, why, and where it is explained", async () => {
    await write("next.config.ts", CREATE_NEXT_APP_CONFIG);

    const files = cacheComponentsFiles(await turnOffCacheComponents(dir));

    expect(files.changed).toEqual([
      { path: "next.config.ts", added: ["cacheComponents: false"] },
    ]);
    expect(files.notices?.join("\n")).toMatch(
      /Turned Cache Components off in next\.config\.ts.*Nextly does not support it yet.*removed partialPrefetching.*nextlyhq\.com\/docs\/getting-started\/installation#cache-components/s
    );
  });

  it("leaves a setting it cannot read alone, and says exactly what to change", async () => {
    const config = `export default { cacheComponents: process.env.CC === "1" };\n`;
    await write("next.config.mjs", config);

    const files = cacheComponentsFiles(await turnOffCacheComponents(dir));

    expect(await read("next.config.mjs")).toBe(config);
    expect(files.skipped).toHaveLength(1);
    expect(files.skipped[0]?.toAdd).toContain("cacheComponents: false");
  });
});

describe("a config whose final setting it cannot see", () => {
  // Next.js receives what a wrapper RETURNS, which may set the option again, so
  // turning off the literal passed in would report a change Next.js never sees.
  it("leaves a wrapped config alone, and says what to change", async () => {
    const config =
      'import withPlugin from "some-plugin";\nexport default withPlugin({ cacheComponents: true });\n';
    await write("next.config.mjs", config);

    const result = await turnOffCacheComponents(dir);

    expect(result.kind).toBe("manual");
    expect(await read("next.config.mjs")).toBe(config);
  });

  // The setting can arrive through a spread without the file ever naming it.
  it("reports a config that spreads another object, though it never names the setting", async () => {
    const config =
      'import base from "./base.mjs";\nexport default { ...base };\n';
    await write("next.config.mjs", config);

    const result = await turnOffCacheComponents(dir);

    expect(result.kind).toBe("manual");
    expect(await read("next.config.mjs")).toBe(config);
  });
});

describe("the page the notice links", () => {
  it("is the one nextly's own error links", async () => {
    const nextly = await readFile(
      new URL("../../../nextly/src/cache-components.ts", import.meta.url),
      "utf-8"
    );
    expect(nextly).toContain(`"${CACHE_COMPONENTS_DOCS_URL}"`);
  });
});

describe("an existing app with Cache Components off", () => {
  it("changes nothing when the config says false or nothing", async () => {
    for (const config of [
      "export default { cacheComponents: false };\n",
      "export default { reactStrictMode: true };\n",
    ]) {
      await write("next.config.mjs", config);
      const result = await turnOffCacheComponents(dir);
      expect(result.kind).toBe("unchanged");
      expect(await read("next.config.mjs")).toBe(config);
    }
  });
});
