/**
 * Tests for project detection utilities
 */

import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  detectPackageManager,
  detectPluginPackage,
  detectProject,
} from "../utils/detect";

/** A path in `/` form, so expectations written with `/` hold on Windows too, where `path.join` gives `\\`. */
const posix = (p: unknown) => String(p).replaceAll("\\", "/");

// Mock fs-extra
vi.mock("fs-extra", () => ({
  default: {
    pathExists: vi.fn(),
    readJson: vi.fn(),
  },
}));

const mockPathExists = vi.mocked(fs.pathExists);
const mockReadJson = vi.mocked(fs.readJson);

// detectPackageManager reads process.env.npm_config_user_agent first;
// the test runner (vitest invoked via pnpm) sets it, which would mask
// the lockfile-fallback path under test. Each lockfile test clears it
// in its own setup.
const originalUserAgent = process.env.npm_config_user_agent;

describe("detectPackageManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no lock files exist
    mockPathExists.mockResolvedValue(false);
    // Wipe the UA so the lockfile-fallback path is exercised.
    delete process.env.npm_config_user_agent;
  });

  afterEach(() => {
    if (originalUserAgent !== undefined) {
      process.env.npm_config_user_agent = originalUserAgent;
    }
  });

  it("should detect pnpm from pnpm-lock.yaml", async () => {
    mockPathExists.mockImplementation(async path => {
      return posix(path).endsWith("pnpm-lock.yaml");
    });

    const result = await detectPackageManager("/test/project");
    expect(result).toBe("pnpm");
  });

  it("should detect yarn from yarn.lock", async () => {
    mockPathExists.mockImplementation(async path => {
      return posix(path).endsWith("yarn.lock");
    });

    const result = await detectPackageManager("/test/project");
    expect(result).toBe("yarn");
  });

  it("should detect bun from bun.lockb", async () => {
    mockPathExists.mockImplementation(async path => {
      return posix(path).endsWith("bun.lockb");
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
      const pathStr = posix(path);
      return (
        pathStr.endsWith("pnpm-lock.yaml") || pathStr.endsWith("yarn.lock")
      );
    });

    const result = await detectPackageManager("/test/project");
    expect(result).toBe("pnpm");
  });

  // A lockfile says which manager installs this project; the user agent only
  // says which one launched the generator. Installing with the launcher instead
  // ran `npm install` in a pnpm app, and npm crashed on pnpm's node_modules.
  it("prefers the project's lockfile over npm_config_user_agent", async () => {
    process.env.npm_config_user_agent = "yarn/1.22.22 npm/? node/v22.10.0";
    mockPathExists.mockImplementation(async path => {
      return posix(path).endsWith("pnpm-lock.yaml");
    });
    expect(await detectPackageManager("/test/project")).toBe("pnpm");
  });

  it("keeps an npm project on npm when the generator is started through pnpm dlx", async () => {
    process.env.npm_config_user_agent = "pnpm/12.5.1 npm/? node/v24.21.0";
    mockPathExists.mockImplementation(async path => {
      return posix(path).endsWith("package-lock.json");
    });
    expect(await detectPackageManager("/test/project")).toBe("npm");
  });

  it("detects bun from the text lockfile Bun writes by default", async () => {
    mockPathExists.mockImplementation(async path => {
      return posix(path).endsWith("bun.lock");
    });
    expect(await detectPackageManager("/test/project")).toBe("bun");
  });

  // Whether an app inside a workspace takes the workspace's manager is tested
  // against real directories in workspace-root.test.ts: it depends on the
  // workspace listing the app, which these mocks cannot model.

  it("uses npm_config_user_agent when the directory has no lockfile", async () => {
    process.env.npm_config_user_agent = "yarn/1.22.22 npm/? node/v22.10.0";
    expect(await detectPackageManager("/test/project")).toBe("yarn");
  });

  it("falls back to lockfile when user-agent is not a known PM", async () => {
    process.env.npm_config_user_agent = "unknown-tool/1.0";
    mockPathExists.mockImplementation(async path => {
      return posix(path).endsWith("yarn.lock");
    });
    expect(await detectPackageManager("/test/project")).toBe("yarn");
  });

  it("falls back to npm when neither user-agent nor lockfile match", async () => {
    process.env.npm_config_user_agent = "unknown-tool/1.0";
    mockPathExists.mockResolvedValue(false);
    expect(await detectPackageManager("/test/project")).toBe("npm");
  });
});

describe("detectProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // detectProject calls detectPackageManager internally; wipe the UA
    // so the assertions about packageManager come from lockfile, not
    // the test runner's pnpm UA.
    delete process.env.npm_config_user_agent;
  });

  afterEach(() => {
    if (originalUserAgent !== undefined) {
      process.env.npm_config_user_agent = originalUserAgent;
    }
  });

  it("should detect a valid Next.js App Router project", async () => {
    mockPathExists.mockImplementation(async path => {
      const pathStr = posix(path);
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
      const pathStr = posix(path);
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
      const pathStr = posix(path);
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
      return posix(path).endsWith("package.json");
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
      const pathStr = posix(path);
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
      const pathStr = posix(path);
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
      const pathStr = posix(path);
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

describe("detectPluginPackage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.npm_config_user_agent;
  });

  afterEach(() => {
    if (originalUserAgent !== undefined) {
      process.env.npm_config_user_agent = originalUserAgent;
    }
  });

  // A plugin scaffold keeps its library in src/ and its Next.js app in dev/,
  // which the app detector rejects with "App Router not detected" although the
  // scaffold is exactly what the template ships.
  it("accepts the plugin layout the app detector rejects", async () => {
    mockPathExists.mockImplementation(async p => {
      const pathStr = posix(p);
      if (pathStr.endsWith("package.json")) return true;
      if (pathStr.endsWith("/src")) return true;
      if (pathStr.endsWith("pnpm-lock.yaml")) return true;
      return false;
    });
    mockReadJson.mockResolvedValue({ devDependencies: { next: "^16.0.0" } });

    await expect(detectProject("/test/plugin")).rejects.toThrow(
      "App Router not detected"
    );

    const result = await detectPluginPackage("/test/plugin");
    expect(result.packageManager).toBe("pnpm");
    expect(result.appDir).toBe("dev/src/app");
  });
});
