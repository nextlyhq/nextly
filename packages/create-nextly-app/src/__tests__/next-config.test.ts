/**
 * Adding Nextly's server packages to an app's own Next config.
 *
 * Each case writes a real config into a temporary directory and reads back what
 * the patch left there, because the property under test is the file the app
 * builds with: its own entries kept, Nextly's missing ones added, nothing else
 * moved, and a config it cannot change left untouched with exact instructions.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getServerExternalPackages,
  nextConfigFiles,
  patchNextConfig,
  type NextConfigPatch,
} from "../generators/next-config";
import type { DatabaseConfig } from "../types";

/** What the run says about a config it left alone: why, then the text to add. */
const said = (patch: NextConfigPatch): string =>
  nextConfigFiles(patch)
    .skipped.map(({ path, why, toAdd }) => `${path}: ${why}\n\n${toAdd ?? ""}`)
    .join("\n");

const postgres: DatabaseConfig = {
  type: "postgresql",
  adapter: "@nextlyhq/adapter-postgres",
  databaseDriver: "pg",
  connectionUrl: "postgresql://localhost/test",
  envExample: "postgresql://localhost/test",
};
const REQUIRED = getServerExternalPackages(postgres);

let dir: string;
const installNext = async (version: string) => {
  await mkdir(path.join(dir, "node_modules/next"), { recursive: true });
  await writeFile(
    path.join(dir, "node_modules/next/package.json"),
    JSON.stringify({ name: "next", version }),
    "utf-8"
  );
};
// Every app starts with Next.js 16 installed, as a real one would, so a case
// reaches the config rather than stopping at an unknown version.
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "next-config-"));
  await installNext("16.0.1");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const write = (name: string, text: string) =>
  writeFile(path.join(dir, name), text, "utf-8");
const read = (name: string) => readFile(path.join(dir, name), "utf-8");
const quoted = (names: string[], quote = '"') =>
  names.map(name => `${quote}${name}${quote}`);

describe("a config that already lists serverExternalPackages", () => {
  it("keeps the app's entries in their order and adds only Nextly's missing packages", async () => {
    await write(
      "next.config.ts",
      'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n  serverExternalPackages: ["my-native-lib", "sharp"],\n};\n\nexport default nextConfig;\n'
    );

    const result = await patchNextConfig(dir, postgres);

    const missing = REQUIRED.filter(name => name !== "sharp");
    expect(result).toEqual({
      kind: "written",
      file: "next.config.ts",
      added: missing,
    });
    expect(await read("next.config.ts")).toBe(
      `import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n  serverExternalPackages: ["my-native-lib", "sharp", ${quoted(missing).join(", ")}],\n};\n\nexport default nextConfig;\n`
    );
  });

  it("adds to a list written one entry per line, in the same layout, keeping its trailing comma", async () => {
    await write(
      "next.config.ts",
      'const nextConfig = {\n  // packages our server code loads natively\n  serverExternalPackages: [\n    "my-native-lib",\n  ],\n  reactStrictMode: true,\n};\n\nexport default nextConfig;\n'
    );

    await patchNextConfig(dir, postgres);

    const lines = quoted(REQUIRED)
      .map(entry => `    ${entry},\n`)
      .join("");
    expect(await read("next.config.ts")).toBe(
      `const nextConfig = {\n  // packages our server code loads natively\n  serverExternalPackages: [\n    "my-native-lib",\n${lines}  ],\n  reactStrictMode: true,\n};\n\nexport default nextConfig;\n`
    );
  });

  it("writes the quote style the list already uses", async () => {
    await write(
      "next.config.mjs",
      "export default {\n  serverExternalPackages: ['my-native-lib'],\n};\n"
    );

    await patchNextConfig(dir, postgres);

    expect(await read("next.config.mjs")).toBe(
      `export default {\n  serverExternalPackages: ['my-native-lib', ${quoted(REQUIRED, "'").join(", ")}],\n};\n`
    );
  });

  it("fills an empty list", async () => {
    await write(
      "next.config.mjs",
      "export default {\n  serverExternalPackages: [],\n};\n"
    );

    await patchNextConfig(dir, postgres);

    expect(await read("next.config.mjs")).toBe(
      `export default {\n  serverExternalPackages: [${quoted(REQUIRED).join(", ")}],\n};\n`
    );
  });

  it("leaves the file byte for byte as it was when every package is already listed", async () => {
    const text = `export default {\n  serverExternalPackages: [${quoted(REQUIRED).join(", ")}, "my-native-lib"],\n};\n`;
    await write("next.config.mjs", text);

    const result = await patchNextConfig(dir, postgres);

    expect(result).toEqual({ kind: "unchanged", file: "next.config.mjs" });
    expect(await read("next.config.mjs")).toBe(text);
  });
});

