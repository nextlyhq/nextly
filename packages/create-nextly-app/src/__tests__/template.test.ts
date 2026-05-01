/**
 * Tests for template copy utility and package.json generation
 */

import path from "path";

import fs from "fs-extra";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { DatabaseConfig } from "../types";
import { copyTemplate, generatePackageJson } from "../utils/template";

// Mock fs-extra
vi.mock("fs-extra", () => ({
  default: {
    pathExists: vi.fn(),
    existsSync: vi.fn(),
    copy: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
    remove: vi.fn(),
  },
}));

const mockPathExists = vi.mocked(fs.pathExists);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockCopy = vi.mocked(fs.copy);
const mockWriteFile = vi.mocked(fs.writeFile);
const mockReaddir = vi.mocked(fs.readdir);

// ============================================================
// Test Fixtures
// ============================================================

const pgDatabase: DatabaseConfig = {
  type: "postgresql",
  adapter: "@revnixhq/adapter-postgres",
  databaseDriver: "pg",
  connectionUrl: "postgresql://localhost/test",
  envExample: "postgresql://localhost/test",
};

const mysqlDatabase: DatabaseConfig = {
  type: "mysql",
  adapter: "@revnixhq/adapter-mysql",
  databaseDriver: "mysql2",
  connectionUrl: "mysql://localhost/test",
  envExample: "mysql://localhost/test",
};

