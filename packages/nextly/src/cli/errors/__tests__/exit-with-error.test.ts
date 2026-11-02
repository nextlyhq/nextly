/**
 * `exitWithError` prints the error shape and then ends the process with the status a command
 * gives, 1 unless it names its own: the one place a command ends on a failure.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { exitWithError } from "../report";

/** What `process.exit` was called with, and the order the print and the exit came in. */
function capture() {
  const events: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation(() => {
    events.push("print");
    return true;
  });
  vi.spyOn(console, "error").mockImplementation(() => {
    events.push("print");
  });
  const exit = vi.spyOn(process, "exit").mockImplementation((code => {
    events.push(`exit ${String(code)}`);
    throw new Error("exited");
  }) as typeof process.exit);
  return { events, exit };
}

const logger = { getOptions: () => ({ verbose: false, noColor: true }) };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exitWithError", () => {
  it("exits with the status a command gives for its error", () => {
    const { exit } = capture();
    expect(() => exitWithError(logger, new Error("edited"), 2)).toThrow(
      "exited"
    );
    expect(exit).toHaveBeenCalledWith(2);
  });

  it("exits 1 when the command gives none", () => {
    const { exit } = capture();
    expect(() => exitWithError(logger, new Error("failed"))).toThrow("exited");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("prints the error shape before it exits", () => {
    const { events } = capture();
    expect(() => exitWithError(logger, new Error("failed"), 2)).toThrow(
      "exited"
    );
    expect(events.indexOf("print")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("print")).toBeLessThan(events.indexOf("exit 2"));
  });
});
