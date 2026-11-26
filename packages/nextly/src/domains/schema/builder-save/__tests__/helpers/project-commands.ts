/**
 * The migration commands over a project a test runs, as their CLI would run them: each command's exit
 * and what it said. The test file mocks `cli/program` and `cli/utils/config-loader`, so that they load
 * the configuration it hands `loadedConfig` (`loaded-config.ts`).
 */
import { vi } from "vitest";

import { runMigrate } from "../../../../../cli/commands/migrate";
import { runMigrateCheck } from "../../../../../cli/commands/migrate-check";
import { runMigrateCreate } from "../../../../../cli/commands/migrate-create";
import type { CommandContext } from "../../../../../cli/program";
import { createLogger } from "../../../../../cli/utils/logger";
import { setNonInteractive } from "../../../migrate/can-prompt";

/** A command's end: whether it ended well, and everything it said. */
export interface Ended {
  ok: boolean;
  said: string;
}

async function command(
  cwd: string,
  run: (context: CommandContext) => Promise<void>
): Promise<Ended> {
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
    cwd,
  } as CommandContext;
  const printed = vi
    .spyOn(console, "error")
    .mockImplementation((...parts: unknown[]) => {
      said.push(parts.map(String).join(" "));
    });
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await run(context);
    return { ok: true, said: said.join("\n") };
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return { ok: match[1] === "0", said: said.join("\n") };
    const e = error as { publicMessage?: string; message?: string };
    said.push(String(e.publicMessage ?? e.message));
    return { ok: false, said: said.join("\n") };
  } finally {
    exit.mockRestore();
    printed.mockRestore();
  }
}

/** `migrate:check`, `migrate:create` and `nextly migrate` over the project at `cwd`, in turn. */
export async function migrationCommands(
  cwd: string
): Promise<Record<"check" | "create" | "migrate", Ended>> {
  const check = await command(cwd, context =>
    runMigrateCheck({ cwd }, context)
  );
  setNonInteractive(true);
  const create = await command(cwd, context =>
    runMigrateCreate("after", { cwd }, context)
  ).finally(() => setNonInteractive(false));
  const migrate = await command(cwd, context =>
    runMigrate(
      { cwd, throwOnFailure: true } as Parameters<typeof runMigrate>[0],
      context
    )
  );
  return { check, create, migrate };
}
