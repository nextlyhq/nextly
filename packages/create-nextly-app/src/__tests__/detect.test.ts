/**
 * Tests for project detection utilities
 */

import fs from "fs-extra";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { detectPackageManager, detectProject } from "../utils/detect";

// Mock fs-extra
vi.mock("fs-extra", () => ({
  default: {
    pathExists: vi.fn(),
    readJson: vi.fn(),
  },
}));

const mockPathExists = vi.mocked(fs.pathExists);
const mockReadJson = vi.mocked(fs.readJson);

describe("detectPackageManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no lock files exist
    mockPathExists.mockResolvedValue(false);
  });

  it("should detect pnpm from pnpm-lock.yaml", async () => {
    mockPathExists.mockImplementation(async path => {
      return String(path).endsWith("pnpm-lock.yaml");
    });

    const result = await detectPackageManager("/test/project");
    expect(result).toBe("pnpm");
  });

  it("should detect yarn from yarn.lock", async () => {
    mockPathExists.mockImplementation(async path => {
      return String(path).endsWith("yarn.lock");
    });

    const result = await detectPackageManager("/test/project");
    expect(result).toBe("yarn");
  });

  it("should detect bun from bun.lockb", async () => {
    mockPathExists.mockImplementation(async path => {
      return String(path).endsWith("bun.lockb");
    });

    const result = await detectPackageManager("/test/project");
    expect(result).toBe("bun");
  });

  it("should default to npm when no lock file exists", async () => {
    mockPathExists.mockResolvedValue(false);

    const result = await detectPackageManager("/test/project");
    expect(result).toBe("npm");
  });

  it("should prioritize pnpm over yarn (check order)", async () => {
    // Both pnpm-lock.yaml and yarn.lock exist
    mockPathExists.mockImplementation(async path => {
      const pathStr = String(path);
      return (
        pathStr.endsWith("pnpm-lock.yaml") || pathStr.endsWith("yarn.lock")
      );
    });

    const result = await detectPackageManager("/test/project");
    expect(result).toBe("pnpm");
  });
});

describe("detectProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should detect a valid Next.js App Router project", async () => {
    mockPathExists.mockImplementation(async path => {
      const pathStr = String(path);
      if (pathStr.endsWith("package.json")) return true;
      if (pathStr.endsWith("tsconfig.json")) return true;
      if (pathStr.endsWith("src")) return true;
      if (pathStr.endsWith("src/app")) return true;
      if (pathStr.endsWith("pnpm-lock.yaml")) return true;
      return false;
    });

    mockReadJson.mockResolvedValue({
      dependencies: {
        next: "^14.0.0",
        react: "^18.0.0",
      },
    });

    const result = await detectProject("/test/project");

    expect(result).toEqual({
      isNextJs: true,
      isAppRouter: true,
      hasTypescript: true,
      packageManager: "pnpm",
      nextVersion: "14.0.0",
      srcDir: true,
      appDir: "src/app",
    });
  });

  it("should detect project without src directory", async () => {
    mockPathExists.mockImplementation(async path => {
      const pathStr = String(path);
      if (pathStr.endsWith("package.json")) return true;
      if (pathStr.endsWith("tsconfig.json")) return true;
      if (pathStr.endsWith("src")) return false;
      if (pathStr.endsWith("app")) return true;
      return false;
    });

    mockReadJson.mockResolvedValue({
      dependencies: {
        next: "~15.0.0",
      },
    });

    const result = await detectProject("/test/project");

    expect(result.srcDir).toBe(false);
    expect(result.appDir).toBe("app");
    expect(result.nextVersion).toBe("15.0.0");
  });

  it("should detect project without TypeScript", async () => {
    mockPathExists.mockImplementation(async path => {
      const pathStr = String(path);
      if (pathStr.endsWith("package.json")) return true;
      if (pathStr.endsWith("tsconfig.json")) return false;
      if (pathStr.endsWith("src")) return false;
      if (pathStr.endsWith("app")) return true;
      return false;
    });

    mockReadJson.mockResolvedValue({
      dependencies: {
        next: "14.0.0",
      },
    });

    const result = await detectProject("/test/project");

    expect(result.hasTypescript).toBe(false);
  });

  it("should throw error if package.json does not exist", async () => {
    mockPathExists.mockResolvedValue(false);

    await expect(detectProject("/test/project")).rejects.toThrow(
      "No package.json found"
    );
  });

  it("should throw error if Next.js is not in dependencies", async () => {
    mockPathExists.mockImplementation(async path => {
      return String(path).endsWith("package.json");
    });

    mockReadJson.mockResolvedValue({
      dependencies: {
        react: "^18.0.0",
      },
    });

    await expect(detectProject("/test/project")).rejects.toThrow(
      "Next.js not found in dependencies"
    );
  });

  it("should detect Next.js in devDependencies", async () => {
    mockPathExists.mockImplementation(async path => {
      const pathStr = String(path);
      if (pathStr.endsWith("package.json")) return true;
      if (pathStr.endsWith("app")) return true;
      return false;
    });

    mockReadJson.mockResolvedValue({
      devDependencies: {
        next: "^14.0.0",
      },
    });

    const result = await detectProject("/test/project");

    expect(result.isNextJs).toBe(true);
  });

  it("should throw error if App Router is not detected", async () => {
    mockPathExists.mockImplementation(async path => {
      const pathStr = String(path);
      if (pathStr.endsWith("package.json")) return true;
      // No app directory
      return false;
    });

    mockReadJson.mockResolvedValue({
      dependencies: {
        next: "^14.0.0",
      },
    });

    await expect(detectProject("/test/project")).rejects.toThrow(
      "App Router not detected"
    );
  });

  it("should handle Next.js version without semver prefix", async () => {
    mockPathExists.mockImplementation(async path => {
      const pathStr = String(path);
      if (pathStr.endsWith("package.json")) return true;
      if (pathStr.endsWith("app")) return true;
      return false;
    });

    mockReadJson.mockResolvedValue({
      dependencies: {
        next: "14.2.3",
      },
    });

    const result = await detectProject("/test/project");

    expect(result.nextVersion).toBe("14.2.3");
  });
});
