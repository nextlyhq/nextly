/**
 * Adding Nextly's server packages to an app's own Next config.
 *
 * Each case writes a real config into a temporary directory and reads back what
 * the patch left there, because the property under test is the file the app
 * builds with: its own entries kept, Nextly's missing ones added, nothing else
 * moved, and a config it cannot change left untouched with exact instructions.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getServerExternalPackages,
  nextConfigReport,
  patchNextConfig,
} from "../generators/next-config";
import type { DatabaseConfig } from "../types";

const postgres: DatabaseConfig = {
  type: "postgresql",
  adapter: "@nextlyhq/adapter-postgres",
  databaseDriver: "pg",
  connectionUrl: "postgresql://localhost/test",
  envExample: "postgresql://localhost/test",
};
const REQUIRED = getServerExternalPackages(postgres);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "next-config-"));
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
  ] as const) {
    it(`leaves the file untouched and says exactly what to add when the config ${why}`, async () => {
      await write("next.config.mjs", text);

      const result = await patchNextConfig(dir, postgres);

      expect(result.kind).toBe("manual");
      expect(await read("next.config.mjs")).toBe(text);
      const report = nextConfigReport(result);
      expect(report.level).toBe("warn");
      expect(report.message).toContain("next.config.mjs");
      expect(report.message).toContain(
        `serverExternalPackages: [${quoted(REQUIRED).join(", ")}]`
      );
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

describe("what the CLI prints", () => {
  it("names each package it added and the file", () => {
    const report = nextConfigReport({
      kind: "written",
      file: "next.config.ts",
      added: ["nextly", "pg"],
    });
    expect(report).toEqual({
      level: "info",
      message: "next.config.ts: added nextly, pg to serverExternalPackages",
    });
  });

  it("says nothing was needed when every package was listed", () => {
    expect(
      nextConfigReport({ kind: "unchanged", file: "next.config.ts" })
    ).toEqual({
      level: "info",
      message:
        "next.config.ts already lists every package Nextly needs in serverExternalPackages",
    });
  });
});
