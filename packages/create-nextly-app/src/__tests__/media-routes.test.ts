/**
 * The media and health routes the existing-app path writes. Each case runs the
 * generator against a real temporary project and the repository's own
 * templates, so the files are judged as written, not as a mock recorded them.
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NEXTLY_MEDIA_PATHS,
  generateMediaRoutes,
  readMediaRouteTemplates,
} from "../generators/media-routes";
import { generateRoutes } from "../generators/routes";
import type { ProjectInfo } from "../types";

const TEMPLATES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../templates"
);
const TEMPLATES = await readMediaRouteTemplates(TEMPLATES_DIR);

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
  readFileSync(join(TEMPLATES_DIR, "base/src/app", path), "utf8");
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

describe("where Next.js sees the same URL", () => {
  // Route groups `(name)` and parallel-route slots `@name` are left out of
  // the URL, so a handler under one serves the same path as the folder the
  // route would be written to, and Next.js refuses the second at build.
  it("finds a handler behind a route group or a slot, and writes nothing beside it", async () => {
    mkdirSync(join(cwd, "src/app/(backend)/api/media"), { recursive: true });
    writeFileSync(
      join(cwd, "src/app/(backend)/api/media/route.ts"),
      "export const GET = () => Response.json([]);\n"
    );
    mkdirSync(join(cwd, "src/app/@ops/(checks)/api/health"), {
      recursive: true,
    });
    writeFileSync(
      join(cwd, "src/app/@ops/(checks)/api/health/route.ts"),
      "export const GET = () => Response.json({ ok: true });\n"
    );

    const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

    expect(result.written).toEqual([`src/app/${ADMIN_MEDIA}`]);
    expect(result.skipped.map(entry => entry.path)).toEqual([
      "src/app/(backend)/api/media",
      "src/app/@ops/(checks)/api/health",
    ]);
    expect(() => readFileSync(join(cwd, "src/app", PUBLIC_MEDIA))).toThrow();
    expect(() => readFileSync(join(cwd, "src/app", HEALTH))).toThrow();
  });

  // The health check is one URL, not a catch-all: a handler deeper in its
  // folder serves another URL and leaves /api/health unanswered.
  it("still writes the health check when only a child of its URL has a handler", async () => {
    mkdirSync(join(cwd, "src/app/api/health/details"), { recursive: true });
    writeFileSync(
      join(cwd, "src/app/api/health/details/route.ts"),
      "export const GET = () => Response.json({});\n"
    );

    const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

    expect(result.written).toContain(`src/app/${HEALTH}`);
    expect(result.skipped).toEqual([]);
  });
});

describe("a route handler that already answers the URL through a dynamic segment", () => {
  // A catch-all route handler takes every URL below it, and a dynamic one the
  // URL at its depth. A route written beside either would take those requests
  // from the handler the app already has, so it is left out and reported.
  it("writes nothing under a catch-all route handler that takes the URL", async () => {
    mkdirSync(join(cwd, "src/app/api/[...rest]"), { recursive: true });
    writeFileSync(
      join(cwd, "src/app/api/[...rest]/route.ts"),
      "export const GET = () => new Response();\n"
    );

    const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

    expect(result.written).toEqual([`src/app/${ADMIN_MEDIA}`]);
    expect(result.skipped.map(entry => entry.path)).toEqual([
      "src/app/api/[...rest]",
      "src/app/api/[...rest]",
    ]);
    for (const entry of result.skipped) {
      expect(entry.why).toMatch(/dynamic segment/);
    }
  });

  // The install writes Nextly's own admin API catch-all just before these
  // routes, as a new project has it, and the admin media route is meant to
  // sit beside it, taking /admin/api/media as the template's does.
  it("writes the admin media route beside the admin API route the install just wrote", async () => {
    await generateRoutes(cwd, project(true));

    const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

    expect(result.written).toEqual([
      `src/app/${ADMIN_MEDIA}`,
      `src/app/${PUBLIC_MEDIA}`,
      `src/app/${HEALTH}`,
    ]);
    expect(result.skipped).toEqual([]);
  });

  // Higher up, a catch-all takes several parts at once, which a single
  // dynamic segment cannot: only the catch-all reading reaches these URLs.
  it("writes nothing under a catch-all route handler at the app's root", async () => {
    mkdirSync(join(cwd, "app/[...rest]"), { recursive: true });
    writeFileSync(
      join(cwd, "app/[...rest]/route.ts"),
      "export const GET = () => new Response();\n"
    );

    const result = await generateMediaRoutes(cwd, project(false), TEMPLATES);

    expect(result.written).toEqual([]);
    expect(result.skipped.map(entry => entry.path)).toEqual([
      "app/[...rest]",
      "app/[...rest]",
      "app/[...rest]",
    ]);
  });

  it("writes nothing beside a dynamic route handler at the URL's last segment", async () => {
    mkdirSync(join(cwd, "app/api/[name]"), { recursive: true });
    writeFileSync(
      join(cwd, "app/api/[name]/route.ts"),
      "export const GET = () => new Response();\n"
    );

    const result = await generateMediaRoutes(cwd, project(false), TEMPLATES);

    expect(result.written).toEqual([`app/${ADMIN_MEDIA}`]);
    expect(result.skipped.map(entry => entry.path)).toEqual([
      "app/api/[name]",
      "app/api/[name]",
    ]);
  });

  // The controls: pages through dynamic segments are the usual shape of a
  // site, and static API routes beside them are how Next.js apps are built.
  it("still writes every route beside a catch-all page and a localised page tree", async () => {
    mkdirSync(join(cwd, "app/(frontend)/[...slug]"), { recursive: true });
    writeFileSync(
      join(cwd, "app/(frontend)/[...slug]/page.tsx"),
      "export default () => null;\n"
    );
    mkdirSync(join(cwd, "app/[locale]/about"), { recursive: true });
    writeFileSync(
      join(cwd, "app/[locale]/about/page.tsx"),
      "export default () => null;\n"
    );

    const result = await generateMediaRoutes(cwd, project(false), TEMPLATES);

    expect(result.skipped).toEqual([]);
    expect(result.written).toEqual([
      `app/${ADMIN_MEDIA}`,
      `app/${PUBLIC_MEDIA}`,
      `app/${HEALTH}`,
    ]);
  });
});

describe("a project that also uses the Pages Router", () => {
  // Next.js serves both routers in one app, but refuses to build when a page
  // and an app route answer the same URL. So a Pages Router endpoint at a
  // route's URL, in `pages/` or `src/pages/`, leaves that route unwritten.
  it("writes no app route where a page already answers its URL", async () => {
    mkdirSync(join(cwd, "pages/api"), { recursive: true });
    writeFileSync(
      join(cwd, "pages/api/health.ts"),
      "export default function handler() {}\n"
    );
    mkdirSync(join(cwd, "src/pages/api/media"), { recursive: true });
    writeFileSync(
      join(cwd, "src/pages/api/media/[...path].ts"),
      "export default function handler() {}\n"
    );

    const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

    expect(result.written).toEqual([`src/app/${ADMIN_MEDIA}`]);
    expect(result.skipped.map(entry => entry.path)).toEqual([
      "src/pages/api/media",
      "pages/api/health.ts",
    ]);
    for (const entry of result.skipped) {
      expect(entry.why).toMatch(/Pages Router/);
    }
    expect(() => readFileSync(join(cwd, "src/app", PUBLIC_MEDIA))).toThrow();
    expect(() => readFileSync(join(cwd, "src/app", HEALTH))).toThrow();
  });

  // A dynamic page on the way to the URL may answer it (`pages/api/[name].ts`
  // serves /api/health), and which one wins is not this generator's to judge.
  it("writes nothing where a dynamic page might answer the URL", async () => {
    mkdirSync(join(cwd, "pages/api"), { recursive: true });
    writeFileSync(
      join(cwd, "pages/api/[name].ts"),
      "export default function handler() {}\n"
    );

    const result = await generateMediaRoutes(cwd, project(false), TEMPLATES);

    expect(result.written).toEqual([`app/${ADMIN_MEDIA}`]);
    expect(result.skipped.map(entry => entry.path)).toEqual([
      "pages/api/[name].ts",
      "pages/api/[name].ts",
    ]);
  });

  // The control: pages at other URLs leave every route free to be written.
  it("still writes every route beside pages at other URLs", async () => {
    mkdirSync(join(cwd, "pages/api/webhooks"), { recursive: true });
    writeFileSync(join(cwd, "pages/about.tsx"), "export default () => null;\n");
    writeFileSync(
      join(cwd, "pages/api/webhooks/stripe.ts"),
      "export default function handler() {}\n"
    );

    const result = await generateMediaRoutes(cwd, project(false), TEMPLATES);

    expect(result.skipped).toEqual([]);
    expect(result.written).toEqual([
      `app/${ADMIN_MEDIA}`,
      `app/${PUBLIC_MEDIA}`,
      `app/${HEALTH}`,
    ]);
  });
});

describe("a route folder that is a symbolic link", () => {
  it.runIf(process.platform !== "win32")(
    "writes nothing when the app folder above it is a link",
    async () => {
      const elsewhere = mkdtempSync(join(tmpdir(), "media-routes-elsewhere-"));
      try {
        mkdirSync(join(elsewhere, "app"), { recursive: true });
        symlinkSync(elsewhere, join(cwd, "src"));

        const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

        expect(readdirSync(join(elsewhere, "app"))).toEqual([]);
        expect(result.written).toEqual([]);
        expect(result.skipped.map(entry => entry.path)).toEqual([
          "src",
          "src",
          "src",
        ]);
      } finally {
        rmSync(elsewhere, { recursive: true, force: true });
      }
    }
  );

  // Writing through a linked folder would put the route wherever the link
  // points, outside the project; the exclusive write guards only the file.
  it.runIf(process.platform !== "win32")(
    "writes nothing through it, and reports it",
    async () => {
      const elsewhere = mkdtempSync(join(tmpdir(), "media-routes-elsewhere-"));
      try {
        mkdirSync(join(cwd, "src/app/api"), { recursive: true });
        symlinkSync(elsewhere, join(cwd, "src/app/api/media"));

        const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

        expect(readdirSync(elsewhere)).toEqual([]);
        expect(result.written).toEqual([
          `src/app/${ADMIN_MEDIA}`,
          `src/app/${HEALTH}`,
        ]);
        expect(result.skipped).toEqual([
          expect.objectContaining({
            path: "src/app/api/media",
            why: expect.stringMatching(
              /^is a symbolic link; nothing was written through it\./
            ),
          }),
        ]);
        expect(result.skipped[0].toAdd).toContain("createMediaHandlers");
      } finally {
        rmSync(elsewhere, { recursive: true, force: true });
      }
    }
  );
});

describe("what Next.js does and does not route", () => {
  it("looks through a route group at the end of the URL", async () => {
    mkdirSync(join(cwd, "src/app/api/health/(ops)"), { recursive: true });
    writeFileSync(
      join(cwd, "src/app/api/health/(ops)/route.ts"),
      "export const GET = () => Response.json({ ok: true });\n"
    );

    const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

    expect(result.skipped.map(entry => entry.path)).toEqual([
      "src/app/api/health/(ops)",
    ]);
    expect(() => readFileSync(join(cwd, "src/app", HEALTH))).toThrow();
  });

  // Private folders, named with a leading underscore, and files in
  // extensions Next.js does not route by default, answer no URL.
  it("ignores private folders, which Next.js never routes", async () => {
    // Under a dynamic child, where a routed handler would clash with the catch-all.
    mkdirSync(join(cwd, "src/app/api/media/[id]/_fixtures"), {
      recursive: true,
    });
    writeFileSync(
      join(cwd, "src/app/api/media/[id]/_fixtures/route.ts"),
      "export const GET = () => new Response();\n"
    );

    const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

    expect(result.written).toEqual([
      `src/app/${ADMIN_MEDIA}`,
      `src/app/${PUBLIC_MEDIA}`,
      `src/app/${HEALTH}`,
    ]);
    expect(result.skipped).toEqual([]);
  });

  // What cannot be classified for certain is left alone and reported, never
  // written beside: a route or page file in an extension Next.js routes only
  // when the app configures it (the app's config is not evaluated), or a
  // folder that cannot be read.
  it("writes nothing where a route file's extension or a folder cannot be judged, and reports it", async () => {
    mkdirSync(join(cwd, "src/app/admin/api/media"), { recursive: true });
    writeFileSync(
      join(cwd, "src/app/admin/api/media/route.mjs"),
      "export const GET = () => new Response();\n"
    );

    const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

    expect(result.written).toEqual([
      `src/app/${PUBLIC_MEDIA}`,
      `src/app/${HEALTH}`,
    ]);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        path: "src/app/admin/api/media",
        why: expect.stringMatching(
          /^holds route\.mjs, which Next\.js routes only if the app configures that extension; left as it is\. The admin's media library needs Nextly's route at /
        ),
        toAdd: expect.stringContaining("requireAuth: true"),
      }),
    ]);
  });

  it.runIf(process.platform !== "win32" && process.getuid?.() !== 0)(
    "writes nothing beside a folder it cannot read",
    async () => {
      const locked = join(cwd, "src/app/api/media");
      mkdirSync(locked, { recursive: true });
      chmodSync(locked, 0o000);
      try {
        const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

        expect(result.written).toEqual([
          `src/app/${ADMIN_MEDIA}`,
          `src/app/${HEALTH}`,
        ]);
        expect(result.skipped).toEqual([
          expect.objectContaining({
            path: "src/app/api/media",
            why: expect.stringMatching(
              /^cannot be read, so whether it already answers this URL is unknown; left as it is\./
            ),
          }),
        ]);
      } finally {
        chmodSync(locked, 0o755);
      }
    }
  );

  // A concrete child URL sorts ahead of an optional catch-all, so the two
  // coexist; a dynamic child at the same level does not.
  it("writes a catch-all beside a concrete child route, and not beside a dynamic one", async () => {
    mkdirSync(join(cwd, "src/app/api/media/sign"), { recursive: true });
    writeFileSync(
      join(cwd, "src/app/api/media/sign/route.ts"),
      "export const POST = () => new Response();\n"
    );
    mkdirSync(join(cwd, "src/app/admin/api/media/(files)/[id]/thumb"), {
      recursive: true,
    });
    writeFileSync(
      join(cwd, "src/app/admin/api/media/(files)/[id]/thumb/route.ts"),
      "export const GET = () => new Response();\n"
    );

    const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

    expect(result.written).toEqual([
      `src/app/${PUBLIC_MEDIA}`,
      `src/app/${HEALTH}`,
    ]);
    // The folder named is the one holding the dynamic child: the route group.
    expect(result.skipped.map(entry => entry.path)).toEqual([
      "src/app/admin/api/media/(files)",
    ]);
    expect(
      readFileSync(join(cwd, "src/app/api/media/sign/route.ts"), "utf8")
    ).toContain("POST");
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

      await expect(readMediaRouteTemplates(templates)).rejects.toThrow(
        /does not import the Nextly config/
      );
      // The broken route is the second; the first, which is fine, must not
      // have been written ahead of the refusal either.
      expect(() => readFileSync(join(cwd, "src/app", ADMIN_MEDIA))).toThrow();
      expect(() => readFileSync(join(cwd, "src/app", PUBLIC_MEDIA))).toThrow();
    } finally {
      rmSync(templates, { recursive: true, force: true });
    }
  });
});

describe("a child folder at a media route's URL", () => {
  const child = (name: string) => {
    const file = join(cwd, "src/app/api/media", name, "route.ts");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "export const GET = () => new Response();\n");
  };
  const publicSkip = async () => {
    const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);
    expect(result.written).toEqual([
      `src/app/${ADMIN_MEDIA}`,
      `src/app/${HEALTH}`,
    ]);
    expect(result.skipped.map(entry => entry.path)).toEqual([
      "src/app/api/media",
    ]);
    return result.skipped[0]?.why ?? "";
  };

  /*
   * Next.js builds `[id]` beside `[[...path]]`, but matches the more specific
   * `[id]` first, so it would take every `/api/media/<id>` request, which
   * Nextly's route serves (an item by its id): the route is reported, not
   * written into a media library that would half work.
   */
  it("leaves the catch-all beside a single dynamic child, saying it would take the item requests", async () => {
    child("[id]");
    expect(await publicSkip()).toMatch(
      /^holds a dynamic route one part below this URL, which Next\.js matches first, so it would take the requests for a media item by its id/
    );
  });

  /*
   * Measured on Next.js 16: a second optional catch-all fails the build as an
   * ambiguous route, and a required one builds but fails every request at
   * this URL ("You cannot use both an required and optional catch-all route
   * at the same level").
   */
  it.each([
    [
      "[[...rest]]",
      /^holds another optional catch-all route, which Next\.js refuses to build beside Nextly's/,
    ],
    [
      "[...rest]",
      /^holds a required catch-all route, which Next\.js builds beside Nextly's optional catch-all and then fails every request/,
    ],
  ])(
    "leaves the catch-all beside a %s child, saying why",
    async (name, reason) => {
      child(name);
      expect(await publicSkip()).toMatch(reason);
    }
  );

  it.each(NEXTLY_MEDIA_PATHS)(
    "leaves the catch-all beside a %s/ child, which would take requests Nextly's route serves",
    async name => {
      child(name);
      expect(await publicSkip()).toMatch(
        new RegExp(
          `^holds a route at ${name}/, which would take the ${name} requests`
        )
      );
    }
  );

  // The paths are the handler's own: drift between the two would let a
  // child take requests nobody listed.
  it("names exactly the fixed first parts Nextly's media handler serves", () => {
    const handler = readFileSync(
      join(TEMPLATES_DIR, "../packages/nextly/src/api/media-handlers.ts"),
      "utf8"
    );
    const served = [...handler.matchAll(/segments\[0\] === "([^"]+)"/g)].map(
      found => found[1]
    );
    expect(served.length).toBeGreaterThan(0);
    expect([...new Set(served)].sort()).toEqual([...NEXTLY_MEDIA_PATHS].sort());
  });
});

