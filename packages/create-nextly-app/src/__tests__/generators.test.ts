/**
 * Tests for file generators
 */

import fs from "fs-extra";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { generateAdminPage } from "../generators/admin";
import { generateConfig } from "../generators/config";
import { generateEnv } from "../generators/env";
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
    expect(content).toContain(
      'import { defineConfig } from "@revnixhq/nextly/config"'
    );
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
      'import { createDynamicHandlers } from "@revnixhq/nextly"'
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
    expect(pageContent).toContain('import "@revnixhq/admin/style.css"');
    expect(pageContent).toContain(
      'import { RootLayout, QueryProvider, ErrorBoundary } from "@revnixhq/admin"'
    );
    expect(pageContent).toContain("export default function AdminPage");

    // Check layout.tsx
    const [layoutPath, layoutContent] = mockWriteFile.mock.calls[1];
    expect(layoutPath).toContain("src/app/admin/[[...params]]/layout.tsx");
    expect(layoutContent).toContain(
      'import { getBrandingCss } from "@revnixhq/nextly/config"'
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
      adapter: "@revnixhq/adapter-postgres",
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

  it("should not include storage configuration", async () => {
    mockPathExists.mockResolvedValue(false as never);

    const database: DatabaseConfig = {
      type: "postgresql",
      adapter: "@revnixhq/adapter-postgres",
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
      adapter: "@revnixhq/adapter-mysql",
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

  it("should not modify .env if DATABASE_URL already present", async () => {
    mockPathExists.mockImplementation((async (path: unknown) => {
      return String(path).endsWith(".env");
    }) as never);
    mockReadFile.mockResolvedValue("DATABASE_URL=existing_url\n" as never);

    const database: DatabaseConfig = {
      type: "sqlite",
      adapter: "@revnixhq/adapter-sqlite",
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

  it("should generate correct content for SQLite", async () => {
    mockPathExists.mockResolvedValue(false as never);

    const database: DatabaseConfig = {
      type: "sqlite",
      adapter: "@revnixhq/adapter-sqlite",
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
