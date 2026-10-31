/**
 * The CLI's commands load neither the service registry, the core widgets nor
 * the dashboard defaults when they are imported.
 *
 * A command's test that reaches any of them loads more than a thousand modules,
 * and the module budget counts those files. It has broken that way twice: a
 * command imported a widget id, which brought `core-widgets/index.ts` and every
 * widget with it, and seven CLI and codegen tests turned heavy together. The
 * budget then names the heavy FILES; this names the EDGE, at the commit that
 * adds it, so the fix is the import rather than a hunt through the graph. The
 * budget stays the gate; this is the pointer.
 *
 * The walk is the shared one (`__tests__/source-import-walk.ts`): a static
 * read of what each file loads, with no module evaluated, so this test is
 * light itself; an `import()` loads only when it runs, which is how the
 * commands boot nextly when they need it, and the budget catches what an
 * `import()` run at load costs.
 *
 * @module cli/__tests__/cli-graph-stays-off-the-dashboard.test
 */
import { readdirSync } from "node:fs";
import { join, win32 } from "node:path";

import { describe, expect, it } from "vitest";

import {
  aliased,
  candidatesFor,
  chainTo,
  isSelfReference,
  loads,
  PACKAGE_NAME,
  sourceFile,
  SRC,
} from "../../__tests__/source-import-walk";
import { UNIT_FILE } from "../../__tests__/unit-files";

const COMMANDS = join(SRC, "cli", "commands");

/** What no command may load at once, named from `src`. */
const OFF_LIMITS = [
  "di/register.ts",
  "domains/widgets/core-widgets/index.ts",
  "domains/widgets/default-layout.ts",
];

/** The command modules: every source file in `cli/commands`, tests aside. */
const commandFiles = readdirSync(COMMANDS)
  .filter(name => /\.tsx?$/.test(name))
  .filter(name => !UNIT_FILE.test(name) && !/\.test-d\.tsx?$/.test(name))
  .map(name => join(COMMANDS, name));

describe("the CLI's commands", () => {
  it("load none of the service registry, core widgets or dashboard defaults", () => {
    const reached = commandFiles.flatMap(command => {
      const walk = loads(command);
      return OFF_LIMITS.map(module => join(SRC, module))
        .filter(module => walk.from.has(module))
        .map(module => chainTo(walk, module));
    });
    expect(reached).toEqual([]);
  });

  it("load nothing the walk cannot read or resolve", () => {
    const problems = [
      ...new Set(commandFiles.flatMap(command => loads(command).problems)),
    ];
    expect(problems).toEqual([]);
  });

  it("are all read, and the walk goes past their own files", () => {
    // Without this the assertions above pass as well for a walk that read
    // nothing: an empty folder, or every import resolved to nothing.
    expect(commandFiles.length).toBeGreaterThan(20);
    expect(commandFiles.some(file => UNIT_FILE.test(file))).toBe(false);
    expect(loads(join(COMMANDS, "migrate.ts")).from.size).toBeGreaterThan(20);
  });

  it("is the control: the walk finds each module where a static edge does reach it", () => {
    // The same walk from the files that do import them, so a module renamed
    // away, or a resolver that misses its path, fails here rather than
    // making the first case pass by finding nothing.
    const widgets = loads(join(SRC, "di/registrations/register-widgets.ts"));
    expect(
      widgets.from.has(join(SRC, "domains/widgets/core-widgets/index.ts"))
    ).toBe(true);
    expect(
      widgets.from.has(join(SRC, "domains/widgets/default-layout.ts"))
    ).toBe(true);
    // And the lazy edges are why the first case holds: followed, they reach
    // the registry from a command.
    expect(
      loads(join(COMMANDS, "plugin-lifecycle-runner.ts"), true).from.has(
        join(SRC, "di/register.ts")
      )
    ).toBe(true);
  });

  it("resolves every spelling the package resolves", () => {
    // The package's `@nextly/*` paths and an explicit extension name the same
    // modules a relative path does; a resolver that knew only the last would
    // let either spelling past the first case.
    expect(aliased("@nextly/di/register")?.map(sourceFile)).toContain(
      join(SRC, "di/register.ts")
    );
    expect(sourceFile(join(SRC, "di/register.ts"))).toBe(
      join(SRC, "di/register.ts")
    );
    expect(sourceFile(join(SRC, "di/register.js"))).toBe(
      join(SRC, "di/register.ts")
    );
    // On Windows, a folder's index is spelled with the separator its folder
    // is, so the lookups above find a module imported as a folder there too.
    const folder = win32.join(
      "C:\\nextly\\src",
      "domains/widgets/core-widgets"
    );
    expect(candidatesFor(folder, win32)).toContain(
      "C:\\nextly\\src\\domains\\widgets\\core-widgets\\index.ts"
    );
    expect(aliased("zod")).toBeUndefined();
    // The package's own name is not a package to skip.
    expect(isSelfReference(PACKAGE_NAME)).toBe(true);
    expect(isSelfReference(`${PACKAGE_NAME}/runtime`)).toBe(true);
    expect(isSelfReference(`${PACKAGE_NAME}-adjacent`)).toBe(false);
  });
});
