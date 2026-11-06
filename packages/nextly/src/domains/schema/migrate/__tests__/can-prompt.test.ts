/**
 * Whether the CLI may ask a question: only with a person on both ends of a
 * terminal, `--non-interactive` not given, and `CI` not set. Every prompt in
 * the CLI asks this one function, so no command waits for input it cannot get.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { canPrompt, setNonInteractive } from "../can-prompt";

// A test worker's streams are not terminals and carry no `isTTY` at all, so
// each case sets it, and the original (usually absent) is put back after.
const original = {
  stdin: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
  stdout: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
};

/** `process.stdin` and `process.stdout` as terminals, or not. */
function terminals(stdin: boolean, stdout: boolean) {
  Object.defineProperty(process.stdin, "isTTY", {
    value: stdin,
    configurable: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    value: stdout,
    configurable: true,
  });
}

function restore(
  stream: NodeJS.ReadStream | NodeJS.WriteStream,
  was?: PropertyDescriptor
) {
  if (was) Object.defineProperty(stream, "isTTY", was);
  else delete (stream as { isTTY?: boolean }).isTTY;
}

beforeEach(() => {
  vi.stubEnv("CI", undefined);
  setNonInteractive(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
  restore(process.stdin, original.stdin);
  restore(process.stdout, original.stdout);
  setNonInteractive(false);
});

describe("canPrompt", () => {
  it("asks with a terminal on both ends, no --non-interactive and no CI", () => {
    terminals(true, true);
    expect(canPrompt()).toBe(true);
  });

  it.each([
    ["stdin is not a terminal", false, true],
    ["stdout is not a terminal", true, false],
    ["neither is a terminal", false, false],
  ])("never asks when %s", (_case, stdin, stdout) => {
    terminals(stdin, stdout);
    expect(canPrompt()).toBe(false);
  });

  it("never asks under --non-interactive, even at a terminal", () => {
    terminals(true, true);
    setNonInteractive(true);
    expect(canPrompt()).toBe(false);
  });

  it.each(["true", "1", "github-actions"])(
    "never asks with CI=%s, even at a terminal a runner fakes",
    value => {
      terminals(true, true);
      vi.stubEnv("CI", value);
      expect(canPrompt()).toBe(false);
    }
  );

  it.each(["", "false", "0"])(
    "treats CI=%j as unset, as the tools that read it do",
    value => {
      terminals(true, true);
      vi.stubEnv("CI", value);
      expect(canPrompt()).toBe(true);
    }
  );
});
