/**
 * The nextly.config.ts the existing-app path writes: well-formed, each
 * comment beside what it describes, and its types output in a folder the same
 * run creates.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { parse } from "@babel/parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateConfig } from "../generators/config";
import { generateTypesDirectory } from "../generators/types";
import type { ProjectInfo } from "../types";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nextly-config-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const info = (srcDir: boolean): ProjectInfo => ({
  isNextJs: true,
  isAppRouter: true,
  hasTypescript: true,
  packageManager: "npm",
  nextVersion: "16.0.0",
  srcDir,
  appDir: srcDir ? "src/app" : "app",
});

describe.each([
  ["an app with a src/ folder", true],
  ["an app with no src/ folder", false],
])("the config written into %s", (_layout, srcDir) => {
  const written = async () => {
    await generateConfig(dir, "blank", info(srcDir));
    return readFile(join(dir, "nextly.config.ts"), "utf8");
  };

  it("parses as TypeScript", async () => {
    const text = await written();
    expect(() =>
      parse(text, { sourceType: "module", plugins: ["typescript"] })
    ).not.toThrow();
  });

  // Each placeholder comment sits on its own line, directly above the key it
  // describes, inside the exported object; none before the export.
  it("puts each comment directly above what it describes", async () => {
    const lines = (await written()).split("\n");
    const exportAt = lines.findIndex(line => line.startsWith("export default"));
    expect(lines.slice(0, exportAt).some(line => line.includes("//"))).toBe(
      false
    );
    for (const [comment, key] of [
      ["// Add your collections here", "collections: ["],
      ["// Add your singles (globals) here", "singles: ["],
    ]) {
      const at = lines.findIndex(line => line.trim() === comment);
      expect(at, comment).toBeGreaterThan(exportAt);
      expect(lines[at + 1].trim().startsWith(key), comment).toBe(true);
    }
  });

  it("sends types to a folder the same run creates", async () => {
    const config = await written();
    await generateTypesDirectory(dir, info(srcDir));

    const outputFile = /outputFile: "([^"]+)"/.exec(config)?.[1] ?? "";
    expect(outputFile).toBe(
      srcDir
        ? "./src/types/generated/nextly-types.ts"
        : "./types/generated/nextly-types.ts"
    );
    expect(existsSync(join(dir, dirname(outputFile)))).toBe(true);
  });
});
