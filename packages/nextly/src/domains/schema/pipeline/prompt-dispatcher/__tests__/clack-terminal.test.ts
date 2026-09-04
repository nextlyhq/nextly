import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ClassifierEvent,
  RenameCandidate,
  ResolutionKind,
} from "../../pushschema-pipeline-interfaces";
import {
  ClackTerminalPromptDispatcher,
  TTYRequiredError,
} from "../clack-terminal";

// Spy hooks for the @clack/prompts entry points the dispatcher uses.
// We mock the module so tests can drive prompt outcomes deterministically
// without an actual terminal.
const mockSelect = vi.fn();
const mockConfirm = vi.fn();
const mockNote = vi.fn();
const mockIntro = vi.fn();
const mockOutro = vi.fn();
const mockIsCancel = vi.fn(
  (value: unknown) => value === Symbol.for("clack:cancel")
);

vi.mock("@clack/prompts", () => ({
  select: (...args: unknown[]) => mockSelect(...args),
  confirm: (...args: unknown[]) => mockConfirm(...args),
  note: (...args: unknown[]) => mockNote(...args),
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
  preservesValues: true,
  defaultSuggestion: typesCompatible ? "rename" : "drop_and_add",
});

/** A compatible rename that CONVERTS its values, as numeric-to-float does. */
const lossyCandidate = (): RenameCandidate => ({
  tableName: "dc_orders",
  fromColumn: "amount",
  toColumn: "total",
  fromType: "numeric(10,2)",
  toType: "float8",
  typesCompatible: true,
  preservesValues: false,
  valueChangeReason:
    "exact decimals become the nearest binary float, so stored digits are lost",
  defaultSuggestion: "rename",
});

const dropEvent = (col: string, type = "text", rows = 5) => ({
  id: `destructive_drop:dc_posts.${col}`,
  kind: "destructive_drop" as const,
  tableName: "dc_posts",
  columnName: col,
  columnType: type,
  tableRowCount: rows,
  applicableResolutions: ["confirm_drop", "abort"] as ResolutionKind[],
});

describe("ClackTerminalPromptDispatcher - non-TTY", () => {
  let originalStdinIsTTY: boolean | undefined;
  let originalStdoutIsTTY: boolean | undefined;
  let originalAcceptDataLoss: string | undefined;

  beforeEach(() => {
    originalStdinIsTTY = process.stdin.isTTY;
    originalStdoutIsTTY = process.stdout.isTTY;
    originalAcceptDataLoss = process.env.NEXTLY_ACCEPT_DATA_LOSS;
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
    delete process.env.NEXTLY_ACCEPT_DATA_LOSS;
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
    if (originalAcceptDataLoss === undefined)
      delete process.env.NEXTLY_ACCEPT_DATA_LOSS;
    else process.env.NEXTLY_ACCEPT_DATA_LOSS = originalAcceptDataLoss;
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

  it("names how many candidates it did not list", async () => {
    // The message exists to say what the operator would have been asked to approve. A
    // list of three beside a count of ten, with nothing marking the gap, reads as the
    // whole list — so the omission has to be stated, not implied by arithmetic.
    const dispatcher = new ClackTerminalPromptDispatcher();
    const many = Array.from({ length: 10 }, (_, i) =>
      candidate(`from_${i}`, `to_${i}`)
    );

    const error = await dispatcher
      .dispatch({
        candidates: many,
        events: [],
        classification: "destructive",
        channel: "terminal",
      })
      .then(
        () => null,
        (e: unknown) => e as Error
      );

    expect(error?.message).toContain("10 rename candidate(s)");
    expect(error?.message).toContain("+7 more");
  });

  it("says how many of the omitted events are column drops", async () => {
    // "+54 more" still leaves a reader unable to act. A drop is the only omitted kind
    // that loses data, so its count is reported separately.
    const dispatcher = new ClackTerminalPromptDispatcher();
    const events: ClassifierEvent[] = [
      ...Array.from({ length: 3 }, (_, i) => ({
        kind: "type_change" as const,
        id: `evt_type_${i}`,
        tableName: "dc_posts",
        columnName: `shown_${i}`,
        fromType: "varchar(20)",
        toType: "varchar(255)",
        isWidening: true,
        perDialectWarning: { pg: "", mysql: "", sqlite: "" },
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        kind: "destructive_drop" as const,
        id: `evt_drop_${i}`,
        tableName: "dc_posts",
        columnName: `hidden_${i}`,
        columnType: "text",
        tableRowCount: 1,
        applicableResolutions: [],
      })),
    ];

    const error = await dispatcher
      .dispatch({
        candidates: [candidate("title", "name")],
        events,
        classification: "destructive",
        channel: "terminal",
      })
      .then(
        () => null,
        (e: unknown) => e as Error
      );

    expect(error?.message).toContain("7 resolution event(s)");
    expect(error?.message).toContain("+4 more");
    expect(error?.message).toContain("4 of them column drops");
  });

  it("adds no remainder when nothing was omitted", async () => {
    const dispatcher = new ClackTerminalPromptDispatcher();

    const error = await dispatcher
      .dispatch({
        candidates: [candidate("title", "name")],
        events: [],
        classification: "destructive",
        channel: "terminal",
      })
      .then(
        () => null,
        (e: unknown) => e as Error
      );

    expect(error?.message).toContain("1 rename candidate(s)");
    expect(error?.message).not.toContain("more");
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

  it("NEXTLY_ACCEPT_DATA_LOSS=1 auto-confirms a drop-only batch without a TTY", async () => {
    // `db:sync --accept-data-loss` exports this env var precisely for
    // non-interactive runs; a drop-only batch must proceed instead of
    // throwing TTYRequiredError.
    process.env.NEXTLY_ACCEPT_DATA_LOSS = "1";
    const dispatcher = new ClackTerminalPromptDispatcher();

    const result = await dispatcher.dispatch({
      candidates: [],
      events: [dropEvent("excerpt"), dropEvent("byline")],
      classification: "interactive",
      channel: "terminal",
    });

    expect(result.proceed).toBe(true);
    expect(result.resolutions).toEqual([
      { kind: "confirm_drop", eventId: "destructive_drop:dc_posts.excerpt" },
      { kind: "confirm_drop", eventId: "destructive_drop:dc_posts.byline" },
    ]);
  });

  it("still throws without a TTY when the opt-in batch includes a rename candidate", async () => {
    // The opt-in only covers destructive drops; anything needing a real
    // decision (renames, type changes) keeps requiring a terminal.
    process.env.NEXTLY_ACCEPT_DATA_LOSS = "1";
    const dispatcher = new ClackTerminalPromptDispatcher();

    await expect(
      dispatcher.dispatch({
        candidates: [candidate("title", "name")],
        events: [dropEvent("excerpt")],
        classification: "interactive",
        channel: "terminal",
      })
    ).rejects.toThrow(TTYRequiredError);
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

  it("does not offer a value-converting rename as 'data preserved'", async () => {
    // The hint is the only thing an author reads before choosing, and it said
    // "data preserved" over a conversion that turns every exact decimal into
    // the nearest binary float. Asserted on the OPTIONS the prompt is built
    // with, because that is the text on screen.
    mockSelect.mockResolvedValueOnce("rename:total");

    const dispatcher = new ClackTerminalPromptDispatcher();
    await dispatcher.dispatch({
      candidates: [lossyCandidate()],
      events: [],
      classification: "destructive",
      channel: "terminal",
    });

    const options = (
      mockSelect.mock.calls[0][0] as { options: { hint?: string }[] }
    ).options;
    const renameHint = options[0].hint ?? "";
    expect(renameHint).not.toMatch(/data preserved/i);
    expect(renameHint).toMatch(/VALUES CHANGE/);
    expect(renameHint).toMatch(/binary float/);
  });

  it("still offers a type-preserving rename as 'data preserved'", async () => {
    // The control: without it the assertion above passes just as well against
    // a prompt that stopped saying it for every candidate.
    mockSelect.mockResolvedValueOnce("rename:name");

    const dispatcher = new ClackTerminalPromptDispatcher();
    await dispatcher.dispatch({
      candidates: [candidate("title", "name")],
      events: [],
      classification: "destructive",
      channel: "terminal",
    });

    const options = (
      mockSelect.mock.calls[0][0] as { options: { hint?: string }[] }
    ).options;
    expect(options[0].hint ?? "").toMatch(/data preserved/i);
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

describe("ClackTerminalPromptDispatcher - destructive_drop events", () => {
  let originalStdinIsTTY: boolean | undefined;
  let originalStdoutIsTTY: boolean | undefined;
  let originalFlag: string | undefined;
  let originalAcceptFlag: string | undefined;

  beforeEach(() => {
    originalStdinIsTTY = process.stdin.isTTY;
    originalStdoutIsTTY = process.stdout.isTTY;
    originalFlag = process.env.NEXTLY_ALLOW_CODE_FIRST_DROPS;
    originalAcceptFlag = process.env.NEXTLY_ACCEPT_DATA_LOSS;
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
    delete process.env.NEXTLY_ALLOW_CODE_FIRST_DROPS;
    delete process.env.NEXTLY_ACCEPT_DATA_LOSS;
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
    if (originalFlag === undefined)
      delete process.env.NEXTLY_ALLOW_CODE_FIRST_DROPS;
    else process.env.NEXTLY_ALLOW_CODE_FIRST_DROPS = originalFlag;
    if (originalAcceptFlag === undefined)
      delete process.env.NEXTLY_ACCEPT_DATA_LOSS;
    else process.env.NEXTLY_ACCEPT_DATA_LOSS = originalAcceptFlag;
  });

  it("user confirms a single drop; emits one confirm_drop resolution", async () => {
    mockConfirm.mockResolvedValue(true);
    const dispatcher = new ClackTerminalPromptDispatcher();
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [dropEvent("excerpt", "text", 5)],
      classification: "interactive",
      channel: "terminal",
    });
    expect(result.proceed).toBe(true);
    expect(result.resolutions).toEqual([
      { kind: "confirm_drop", eventId: "destructive_drop:dc_posts.excerpt" },
    ]);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    // The note rendered above the prompt surfaces the type + row count.
    expect(mockNote).toHaveBeenCalled();
  });

  it("user declines a drop; proceed=false and the pipeline aborts", async () => {
    mockConfirm.mockResolvedValue(false);
    const dispatcher = new ClackTerminalPromptDispatcher();
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [dropEvent("excerpt")],
      classification: "interactive",
      channel: "terminal",
    });
    expect(result.proceed).toBe(false);
    expect(result.resolutions).toEqual([]);
  });

  it("prompts once per destructive_drop event", async () => {
    mockConfirm.mockResolvedValue(true);
    const dispatcher = new ClackTerminalPromptDispatcher();
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [
        dropEvent("excerpt"),
        dropEvent("byline"),
        dropEvent("subtitle"),
      ],
      classification: "interactive",
      channel: "terminal",
    });
    expect(result.proceed).toBe(true);
    expect(result.resolutions).toHaveLength(3);
    expect(result.resolutions.every(r => r.kind === "confirm_drop")).toBe(true);
    expect(mockConfirm).toHaveBeenCalledTimes(3);
  });

  it("NEXTLY_ALLOW_CODE_FIRST_DROPS=1 auto-confirms every drop with no clack interaction", async () => {
    process.env.NEXTLY_ALLOW_CODE_FIRST_DROPS = "1";
    const dispatcher = new ClackTerminalPromptDispatcher();
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [dropEvent("excerpt"), dropEvent("byline")],
      classification: "interactive",
      channel: "terminal",
    });
    expect(result.proceed).toBe(true);
    expect(result.resolutions).toHaveLength(2);
    expect(result.resolutions.every(r => r.kind === "confirm_drop")).toBe(true);
    // Flag path skips the entire intro/confirm/note frame.
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockIntro).not.toHaveBeenCalled();
  });

  it("NEXTLY_ACCEPT_DATA_LOSS=1 auto-confirms drops the same way", async () => {
    // The env var exported by `db:sync --accept-data-loss`; both spellings
    // of the opt-in must behave identically.
    process.env.NEXTLY_ACCEPT_DATA_LOSS = "1";
    const dispatcher = new ClackTerminalPromptDispatcher();
    const result = await dispatcher.dispatch({
      candidates: [],
      events: [dropEvent("excerpt"), dropEvent("byline")],
      classification: "interactive",
      channel: "terminal",
    });
    expect(result.proceed).toBe(true);
    expect(result.resolutions).toHaveLength(2);
    expect(result.resolutions.every(r => r.kind === "confirm_drop")).toBe(true);
    expect(mockConfirm).not.toHaveBeenCalled();
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
