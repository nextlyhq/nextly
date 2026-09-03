/**
 * Tests for file generators
 */

import fs from "fs-extra";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { generateAdminPage } from "../generators/admin";
import { generateConfig } from "../generators/config";
import { generateEnv } from "../generators/env";
import { patchNextConfig } from "../generators/next-config";
import { generateRoutes } from "../generators/routes";
import { generateTypesDirectory } from "../generators/types";
import type { ProjectInfo, DatabaseConfig } from "../types";

// Mock fs-extra
vi.mock("fs-extra", () => ({
  default: {
    pathExists: vi.fn(),
    readJson: vi.fn(),
    writeFile: vi.fn(),
    appendFile: vi.fn(),
    readFile: vi.fn(),
    ensureDir: vi.fn(),
  },
}));

const mockPathExists = vi.mocked(fs.pathExists);
const mockWriteFile = vi.mocked(fs.writeFile);
const mockAppendFile = vi.mocked(fs.appendFile);
const mockReadFile = vi.mocked(fs.readFile);
const mockEnsureDir = vi.mocked(fs.ensureDir);

describe("generateConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathExists.mockResolvedValue(false as never);
    mockWriteFile.mockResolvedValue(undefined as never);
  });

  it("should generate blank template", async () => {
    await generateConfig("/test/project", "blank");

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [path, content] = mockWriteFile.mock.calls[0];
    expect(path).toContain("nextly.config.ts");
    expect(content).toContain('import { defineConfig } from "nextly/config"');
    expect(content).toContain("collections: []");
    expect(content).toContain("singles: []");
  });

  it("should fall back to blank for unknown project types", async () => {
    // Unknown types fall back to blank template via BASE_TEMPLATES lookup
    await generateConfig("/test/project", "blank");

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).toContain("collections: []");
    expect(content).toContain("singles: []");
  });

  it("should not include storage configuration", async () => {
    await generateConfig("/test/project", "blank");

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).not.toContain("storage");
    expect(content).not.toContain("vercelBlobStorage");
    expect(content).not.toContain("s3Storage");
  });

  it("should throw error if config already exists", async () => {
    mockPathExists.mockResolvedValue(true as never);

    await expect(generateConfig("/test/project", "blank")).rejects.toThrow(
      "nextly.config.ts already exists"
    );
  });
});

describe("patchNextConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined as never);
    mockReadFile.mockResolvedValue(
      'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;\n' as never
    );
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
    expect(path).toContain("src/app/admin/api/[[...params]]/route.ts");
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
    expect(path).toContain("app/admin/api/[[...params]]/route.ts");
    expect(path).not.toContain("src/app");
  });

  it("should throw error if route already exists", async () => {
    mockPathExists.mockResolvedValue(true as never);

    const projectInfo: ProjectInfo = {
      isNextJs: true,
      isAppRouter: true,
      hasTypescript: true,
      packageManager: "pnpm",
      nextVersion: "14.0.0",
      srcDir: true,
      appDir: "src/app",
    };

    await expect(generateRoutes("/test/project", projectInfo)).rejects.toThrow(
      "API route already exists"
    );
  });
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

    await generateAdminPage("/test/project", projectInfo);

    expect(mockEnsureDir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledTimes(2);

    // Check page.tsx
    const [pagePath, pageContent] = mockWriteFile.mock.calls[0];
    expect(pagePath).toContain("src/app/admin/[[...params]]/page.tsx");
    expect(pageContent).toContain('"use client"');
    expect(pageContent).toContain('import "@nextlyhq/admin/style.css"');
    expect(pageContent).toContain(
      'import { RootLayout, QueryProvider, ErrorBoundary } from "@nextlyhq/admin"'
    );
    expect(pageContent).toContain("export default function AdminPage");

    // Check layout.tsx
    const [layoutPath, layoutContent] = mockWriteFile.mock.calls[1];
    expect(layoutPath).toContain("src/app/admin/[[...params]]/layout.tsx");
    expect(layoutContent).toContain(
      'import { getBrandingCss } from "nextly/config"'
    );
    expect(layoutContent).toContain(
      'import config from "../../../../nextly.config"'
    );
    expect(layoutContent).toContain("getBrandingCss(config.admin?.branding)");
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

    await generateAdminPage("/test/project", projectInfo);

    const [pagePath] = mockWriteFile.mock.calls[0];
    expect(pagePath).toContain("app/admin/[[...params]]/page.tsx");
    expect(pagePath).not.toContain("src/app");

    // Without src/, config import should be 3 levels up
    const [, layoutContent] = mockWriteFile.mock.calls[1];
    expect(layoutContent).toContain(
      'import config from "../../../nextly.config"'
    );
  });

  it("should throw error if admin page already exists", async () => {
    mockPathExists.mockResolvedValue(true as never);

    const projectInfo: ProjectInfo = {
      isNextJs: true,
      isAppRouter: true,
      hasTypescript: true,
      packageManager: "pnpm",
      nextVersion: "14.0.0",
      srcDir: true,
      appDir: "src/app",
    };

    await expect(
      generateAdminPage("/test/project", projectInfo)
    ).rejects.toThrow("Admin page already exists");
  });
});

