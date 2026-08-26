import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RenameCandidate } from "../../pipeline/pushschema-pipeline-interfaces";

const confirm = vi.fn();
const warn = vi.fn();

vi.mock("@clack/prompts", () => ({
  confirm: (...args: unknown[]) => confirm(...args),
  isCancel: () => false,
  cancel: vi.fn(),
  log: { warn: (...args: unknown[]) => warn(...args) },
}));

const { promptRenames } = await import("../prompt-renames");

const candidate = (over: Partial<RenameCandidate> = {}): RenameCandidate => ({
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
  ...over,
});

const askedWith = () =>
  confirm.mock.calls[0]?.[0] as {
    message: string;
    initialValue: boolean;
  };

beforeEach(() => {
  confirm.mockReset();
  warn.mockReset();
  confirm.mockResolvedValue(true);
});

describe("promptRenames - what the operator is told", () => {
  it("names what happens to the values before asking", async () => {
    await promptRenames([candidate()]);
    expect(askedWith().message).toContain(
      "exact decimals become the nearest binary float"
    );
  });

  it("says declining loses every value, not merely 'data'", async () => {
    await promptRenames([candidate()]);
    expect(askedWith().message).toContain("losing every value instead");
  });

  it("does not warn about values on a rename that preserves them", async () => {
    await promptRenames([
      candidate({
        toType: "numeric(12,2)",
        preservesValues: true,
        valueChangeReason: undefined,
      }),
    ]);
    expect(askedWith().message).not.toContain("CHANGES the stored values");
  });

  it("still suggests the rename when it converts, because declining drops the column", async () => {
    // Deliberate: both answers cost something and this one costs less. A
    // change that makes Enter decline a lossy rename chooses total loss over
    // partial loss, so it is pinned rather than left to preference.
    await promptRenames([candidate()]);
    expect(askedWith().initialValue).toBe(true);
  });

  it("does not suggest a rename the types cannot support", async () => {
    await promptRenames([
      candidate({ typesCompatible: false, defaultSuggestion: "drop_and_add" }),
    ]);
    expect(askedWith().initialValue).toBe(false);
  });
});

describe("promptRenames - non-interactive", () => {
  it("warns when --accept-renames accepts a value-changing rename", async () => {
    const [decision] = await promptRenames([candidate()], {
      nonInteractive: true,
      autoAccept: true,
    });
    expect(decision?.accepted).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("changes the stored values")
    );
  });

  it("stays silent when the accepted rename preserves its values", async () => {
    await promptRenames([candidate({ preservesValues: true })], {
      nonInteractive: true,
      autoAccept: true,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when a value-changing rename is declined", async () => {
    const [decision] = await promptRenames([candidate()], {
      nonInteractive: true,
    });
    expect(decision?.accepted).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});