const sqliteDatabase: DatabaseConfig = {
  type: "sqlite",
  adapter: "@revnixhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

// ============================================================
// generatePackageJson Tests
// ============================================================

describe("generatePackageJson", () => {
  // First call warms the npm registry cache (fetches latest Next.js + @revnixhq versions)
  it("should include correct project name", async () => {
    const result = JSON.parse(await generatePackageJson("my-app", pgDatabase));
    expect(result.name).toBe("my-app");
  }, 30_000);

  it("should include only the selected adapter (PostgreSQL)", async () => {
    const result = JSON.parse(await generatePackageJson("test", pgDatabase));
    expect(result.dependencies["@revnixhq/adapter-postgres"]).toBeDefined();
    expect(result.dependencies["pg"]).toBeUndefined();
    expect(result.dependencies["mysql2"]).toBeUndefined();
    expect(result.dependencies["better-sqlite3"]).toBeUndefined();
  });

  it("should include only the selected adapter (MySQL)", async () => {
    const result = JSON.parse(await generatePackageJson("test", mysqlDatabase));
    expect(result.dependencies["@revnixhq/adapter-mysql"]).toBeDefined();
    expect(result.dependencies["@revnixhq/adapter-postgres"]).toBeUndefined();
  });

  it("should include only the selected adapter (SQLite)", async () => {
    const result = JSON.parse(
      await generatePackageJson("test", sqliteDatabase)
    );
    expect(result.dependencies["@revnixhq/adapter-sqlite"]).toBeDefined();
    expect(result.dependencies["@revnixhq/adapter-postgres"]).toBeUndefined();
  });

  it("should not include storage packages (local disk is default)", async () => {
    const result = JSON.parse(await generatePackageJson("test", pgDatabase));
    expect(result.dependencies["@revnixhq/storage-s3"]).toBeUndefined();
    expect(
      result.dependencies["@revnixhq/storage-vercel-blob"]
    ).toBeUndefined();
  });

  it("should always include core Nextly packages", async () => {
    const result = JSON.parse(await generatePackageJson("test", pgDatabase));
    expect(result.dependencies["@revnixhq/nextly"]).toBeDefined();
    expect(result.dependencies["@revnixhq/admin"]).toBeDefined();
    expect(result.dependencies["@revnixhq/adapter-drizzle"]).toBeDefined();
  });

  it("should always include Next.js and React", async () => {
    const result = JSON.parse(await generatePackageJson("test", pgDatabase));
    expect(result.dependencies["next"]).toBeDefined();
    expect(result.dependencies["react"]).toBeDefined();
    expect(result.dependencies["react-dom"]).toBeDefined();
  });

  it("should include dev dependencies", async () => {
    const result = JSON.parse(await generatePackageJson("test", pgDatabase));
    expect(result.devDependencies["typescript"]).toBeDefined();
    expect(result.devDependencies["@types/node"]).toBeDefined();
    expect(result.devDependencies["@types/react"]).toBeDefined();
    expect(result.devDependencies["eslint"]).toBeDefined();
  });

  it("should output valid JSON", async () => {
    const output = await generatePackageJson("test", pgDatabase);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("should omit @revnixhq packages in yalc mode", async () => {
    const result = JSON.parse(
      await generatePackageJson("test", pgDatabase, true)
    );
    expect(result.dependencies["@revnixhq/nextly"]).toBeUndefined();
    expect(result.dependencies["@revnixhq/admin"]).toBeUndefined();
    expect(result.dependencies["@revnixhq/adapter-drizzle"]).toBeUndefined();
    expect(result.dependencies["@revnixhq/adapter-postgres"]).toBeUndefined();
  });

  it("should not include DB drivers in yalc mode (they are transitive deps)", async () => {
    const result = JSON.parse(
      await generatePackageJson("test", pgDatabase, true)
    );
    expect(result.dependencies["pg"]).toBeUndefined();
    expect(result.dependencies["mysql2"]).toBeUndefined();
    expect(result.dependencies["better-sqlite3"]).toBeUndefined();
  });

  it("should include Next.js scripts", async () => {
    const result = JSON.parse(await generatePackageJson("test", pgDatabase));
    expect(result.scripts.dev).toBe("next dev --turbopack");
    expect(result.scripts.build).toBe("nextly migrate && next build");
    expect(result.scripts.start).toBe("next start");
    expect(result.scripts.lint).toBe("next lint");
  });

  it("should include db:* scripts that proxy to the nextly CLI", async () => {
    const result = JSON.parse(await generatePackageJson("test", pgDatabase));

    expect(result.scripts.nextly).toBe("nextly");
    expect(result.scripts["db:setup"]).toBe("nextly db:sync");
    expect(result.scripts["db:migrate"]).toBe("nextly migrate");
    expect(result.scripts["db:migrate:status"]).toBe("nextly migrate:status");
    expect(result.scripts["db:migrate:fresh"]).toBe("nextly migrate:fresh");
    expect(result.scripts["db:migrate:reset"]).toBe("nextly migrate:reset");
    expect(result.scripts["types:generate"]).toBe("nextly generate:types");
  });
});

// ============================================================
// copyTemplate Tests
// ============================================================

describe("copyTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: target dir does not exist, template dirs exist
    mockPathExists.mockResolvedValue(false as never);
    mockExistsSync.mockReturnValue(true);
    mockCopy.mockResolvedValue(undefined as never);
    mockWriteFile.mockResolvedValue(undefined as never);
    mockReaddir.mockResolvedValue([] as never);
  });

  it("should error if target directory already exists", async () => {
    mockPathExists.mockResolvedValueOnce(true as never);

    await expect(
      copyTemplate({
        projectName: "my-app",
        projectType: "blank",
        targetDir: "/test/my-app",
        database: pgDatabase,
      })
    ).rejects.toThrow('Directory "my-app" already exists');
  });

  it("should error if base template is missing", async () => {
    // target dir doesn't exist
    mockPathExists.mockResolvedValueOnce(false as never);
    // base dir doesn't exist
    mockPathExists.mockResolvedValueOnce(false as never);

    await expect(
      copyTemplate({
        projectName: "my-app",
        projectType: "blank",
        targetDir: "/test/my-app",
        database: pgDatabase,
      })
    ).rejects.toThrow("Base template not found");
  });

  it("should error if project type template is missing", async () => {
    // target dir doesn't exist
    mockPathExists.mockResolvedValueOnce(false as never);
    // base dir exists
    mockPathExists.mockResolvedValueOnce(true as never);
    // type dir doesn't exist
    mockPathExists.mockResolvedValueOnce(false as never);

    await expect(
      copyTemplate({
        projectName: "my-app",
        projectType: "blank",
        targetDir: "/test/my-app",
        database: pgDatabase,
      })
    ).rejects.toThrow('Template "blank" not found');
  });

  it("should copy base template and handle template files", async () => {
    // Smart mock: only the top-level template dirs exist (not src/, configs/, etc.)
    mockPathExists.mockImplementation((async (p: unknown) => {
      const s = String(p);
      // Target dir doesn't exist
      if (s === "/test/my-app") return false;
      // Base and type template dirs exist at top level
      if (s.endsWith(path.join("templates", "base"))) return true;
      if (s.endsWith(path.join("templates", "blank"))) return true;
      // Everything else (src/, configs/, nextly.config.ts, etc.) doesn't exist
      return false;
    }) as never);

    await copyTemplate({
      projectName: "my-app",
      projectType: "blank",
      targetDir: "/test/my-app",
      database: pgDatabase,
    });

    // At minimum, base template should be copied
    expect(mockCopy).toHaveBeenCalled();
    const firstCopySrc = mockCopy.mock.calls[0][0] as string;
    expect(firstCopySrc).toContain(path.join("templates", "base"));
  });

  it("should generate package.json in target directory", async () => {
    // Smart mock: true for base/type dir checks, false for everything else
    mockPathExists.mockImplementation((async (p: unknown) => {
      const s = String(p);
      if (s.includes("my-app") && !s.includes("templates")) return false; // target doesn't exist
      if (s.includes(path.join("templates", "base"))) return true;
      if (s.includes(path.join("templates", "blank"))) return true;
      return false;
    }) as never);

    await copyTemplate({
      projectName: "my-app",
      projectType: "blank",
      targetDir: "/test/my-app",
      database: pgDatabase,
    });

    // writeFile called for package.json
    const writeCall = mockWriteFile.mock.calls.find(
      call => (call[0] as string) === path.join("/test/my-app", "package.json")
    );
    expect(writeCall).toBeDefined();

    // Verify it's valid JSON with correct project name
    const content = JSON.parse(writeCall![1] as string);
    expect(content.name).toBe("my-app");
  });

  it("should generate package.json without @revnixhq packages in yalc mode", async () => {
    mockPathExists.mockImplementation((async (p: unknown) => {
      const s = String(p);
      if (s.includes("my-app") && !s.includes("templates")) return false;
      if (s.includes(path.join("templates", "base"))) return true;
      if (s.includes(path.join("templates", "blank"))) return true;
      return false;
    }) as never);

    await copyTemplate({
      projectName: "my-app",
      projectType: "blank",
      targetDir: "/test/my-app",
      database: pgDatabase,
      useYalc: true,
    });

    const writeCall = mockWriteFile.mock.calls.find(
      call => (call[0] as string) === path.join("/test/my-app", "package.json")
    );
    const content = JSON.parse(writeCall![1] as string);
    expect(content.dependencies["@revnixhq/nextly"]).toBeUndefined();
  });
});