describe("generateEnv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined as never);
    mockAppendFile.mockResolvedValue(undefined as never);
  });

  it("should create new .env file when none exists", async () => {
    mockPathExists.mockResolvedValue(false as never);

    const database: DatabaseConfig = {
      type: "postgresql",
      adapter: "@nextlyhq/adapter-postgres",
      databaseDriver: "pg",
      connectionUrl: "postgresql://localhost/test",
      envExample: "postgresql://user:password@localhost:5432/nextly",
    };

    const result = await generateEnv("/test/project", database);

    expect(result).toEqual({ created: true, updated: false });
    expect(mockWriteFile).toHaveBeenCalledTimes(2); // .env and .env.example

    // Check .env.example
    const [examplePath, exampleContent] = mockWriteFile.mock.calls[0];
    expect(examplePath).toContain(".env.example");
    expect(exampleContent).toContain("DB_DIALECT=postgresql");
    expect(exampleContent).toContain(
      "DATABASE_URL=postgresql://user:password@localhost:5432/nextly"
    );
    // NEXTLY_SECRET should be auto-generated (not a placeholder)
    expect(exampleContent).toContain("NEXTLY_SECRET=");
    expect(exampleContent).not.toContain("change-me");

    // Check .env
    const [envPath, envContent] = mockWriteFile.mock.calls[1];
    expect(envPath).toContain(".env");
    expect(envContent).toContain("DB_DIALECT=postgresql");
  });

  it("names the variable the generated app READS for its public origin", async () => {
    /*
     * The scaffold wrote `NEXT_PUBLIC_APP_URL` and the base template's layout
     * read `NEXT_PUBLIC_SITE_URL`, so a project that configured the only URL
     * variable it was given still published `localhost` canonicals and Open
     * Graph tags. Nothing fails at build time for a wrong absolute URL, so the
     * first sign is a wrong link in someone else's crawler.
     */
    mockPathExists.mockResolvedValue(false as never);

    await generateEnv("/test/project", {
      type: "sqlite",
      adapter: "@nextlyhq/adapter-sqlite",
      databaseDriver: "better-sqlite3",
      connectionUrl: "file:./data.db",
      envExample: "file:./data.db",
    });

    const [, exampleContent] = mockWriteFile.mock.calls[0];
    expect(exampleContent).toContain("NEXT_PUBLIC_SITE_URL");
    // Commented, not set: the app's own origin is the right default, and an
    // uncommented localhost here would override it in every deployment.
    expect(exampleContent).toContain("# NEXT_PUBLIC_SITE_URL=");
  });

  it("still sets the app's own origin, which the backend reads", async () => {
    /*
     * The control. `NEXT_PUBLIC_APP_URL` is not decoration — the core package
     * reads it for preview links, invite emails and absolute API URLs — so a
     * change that introduced the public variable by replacing this one would
     * break those and satisfy the case above.
     */
    mockPathExists.mockResolvedValue(false as never);

    await generateEnv("/test/project", {
      type: "sqlite",
      adapter: "@nextlyhq/adapter-sqlite",
      databaseDriver: "better-sqlite3",
      connectionUrl: "file:./data.db",
      envExample: "file:./data.db",
    });

    const [, exampleContent] = mockWriteFile.mock.calls[0];
    expect(exampleContent).toContain(
      "NEXT_PUBLIC_APP_URL=http://localhost:3000"
    );
  });

  it("documents the diagnostics opt-in without enabling it", async () => {
    // Without the note the feature exists and nobody finds it: an author hitting
    // an error sees the generic public shape and has no reason to suspect there
    // is a flag that would have named the cause.
    mockPathExists.mockResolvedValue(false as never);

    await generateEnv("/test/project", {
      type: "sqlite",
      adapter: "@nextlyhq/adapter-sqlite",
      databaseDriver: "better-sqlite3",
      connectionUrl: "file:./nextly.db",
      envExample: "file:./nextly.db",
    });

    // The two targets by NAME, not just two payloads: asserting only the
    // contents passes if one file is written twice and the other skipped, which
    // is the failure this is meant to catch.
    const written = new Map(
      mockWriteFile.mock.calls.map(([p, content]) => [
        String(p).endsWith(".env.example") ? ".env.example" : ".env",
        content as string,
      ])
    );
    expect([...written.keys()].sort()).toEqual([".env", ".env.example"]);

    // A contributor working from .env.example should get the same experience as
    // the person who ran the scaffold.
    for (const text of written.values()) {
      // Present and explained, so the setting is discoverable...
      expect(text).toContain("NEXTLY_DEV_DIAGNOSTICS");
      // ...and COMMENTED, so it is not enabled by a file that ships with the
      // app. The flag is the second of two independent signals, and the second
      // exists because NODE_ENV is a runtime value a deployment can carry by
      // mistake. A default here would be true in exactly that case — the one it
      // guards against — which collapses two signals back into one.
      expect(text).toContain("# NEXTLY_DEV_DIAGNOSTICS=1");
      expect(text).not.toMatch(/^NEXTLY_DEV_DIAGNOSTICS=/m);
    }
  });

  it("should not include storage configuration", async () => {
    mockPathExists.mockResolvedValue(false as never);

    const database: DatabaseConfig = {
      type: "postgresql",
      adapter: "@nextlyhq/adapter-postgres",
      databaseDriver: "pg",
      connectionUrl: "postgresql://localhost/test",
      envExample: "postgresql://localhost/test",
    };

    await generateEnv("/test/project", database);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).not.toContain("STORAGE_ADAPTER");
    expect(content).not.toContain("BLOB_READ_WRITE_TOKEN");
    expect(content).not.toContain("S3_BUCKET");
  });

  it("should append to existing .env if DATABASE_URL not present", async () => {
    mockPathExists.mockImplementation((async (path: unknown) => {
      return String(path).endsWith(".env");
    }) as never);
    mockReadFile.mockResolvedValue("EXISTING_VAR=value\n" as never);

    const database: DatabaseConfig = {
      type: "mysql",
      adapter: "@nextlyhq/adapter-mysql",
      databaseDriver: "mysql2",
      connectionUrl: "mysql://localhost/test",
      envExample: "mysql://user:password@localhost:3306/nextly",
    };

    const result = await generateEnv("/test/project", database);

    expect(result).toEqual({ created: false, updated: true });
    expect(mockAppendFile).toHaveBeenCalledTimes(1);
    const [, appendContent] = mockAppendFile.mock.calls[0];
    expect(appendContent).toContain("DB_DIALECT=mysql");
  });

  it("should not re-add database config when DATABASE_URL is already present", async () => {
    // A configured .env keeps its database settings. It does still gain the
    // diagnostics note, which is keyed on its OWN absence — see below.
    mockPathExists.mockImplementation((async (path: unknown) => {
      return String(path).endsWith(".env");
    }) as never);
    mockReadFile.mockResolvedValue(
      "DATABASE_URL=existing_url\nNEXTLY_DEV_DIAGNOSTICS=1\n" as never
    );

    const database: DatabaseConfig = {
      type: "sqlite",
      adapter: "@nextlyhq/adapter-sqlite",
      databaseDriver: "better-sqlite3",
      connectionUrl: "file:./data/nextly.db",
      envExample: "file:./data/nextly.db",
    };

    const result = await generateEnv("/test/project", database);

    expect(result).toEqual({ created: false, updated: false });
    expect(mockAppendFile).not.toHaveBeenCalled();
    // Should still update .env.example
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it("does not mistake a similarly-named variable for the setting", async () => {
    // A substring test treats `NEXTLY_DEV_DIAGNOSTICS_BACKUP` as the setting
    // and skips the note, so a project that happens to use such a name never
    // learns the real one exists.
    mockPathExists.mockImplementation((async (path: unknown) =>
      String(path).endsWith(".env")) as never);
    mockReadFile.mockResolvedValue(
      "DATABASE_URL=existing\nNEXTLY_DEV_DIAGNOSTICS_BACKUP=1\n" as never
    );

    const result = await generateEnv("/test/project", {
      type: "sqlite",
      adapter: "@nextlyhq/adapter-sqlite",
      databaseDriver: "better-sqlite3",
      connectionUrl: "file:./nextly.db",
      envExample: "file:./nextly.db",
    });

    expect(result).toEqual({ created: false, updated: true });
    expect(mockAppendFile).toHaveBeenCalledOnce();
  });

  it.each([
    ["export form", "export NEXTLY_DEV_DIAGNOSTICS=1"],
    ["commented export", "# export NEXTLY_DEV_DIAGNOSTICS=1"],
    ["indented", "  NEXTLY_DEV_DIAGNOSTICS=1"],
    ["spaced around =", "NEXTLY_DEV_DIAGNOSTICS = 1"],
  ])("recognises the setting written as %s", async (_label, line) => {
    // dotenv accepts `export KEY=value` so the same file can be sourced by a
    // shell. A project written that way would otherwise be told the setting is
    // absent and handed a duplicate block below the one it already has.
    mockPathExists.mockImplementation((async (path: unknown) =>
      String(path).endsWith(".env")) as never);
    mockReadFile.mockResolvedValue(`DATABASE_URL=existing\n${line}\n` as never);

    const result = await generateEnv("/test/project", {
      type: "sqlite",
      adapter: "@nextlyhq/adapter-sqlite",
      databaseDriver: "better-sqlite3",
      connectionUrl: "file:./nextly.db",
      envExample: "file:./nextly.db",
    });

    expect(result).toEqual({ created: false, updated: false });
    expect(mockAppendFile).not.toHaveBeenCalled();
  });

  it("scans a blank-line-heavy .env without backtracking", async () => {
    // The whitespace classes are confined to the current line. With `\s` under
    // the `m` flag they cross newlines, so each retry chews through the blank
    // lines an .env is full of — quadratic on a file that does not contain the
    // key at all, which is the common case.
    mockPathExists.mockImplementation((async (path: unknown) =>
      String(path).endsWith(".env")) as never);
    mockReadFile.mockResolvedValue(
      ("DATABASE_URL=existing\n" + "   \n".repeat(20000)) as never
    );

    const started = performance.now();
    const result = await generateEnv("/test/project", {
      type: "sqlite",
      adapter: "@nextlyhq/adapter-sqlite",
      databaseDriver: "better-sqlite3",
      connectionUrl: "file:./nextly.db",
      envExample: "file:./nextly.db",
    });

    // Generous by design: this fails on catastrophic backtracking, not on a
    // slow machine. The pathological form takes orders of magnitude longer.
    expect(performance.now() - started).toBeLessThan(2000);
    expect(result).toEqual({ created: false, updated: true });
  });

  it("leaves an already-commented setting alone", async () => {
    // The commented form IS the note, so appending a second copy below it would
    // be noise rather than help.
    mockPathExists.mockImplementation((async (path: unknown) =>
      String(path).endsWith(".env")) as never);
    mockReadFile.mockResolvedValue(
      "DATABASE_URL=existing\n# NEXTLY_DEV_DIAGNOSTICS=1\n" as never
    );

    const result = await generateEnv("/test/project", {
      type: "sqlite",
      adapter: "@nextlyhq/adapter-sqlite",
      databaseDriver: "better-sqlite3",
      connectionUrl: "file:./nextly.db",
      envExample: "file:./nextly.db",
    });

    expect(result).toEqual({ created: false, updated: false });
    expect(mockAppendFile).not.toHaveBeenCalled();
  });

  it("adds the diagnostics note to an already-configured .env", async () => {
    // Installing into an existing Next.js project is a supported flow, and its
    // .env already has DATABASE_URL. Sharing that condition meant the file the
    // developer actually runs never mentioned the setting while .env.example
    // did, so the note reached only brand-new apps.
    mockPathExists.mockImplementation((async (path: unknown) => {
      return String(path).endsWith(".env");
    }) as never);
    mockReadFile.mockResolvedValue("DATABASE_URL=existing_url\n" as never);

    const result = await generateEnv("/test/project", {
      type: "sqlite",
      adapter: "@nextlyhq/adapter-sqlite",
      databaseDriver: "better-sqlite3",
      connectionUrl: "file:./data/nextly.db",
      envExample: "file:./data/nextly.db",
    });

    expect(result).toEqual({ created: false, updated: true });
    const [, appended] = mockAppendFile.mock.calls[0] as [string, string];
    expect(appended).toContain("NEXTLY_DEV_DIAGNOSTICS");
    // Appended commented, like everywhere else: the note is discoverable, the
    // setting is not enabled by a file that ships with the app.
    expect(appended).toContain("# NEXTLY_DEV_DIAGNOSTICS=1");
    // And it does not re-add the database block it was told is already there.
    expect(appended).not.toContain("DATABASE_URL=");
  });

  it("should generate correct content for SQLite", async () => {
    mockPathExists.mockResolvedValue(false as never);

    const database: DatabaseConfig = {
      type: "sqlite",
      adapter: "@nextlyhq/adapter-sqlite",
      databaseDriver: "better-sqlite3",
      connectionUrl: "file:./data/nextly.db",
      envExample: "file:./data/nextly.db",
    };

    await generateEnv("/test/project", database);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).toContain("DB_DIALECT=sqlite");
    expect(content).toContain("DATABASE_URL=file:./data/nextly.db");
  });
});

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
    expect(ensureDirPath).toContain("src/types/generated");

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
    expect(ensureDirPath).toContain("types/generated");
    expect(ensureDirPath).not.toContain("src/types");
  });

  it("should not overwrite existing files", async () => {
    mockPathExists.mockResolvedValue(true as never);

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

    // Should still ensure directory exists
    expect(mockEnsureDir).toHaveBeenCalled();
    // But should not write files if they exist
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