describe("a config with no serverExternalPackages", () => {
  it("adds the list to create-next-app's own config, keeping its comment", async () => {
    await write(
      "next.config.ts",
      'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n  /* config options here */\n};\n\nexport default nextConfig;\n'
    );

    const result = await patchNextConfig(dir, postgres);

    expect(result).toEqual({
      kind: "written",
      file: "next.config.ts",
      added: REQUIRED,
    });
    const text = await read("next.config.ts");
    expect(text).toContain("/* config options here */");
    expect(text).toContain(
      `  serverExternalPackages: [\n${quoted(REQUIRED)
        .map(entry => `    ${entry},\n`)
        .join("")}  ],\n`
    );
  });

  it("finds the config through `satisfies`, a wrapper call and `module.exports`", async () => {
    for (const [name, text] of [
      [
        "next.config.ts",
        'import type { NextConfig } from "next";\n\nexport default {\n  reactStrictMode: true,\n} satisfies NextConfig;\n',
      ],
      [
        "next.config.mjs",
        'import createMDX from "@next/mdx";\n\nconst withMDX = createMDX();\nconst nextConfig = {\n  pageExtensions: ["ts", "tsx", "mdx"],\n};\n\nexport default withMDX(nextConfig);\n',
      ],
      ["next.config.js", "module.exports = {\n  reactStrictMode: true,\n};\n"],
    ] as const) {
      await rm(dir, { recursive: true, force: true });
      dir = await mkdtemp(path.join(tmpdir(), "next-config-"));
      await installNext("16.0.1");
      await write(name, text);

      const result = await patchNextConfig(dir, postgres);

      expect(result, name).toEqual({
        kind: "written",
        file: name,
        added: REQUIRED,
      });
      for (const entry of quoted(REQUIRED))
        expect(await read(name), name).toContain(entry);
    }
  });
});

