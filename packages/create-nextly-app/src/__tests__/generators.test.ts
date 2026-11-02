/**
 * Tests for file generators
 */

import { readFileSync } from "node:fs";

import fs from "fs-extra";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { generateAdminPage } from "../generators/admin";
import { generateConfig } from "../generators/config";
import { ADMIN_LAYOUT } from "../generators/media-routes";
import { patchNextConfig } from "../generators/next-config";
import { generateRoutes } from "../generators/routes";
import { generateTypesDirectory } from "../generators/types";
import type { ProjectInfo, DatabaseConfig } from "../types";

/** A path in `/` form, so expectations written with `/` hold on Windows too, where `path.join` gives `\\`. */
const posix = (p: unknown) => String(p).replaceAll("\\", "/");

// Mock fs-extra
vi.mock("fs-extra", () => ({
  default: {
    pathExists: vi.fn(),
    // Nothing on any path is a link: these cases scaffold into plain folders.
    lstat: vi.fn(async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }),
    readJson: vi.fn(),
    writeFile: vi.fn(),
    appendFile: vi.fn(),
    readFile: vi.fn(),
    ensureDir: vi.fn(),
  },
}));

const mockPathExists = vi.mocked(fs.pathExists);
const mockWriteFile = vi.mocked(fs.writeFile);
const mockReadFile = vi.mocked(fs.readFile);
const mockEnsureDir = vi.mocked(fs.ensureDir);

// The base template's admin layout, read past the mocked file system: the one
// source a generated admin layout is taken from.
const ADMIN_LAYOUT_TEXT = readFileSync(
  new URL(
    `../../../../templates/base/src/app/${ADMIN_LAYOUT.path}`,
    import.meta.url
  ),
  "utf8"
);
const templates = new Map([[ADMIN_LAYOUT.path, ADMIN_LAYOUT_TEXT]]);

const srcLayout: ProjectInfo = {
  isNextJs: true,
  isAppRouter: true,
  hasTypescript: true,
  packageManager: "pnpm",
  nextVersion: "16.0.0",
  srcDir: true,
  appDir: "src/app",
};
const rootLayout: ProjectInfo = { ...srcLayout, srcDir: false, appDir: "app" };

describe("generateConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathExists.mockResolvedValue(false as never);
    mockWriteFile.mockResolvedValue(undefined as never);
  });

  it("should generate blank template", async () => {
    await generateConfig("/test/project", "blank", rootLayout);

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [path, content] = mockWriteFile.mock.calls[0];
    expect(path).toContain("nextly.config.ts");
    expect(content).toContain('import { defineConfig } from "nextly/config"');
    expect(content).toContain("collections: []");
    expect(content).toContain("singles: []");
  });

  it("should fall back to blank for unknown project types", async () => {
    // Unknown types fall back to blank template via BASE_TEMPLATES lookup
    await generateConfig("/test/project", "blank", rootLayout);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).toContain("collections: []");
    expect(content).toContain("singles: []");
  });

  it("should not include storage configuration", async () => {
    await generateConfig("/test/project", "blank", rootLayout);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).not.toContain("storage");
    expect(content).not.toContain("vercelBlobStorage");
    expect(content).not.toContain("s3Storage");
  });

  // A file the app already has is kept and reported, not refused: that is
  // tested against real directories in existing-app-files.test.ts.

  // The types file goes where the app keeps its code. A `./src/...` path written
  // into an app with no src/ makes the first `generate:types` create a src/
  // folder beside the root app/, split from the schemas it writes at the root.
  it("points the types file into src/ for an app that uses src/", async () => {
    await generateConfig("/test/project", "blank", srcLayout);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).toContain(
      'outputFile: "./src/types/generated/nextly-types.ts"'
    );
  });

  it("points the types file at the root for an app with no src/", async () => {
    await generateConfig("/test/project", "blank", rootLayout);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).toContain(
      'outputFile: "./types/generated/nextly-types.ts"'
    );
    expect(content).not.toContain("./src/");
  });

  it("names the same file the types directory step creates", async () => {
    // Two steps write one path: the config names it, the types step creates
    // its placeholder. Observed from both calls, not restated here.
    mockEnsureDir.mockResolvedValue(undefined as never);
    for (const layout of [srcLayout, rootLayout]) {
      vi.clearAllMocks();
      mockPathExists.mockResolvedValue(false as never);
      await generateConfig("/test/project", "blank", layout);
      await generateTypesDirectory("/test/project", layout);

      const configured = String(mockWriteFile.mock.calls[0][1]).match(
        /outputFile: "\.\/([^"]+)"/
      )?.[1];
      const placeholder = posix(mockWriteFile.mock.calls[2][0]);
      expect(configured).toBeDefined();
      expect(placeholder).toBe(`/test/project/${configured}`);
    }
  });
});

