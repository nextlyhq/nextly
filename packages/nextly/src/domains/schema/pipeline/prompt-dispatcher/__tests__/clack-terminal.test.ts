import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RenameCandidate } from "../../pushschema-pipeline-interfaces.js";
import {
  ClackTerminalPromptDispatcher,
  TTYRequiredError,
} from "../clack-terminal.js";

// Spy hooks for the @clack/prompts entry points the dispatcher uses.
// We mock the module so tests can drive prompt outcomes deterministically
// without an actual terminal.
const mockSelect = vi.fn();
const mockIntro = vi.fn();
const mockOutro = vi.fn();
const mockIsCancel = vi.fn(
  (value: unknown) => value === Symbol.for("clack:cancel")
);

vi.mock("@clack/prompts", () => ({
  select: (...args: unknown[]) => mockSelect(...args),
  intro: (...args: unknown[]) => mockIntro(...args),
  outro: (...args: unknown[]) => mockOutro(...args),
  isCancel: (value: unknown) => mockIsCancel(value),
}));

const candidate = (
  fromColumn: string,
  toColumn: string,
  typesCompatible = true
): RenameCandidate => ({
  tableName: "dc_posts",
  fromColumn,
  toColumn,
  fromType: "text",
  toType: "text",
  typesCompatible,
  defaultSuggestion: typesCompatible ? "rename" : "drop_and_add",
});

describe("ClackTerminalPromptDispatcher - non-TTY", () => {
  let originalStdinIsTTY: boolean | undefined;
  let originalStdoutIsTTY: boolean | undefined;

  beforeEach(() => {
    originalStdinIsTTY = process.stdin.isTTY;
    originalStdoutIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
      writable: true,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalStdinIsTTY,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalStdoutIsTTY,
      configurable: true,
      writable: true,
    });
  });

  it("throws TTYRequiredError when there's a candidate AND no TTY", async () => {
    const dispatcher = new ClackTerminalPromptDispatcher();

    await expect(
      dispatcher.dispatch({
        candidates: [candidate("title", "name")],
        events: [],
        classification: "destructive",
        channel: "terminal",
      })
    ).rejects.toThrow(TTYRequiredError);
  });

  it("returns empty resolutions when no candidates AND no TTY (no prompt needed)", async () => {
    const dispatcher = new ClackTerminalPromptDispatcher();

    const result = await dispatcher.dispatch({
      candidates: [],
      events: [],
      classification: "safe",
      channel: "terminal",
    });

    expect(result).toEqual({
      confirmedRenames: [],
      resolutions: [],
      proceed: true,
    });
  });
});

describe("ClackTerminalPromptDispatcher - TTY available", () => {
  let originalStdinIsTTY: boolean | undefined;
  let originalStdoutIsTTY: boolean | undefined;

  beforeEach(() => {
    originalStdinIsTTY = process.stdin.isTTY;
    originalStdoutIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalStdinIsTTY,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalStdoutIsTTY,
      configurable: true,
      writable: true,
    });
  });

  it("user picks 'rename' on a single candidate; result includes confirmedRename", async () => {
    // Implementation encodes choice as `rename:<targetColumn>` so the
    // dispatcher knows which add was picked when multiple alternatives exist.
    mockSelect.mockResolvedValueOnce("rename:name");

    const dispatcher = new ClackTerminalPromptDispatcher();
    const c = candidate("title", "name");
    const result = await dispatcher.dispatch({
      candidates: [c],
      events: [],
      classification: "destructive",
      channel: "terminal",
    });

    expect(result.confirmedRenames).toEqual([c]);
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("user picks 'drop_and_add' on a single candidate; confirmedRenames is empty", async () => {
    mockSelect.mockResolvedValueOnce("drop_and_add");

    const dispatcher = new ClackTerminalPromptDispatcher();
    const result = await dispatcher.dispatch({
      candidates: [candidate("title", "name")],
      events: [],
      classification: "destructive",
      channel: "terminal",
    });

    expect(result.confirmedRenames).toEqual([]);
  });

  it("user cancels mid-prompt; throws PromptCancelledError", async () => {
    mockSelect.mockResolvedValueOnce(Symbol.for("clack:cancel"));

    const dispatcher = new ClackTerminalPromptDispatcher();

    await expect(
      dispatcher.dispatch({
        candidates: [candidate("title", "name")],
        events: [],
        classification: "destructive",
        channel: "terminal",
      })
    ).rejects.toThrow(/cancel/i);
  });

  it("multiple candidates with shrinking pool: each rename consumes its drop+add", async () => {
    // 2 drops (title, body) + 2 adds (name, summary) = up to 4 candidates.
    // First prompt: pick rename:name for title. Second prompt for body
    // shows only the 'summary' option (name is consumed); pick rename:summary.
    mockSelect.mockResolvedValueOnce("rename:name");
    mockSelect.mockResolvedValueOnce("rename:summary");

    const dispatcher = new ClackTerminalPromptDispatcher();
    const result = await dispatcher.dispatch({
      candidates: [
        candidate("title", "name"),
        candidate("title", "summary"), // alternative for title
        candidate("body", "name"), // alternative for body - skipped after name consumed
        candidate("body", "summary"),
      ],
      events: [],
      classification: "destructive",
      channel: "terminal",
    });

    expect(
      result.confirmedRenames.map(r => `${r.fromColumn}->${r.toColumn}`)
    ).toEqual(["title->name", "body->summary"]);
    // Only 2 prompts fired (one per drop), even though there were 4 raw candidates.
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });
});

describe("TTYRequiredError", () => {
  it("includes a clear actionable message", () => {
    const err = new TTYRequiredError("test reason");
    expect(err.message).toMatch(/TTY/i);
    expect(err.name).toBe("TTYRequiredError");
  });

  it("is instanceof Error", () => {
    const err = new TTYRequiredError("x");
    expect(err).toBeInstanceOf(Error);
  });
});