describe("a config it cannot change safely", () => {
  for (const [why, text] of [
    [
      "exports a function of the phase",
      "export default (phase) => ({\n  reactStrictMode: true,\n});\n",
    ],
    [
      "builds the list from a variable",
      'const base = ["my-native-lib"];\n\nexport default {\n  serverExternalPackages: base,\n};\n',
    ],
    [
      "spreads another object that may hold the list",
      "const shared = {};\n\nexport default {\n  ...shared,\n  reactStrictMode: true,\n};\n",
    ],
    ["does not parse", "export default {\n  reactStrictMode: true,\n\n"],
    [
      "hands a wrapper its options first and the config after",
      "const nextConfig = {};\n\nexport default makeConfig({ enabled: true }, nextConfig);\n",
    ],
    [
      "hands a wrapper named options first and the config written in place",
      "const options = {};\n\nexport default makeConfig(options, {});\n",
    ],
    [
      "hands a wrapper the config and its options",
      'const nextConfig = {};\n\nexport default withSentryConfig(nextConfig, { org: "acme" });\n',
    ],
    [
      "sets a nested property of the exported variable",
      'const nextConfig = { experimental: {} };\nnextConfig.experimental.optimizePackageImports = ["nextly"];\n\nexport default nextConfig;\n',
    ],
    [
      "changes the exported variable through another name",
      'const nextConfig = {};\nconst settings = nextConfig;\nsettings.transpilePackages = ["nextly"];\n\nexport default nextConfig;\n',
    ],
    [
      "uses the exported variable in a destructuring default",
      "const nextConfig = {};\nconst [alias = configure(nextConfig)] = [];\n\nexport default nextConfig;\n",
    ],
    [
      "hands the exported variable to a function",
      "const nextConfig = {};\nconfigure(nextConfig);\n\nexport default nextConfig;\n",
    ],
    [
      'assigns module["exports"] after module.exports',
      'module.exports = {};\nmodule["exports"] = { reactStrictMode: true };\n',
    ],
    [
      "sets a nested property of module.exports",
      'module.exports = { experimental: {} };\nmodule.exports.experimental.optimizePackageImports = ["nextly"];\n',
    ],
    [
      "assigns module.exports twice",
      "module.exports = {};\nmodule.exports = { reactStrictMode: true };\n",
    ],
    [
      "sets a property of module.exports after assigning it",
      'module.exports = {};\nmodule.exports.serverExternalPackages = ["my-native-lib"];\n',
    ],
    [
      "replaces module.exports inside a branch",
      'module.exports = {};\nif (process.env.CI) {\n  module.exports = { output: "standalone" };\n}\n',
    ],
    [
      "spreads another object before its own list",
      'const shared = {};\n\nexport default {\n  ...shared,\n  serverExternalPackages: ["sharp"],\n};\n',
    ],
    [
      "spreads another object into its experimental settings",
      "const shared = {};\n\nexport default {\n  experimental: { ...shared },\n};\n",
    ],
    [
      "reads transpilePackages from a getter",
      'export default {\n  get transpilePackages() {\n    return ["nextly"];\n  },\n};\n',
    ],
    [
      "builds the list's key at run time",
      'const key = "serverExternalPackages";\n\nexport default {\n  [key]: ["my-native-lib"],\n};\n',
    ],
    [
      "replaces the exported variable after declaring it",
      "let nextConfig = {};\nnextConfig = buildConfig();\n\nexport default nextConfig;\n",
    ],
    [
      "sets the list on the exported variable later",
      'const nextConfig = {};\nnextConfig.serverExternalPackages = ["my-native-lib"];\n\nexport default nextConfig;\n',
    ],
    [
      "already transpiles a package Nextly needs external",
      'export default {\n  transpilePackages: ["nextly"],\n};\n',
    ],
    [
      "optimises the imports of a package Nextly needs external",
      'export default {\n  experimental: { optimizePackageImports: ["drizzle-orm"] },\n};\n',
    ],
    [
      "uses the deprecated experimental option for the list",
      'export default {\n  experimental: { serverComponentsExternalPackages: ["my-native-lib"] },\n};\n',
    ],
  ] as const) {
    it(`leaves the file untouched and says exactly what to add when the config ${why}`, async () => {
      await write("next.config.mjs", text);

      const result = await patchNextConfig(dir, postgres);

      expect(result.kind).toBe("manual");
      expect(await read("next.config.mjs")).toBe(text);
      expect(nextConfigFiles(result).skipped).toHaveLength(1);
      const message = said(result);
      expect(message).toContain("next.config.mjs");
      expect(message).toContain(
        `serverExternalPackages: [${quoted(REQUIRED).join(", ")}]`
      );
    });
  }
});

describe("configs it can still change safely", () => {
  it("reads a list under a computed string key, and keeps its entries", async () => {
    await write(
      "next.config.mjs",
      'export default {\n  ["serverExternalPackages"]: ["my-native-lib"],\n};\n'
    );

    const result = await patchNextConfig(dir, postgres);

    expect(result).toEqual({
      kind: "written",
      file: "next.config.mjs",
      added: REQUIRED,
    });
    expect(await read("next.config.mjs")).toContain(
      `["serverExternalPackages"]: ["my-native-lib", ${quoted(REQUIRED).join(", ")}]`
    );
  });

  it("counts a key spelled like the config's variable as no use of it", async () => {
    await write(
      "next.config.mjs",
      'const nextConfig = {\n  env: { nextConfig: "on" },\n};\n\nexport default nextConfig;\n'
    );

    const result = await patchNextConfig(dir, postgres);

    expect(result).toMatchObject({ kind: "written", file: "next.config.mjs" });
  });

  it("reads a next.config.mts as TypeScript", async () => {
    await write(
      "next.config.mts",
      'import type { NextConfig } from "next";\n\nexport default {\n  reactStrictMode: true,\n} satisfies NextConfig;\n'
    );

    const result = await patchNextConfig(dir, postgres);

    expect(result).toEqual({
      kind: "written",
      file: "next.config.mts",
      added: REQUIRED,
    });
  });

  it("edits the file Next.js reads first when there are several", async () => {
    // Next.js prefers next.config.js over next.config.ts.
    const ts = "export default {};\n";
    await write("next.config.ts", ts);
    await write(
      "next.config.js",
      "module.exports = {\n  reactStrictMode: true,\n};\n"
    );

    const result = await patchNextConfig(dir, postgres);

    expect(result).toMatchObject({ kind: "written", file: "next.config.js" });
    expect(await read("next.config.ts")).toBe(ts);
  });

  it("keeps a comment in an empty list", async () => {
    await write(
      "next.config.mjs",
      "export default {\n  serverExternalPackages: [/* native modules */],\n};\n"
    );

    await patchNextConfig(dir, postgres);

    expect(await read("next.config.mjs")).toBe(
      `export default {\n  serverExternalPackages: [/* native modules */ ${quoted(REQUIRED).join(", ")}],\n};\n`
    );
  });

  it("names the clash when a package Nextly needs external is transpiled", async () => {
    await write(
      "next.config.mjs",
      'export default {\n  transpilePackages: ["nextly"],\n};\n'
    );

    const result = await patchNextConfig(dir, postgres);

    expect(result.kind).toBe("manual");
    expect(said(result)).toContain(
      "nextly also appears in its transpilePackages"
    );
  });
});

