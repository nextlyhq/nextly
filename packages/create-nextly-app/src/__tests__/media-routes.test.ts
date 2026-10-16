/**
 * The media and health routes the existing-app path writes. Each case runs the
 * generator against a real temporary project and the repository's own
 * templates, so the files are judged as written, not as a mock recorded them.
 */
import {
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

import { generateMediaRoutes } from "../generators/media-routes";
import type { ProjectInfo } from "../types";

const TEMPLATES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../templates"
);

const ADMIN_MEDIA = "admin/api/media/[[...path]]/route.ts";
const PUBLIC_MEDIA = "api/media/[[...path]]/route.ts";
const HEALTH = "api/health/route.ts";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "media-routes-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

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

/** The module a file imports its Nextly config from: the specifier of the import naming it. */
function configSpecifier(text: string): string {
  const found =
    /import\s+\w+\s+from\s+"([^"]*(?:@nextly-config|nextly\.config))";/.exec(
      text
    );
  if (!found) throw new Error("no import of the Nextly config");
  return found[1];
}

/** The text with its config import's specifier replaced by a marker, so two files compare on everything else. */
function withoutConfigSpecifier(text: string): string {
  return text.replace(configSpecifier(text), "<nextly config>");
}

const template = (path: string) =>
  readFileSync(join(TEMPLATES, "base/src/app", path), "utf8");
const written = (appDir: string, path: string) =>
  readFileSync(join(cwd, appDir, path), "utf8");

describe.each([
  ["with a src/ folder", true],
  ["without a src/ folder", false],
])("the routes written into an existing app %s", (_label, srcDir) => {
  const appDir = srcDir ? "src/app" : "app";

  it("are the template's own routes, and report each as written", async () => {
    const result = await generateMediaRoutes(cwd, project(srcDir), TEMPLATES);

    expect(result).toEqual({
      written: [
        `${appDir}/${ADMIN_MEDIA}`,
        `${appDir}/${PUBLIC_MEDIA}`,
        `${appDir}/${HEALTH}`,
      ],
      changed: [],
      skipped: [],
    });
    for (const path of [ADMIN_MEDIA, PUBLIC_MEDIA]) {
      expect(withoutConfigSpecifier(written(appDir, path))).toBe(
        withoutConfigSpecifier(template(path))
      );
    }
    expect(written(appDir, HEALTH)).toBe(template(HEALTH));
  });

  // The project has no `@nextly-config` alias, so each route reaches the
  // config by a path relative to itself, wherever the app directory is.
  it("import the project's nextly.config by a path that resolves from where each file is", async () => {
    await generateMediaRoutes(cwd, project(srcDir), TEMPLATES);

    for (const path of [ADMIN_MEDIA, PUBLIC_MEDIA]) {
      const file = join(cwd, appDir, path);
      const specifier = configSpecifier(readFileSync(file, "utf8"));
      expect(specifier.startsWith(".")).toBe(true);
      expect(resolve(dirname(file), specifier)).toBe(
        join(cwd, "nextly.config")
      );
    }
  });

  // The admin's media library calls the route under /admin; only it may
  // serve writes, and only to a signed-in caller with the media permission.
  it("check every request to the admin route, and leave the public route read-only", async () => {
    await generateMediaRoutes(cwd, project(srcDir), TEMPLATES);

    expect(written(appDir, ADMIN_MEDIA)).toMatch(/requireAuth:\s*true/);
    expect(written(appDir, PUBLIC_MEDIA)).not.toMatch(/requireAuth/);
  });
});

describe("a project that already has one of the routes", () => {
  it("keeps every existing file exactly as it was, and reports it as skipped", async () => {
    const own =
      "// the project's own media route\nexport const GET = () => new Response('mine');\n";
    const health = "export const GET = () => Response.json({ ok: true });\n";
    for (const [path, text] of [
      [`src/app/${ADMIN_MEDIA}`, own],
      [`src/app/${HEALTH}`, health],
    ]) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), text);
    }

    const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

    // What a project without the file receives, for the hand-added text to match.
    const fresh = mkdtempSync(join(tmpdir(), "media-routes-fresh-"));
    try {
      await generateMediaRoutes(fresh, project(true), TEMPLATES);
      const nextlyRoute = readFileSync(
        join(fresh, "src/app", ADMIN_MEDIA),
        "utf8"
      );
      expect(result).toEqual({
        written: [`src/app/${PUBLIC_MEDIA}`],
        changed: [],
        skipped: [
          {
            path: `src/app/${ADMIN_MEDIA}`,
            why: "already exists; left as it is. The admin's media library needs Nextly's route here: replace or merge it with the content below",
            toAdd: nextlyRoute,
          },
          { path: `src/app/${HEALTH}`, why: "already exists; left as it is" },
        ],
      });
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
    expect(written("src/app", ADMIN_MEDIA)).toBe(own);
    expect(written("src/app", HEALTH)).toBe(health);
  });
});

describe("a template that no longer imports the config", () => {
  // A route copied without a config to rewrite would boot with none. Refusing
  // is the only safe answer, and it must come before anything is written.
  it("is refused before any file is written", async () => {
    const templates = mkdtempSync(join(tmpdir(), "media-templates-"));
    try {
      for (const path of [ADMIN_MEDIA, PUBLIC_MEDIA, HEALTH]) {
        const file = join(templates, "base/src/app", path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(
          file,
          path === PUBLIC_MEDIA
            ? "export const GET = () => new Response();\n"
            : template(path)
        );
      }

      await expect(
        generateMediaRoutes(cwd, project(true), templates)
      ).rejects.toThrow(/does not import the Nextly config/);
      // The broken route is the second; the first, which is fine, must not
      // have been written ahead of the refusal either.
      expect(() => readFileSync(join(cwd, "src/app", ADMIN_MEDIA))).toThrow();
      expect(() => readFileSync(join(cwd, "src/app", PUBLIC_MEDIA))).toThrow();
    } finally {
      rmSync(templates, { recursive: true, force: true });
    }
  });
});
