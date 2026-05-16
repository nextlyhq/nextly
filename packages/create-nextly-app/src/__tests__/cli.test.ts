/**
 * Regression tests for the positional `[directory]` argument parser in cli.ts.
 */

import { describe, expect, it } from "vitest";

import {
  resolveProjectArg,
  validateProjectName,
  validateProjectNamePromptInput,
} from "../cli-args";

// ============================================================
// resolveProjectArg
// ============================================================

describe("resolveProjectArg", () => {
  it("returns no project name and no cwd flag when no argument", () => {
    const result = resolveProjectArg(undefined);
    expect(result).toEqual({ projectName: undefined, installInCwd: false });
  });

  it("returns no project name and no cwd flag for empty string", () => {
    const result = resolveProjectArg("");
    expect(result).toEqual({ projectName: undefined, installInCwd: false });
  });

  it("returns installInCwd: true when '.' is passed", () => {
    const result = resolveProjectArg(".");
    expect(result).toEqual({ projectName: undefined, installInCwd: true });
  });

  it("returns project name for a simple directory name", () => {
    const result = resolveProjectArg("my-project");
    expect(result).toEqual({ projectName: "my-project", installInCwd: false });
  });

  it("returns basename for nested paths", () => {
    const result = resolveProjectArg("some/path/foo");
    expect(result).toEqual({ projectName: "foo", installInCwd: false });
  });

  it("returns basename when given a trailing slash", () => {
    const result = resolveProjectArg("foo/");
    expect(result).toEqual({ projectName: "foo", installInCwd: false });
  });

  // Treat "./" the same as ".": commander/users frequently type either form
  // when they mean "install in the current directory".
  it("returns installInCwd: true when './' is passed", () => {
    const result = resolveProjectArg("./");
    expect(result).toEqual({ projectName: undefined, installInCwd: true });
  });

  // "./foo" is a relative path; we still want the basename as the project
  // name and a subdirectory install, matching `create-next-app` and
  // `create-astro` semantics.
  it("returns basename for a leading './' path", () => {
    const result = resolveProjectArg("./foo");
    expect(result).toEqual({ projectName: "foo", installInCwd: false });
  });

  // Whitespace-only input should behave like an empty argument so that a
  // user mashing the spacebar at the prompt doesn't accidentally trigger
  // a cwd install.
  it("returns no project name and no cwd flag for whitespace-only input", () => {
    const result = resolveProjectArg("   ");
    expect(result).toEqual({ projectName: undefined, installInCwd: false });
  });
});

// ============================================================
// validateProjectName
// ============================================================

describe("validateProjectName", () => {
  it("accepts a normal lowercase name", () => {
    expect(validateProjectName("my-project")).toBeUndefined();
  });

  it("accepts names with digits, dots, and underscores", () => {
    expect(validateProjectName("my.app_2")).toBeUndefined();
  });

  it("rejects names starting with a dash", () => {
    expect(validateProjectName("-bad")).toBeDefined();
  });

  it("rejects names with uppercase letters", () => {
    expect(validateProjectName("MyApp")).toBeDefined();
  });

  it("rejects names with spaces", () => {
    expect(validateProjectName("my app")).toBeDefined();
  });
});

// ============================================================
// validateProjectNamePromptInput
// ============================================================

describe("validateProjectNamePromptInput", () => {
  // Empty string is accepted at the validate step because @clack/prompts
  // substitutes the `initialValue` / `defaultValue` for empty submissions.
  // Rejecting it here would block Enter-to-accept-default.
  it("accepts empty string (default value substitution)", () => {
    expect(validateProjectNamePromptInput("")).toBeUndefined();
  });

  it("accepts whitespace-only input", () => {
    expect(validateProjectNamePromptInput("   ")).toBeUndefined();
  });

  it("accepts '.' as cwd-install signal", () => {
    expect(validateProjectNamePromptInput(".")).toBeUndefined();
  });

  it("accepts './' as cwd-install signal", () => {
    expect(validateProjectNamePromptInput("./")).toBeUndefined();
  });

  it("accepts a plain folder name", () => {
    expect(validateProjectNamePromptInput("my-project")).toBeUndefined();
  });

  it("accepts a leading './' path", () => {
    expect(validateProjectNamePromptInput("./my-project")).toBeUndefined();
  });

  it("rejects an invalid folder name (uppercase)", () => {
    expect(validateProjectNamePromptInput("MyApp")).toBeDefined();
  });

  it("rejects '..' (path traversal masquerading as name)", () => {
    expect(validateProjectNamePromptInput("..")).toBeDefined();
  });
});