describe("a config with the deprecated experimental list", () => {
  // Next.js still reads `experimental.serverComponentsExternalPackages`, by
  // copying it over the top-level list, so writing a top-level list beside it
  // would report success and lose Nextly's packages.
  it("says to move its entries to the top-level list and delete the key", async () => {
    const text =
      'export default {\n  experimental: { serverComponentsExternalPackages: ["my-native-lib"] },\n};\n';
    await write("next.config.mjs", text);

    const result = await patchNextConfig(dir, postgres);

    expect(result.kind).toBe("manual");
    expect(await read("next.config.mjs")).toBe(text);
    const message = said(result);
    expect(message).toContain(
      "move those entries into the top-level serverExternalPackages list and delete experimental.serverComponentsExternalPackages"
    );
  });
});

describe("an app whose Next.js version cannot be read", () => {
  // The list is written without asking which Next.js the app runs: every
  // supported release reads it as the top-level option.
  const config = "export default {\n  reactStrictMode: true,\n};\n";

  for (const [why, range] of [
    ["names no version", "latest"],
    ["is missing", null],
  ] as const) {
    it(`still writes the list when the app's range ${why} and nothing is installed`, async () => {
      await rm(path.join(dir, "node_modules"), {
        recursive: true,
        force: true,
      });
      if (range) {
        await write(
          "package.json",
          JSON.stringify({ dependencies: { next: range } })
        );
      }
      await write("next.config.mjs", config);

      const result = await patchNextConfig(dir, postgres);

      expect(result).toMatchObject({
        kind: "written",
        file: "next.config.mjs",
        added: REQUIRED,
      });
    });
  }
});

describe("an app with no Next config", () => {
  it("writes a TypeScript config when the app uses TypeScript", async () => {
    await write("tsconfig.json", "{}\n");

    const result = await patchNextConfig(dir, postgres);

    expect(result).toEqual({
      kind: "created",
      file: "next.config.ts",
      added: REQUIRED,
    });
    const text = await read("next.config.ts");
    expect(text).toContain('import type { NextConfig } from "next";');
    for (const entry of quoted(REQUIRED)) expect(text).toContain(entry);
  });

  it("writes a JavaScript module config otherwise, with no TypeScript in it", async () => {
    const result = await patchNextConfig(dir, postgres);

    expect(result).toEqual({
      kind: "created",
      file: "next.config.mjs",
      added: REQUIRED,
    });
    const text = await read("next.config.mjs");
    // A JSDoc type in a comment is plain JavaScript; a type import or annotation is not.
    expect(text).not.toContain("import type");
    expect(text).not.toMatch(/:\s*NextConfig/);
    for (const entry of quoted(REQUIRED)) expect(text).toContain(entry);
  });
});

describe("what the run reports", () => {
  it("names the file and each package it added", () => {
    expect(
      nextConfigFiles({
        kind: "written",
        file: "next.config.ts",
        added: ["nextly", "pg"],
      }).changed
    ).toEqual([
      {
        path: "next.config.ts",
        added: ["serverExternalPackages: nextly, pg"],
      },
    ]);
  });

  it("names a config it created as written", () => {
    expect(
      nextConfigFiles({
        kind: "created",
        file: "next.config.ts",
        added: ["nextly"],
      }).written
    ).toEqual(["next.config.ts"]);
  });

  it("says nothing when every package was already listed", () => {
    expect(
      nextConfigFiles({ kind: "unchanged", file: "next.config.ts" })
    ).toEqual({ written: [], changed: [], skipped: [] });
  });
});
