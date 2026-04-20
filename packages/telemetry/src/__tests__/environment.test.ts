import { describe, it, expect } from "vitest";

import {
  detectOs,
  detectArch,
  detectPackageManager,
  detectIsDocker,
  detectIsCi,
  collectBaseContext,
} from "../environment.js";

describe("detectOs", () => {
  it("returns one of the known OS names", () => {
    const result = detectOs();
    expect(["darwin", "linux", "win32", "freebsd", "other"]).toContain(result);
  });
});

describe("detectArch", () => {
  it("returns one of the known arch names", () => {
    const result = detectArch();
    expect(["arm64", "x64", "other"]).toContain(result);
  });
});

describe("detectPackageManager", () => {
  it("reads npm_config_user_agent for pnpm", () => {
    const pm = detectPackageManager({
      npm_config_user_agent: "pnpm/9.0.0 npm/? node/v20.10.0 darwin arm64",
    });
    expect(pm).toBe("pnpm");
  });
  it("returns 'unknown' when no signal is present", () => {
    expect(detectPackageManager({})).toBe("unknown");
  });
  it("detects yarn, npm, bun from user agent strings", () => {
    expect(
      detectPackageManager({
        npm_config_user_agent: "yarn/1.22 npm/? node/v20 darwin arm64",
      })
    ).toBe("yarn");
    expect(
      detectPackageManager({
        npm_config_user_agent: "npm/10 node/v20 darwin arm64",
      })
    ).toBe("npm");
    expect(
      detectPackageManager({
        npm_config_user_agent: "bun/1.1 node/v20 darwin arm64",
      })
    ).toBe("bun");
  });
});

describe("detectIsCi", () => {
  it("returns true when CI env var is set", () => {
    expect(detectIsCi({ CI: "1" })).toBe(true);
  });
  it("returns true for known CI systems even if CI is unset", () => {
    expect(detectIsCi({ GITHUB_ACTIONS: "true" })).toBe(true);
    expect(detectIsCi({ GITLAB_CI: "true" })).toBe(true);
    expect(detectIsCi({ CIRCLECI: "true" })).toBe(true);
    expect(detectIsCi({ TRAVIS: "true" })).toBe(true);
    expect(detectIsCi({ JENKINS_URL: "http://x" })).toBe(true);
    expect(detectIsCi({ BUILDKITE: "true" })).toBe(true);
    expect(detectIsCi({ VERCEL: "1" })).toBe(true);
    expect(detectIsCi({ NETLIFY: "true" })).toBe(true);
    expect(detectIsCi({ RENDER: "true" })).toBe(true);
  });
  it("returns false for an empty env", () => {
    expect(detectIsCi({})).toBe(false);
  });
  it("treats CI=0 and CI=false as not-CI", () => {
    expect(detectIsCi({ CI: "0" })).toBe(false);
    expect(detectIsCi({ CI: "false" })).toBe(false);
  });
});

describe("detectIsDocker", () => {
  it("returns a boolean", () => {
    expect(typeof detectIsDocker()).toBe("boolean");
  });
});

describe("collectBaseContext", () => {
  it("produces a BaseContext with all required fields", () => {
    const ctx = collectBaseContext("nextly", "0.1.3");
    expect(ctx.cli_name).toBe("nextly");
    expect(ctx.cli_version).toBe("0.1.3");
    expect(ctx.node_version).toMatch(/^\d+\./);
    expect(ctx.schema_version).toBeGreaterThan(0);
    expect(typeof ctx.is_ci).toBe("boolean");
    expect(typeof ctx.is_docker).toBe("boolean");
  });
});