describe("an app that sets pageExtensions", () => {
  const config = (text: string) =>
    writeFileSync(join(cwd, "next.config.ts"), text);
  const nothingWritten = () => {
    for (const route of [ADMIN_MEDIA, PUBLIC_MEDIA, HEALTH]) {
      const folder = dirname(join(cwd, "src/app", route));
      expect(() => readdirSync(folder)).toThrow();
    }
  };

  /*
   * Next.js routes `route.page.tsx` there and never `route.ts`, and the app
   * may already have routes under such names, so each route is reported with
   * the name to create and its content, and none is written.
   */
  it("writes no route, and names each under the extension the app routes", async () => {
    config(
      'const config = { pageExtensions: ["page.tsx", "page.ts"] };\nexport default config;\n'
    );

    const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

    expect(result.written).toEqual([]);
    expect(result.skipped.map(entry => entry.path)).toEqual([
      "src/app/admin/api/media/[[...path]]/route.page.tsx",
      "src/app/api/media/[[...path]]/route.page.tsx",
      "src/app/api/health/route.page.tsx",
    ]);
    expect(result.skipped[0]?.why).toMatch(
      /^next\.config\.ts sets pageExtensions, and Next\.js routes a file there only under a name with one of them/
    );
    expect(result.skipped[2]?.toAdd).toBe(template(HEALTH));
    nothingWritten();
  });

  it("gives a placeholder name for a list it cannot read", async () => {
    config(
      'const extensions = ["page.tsx"];\nexport default { pageExtensions: extensions };\n'
    );

    const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

    expect(result.written).toEqual([]);
    expect(result.skipped[2]?.path).toBe(
      "src/app/api/health/route.<one of your pageExtensions>"
    );
    nothingWritten();
  });

  it("says to add a module extension when the list holds none", async () => {
    config('export default { pageExtensions: ["md", "mdx"] };\n');

    const result = await generateMediaRoutes(cwd, project(true), TEMPLATES);

    expect(result.written).toEqual([]);
    expect(result.skipped[2]?.why).toContain(
      "none of them (md, mdx) is a JavaScript or TypeScript extension"
    );
    nothingWritten();
  });
});

