/**
 * The route that serves local uploads, as a project receives it.
 *
 * Nextly's default storage writes to `public/uploads` and hands out
 * `/uploads/...` URLs. `next start` serves only what `public/` held when it
 * started, so a project without a route at `/uploads` answers 404 for every
 * file uploaded since, until the next restart. Every app template is copied
 * from `base`, so the route lives there; an existing app gets it from the
 * same template file.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  generateUploadsRoute,
  readMediaRouteTemplates,
} from "../generators/media-routes";
import type { ProjectInfo } from "../types";

const TEMPLATES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../templates"
);

/** Under the app folder; `uploads` is the local adapter's default `baseUrl`. */
const UPLOADS_ROUTE = "uploads/[...path]/route.ts";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "uploads-route-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function project(): ProjectInfo {
  return {
    isNextJs: true,
    isAppRouter: true,
    hasTypescript: true,
    packageManager: "npm",
    nextVersion: "16.4.2",
    srcDir: true,
    appDir: "src/app",
  };
}

describe("a new project", () => {
  const file = join(TEMPLATES_DIR, "base/src/app", UPLOADS_ROUTE);

  it("ships the route in the base template every app template is copied from", () => {
    expect(existsSync(file)).toBe(true);
  });

  it("serves GET and HEAD from Nextly's uploads handlers, started with the project's config", () => {
    const text = readFileSync(file, "utf8");
    expect(text).toMatch(
      /import \{ createUploadsHandlers \} from "nextly\/api\/uploads";/
    );
    expect(text).toMatch(/createUploadsHandlers\(\{ config(: \w+)? \}\)/);
    expect(text).toMatch(/export const GET = handlers\.GET;/);
    expect(text).toMatch(/export const HEAD = handlers\.HEAD;/);
  });
});

describe("an existing app Nextly is added to", () => {
  it("receives the same route, with the config imported by a path that resolves", async () => {
    const templates = await readMediaRouteTemplates(TEMPLATES_DIR);

    const result = await generateUploadsRoute(cwd, project(), templates);

    expect(result.written).toContain(`src/app/${UPLOADS_ROUTE}`);
    const written = join(cwd, "src/app", UPLOADS_ROUTE);
    const specifier = /from "([^"]*nextly\.config)";/.exec(
      readFileSync(written, "utf8")
    )?.[1];
    expect(specifier).toBeDefined();
    expect(resolve(dirname(written), specifier ?? "")).toBe(
      join(cwd, "nextly.config")
    );
  });

  it("keeps its own route at /uploads, and is told what to add", async () => {
    const own = "export const GET = () => new Response('mine');\n";
    const path = join(cwd, "src/app/uploads/[...slug]/route.ts");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, own);
    const templates = await readMediaRouteTemplates(TEMPLATES_DIR);

    const result = await generateUploadsRoute(cwd, project(), templates);

    expect(result.written).not.toContain(`src/app/${UPLOADS_ROUTE}`);
    const skipped = result.skipped.find(entry =>
      entry.path.startsWith("src/app/uploads")
    );
    expect(skipped?.toAdd).toContain("createUploadsHandlers");
    expect(readFileSync(path, "utf8")).toBe(own);
  });
});
