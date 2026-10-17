/**
 * The admin API mount must be the same in a new project and in an existing app
 * Nextly is added to: plugin routes answer under it, and the docs name one
 * address for them. A new project takes the mount from where the base
 * template keeps its catch-all route; an existing app takes it from the path
 * `generateRoutes` writes. This runs the generator against a real temporary
 * project and compares the file it writes with the template's, so how the
 * generator spells the path does not matter, only where the file lands.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateRoutes } from "../generators/routes";
import type { ProjectInfo } from "../types";

const TEMPLATE_APP = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../templates/base/src/app"
);

/** The base template's catch-all routes that serve Nextly's API, relative to its app folder. */
function templateApiRoutes(): string[] {
  return readdirSync(TEMPLATE_APP, { recursive: true, encoding: "utf-8" })
    .map(file => file.split("\\").join("/"))
    .filter(file => file.endsWith("/[[...params]]/route.ts"))
    .filter(file =>
      readFileSync(join(TEMPLATE_APP, file), "utf-8").includes(
        "createDynamicHandlers"
      )
    );
}

function project(srcDir: boolean): ProjectInfo {
  return {
    isNextJs: true,
    isAppRouter: true,
    hasTypescript: true,
    packageManager: "npm",
    nextVersion: "16.4.2",
    srcDir,
    appDir: srcDir ? "src/app" : "app",
  };
}

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "admin-api-mount-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("the admin API mount", () => {
  it("is held by exactly one route in the base template", () => {
    expect(templateApiRoutes()).toHaveLength(1);
  });

  it.each([true, false])(
    "is where generateRoutes writes the route in an existing app (src/: %s)",
    async srcDir => {
      const [templateRoute] = templateApiRoutes();
      const info = project(srcDir);

      const result = await generateRoutes(cwd, info);

      expect(result.written).toEqual([`${info.appDir}/${templateRoute}`]);
    }
  );
});