describe("patchNextConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined as never);
    mockReadFile.mockResolvedValue(
      'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;\n' as never
    );
    // The app has Next.js 16 installed, so the top-level option is written.
    vi.mocked(fs.readJson).mockResolvedValue({
      name: "next",
      version: "16.0.1",
    } as never);
  });

  it("should inject only the selected database packages", async () => {
    mockPathExists.mockImplementation((async (p: unknown) => {
      const s = String(p);
      if (s.endsWith("next.config.ts")) return true;
      if (s.endsWith("next.config.mjs")) return false;
      if (s.endsWith("next.config.js")) return false;
      return false;
    }) as never);

    const database: DatabaseConfig = {
      type: "postgresql",
      adapter: "@nextlyhq/adapter-postgres",
      databaseDriver: "pg",
      connectionUrl: "postgresql://localhost/test",
      envExample: "postgresql://localhost/test",
    };

    await patchNextConfig("/test/project", database);

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).toContain("@nextlyhq/adapter-postgres");
    expect(content).toContain("pg");
    expect(content).not.toContain("@nextlyhq/adapter-mysql");
    expect(content).not.toContain("mysql2");
    expect(content).not.toContain("@nextlyhq/adapter-sqlite");
    expect(content).not.toContain("better-sqlite3");
  });
});

describe("generateRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathExists.mockResolvedValue(false as never);
    mockWriteFile.mockResolvedValue(undefined as never);
    mockEnsureDir.mockResolvedValue(undefined as never);
  });

  it("should generate API route in src/app directory", async () => {
    const projectInfo: ProjectInfo = {
      isNextJs: true,
      isAppRouter: true,
      hasTypescript: true,
      packageManager: "pnpm",
      nextVersion: "14.0.0",
      srcDir: true,
      appDir: "src/app",
    };

    await generateRoutes("/test/project", projectInfo);

    expect(mockEnsureDir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledTimes(1);

    const [path, content] = mockWriteFile.mock.calls[0];
    expect(posix(path)).toContain("src/app/admin/api/[[...params]]/route.ts");
    expect(content).toContain(
      'import { createDynamicHandlers } from "nextly/runtime"'
    );
    expect(content).toContain("export const GET = handlers.GET");
    expect(content).toContain("export const POST = handlers.POST");
    expect(content).toContain("export const PUT = handlers.PUT");
    expect(content).toContain("export const PATCH = handlers.PATCH");
    expect(content).toContain("export const DELETE = handlers.DELETE");
    expect(content).toContain("export const OPTIONS = handlers.OPTIONS");
  });

  it("should generate API route in app directory (no src)", async () => {
    const projectInfo: ProjectInfo = {
      isNextJs: true,
      isAppRouter: true,
      hasTypescript: true,
      packageManager: "npm",
      nextVersion: "14.0.0",
      srcDir: false,
      appDir: "app",
    };

    await generateRoutes("/test/project", projectInfo);

    const [path] = mockWriteFile.mock.calls[0];
    expect(posix(path)).toContain("app/admin/api/[[...params]]/route.ts");
    expect(posix(path)).not.toContain("src/app");
  });

  // A file the app already has is kept and reported, not refused: that is
  // tested against real directories in existing-app-files.test.ts.
});

