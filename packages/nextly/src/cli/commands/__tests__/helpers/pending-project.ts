/**
 * `migrate:check` and `migrate:create` driven themselves over a project directory, for the tests of
 * the changes not yet in a migration: the configuration is handed to the loader (the test file
 * mocks it to return `loaded.config`), and each run ends in its exit code and what it said.
 */
import type { MockInstance } from "vitest";
import { vi } from "vitest";

import { setNonInteractive } from "../../../../domains/schema/migrate/can-prompt";
import type { CommandContext } from "../../../program";
import { createLogger } from "../../../utils/logger";
import { runMigrateCheck } from "../../migrate-check";
import { runMigrateCreate } from "../../migrate-create";

/** What a run ends with: its exit code, if it exited, and every line it said. */
export interface Ran {
  code: number | undefined;
  said: string[];
}

/** The configuration the mocked loader returns. */
export interface Loaded {
  config: unknown;
}

/** Run `command` in `dir` over `config`, as the CLI runs it. */
async function run(
  loaded: Loaded,
  dir: string,
  config: unknown,
  command: (context: CommandContext) => Promise<void>
): Promise<Ran> {
  loaded.config = config;
  const said: string[] = [];
  const capture = (message: string) => {
    said.push(message);
  };
  const context = {
    logger: {
      ...createLogger({ quiet: true }),
      error: capture,
      info: capture,
      success: capture,
      warn: capture,
    },
    options: {},
    cwd: dir,
  } as CommandContext;
  // The error a command ends with is printed on standard error, in the error shape.
  const printed: MockInstance = vi
    .spyOn(console, "error")
    .mockImplementation(message => {
      said.push(String(message));
    });
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await command(context);
    return { code: undefined, said };
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return { code: Number(match[1]), said };
    throw error;
  } finally {
    exit.mockRestore();
    printed.mockRestore();
  }
}

/** The two commands over one project directory. */
export function pendingProject(loaded: Loaded, dir: () => string) {
  return {
    /** `nextly migrate:create --non-interactive` with `options`. */
    create: (
      config: unknown,
      options: Parameters<typeof runMigrateCreate>[1] = {}
    ): Promise<Ran> =>
      run(loaded, dir(), config, context => {
        // As `--non-interactive` does: no rename is asked about.
        setNonInteractive(true);
        return runMigrateCreate(
          "change",
          { cwd: dir(), ...options },
          context
        ).finally(() => setNonInteractive(false));
      }),
    /** `nextly migrate:check` with `options`. */
    check: (
      config: unknown,
      options: Parameters<typeof runMigrateCheck>[0] = {}
    ): Promise<Ran> =>
      run(loaded, dir(), config, context =>
        runMigrateCheck({ cwd: dir(), ...options }, context)
      ),
  };
}
