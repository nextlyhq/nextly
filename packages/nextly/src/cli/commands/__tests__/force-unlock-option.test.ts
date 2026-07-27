/**
 * The migrate-lock busy error tells operators to "run with `--force-unlock`".
 * That guidance is only true if every command that takes the shared migrate
 * lock actually registers the flag — on a command without it, Commander
 * rejects the retry with "unknown option". This test pins the flag to the
 * full set of lock-taking commands.
 */
import { describe, it, expect } from "vitest";

import { createProgram } from "../../program";

/** Commands that acquire the shared migrate lock (`withMigrateLock`). */
const LOCK_TAKING_COMMANDS = [
  "migrate",
  "migrate:down",
  "migrate:resolve",
  "upgrade",
];

describe("--force-unlock availability", () => {
  it.each(LOCK_TAKING_COMMANDS)(
    "registers --force-unlock on `nextly %s`",
    commandName => {
      const program = createProgram();
      const command = program.commands.find(c => c.name() === commandName);

      expect(
        command,
        `\`nextly ${commandName}\` is not registered`
      ).toBeDefined();
      const hasFlag = command?.options.some(
        option => option.long === "--force-unlock"
      );
      expect(
        hasFlag,
        `\`nextly ${commandName}\` takes the migrate lock but lacks --force-unlock`
      ).toBe(true);
    }
  );
});
