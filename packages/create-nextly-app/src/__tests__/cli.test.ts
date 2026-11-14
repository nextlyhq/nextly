/**
 * Regression tests for the positional `[directory]` argument parser in cli.ts.
 */

import { describe, expect, it, vi } from "vitest";

import {
  resolveProjectArg,
  validateProjectName,
  validateProjectNamePromptInput,
  validateTemplateName,
} from "../cli-args";
import { packageVersion } from "../lib/package-version";
import { buildProgram } from "../program";

vi.mock("@nextlyhq/telemetry", () => ({
  init: async () => {},
  capture: () => {},
  shutdown: async () => {},
  classifyError: () => "unknown",
}));

/** Parses `args` without running a scaffold: what it printed and its exit code. */
async function parse(args: string[]) {
  const out: string[] = [];
  const createNextly = vi.fn(async (_options: unknown) => {});
  let exitCode = 0;
  let thrown = "";
  try {
    await buildProgram({ createNextly })
      .exitOverride()
      .configureOutput({
        writeOut: text => out.push(text),
        writeErr: text => out.push(text),
      })
      .parseAsync(args, { from: "user" });
  } catch (error) {
    exitCode = (error as { exitCode?: number }).exitCode ?? 1;
    thrown = String(error);
  }
  return {
    out: out.join(""),
    exitCode,
    thrown,
    ran: createNextly.mock.calls.length,
    options: createNextly.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined,
  };
}

describe("the create-nextly-app command line", () => {
  it("--version is the package's version", async () => {
    const result = await parse(["--version"]);
    expect(result.out.trim()).toBe(packageVersion());
    expect(result.ran).toBe(0);
  });

  it("a misspelt flag is refused with the nearest suggested", async () => {
    const result = await parse(["my-app", "--package-manger", "pnpm"]);
    expect(result.exitCode).toBe(1);
    expect(result.out).toContain("unknown option '--package-manger'");
    expect(result.out).toContain("Did you mean --package-manager?");
    expect(result.ran).toBe(0);
  });

  // --no-git is parsed and handed on, by design: the scaffold makes no
  // repository yet, so the flag changes nothing until it does (the full
  // scaffold test checks no .git is made either way).
  it("--no-git reaches the scaffold as git: false, and git is on otherwise", async () => {
    expect((await parse(["my-app", "--no-git"])).options?.git).toBe(false);
    expect((await parse(["my-app"])).options?.git).toBe(true);
  });

  it("a misspelt choice is refused with the nearest suggested", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new Error(`process.exit(${String(code)})`);
    });
    const result = await parse(["my-app", "-d", "postgres"]);
    expect(result.thrown).toContain("process.exit(1)");
    expect(result.ran).toBe(0);
    expect(String(error.mock.calls[0]?.[0])).toContain(
      "Did you mean --database postgresql?"
    );
    vi.restoreAllMocks();
  });
});

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

// ============================================================
// validateTemplateName
// ============================================================

describe("validateTemplateName", () => {
  // The interactive prompt offers every registered template, so the flag has
  // to accept the same set or `--template plugin` is refused for a template
  // the prompt would have scaffolded.
  it.each(["blank", "blog", "plugin"])("accepts the '%s' template", name => {
    expect(validateTemplateName(name)).toBeUndefined();
  });

  it("rejects an unknown template and lists every registered one", () => {
    const error = validateTemplateName("nope");
    expect(error).toContain("'nope'");
    expect(error).toContain("blank, blog, plugin");
  });
});
