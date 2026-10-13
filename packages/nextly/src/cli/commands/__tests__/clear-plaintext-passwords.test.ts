/**
 * `users:clear-plaintext-passwords` previews unless told to apply.
 *
 * Clearing changes stored credentials, so a run without `--apply` must only
 * count. The clean-up itself is integration-tested on every dialect; this
 * checks which half the command asks for, and that it prints counts only.
 */
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
  },
} as unknown as Parameters<typeof runClearPlaintextPasswords>[1];

beforeEach(() => {
  printed.length = 0;
  find.mockReset().mockResolvedValue(["user-a", "user-b"]);
  clear.mockReset().mockResolvedValue(2);
});

describe("users:clear-plaintext-passwords", () => {
  it("only counts without --apply", async () => {
    expect(await runClearPlaintextPasswords(false, context)).toBe(2);
    expect(clear).not.toHaveBeenCalled();
    expect(printed.join("\n")).toContain("2 account(s)");
    expect(printed.join("\n")).toContain("Nothing was changed");
  });

  it("clears with --apply", async () => {
    expect(await runClearPlaintextPasswords(true, context)).toBe(2);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(printed.join("\n")).toContain("Cleared the stored password of 2");
  });

  it("prints counts, never an account", async () => {
    await runClearPlaintextPasswords(false, context);
    await runClearPlaintextPasswords(true, context);
    expect(printed.join("\n")).not.toContain("user-a");
  });

  it("says when there is nothing to clear", async () => {
    find.mockResolvedValue([]);
    clear.mockResolvedValue(0);
    await runClearPlaintextPasswords(false, context);
    await runClearPlaintextPasswords(true, context);
    expect(
      printed.filter(m => m.includes("No account holds a password"))
    ).toHaveLength(2);
  });

  it("gives migrate a line only when there is something to clear", () => {
    expect(plainTextPasswordNotice(0)).toBeNull();
    expect(plainTextPasswordNotice(3)).toContain(
      "nextly users:clear-plaintext-passwords"
    );
  });
});