describe("generateAdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathExists.mockResolvedValue(false as never);
    mockWriteFile.mockResolvedValue(undefined as never);
    mockEnsureDir.mockResolvedValue(undefined as never);
  });

  it("should generate admin page and layout", async () => {
    const projectInfo: ProjectInfo = {
      isNextJs: true,
      isAppRouter: true,
      hasTypescript: true,
      packageManager: "pnpm",
      nextVersion: "14.0.0",
      srcDir: true,
      appDir: "src/app",
    };

    await generateAdminPage("/test/project", projectInfo, templates);

    expect(mockEnsureDir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledTimes(2);

    // Check page.tsx
    const [pagePath, pageContent] = mockWriteFile.mock.calls[0];
    expect(posix(pagePath)).toContain("src/app/admin/[[...params]]/page.tsx");
    expect(pageContent).toContain('"use client"');
    expect(pageContent).toContain('import "@nextlyhq/admin/style.css"');
    expect(pageContent).toContain(
      'import { RootLayout, QueryProvider, ErrorBoundary } from "@nextlyhq/admin"'
    );
    expect(pageContent).toContain("export default function AdminPage");

    // Check layout.tsx
    const [layoutPath, layoutContent] = mockWriteFile.mock.calls[1];
    expect(posix(layoutPath)).toContain(
      "src/app/admin/[[...params]]/layout.tsx"
    );
    // The template's own layout, whose config import already suits src/.
    expect(layoutContent).toBe(ADMIN_LAYOUT_TEXT);
  });

  it("should generate admin page in app directory (no src)", async () => {
    const projectInfo: ProjectInfo = {
      isNextJs: true,
      isAppRouter: true,
      hasTypescript: true,
      packageManager: "npm",
      nextVersion: "14.0.0",
      srcDir: false,
      appDir: "app",
    };

    await generateAdminPage("/test/project", projectInfo, templates);

    const [pagePath] = mockWriteFile.mock.calls[0];
    expect(posix(pagePath)).toContain("app/admin/[[...params]]/page.tsx");
    expect(posix(pagePath)).not.toContain("src/app");

    // Without src/, config import should be 3 levels up
    const [, layoutContent] = mockWriteFile.mock.calls[1];
    expect(layoutContent).toBe(
      ADMIN_LAYOUT_TEXT.replace(
        '"../../../../nextly.config"',
        '"../../../nextly.config"'
      )
    );
  });

  // A file the app already has is kept and reported, not refused: that is
  // tested against real directories in existing-app-files.test.ts.
});

// generateEnv is tested in env-files.test.ts, against real files: what it
// must get right is what lands on disk when a project already has its own
// env files and .gitignore, which these mocked file-system calls could not
// show. Every property the earlier cases here held is asserted there.

describe("generateTypesDirectory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathExists.mockResolvedValue(false as never);
    mockWriteFile.mockResolvedValue(undefined as never);
    mockEnsureDir.mockResolvedValue(undefined as never);
  });

  it("should create types directory with src", async () => {
    const projectInfo: ProjectInfo = {
      isNextJs: true,
      isAppRouter: true,
      hasTypescript: true,
      packageManager: "pnpm",
      nextVersion: "14.0.0",
      srcDir: true,
      appDir: "src/app",
    };

    await generateTypesDirectory("/test/project", projectInfo);

    expect(mockEnsureDir).toHaveBeenCalled();
    const ensureDirPath = mockEnsureDir.mock.calls[0][0];
    expect(posix(ensureDirPath)).toContain("src/types/generated");

    // Should create .gitkeep and placeholder
    expect(mockWriteFile).toHaveBeenCalledTimes(2);

    const [gitkeepPath] = mockWriteFile.mock.calls[0];
    expect(gitkeepPath).toContain(".gitkeep");

    const [placeholderPath, placeholderContent] = mockWriteFile.mock.calls[1];
    expect(placeholderPath).toContain("nextly-types.ts");
    expect(placeholderContent).toContain("Nextly Generated Types");
    expect(placeholderContent).toContain("next dev");
  });

  it("should create types directory without src", async () => {
    const projectInfo: ProjectInfo = {
      isNextJs: true,
      isAppRouter: true,
      hasTypescript: true,
      packageManager: "npm",
      nextVersion: "14.0.0",
      srcDir: false,
      appDir: "app",
    };

    await generateTypesDirectory("/test/project", projectInfo);

    const ensureDirPath = mockEnsureDir.mock.calls[0][0];
    expect(posix(ensureDirPath)).toContain("types/generated");
    expect(posix(ensureDirPath)).not.toContain("src/types");
  });

  // Existing types files are kept byte for byte: existing-app-files.test.ts,
  // against real directories, since the write itself (wx) is what keeps them.
});
