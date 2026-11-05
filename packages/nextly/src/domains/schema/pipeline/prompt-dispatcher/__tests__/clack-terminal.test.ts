import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setCancelEndsRun } from "../../../migrate/can-prompt";
import type {
  ClassifierEvent,
  RenameCandidate,
  ResolutionKind,
} from "../../pushschema-pipeline-interfaces";
import {
  ClackTerminalPromptDispatcher,
  PromptCancelledError,
  TTYRequiredError,
} from "../clack-terminal";
import { ttyRequiredDetail } from "../errors";

// Spy hooks for the @clack/prompts entry points the dispatcher uses.
// We mock the module so tests can drive prompt outcomes deterministically
// without an actual terminal.
const mockSelect = vi.fn();
const mockConfirm = vi.fn();
const mockText = vi.fn();
const mockNote = vi.fn();
const mockIntro = vi.fn();
const mockOutro = vi.fn();
const mockIsCancel = vi.fn(
  (value: unknown) => value === Symbol.for("clack:cancel")
);

// Every case here fakes the terminal it needs, and the dispatcher asks only when a person can
// answer (`canPrompt`), which a set `CI` rules out: a CI runner's own `CI` must not decide them.
beforeEach(() => {
  vi.stubEnv("CI", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

vi.mock("@clack/prompts", () => ({
  select: (...args: unknown[]) => mockSelect(...args),
  confirm: (...args: unknown[]) => mockConfirm(...args),
  text: (...args: unknown[]) => mockText(...args),
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

const dropEvent = (col: string, type = "text", rows = 5, values = 3) => ({
  id: `destructive_drop:dc_posts.${col}`,
  kind: "destructive_drop" as const,
  tableName: "dc_posts",
  columnName: col,
  columnType: type,
  tableRowCount: rows,
  nonEmptyValues: values,
  applicableResolutions: ["confirm_drop", "abort"] as ResolutionKind[],
});

/** A dispatcher whose listing is collected rather than printed. */
function listingDispatcher(): {
  dispatcher: ClackTerminalPromptDispatcher;
  printed: string[];
} {
  const printed: string[] = [];
  return {
    dispatcher: new ClackTerminalPromptDispatcher(line => printed.push(line)),
    printed,
  };
}

/** Runs `body` with the environment variables set, restoring them after. */
async function withEnv(
  vars: Record<string, string>,
  body: () => Promise<void>
): Promise<void> {
  const before = Object.fromEntries(
    Object.keys(vars).map(key => [key, process.env[key]])
  );
  Object.assign(process.env, vars);
  try {
    await body();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

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

  it("leaves a column made required unanswered without a TTY, for the push to refuse with its count", async () => {
    // No terminal can answer it, so it reaches the push unanswered, which counts the rows in its
    // way and refuses naming the entity, the field and the count. Thrown here as a confirmation
    // the run could never give, it named none of them.
    const dispatcher = new ClackTerminalPromptDispatcher();
    const events: ClassifierEvent[] = [
      {
        id: "add_not_null_with_nulls:dc_posts.summary",
        kind: "add_not_null_with_nulls",
        tableName: "dc_posts",
        columnName: "summary",
        nullCount: 2,
        tableRowCount: 3,
        applicableResolutions: ["provide_default", "make_optional", "abort"],
      },
      {
        id: "add_required_field_no_default:dc_posts.byline",
        kind: "add_required_field_no_default",
        tableName: "dc_posts",
        columnName: "byline",
        tableRowCount: 3,
        applicableResolutions: ["provide_default", "make_optional", "abort"],
      },
    ];

    const result = await dispatcher.dispatch({
      candidates: [],
      events,
      classification: "interactive",
      channel: "terminal",
    });

    expect(result).toEqual({
      confirmedRenames: [],
      resolutions: [],
      proceed: true,
    });
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("still needs a TTY when a column made required comes with a rename candidate", async () => {
    // The control: only a batch nothing else in it needs answering goes on unanswered.
    const dispatcher = new ClackTerminalPromptDispatcher();
    await expect(
      dispatcher.dispatch({
        candidates: [candidate("title", "name")],
        events: [
          {
            id: "add_not_null_with_nulls:dc_posts.summary",
            kind: "add_not_null_with_nulls",
            tableName: "dc_posts",
            columnName: "summary",
            nullCount: 2,
            tableRowCount: 3,
            applicableResolutions: ["provide_default", "abort"],
          },
        ],
        classification: "interactive",
        channel: "terminal",
      })
    ).rejects.toThrow(TTYRequiredError);
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

  it("refuses a drop without consent at once, naming the consent that covers it", async () => {
    const { dispatcher } = listingDispatcher();
    await expect(
      dispatcher.dispatch({
        candidates: [],
        events: [dropEvent("excerpt"), dropEvent("byline")],
        classification: "interactive",
        channel: "terminal",
      })
    ).rejects.toThrow(
      /column dc_posts\.excerpt \(3 non-empty values\)[\s\S]*NEXTLY_ACCEPT_DATA_LOSS=dc_posts\.excerpt,dc_posts\.byline/
    );
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("refuses every drop when the consent names only one, naming the other", async () => {
    await withEnv({ NEXTLY_ACCEPT_DATA_LOSS: "dc_posts.excerpt" }, async () => {
      const { dispatcher } = listingDispatcher();
      const outcome = dispatcher.dispatch({
        candidates: [],
        events: [dropEvent("excerpt"), dropEvent("byline")],
        classification: "interactive",
        channel: "terminal",
      });
      await expect(outcome).rejects.toThrow(
        /does not cover 1 deletion:\n {2}- column dc_posts\.byline/
      );
      await expect(outcome).rejects.not.toThrow(/- column dc_posts\.excerpt/);
    });
  });

  it("lets NEXTLY_ALLOW_CODE_FIRST_DROPS widen no consent that names its drops", async () => {
    await withEnv(
      {
        NEXTLY_ACCEPT_DATA_LOSS: "dc_posts.excerpt",
        NEXTLY_ALLOW_CODE_FIRST_DROPS: "1",
      },
      async () => {
        const { dispatcher, printed } = listingDispatcher();
        await expect(
          dispatcher.dispatch({
            candidates: [],
            events: [dropEvent("excerpt"), dropEvent("byline")],
            classification: "interactive",
            channel: "terminal",
          })
        ).rejects.toThrow(
          /does not cover 1 deletion:\n {2}- column dc_posts\.byline/
        );
        expect(printed[0]).toMatch(/NEXTLY_ALLOW_CODE_FIRST_DROPS is ignored/);
      }
    );
  });

  it("drops every column of a table the consent names", async () => {
    await withEnv({ NEXTLY_ACCEPT_DATA_LOSS: "dc_posts" }, async () => {
      const { dispatcher } = listingDispatcher();
      const result = await dispatcher.dispatch({
        candidates: [],
        events: [dropEvent("excerpt"), dropEvent("byline")],
        classification: "interactive",
        channel: "terminal",
      });
      expect(result.resolutions).toHaveLength(2);
    });
  });

  it("prints every column the consent without targets drops, with its values", async () => {
    await withEnv({ NEXTLY_ACCEPT_DATA_LOSS: "1" }, async () => {
      const { dispatcher, printed } = listingDispatcher();
      await dispatcher.dispatch({
        candidates: [],
        events: [
          dropEvent("excerpt", "text", 5, 3),
          dropEvent("byline", "text", 5, 0),
        ],
        classification: "interactive",
        channel: "terminal",
      });
      expect(printed).toEqual([
        "Deleting 2 items, with consent:",
        "  - column dc_posts.excerpt (3 non-empty values)",
        "  - column dc_posts.byline (0 non-empty values)",
      ]);
    });
  });

  it("honours NEXTLY_ALLOW_CODE_FIRST_DROPS, naming it deprecated", async () => {
    await withEnv({ NEXTLY_ALLOW_CODE_FIRST_DROPS: "1" }, async () => {
      const { dispatcher, printed } = listingDispatcher();
      const result = await dispatcher.dispatch({
        candidates: [],
        events: [dropEvent("excerpt")],
        classification: "interactive",
        channel: "terminal",
      });
      expect(result.resolutions).toHaveLength(1);
      expect(printed[0]).toMatch(
        /NEXTLY_ALLOW_CODE_FIRST_DROPS is deprecated.*NEXTLY_ACCEPT_DATA_LOSS/
      );
    });
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
    const { dispatcher, printed } = listingDispatcher();
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
    // Listed above the question, with what the column holds.
    expect(printed).toContain(
      "  - column dc_posts.excerpt (3 non-empty values)"
    );
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

  it("lists every drop, then asks once", async () => {
    mockConfirm.mockResolvedValue(true);
    const { dispatcher, printed } = listingDispatcher();
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
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(printed).toEqual([
      "This deletes 3 items, which cannot be undone:",
      "  - column dc_posts.excerpt (3 non-empty values)",
      "  - column dc_posts.byline (3 non-empty values)",
      "  - column dc_posts.subtitle (3 non-empty values)",
    ]);
  });

  it("refuses a drop chosen at a rename prompt that the consent's list leaves out", async () => {
    process.env.NEXTLY_ACCEPT_DATA_LOSS = "dc_posts.summary";
    mockSelect.mockResolvedValue("drop_and_add");
    const { dispatcher } = listingDispatcher();
    await expect(
      dispatcher.dispatch({
        candidates: [candidate("title", "name")],
        events: [],
        classification: "interactive",
        channel: "terminal",
      })
    ).rejects.toThrow(
      /does not cover 1 deletion:\n {2}- column dc_posts\.title/
    );
  });

  it("takes a drop chosen at a rename prompt as asked, and lists it", async () => {
    mockSelect.mockResolvedValue("drop_and_add");
    const { dispatcher, printed } = listingDispatcher();
    const result = await dispatcher.dispatch({
      candidates: [candidate("title", "name")],
      events: [],
      classification: "interactive",
      channel: "terminal",
    });
    expect(result.proceed).toBe(true);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(printed).toContain("  - column dc_posts.title");
  });

  it("asks about a drop whose rename prompt was never shown", async () => {
    // `title` and `body` were both removed and `name` added. Renaming `title`
    // to `name` consumes `name`, so `body` is never asked about at the rename
    // prompt, and its drop has to be asked about like any other.
    mockSelect.mockResolvedValue("rename:name");
    mockConfirm.mockResolvedValue(false);
    const { dispatcher, printed } = listingDispatcher();
    const result = await dispatcher.dispatch({
      candidates: [candidate("title", "name"), candidate("body", "name")],
      events: [],
      classification: "interactive",
      channel: "terminal",
    });
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(printed).toContain("  - column dc_posts.body");
    expect(printed).not.toContain("  - column dc_posts.title");
    expect(result.proceed).toBe(false);
  });

  /** A NOT NULL change on a table holding rows without a value. */
  const notNullEvent = (table: string) => ({
    id: `add_not_null_with_nulls:${table}.summary`,
    kind: "add_not_null_with_nulls" as const,
    tableName: table,
    columnName: "summary",
    nullCount: 2,
    tableRowCount: 9,
    applicableResolutions: [
      "provide_default",
      "make_optional",
      "delete_nonconforming",
      "abort",
    ] as ResolutionKind[],
  });

  it("refuses rows a NOT NULL answer would delete that the consent's list leaves out", async () => {
    process.env.NEXTLY_ACCEPT_DATA_LOSS = "dc_posts.summary";
    mockSelect.mockResolvedValue("delete_nonconforming");
    const { dispatcher } = listingDispatcher();
    await expect(
      dispatcher.dispatch({
        candidates: [],
        events: [notNullEvent("dc_pages")],
        classification: "interactive",
        channel: "terminal",
      })
    ).rejects.toThrow(
      /does not cover 1 deletion:\n {2}- rows of dc_pages \(the table has 9 rows\)/
    );
  });

  it("deletes those rows with consent naming their table, or as answered without a list", async () => {
    mockSelect.mockResolvedValue("delete_nonconforming");
    const answered = listingDispatcher();
    const result = await answered.dispatcher.dispatch({
      candidates: [],
      events: [notNullEvent("dc_pages")],
      classification: "interactive",
      channel: "terminal",
    });
    expect(result.resolutions).toEqual([
      {
        kind: "delete_nonconforming",
        eventId: "add_not_null_with_nulls:dc_pages.summary",
      },
    ]);
    expect(answered.printed).toContain(
      "  - rows of dc_pages (the table has 9 rows)"
    );

    process.env.NEXTLY_ACCEPT_DATA_LOSS = "dc_pages";
    const named = listingDispatcher();
    await expect(
      named.dispatcher.dispatch({
        candidates: [],
        events: [notNullEvent("dc_pages")],
        classification: "interactive",
        channel: "terminal",
      })
    ).resolves.toMatchObject({ proceed: true });
  });

  it("refuses, without asking, a drop a consent naming other columns leaves out", async () => {
    process.env.NEXTLY_ACCEPT_DATA_LOSS = "dc_posts.byline";
    const { dispatcher } = listingDispatcher();
    await expect(
      dispatcher.dispatch({
        candidates: [],
        events: [dropEvent("excerpt")],
        classification: "interactive",
        channel: "terminal",
      })
    ).rejects.toThrow(/does not cover[\s\S]*column dc_posts\.excerpt/);
    expect(mockConfirm).not.toHaveBeenCalled();
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

describe("ClackTerminalPromptDispatcher - a cancel exits 130 under a nextly command", () => {
  /** What `process.exit` was asked for, thrown so the dispatch goes no further. */
  class Exited extends Error {
    constructor(readonly code: number | string | null | undefined) {
      super(`process.exit(${String(code)})`);
    }
  }
  const CANCEL = Symbol.for("clack:cancel");
  const tty = {
    stdin: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
    stdout: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
  };

  beforeEach(() => {
    for (const stream of [process.stdin, process.stdout]) {
      Object.defineProperty(stream, "isTTY", {
        value: true,
        configurable: true,
      });
    }
    vi.stubEnv("CI", undefined);
    vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", undefined);
    vi.stubEnv("NEXTLY_ALLOW_CODE_FIRST_DROPS", undefined);
    vi.clearAllMocks();
    mockSelect.mockReset();
    mockConfirm.mockReset();
    mockText.mockReset();
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new Exited(code);
    });
    // As the program's hook turns it on for every `nextly` command.
    setCancelEndsRun(true);
  });

  afterEach(() => {
    setCancelEndsRun(false);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const [stream, was] of [
      [process.stdin, tty.stdin],
      [process.stdout, tty.stdout],
    ] as const) {
      if (was) Object.defineProperty(stream, "isTTY", was);
      else delete (stream as { isTTY?: boolean }).isTTY;
    }
  });

  const typeChange = {
    id: "type_change:dc_posts.views",
    kind: "type_change" as const,
    tableName: "dc_posts",
    columnName: "views",
    fromType: "text",
    toType: "integer",
    perDialectWarning: { pg: "pg", mysql: "mysql", sqlite: "sqlite" },
    applicableResolutions: [] as ResolutionKind[],
  } as unknown as ClassifierEvent;

  const notNull = {
    id: "add_not_null_with_nulls:dc_posts.summary",
    kind: "add_not_null_with_nulls" as const,
    tableName: "dc_posts",
    columnName: "summary",
    nullCount: 2,
    tableRowCount: 9,
    applicableResolutions: [
      "provide_default",
      "make_optional",
      "abort",
    ] as ResolutionKind[],
  } as unknown as ClassifierEvent;

  const dispatch = (args: {
    candidates?: RenameCandidate[];
    events?: ClassifierEvent[];
  }) =>
    new ClackTerminalPromptDispatcher(() => {}).dispatch({
      candidates: args.candidates ?? [],
      events: args.events ?? [],
      classification: "interactive",
      channel: "terminal",
    });

  it("at a rename prompt", async () => {
    mockSelect.mockResolvedValueOnce(CANCEL);
    await expect(
      dispatch({ candidates: [candidate("title", "name")] })
    ).rejects.toMatchObject({ code: 130 });
  });

  it("at the drop question", async () => {
    mockConfirm.mockResolvedValueOnce(CANCEL);
    await expect(
      dispatch({ events: [dropEvent("excerpt")] })
    ).rejects.toMatchObject({ code: 130 });
  });

  it("at a type change's question", async () => {
    mockConfirm.mockResolvedValueOnce(CANCEL);
    await expect(dispatch({ events: [typeChange] })).rejects.toMatchObject({
      code: 130,
    });
  });

  it("at a NOT NULL question", async () => {
    mockSelect.mockResolvedValueOnce(CANCEL);
    await expect(dispatch({ events: [notNull] })).rejects.toMatchObject({
      code: 130,
    });
  });

  it("at a default value's question", async () => {
    mockSelect.mockResolvedValueOnce("provide_default");
    mockText.mockResolvedValueOnce(CANCEL);
    await expect(dispatch({ events: [notNull] })).rejects.toMatchObject({
      code: 130,
    });
  });

  it("while a no, or 'Cancel everything', still stops the apply without exiting", async () => {
    mockConfirm.mockResolvedValueOnce(false);
    await expect(dispatch({ events: [typeChange] })).resolves.toMatchObject({
      proceed: false,
    });
    mockSelect.mockResolvedValueOnce("abort");
    await expect(dispatch({ events: [notNull] })).resolves.toMatchObject({
      proceed: false,
    });
    mockConfirm.mockResolvedValueOnce(false);
    await expect(
      dispatch({ events: [dropEvent("excerpt")] })
    ).resolves.toMatchObject({ proceed: false });
    expect(process.exit).not.toHaveBeenCalled();
  });

  // Inside the app's dev server (`next dev`), nothing turns the flag on: a
  // cancel stops only this apply, and the server keeps running.
  it("but inside the dev server cancels only this apply, without exiting", async () => {
    setCancelEndsRun(false);
    mockSelect.mockResolvedValueOnce(CANCEL);
    await expect(
      dispatch({ candidates: [candidate("title", "name")] })
    ).rejects.toBeInstanceOf(PromptCancelledError);
    mockConfirm.mockResolvedValueOnce(CANCEL);
    await expect(
      dispatch({ events: [dropEvent("excerpt")] })
    ).rejects.toBeInstanceOf(PromptCancelledError);
    expect(process.exit).not.toHaveBeenCalled();
  });
});

describe("TTYRequiredError", () => {
  it("says nobody can be asked, and why, around its detail", () => {
    const err = new TTYRequiredError("test reason");
    expect(err.message).toContain(
      "nobody can be asked (no terminal, CI, or --non-interactive)"
    );
    expect(err.message).toContain(" test reason ");
    expect(err.message).toContain("nextly migrate:create");
    expect(err.name).toBe("TTYRequiredError");
  });

  it("gives back its detail alone, and any other message as it is", () => {
    expect(
      ttyRequiredDetail(new TTYRequiredError("Rename a to b?\n- x").message)
    ).toBe("Rename a to b?\n- x");
    expect(ttyRequiredDetail("  something else  ")).toBe("something else");
  });

  it("is instanceof Error", () => {
    const err = new TTYRequiredError("x");
    expect(err).toBeInstanceOf(Error);
  });
});
