/**
 * Regression tests for the positional `[directory]` argument parser in cli.ts.
 */

import { describe, expect, it } from "vitest";

import {
  resolveProjectArg,
  resolveProjectNameFromArg,
  validateProjectName,
} from "../cli-args";

// ============================================================
// resolveProjectNameFromArg (deprecated, kept for backwards compat)
// ============================================================

describe("resolveProjectNameFromArg", () => {
  it("returns undefined when no directory argument was passed", () => {
    expect(resolveProjectNameFromArg(undefined)).toBeUndefined();
  });

  it("returns undefined when directory is '.' (commander default)", () => {
    expect(resolveProjectNameFromArg(".")).toBeUndefined();
  });

  it("returns undefined when directory is an empty string", () => {
    expect(resolveProjectNameFromArg("")).toBeUndefined();
  });

  it("uses the argument as the project name when given a simple name", () => {
    expect(resolveProjectNameFromArg("postgres-code-first")).toBe(
      "postgres-code-first"
    );
  });

  it("uses the basename when given a nested path", () => {
    expect(resolveProjectNameFromArg("some/path/foo")).toBe("foo");
  });

  it("uses the basename when given a trailing slash", () => {
    expect(resolveProjectNameFromArg("foo/")).toBe("foo");
  });

  it("handles single-letter names", () => {
    expect(resolveProjectNameFromArg("a")).toBe("a");
  });

  it("passes through names that contain dashes, dots, and underscores", () => {
    expect(resolveProjectNameFromArg("my-nextly-app")).toBe("my-nextly-app");
    expect(resolveProjectNameFromArg("my.test.app")).toBe("my.test.app");
    expect(resolveProjectNameFromArg("my_app_1")).toBe("my_app_1");
  });
});

// ============================================================
// resolveProjectArg (new, replaces resolveProjectNameFromArg)
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
