/**
 * `users:clear-plaintext-passwords` previews unless told to apply.
 *
 * Clearing changes stored credentials, so a run without `--apply` must only
 * count. The clean-up itself is integration-tested on every dialect; this
 * checks which half the command asks for, and that it prints counts only.
 */
import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const find = vi.fn<() => Promise<string[]>>();
const clear = vi.fn<() => Promise<number>>();

vi.mock("../../../domains/users/services/plaintext-password-cleanup", () => ({
  PlainTextPasswordCleanup: class {
    find = find;
    clear = clear;
  },
}));

vi.mock("../../utils/adapter", () => ({
  withAdapter: async <T>(work: (adapter: unknown) => Promise<T>): Promise<T> =>
    work({}),
}));

import {
  plainTextPasswordNotice,
  registerClearPlaintextPasswordsCommand,
  runClearPlaintextPasswords,
} from "../clear-plaintext-passwords";

/** Everything printed, in order. */
const printed: string[] = [];

const context = {
  logger: {
    info: (m: string) => printed.push(m),
    warn: (m: string) => printed.push(`WARN ${m}`),
    error: (m: string) => printed.push(`ERROR ${m}`),
    debug: vi.fn(),
    success: (m: string) => printed.push(`OK ${m}`),
    newline: vi.fn(),
    keyValue: (k: string, v: string) => printed.push(`${k}=${v}`),
    getOptions: () => ({ noColor: true }),
  },
} as unknown as Parameters<typeof runClearPlaintextPasswords>[1];

beforeEach(() => {
  printed.length = 0;
  find.mockReset().mockResolvedValue(["user-a", "user-b"]);
  clear.mockReset().mockResolvedValue(2);
});

describe("users:clear-plaintext-passwords", () => {
  it("only counts without --apply, and warns about an app's own hasher", async () => {
    expect(await runClearPlaintextPasswords(false, context)).toBe(2);
    expect(clear).not.toHaveBeenCalled();
    expect(printed.join("\n")).toContain("2 account(s)");
    expect(printed.join("\n")).toContain("Nothing was changed");
    expect(printed.join("\n")).toContain("a passwordHasher to getNextly");
  });

  it("refuses --apply without the hasher confirmation, before reading anything", async () => {
    // The app's own hasher is invisible to the CLI, and its hashes can look
    // like plain text; clearing them locks people out.
    const refusal = runClearPlaintextPasswords(true, context);
    await expect(refusal).rejects.toMatchObject({
      code: "PASSWORD_CLEAR_UNCONFIRMED",
    });
    await expect(refusal).rejects.toMatchObject({
      next: expect.stringContaining("--apply --confirm-default-hasher"),
    });
    expect(clear).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });

  it("exits with status 1 when --apply lacks the hasher confirmation", async () => {
    // Automation reads the exit status: a refusal that exited 0 would record
    // the clean-up as done while every value stays.
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const run = async (...args: string[]) => {
        const program = new Command();
        registerClearPlaintextPasswordsCommand(program, () => context);
        await program.parseAsync(["users:clear-plaintext-passwords", ...args], {
          from: "user",
        });
      };
      await run("--apply");
      expect(exit).toHaveBeenCalledWith(1);
      expect(String(stderr.mock.calls[0]?.[0])).toContain(
        "(PASSWORD_CLEAR_UNCONFIRMED)"
      );
      expect(clear).not.toHaveBeenCalled();

      // The control: with the confirmation the same command clears, and does
      // not exit with an error.
      exit.mockClear();
      await run("--apply", "--confirm-default-hasher");
      expect(clear).toHaveBeenCalledTimes(1);
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
      stderr.mockRestore();
    }
  });

  it("clears with --apply and the hasher confirmation", async () => {
    expect(await runClearPlaintextPasswords(true, context, true)).toBe(2);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(printed.join("\n")).toContain("Cleared the stored password of 2");
    // Renewal ends at once; a token already issued lasts until it expires.
    expect(printed.join("\n")).toContain(
      "an access token already issued stays valid until it expires"
    );
  });

  it("prints counts, never an account", async () => {
    await runClearPlaintextPasswords(false, context);
    await runClearPlaintextPasswords(true, context, true);
    expect(printed.join("\n")).not.toContain("user-a");
  });

  it("says when there is nothing to clear", async () => {
    find.mockResolvedValue([]);
    clear.mockResolvedValue(0);
    await runClearPlaintextPasswords(false, context);
    await runClearPlaintextPasswords(true, context, true);
    expect(
      printed.filter(m => m.includes("No account holds a password"))
    ).toHaveLength(2);
  });

  it("gives migrate a line only when there is something to clear", () => {
    expect(plainTextPasswordNotice(0)).toBeNull();
    expect(plainTextPasswordNotice(3)).toContain(
      "nextly users:clear-plaintext-passwords"
    );
    expect(plainTextPasswordNotice(3)).toContain(
      "a passwordHasher to getNextly"
    );
  });
});
