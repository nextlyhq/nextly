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

describe("a project that already has routes where these go", () => {
  /** What a project without those folders receives, for the hand-added text to match. */
  async function freshRoute(srcDir: boolean, route: string): Promise<string> {
    const fresh = mkdtempSync(join(tmpdir(), "media-routes-fresh-"));
    try {
      await generateMediaRoutes(fresh, project(srcDir), TEMPLATES);
      return readFileSync(
        join(fresh, srcDir ? "src/app" : "app", route),
        "utf8"
      );
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  }

  const ADMIN_ROLE = (file: string) =>
    `already holds routes; left as it is. The admin's media library needs Nextly's route at ${file}, where it uploads, edits and deletes media for signed-in users with media permissions: put the content below there, replacing or merging what handles those requests now`;
  const PUBLIC_ROLE = (file: string) =>
    `already holds routes; left as it is. Nextly's public media route at ${file} serves media files to visitors, read-only: put the content below there, replacing or merging what handles those requests now`;

  it("leaves a file at either media route's path exactly as it was, and says what to add there", async () => {
    const admin =
      "// the project's own admin media route\nexport const GET = () => new Response('mine');\n";
    const pub =
      "// the project's own public media route\nexport const GET = () => new Response('ours');\n";
    for (const [path, text] of [
      [`src/app/${ADMIN_MEDIA}`, admin],
      [`src/app/${PUBLIC_MEDIA}`, pub],
    ]) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), text);
    }

    const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

    expect(result).toEqual({
      written: [`src/app/${HEALTH}`],
      changed: [],
      skipped: [
        {
          path: "src/app/admin/api/media",
          why: ADMIN_ROLE(`src/app/${ADMIN_MEDIA}`),
          toAdd: await freshRoute(true, ADMIN_MEDIA),
        },
        {
          path: "src/app/api/media",
          why: PUBLIC_ROLE(`src/app/${PUBLIC_MEDIA}`),
          toAdd: await freshRoute(true, PUBLIC_MEDIA),
        },
      ],
    });
    expect(written("src/app", ADMIN_MEDIA)).toBe(admin);
    expect(written("src/app", PUBLIC_MEDIA)).toBe(pub);
  });

  // The route's whole folder is the unit: Next.js serves `route.js` as well
  // as `route.ts`, and an optional catch-all also answers its parent URL, so
  // a handler anywhere in the folder would compete with the one written here.
  it("adds no catch-all beside a handler the app has at its parent URL, in any route file", async () => {
    const media = "export const GET = () => Response.json([]);\n";
    const health = "export const GET = () => Response.json({ ok: true });\n";
    for (const [path, text] of [
      ["app/api/media/route.js", media],
      ["app/api/health/route.js", health],
    ]) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), text);
    }

    const result = await generateMediaRoutes(cwd, project(false), TEMPLATES);

    expect(result).toEqual({
      written: [`app/${ADMIN_MEDIA}`],
      changed: [],
      skipped: [
        {
          path: "app/api/media",
          why: PUBLIC_ROLE(`app/${PUBLIC_MEDIA}`),
          toAdd: await freshRoute(false, PUBLIC_MEDIA),
        },
        { path: "app/api/health", why: "already holds routes; left as it is" },
      ],
    });
    expect(() => readFileSync(join(cwd, "app", PUBLIC_MEDIA))).toThrow();
    expect(() => readFileSync(join(cwd, "app", HEALTH))).toThrow();
    expect(readFileSync(join(cwd, "app/api/media/route.js"), "utf8")).toBe(
      media
    );
    expect(readFileSync(join(cwd, "app/api/health/route.js"), "utf8")).toBe(
      health
    );
  });
});

describe("a folder that holds no handler", () => {
  // A folder is not a route: Next.js answers only through a route (or page)
  // file. An empty folder, or one with only a placeholder, competes with
  // nothing, so the route still goes there.
  it("still receives the route, beside whatever else it holds", async () => {
    mkdirSync(join(cwd, "src/app/admin/api/media"), { recursive: true });
    mkdirSync(join(cwd, "src/app/api/media"), { recursive: true });
    writeFileSync(join(cwd, "src/app/api/media/.gitkeep"), "");
    mkdirSync(join(cwd, "src/app/api/health/notes"), { recursive: true });
    writeFileSync(
      join(cwd, "src/app/api/health/notes/README.md"),
      "Health notes.\n"
    );

    const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

    expect(result).toEqual({
      written: [
        `src/app/${ADMIN_MEDIA}`,
        `src/app/${PUBLIC_MEDIA}`,
        `src/app/${HEALTH}`,
      ],
      changed: [],
      skipped: [],
    });
    expect(readFileSync(join(cwd, "src/app/api/media/.gitkeep"), "utf8")).toBe(
      ""
    );
  });

  it("counts a handler anywhere inside the folder, in any route or page file", async () => {
    mkdirSync(join(cwd, "src/app/admin/api/media/[id]"), { recursive: true });
    writeFileSync(
      join(cwd, "src/app/admin/api/media/[id]/route.tsx"),
      "export const GET = () => new Response();\n"
    );

    const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

    expect(result.skipped.map(entry => entry.path)).toEqual([
      "src/app/admin/api/media",
    ]);
    expect(() => readFileSync(join(cwd, "src/app", ADMIN_MEDIA))).toThrow();
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
