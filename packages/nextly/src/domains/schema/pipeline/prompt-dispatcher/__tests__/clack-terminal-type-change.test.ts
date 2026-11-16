/**
 * The terminal dispatcher and a type change judged by the repair command's rule.
 *
 * A lossy one clears its named values only under the consent naming its column, or a yes at a
 * terminal, asked once per column and defaulting to no; the form without a list and one naming
 * the table do not cover it. With no terminal, one no consent covers is refused before anything,
 * naming its rows and the consent that would. The warning shown is the changed database's own,
 * and a pair the rule has no conversion for says how many rows hold a value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildPerDialectWarning } from "../../classifier/type-warnings";
import type { TypeChangeEvent } from "../../resolution/types";
import { ClackTerminalPromptDispatcher } from "../clack-terminal";

const mockConfirm = vi.fn();
const mockNote = vi.fn();

vi.mock("@clack/prompts", () => ({
  select: vi.fn(),
  confirm: (...args: unknown[]) => mockConfirm(...args),
  text: vi.fn(),
  note: (...args: unknown[]) => mockNote(...args),
  intro: vi.fn(),
  outro: vi.fn(),
  isCancel: () => false,
}));

const ENV = "NEXTLY_ACCEPT_DATA_LOSS";

/** Whether a person can be asked: a terminal on both ends, or neither. */
function terminal(on: boolean) {
  for (const stream of [process.stdin, process.stdout]) {
    Object.defineProperty(stream, "isTTY", {
      value: on,
      configurable: true,
      writable: true,
    });
  }
}

const lossy: TypeChangeEvent = {
  id: "type_change:dc_posts.seo",
  kind: "type_change",
  tableName: "dc_posts",
  columnName: "seo",
  fromType: "text",
  toType: "jsonb",
  isWidening: false,
  perDialectWarning: buildPerDialectWarning("text", "jsonb"),
  dialect: "postgresql",
  lossy: {
    judgement: {
      class: "lossy",
      reasons: [
        {
          kind: "not-json",
          class: "lossy",
          rows: { first: [{ id: "p1" }], count: 1 },
        },
      ],
    },
    keyedBy: "id",
    cleared: [{ id: "p1" }],
    conversion: {
      dialect: "postgresql",
      from: { type: "text", nullable: true },
      to: { type: "jsonb", nullable: true },
      compareAs: "json",
    },
  },
};

const DESCRIBED =
  "dc_posts.seo: text -> jsonb is lossy: values that do not parse as JSON would be cleared (1 row: id p1).";

const dispatch = (
  events: TypeChangeEvent[],
  print: (line: string) => void = () => {}
) =>
  new ClackTerminalPromptDispatcher(print).dispatch({
    candidates: [],
    events,
    classification: "destructive",
    channel: "terminal",
  });

let stdinTTY: boolean | undefined;
let stdoutTTY: boolean | undefined;

beforeEach(() => {
  stdinTTY = process.stdin.isTTY;
  stdoutTTY = process.stdout.isTTY;
  vi.stubEnv("CI", "");
  vi.stubEnv(ENV, "");
  vi.clearAllMocks();
});

afterEach(() => {
  Object.defineProperty(process.stdin, "isTTY", {
    value: stdinTTY,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    value: stdoutTTY,
    configurable: true,
    writable: true,
  });
  vi.unstubAllEnvs();
});

describe("a lossy type change without a terminal", () => {
  beforeEach(() => terminal(false));

  it("clears under the consent naming the column, without asking", async () => {
    vi.stubEnv(ENV, "dc_posts.seo");
    const printed: string[] = [];

    const result = await dispatch([lossy], line => printed.push(line));

    expect(result).toMatchObject({ proceed: true, clearing: [lossy.id] });
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(printed).toContain(
      `${DESCRIBED} Clearing the value in 1 row, under the consent naming the column.`
    );
  });

  it("is refused, naming its rows and the consent that would cover it, with no consent", async () => {
    await expect(dispatch([lossy])).rejects.toMatchObject({
      publicData: {
        errors: [
          {
            code: "CONVERSION_NEEDS_CONSENT",
            message: `${DESCRIBED} To convert it, clearing the named values, give the consent naming the column: --accept-data-loss=dc_posts.seo (or NEXTLY_ACCEPT_DATA_LOSS=dc_posts.seo).`,
          },
        ],
      },
    });
  });

  it.each([
    ["1", "--accept-data-loss without a list does not cover a type change"],
    [
      "dc_posts",
      "--accept-data-loss names the table dc_posts, not the column: a type change clears values only in a column named",
    ],
  ])("is not covered by the consent %s", async (given, notice) => {
    vi.stubEnv(ENV, given);
    await expect(dispatch([lossy])).rejects.toMatchObject({
      publicData: {
        errors: [{ message: expect.stringContaining(notice) }],
      },
    });
  });
});

describe("a lossy type change at a terminal", () => {
  beforeEach(() => terminal(true));

  it("asks once, defaulting to no, showing the changed database's line", async () => {
    mockConfirm.mockResolvedValueOnce(true);

    const result = await dispatch([lossy]);

    expect(result).toMatchObject({ proceed: true, clearing: [lossy.id] });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith({
      message: "Clear the value in 1 row named above and convert dc_posts.seo?",
      initialValue: false,
    });
    const [body] = mockNote.mock.calls[0] as [string];
    expect(body).toBe(`${DESCRIBED}\n${lossy.perDialectWarning.pg}`);
    expect(body).not.toContain("MySQL:");
  });

  it("stops the apply on a no, clearing nothing", async () => {
    mockConfirm.mockResolvedValueOnce(false);

    const result = await dispatch([lossy]);

    expect(result.proceed).toBe(false);
    expect(result.clearing).toBeUndefined();
  });
});

describe("a pair the rule has no conversion for, at a terminal", () => {
  beforeEach(() => terminal(true));

  it("shows the changed database's line and how many rows hold a value", async () => {
    mockConfirm.mockResolvedValueOnce(true);
    const unknown: TypeChangeEvent = {
      id: "type_change:dc_posts.seen",
      kind: "type_change",
      tableName: "dc_posts",
      columnName: "seen",
      fromType: "timestamp",
      toType: "text",
      isWidening: false,
      perDialectWarning: buildPerDialectWarning("timestamp", "text"),
      dialect: "mysql",
      rowsHoldingValue: 2,
    };

    const result = await dispatch([unknown]);

    expect(result.proceed).toBe(true);
    expect(mockNote).toHaveBeenCalledWith(
      `${unknown.perDialectWarning.mysql}\n2 rows hold a value.`,
      "Type change on dc_posts.seen: timestamp -> text"
    );
  });
});