describe("which Pages Router pages answer a route's URL", () => {
  const page = (file: string) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), "export default function handler() {}\n");
  };
  const run = () => generateMediaRoutes(cwd, project(false), TEMPLATES);
  const all = [`app/${ADMIN_MEDIA}`, `app/${PUBLIC_MEDIA}`, `app/${HEALTH}`];

  // `[slug].tsx` takes exactly one part, so it answers `/about` and never a
  // URL of two parts or more such as `/api/health`.
  it("writes every route beside a single dynamic page at the top", async () => {
    page("pages/[slug].tsx");

    const result = await run();

    expect(result.skipped).toEqual([]);
    expect(result.written).toEqual(all);
  });

  // A dynamic folder takes one part and is walked with the rest of the URL.
  it("follows a dynamic folder with the rest of the URL", async () => {
    page("pages/[section]/media.ts");

    const result = await run();

    expect(result.written).toEqual([`app/${ADMIN_MEDIA}`, `app/${HEALTH}`]);
    expect(result.skipped.map(entry => entry.path)).toEqual([
      "pages/[section]/media.ts",
    ]);
    expect(result.skipped[0]?.why).toMatch(/^is a dynamic Pages Router route/);
  });

  // `health/details.ts` is `/api/health/details`; only the folder's `index`
  // page, in any extension, or an optional catch-all in it is `/api/health`.
  it("writes the health route beside a page below its URL", async () => {
    page("pages/api/health/details.ts");

    const result = await run();

    expect(result.skipped).toEqual([]);
    expect(result.written).toEqual(all);
  });

  it.each([
    ["pages/api/health/index.ts", /^is a Pages Router route at the same URL/],
    ["pages/api/health/index.mdx", /^is a Pages Router route at the same URL/],
    ["pages/api/health/[[...rest]].ts", /^is a dynamic Pages Router route/],
  ])("leaves the health route where %s answers its URL", async (file, why) => {
    page(file);

    const result = await run();

    expect(result.written).toEqual([
      `app/${ADMIN_MEDIA}`,
      `app/${PUBLIC_MEDIA}`,
    ]);
    expect(result.skipped.map(entry => entry.path)).toEqual([file]);
    expect(result.skipped[0]?.why).toMatch(why);
  });

  // The media routes serve every URL below theirs, so any page there competes.
  it("leaves a media route beside any page below its URL", async () => {
    page("pages/api/media/details.ts");

    const result = await run();

    expect(result.written).toEqual([`app/${ADMIN_MEDIA}`, `app/${HEALTH}`]);
    expect(result.skipped.map(entry => entry.path)).toEqual([
      "pages/api/media",
    ]);
  });
});
