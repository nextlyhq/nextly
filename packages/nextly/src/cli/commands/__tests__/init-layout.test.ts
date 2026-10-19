/**
 * `nextly init` writes its paths where the app keeps its code: under src/
 * when the app does, at the root when it has a root app/ folder. A ./src/...
 * path written into a root-layout app made a stray src/ tree, and split the
 * generated output from it (generation follows the layout).
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  generatedTypesFile,
  generatedZodDir,
} from "../../../shared/lib/generated-output-paths";
import { createContext } from "../../program";
import { runInit } from "../init";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A project with the given folders, initialized with every default. */
async function initIn(folders: string[]): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), "nextly-init-"));
  made.push(cwd);
  for (const folder of folders)
    mkdirSync(join(cwd, folder), { recursive: true });
  await runInit(
    { cwd, yes: true, quiet: true },
    createContext({ quiet: true, cwd })
  );
  return cwd;
}

/** A path the written config names, read back from the file. */
const configured = (cwd: string, key: string) =>
  readFileSync(join(cwd, "nextly.config.ts"), "utf8").match(
    new RegExp(`${key}: "([^"]+)"`)
  )?.[1];

describe("nextly init follows the app's layout", () => {
  it("writes nothing under src/ in an app with a root app/ folder", async () => {
    const cwd = await initIn(["app"]);

    expect(existsSync(join(cwd, "src"))).toBe(false);
    expect(configured(cwd, "outputFile")).toBe(
      "./types/generated/nextly-types.ts"
    );
    expect(configured(cwd, "schemasDir")).toBe("./db/schemas/collections");
    expect(configured(cwd, "migrationsDir")).toBe("./db/migrations");
    expect(existsSync(join(cwd, "collections", "posts.ts"))).toBe(true);
    // From a root lib/, the config is one level up; the src/ spelling
    // (../../) would resolve outside the project.
    expect(readFileSync(join(cwd, "lib", "nextly.ts"), "utf8")).toContain(
      'import nextlyConfig from "../nextly.config";'
    );
  });

  it("keeps everything under src/ in an app that uses src/", async () => {
    const cwd = await initIn(["src/app"]);

    expect(configured(cwd, "outputFile")).toBe(
      "./src/types/generated/nextly-types.ts"
    );
    expect(configured(cwd, "schemasDir")).toBe("./src/db/schemas/collections");
    expect(existsSync(join(cwd, "src", "collections", "posts.ts"))).toBe(true);
    expect(
      readFileSync(join(cwd, "src", "lib", "nextly.ts"), "utf8")
    ).toContain('import nextlyConfig from "../../nextly.config";');
  });

  it("names the paths generation then writes to, in either layout", async () => {
    // The types and schemas land in the folders init made, not beside them.
    for (const folders of [["app"], ["src/app"]]) {
      const cwd = await initIn(folders);
      const outputFile = configured(cwd, "outputFile") ?? "";
      const schemasDir = configured(cwd, "schemasDir") ?? "";

      expect(generatedTypesFile(cwd, outputFile)).toBe(join(cwd, outputFile));
      expect(generatedZodDir(cwd, schemasDir)).toBe(
        join(cwd, schemasDir, "zod")
      );
      expect(existsSync(join(cwd, schemasDir))).toBe(true);
    }
  });
});
