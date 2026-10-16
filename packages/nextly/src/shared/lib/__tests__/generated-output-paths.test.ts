import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_DB_CONFIG,
  DEFAULT_TYPESCRIPT_CONFIG,
} from "../../types/config";
import {
  generatedTypesFile,
  generatedZodDir,
  projectUsesSrcLayout,
} from "../generated-output-paths";

const made: string[] = [];
function project(...dirs: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "nextly-layout-"));
  made.push(root);
  for (const dir of dirs) mkdirSync(join(root, dir), { recursive: true });
  return root;
}
afterEach(() => {
  for (const root of made.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("projectUsesSrcLayout — as Next.js decides it", () => {
  it("is true for an app under src/", () => {
    expect(projectUsesSrcLayout(project("src/app"))).toBe(true);
  });

  it("is false for an app at the root, with no src/", () => {
    expect(projectUsesSrcLayout(project("app"))).toBe(false);
  });

  it("is false when a root app/ exists beside src/, since Next.js then ignores src/app", () => {
    expect(projectUsesSrcLayout(project("app", "src/app"))).toBe(false);
  });

  it("counts pages/ as an app directory too", () => {
    expect(projectUsesSrcLayout(project("pages"))).toBe(false);
    expect(projectUsesSrcLayout(project("src/pages"))).toBe(true);
  });
});

describe("generated output follows the project's layout", () => {
  it("keeps the built-in paths in a project under src/", () => {
    const root = project("src/app");

    expect(generatedTypesFile(root, DEFAULT_TYPESCRIPT_CONFIG.outputFile)).toBe(
      resolve(root, DEFAULT_TYPESCRIPT_CONFIG.outputFile)
    );
    expect(generatedZodDir(root, DEFAULT_DB_CONFIG.schemasDir)).toBe(
      resolve(root, DEFAULT_DB_CONFIG.schemasDir, "zod")
    );
  });

  it("drops src/ from the built-in paths in a project without one", () => {
    const root = project("app");

    expect(generatedTypesFile(root, DEFAULT_TYPESCRIPT_CONFIG.outputFile)).toBe(
      resolve(
        root,
        DEFAULT_TYPESCRIPT_CONFIG.outputFile.replace("./src/", "./")
      )
    );
    expect(generatedZodDir(root, DEFAULT_DB_CONFIG.schemasDir)).toBe(
      resolve(root, DEFAULT_DB_CONFIG.schemasDir.replace("./src/", "./"), "zod")
    );
  });

  it("leaves a path the project chose alone, whatever its layout", () => {
    // Only the built-in default guesses at a layout; a configured path is the
    // project's own decision, even one that names a src/ the project lacks.
    const root = project("app");

    expect(generatedTypesFile(root, "./src/custom/types.ts")).toBe(
      resolve(root, "./src/custom/types.ts")
    );
    expect(generatedZodDir(root, "./lib/schemas")).toBe(
      resolve(root, "./lib/schemas", "zod")
    );
  });
});
