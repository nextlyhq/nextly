/**
 * Holding the versions a lost retirement is derived from, and releasing them.
 *
 * Driven over an in-memory history and holder, so each case asserts which
 * slots end up pointing at which versions. The properties a plausible version
 * gets wrong: pinning the wrong pair when drafts sit between the two
 * publishes, pinning when the newest definition exposes the ids again, and
 * releasing a removal the repair never read.
 */
import { describe, expect, it } from "vitest";

import type { ComponentHistory } from "./retired-history";
import { retiredPins, type RetiredPinHolder } from "./retired-pins";

type Row = Record<string, unknown>;

const definition = (fields: string[]): Row => ({
  formatVersion: 1,
  kind: "component",
  nodes: [],
  exposed: fields.map(id => ({
    id,
    label: id,
    nodeId: "h",
    propPath: "text",
    type: "text",
  })),
});

/** A history over versions given oldest first, numbered from 1. */
function memoryHistory(
  versions: { status: string; fields: string[] }[]
): ComponentHistory {
  return {
    list: async (_ref, { limit, cursor }) =>
      versions
        .map((version, index) => ({
          versionNo: index + 1,
          status: version.status,
        }))
        .reverse()
        .filter(row => cursor === undefined || row.versionNo < cursor)
        .slice(0, limit),
    get: async (_ref, versionNo) => ({
      snapshot: { content: definition(versions[versionNo - 1]!.fields) },
    }),
  };
}

/** A holder over in-memory slots, and the transactions opened. */
function memoryHolder() {
  const slots = new Map<string, number>();
  const transactions: string[] = [];
  const holder: RetiredPinHolder<string> = {
    pin: async (_ref, { slot, versionNo }, { tx }) => {
      expect(tx).toBe("tx");
      slots.set(slot, versionNo);
    },
    release: async (_ref, { slot }, { tx }) => {
      expect(tx).toBe("tx");
      slots.delete(slot);
    },
    list: async (_ref, { tx }) => {
      expect(tx).toBe("tx");
      return [...slots].map(([slot, versionNo]) => ({ slot, versionNo }));
    },
  };
  const transaction = async <R>(work: (tx: string) => Promise<R>) => {
    transactions.push("open");
    return work("tx");
  };
  return { holder, slots, transactions, transaction };
}

function pinsOver(
  history: ComponentHistory,
  memory: ReturnType<typeof memoryHolder>,
  offered = true
) {
  return retiredPins({
    holder: () => (offered ? memory.holder : undefined),
    transaction: memory.transaction,
    history: () => history,
    componentCollection: "nx_pb_components",
    componentField: "content",
  });
}

const TITLE = { properties: ["title"], slots: [] };

describe("holding a lost removal", () => {
  it("pins the published versions either side of it, in one transaction", async () => {
    const memory = memoryHolder();
    const pins = pinsOver(
      memoryHistory([
        { status: "published", fields: ["title", "body"] },
        { status: "published", fields: ["body"] },
      ]),
      memory
    );

    expect(await pins.hold("hero", TITLE, true)).toBe(true);

    expect(Object.fromEntries(memory.slots)).toEqual({
      "removal-2-before": 1,
      "removal-2": 2,
    });
    expect(memory.transactions).toHaveLength(1);
  });

  it("pairs the publishes across the drafts saved between them", async () => {
    const memory = memoryHolder();
    const pins = pinsOver(
      memoryHistory([
        { status: "published", fields: ["title"] },
        { status: "draft", fields: [] },
        { status: "published", fields: [] },
        { status: "draft", fields: ["x"] },
      ]),
      memory
    );

    await pins.hold("hero", TITLE, true);

    expect(Object.fromEntries(memory.slots)).toEqual({
      "removal-3-before": 1,
      "removal-3": 3,
    });
  });

  it("finds the publish before the removal past a page of drafts", async () => {
    const memory = memoryHolder();
    const pins = pinsOver(
      memoryHistory([
        { status: "published", fields: ["title"] },
        ...Array.from({ length: 60 }, () => ({
          status: "draft",
          fields: [],
        })),
        { status: "published", fields: [] },
      ]),
      memory
    );

    expect(await pins.hold("hero", TITLE, true)).toBe(true);
    expect(Object.fromEntries(memory.slots)).toEqual({
      "removal-62-before": 1,
      "removal-62": 62,
    });
  });

  it("pins the same removal once, however often it is held", async () => {
    const memory = memoryHolder();
    const pins = pinsOver(
      memoryHistory([
        { status: "published", fields: ["title"] },
        { status: "published", fields: [] },
      ]),
      memory
    );

    await pins.hold("hero", TITLE, true);
    await pins.hold("hero", TITLE, true);

    expect(memory.slots.size).toBe(2);
  });

  it("finds a removal behind a publish that exposes the id again", async () => {
    const memory = memoryHolder();
    const pins = pinsOver(
      memoryHistory([
        { status: "published", fields: ["title"] },
        { status: "published", fields: [] },
        { status: "published", fields: ["title"] },
      ]),
      memory
    );

    expect(await pins.hold("hero", TITLE, true)).toBe(true);
    expect(Object.fromEntries(memory.slots)).toEqual({
      "removal-2-before": 1,
      "removal-2": 2,
    });
  });

  it("reads down to the version it is given, past ten later publishes", async () => {
    const memory = memoryHolder();
    const pins = pinsOver(
      memoryHistory([
        { status: "published", fields: ["title"] },
        { status: "published", fields: [] },
        ...Array.from({ length: 12 }, () => ({
          status: "published",
          fields: [],
        })),
      ]),
      memory
    );

    expect(await pins.hold("hero", TITLE, true, 1)).toBe(true);
    expect(Object.fromEntries(memory.slots)).toEqual({
      "removal-2-before": 1,
      "removal-2": 2,
    });
  });

  it("holds each id's removal when they were removed apart", async () => {
    const memory = memoryHolder();
    const pins = pinsOver(
      memoryHistory([
        { status: "published", fields: ["title", "body"] },
        { status: "published", fields: [] },
        { status: "published", fields: ["title"] },
        { status: "published", fields: [] },
      ]),
      memory
    );

    expect(
      await pins.hold(
        "hero",
        { properties: ["title", "body"], slots: [] },
        true
      )
    ).toBe(true);
    expect(Object.fromEntries(memory.slots)).toEqual({
      "removal-4-before": 3,
      "removal-4": 4,
      "removal-2-before": 1,
      "removal-2": 2,
    });
  });

  it("scans past ten later publishes without a floor", async () => {
    const memory = memoryHolder();
    const pins = pinsOver(
      memoryHistory([
        { status: "published", fields: ["title"] },
        { status: "published", fields: [] },
        ...Array.from({ length: 12 }, () => ({
          status: "published",
          fields: [],
        })),
      ]),
      memory
    );

    expect(await pins.hold("hero", TITLE, true)).toBe(true);
    expect(Object.fromEntries(memory.slots)).toEqual({
      "removal-2-before": 1,
      "removal-2": 2,
    });
  });

  it("takes only a removal newer than the version it is given", async () => {
    const memory = memoryHolder();
    const pins = pinsOver(
      memoryHistory([
        { status: "published", fields: ["title"] },
        { status: "published", fields: [] },
        { status: "published", fields: ["title"] },
      ]),
      memory
    );

    expect(await pins.hold("hero", TITLE, true, 3)).toBe(false);
    expect(memory.slots.size).toBe(0);
    expect(await pins.newestVersion("hero")).toBe(3);
  });

  it("pins nothing where pins are not offered", async () => {
    const memory = memoryHolder();
    const pins = pinsOver(
      memoryHistory([
        { status: "published", fields: ["title"] },
        { status: "published", fields: [] },
      ]),
      memory,
      false
    );

    expect(await pins.hold("hero", TITLE, true)).toBe(false);
    expect(memory.transactions).toEqual([]);
  });
});

describe("releasing", () => {
  it("frees the slots of the removals the repair read", async () => {
    const memory = memoryHolder();
    const pins = pinsOver(
      memoryHistory([
        { status: "published", fields: ["title"] },
        { status: "published", fields: [] },
      ]),
      memory
    );
    await pins.hold("hero", TITLE, true);

    await pins.release("hero", 2);

    expect(memory.slots.size).toBe(0);
  });

  it("keeps the slots of a removal made after the repair's read", async () => {
    const versions = [
      { status: "published", fields: ["title", "body"] },
      { status: "published", fields: ["body"] },
    ];
    const memory = memoryHolder();
    const pins = pinsOver(memoryHistory(versions), memory);
    await pins.hold("hero", TITLE, true);
    versions.push({ status: "published", fields: [] });
    await pins.hold("hero", { properties: ["body"], slots: [] }, true);

    // A repair that read up to version 2 recorded the first removal only.
    await pins.release("hero", 2);

    expect(Object.fromEntries(memory.slots)).toEqual({
      "removal-3-before": 2,
      "removal-3": 3,
    });
  });

  it("leaves slots it did not make alone", async () => {
    const memory = memoryHolder();
    memory.slots.set("other", 1);
    const pins = pinsOver(memoryHistory([]), memory);

    await pins.release("hero", 10);

    expect(Object.fromEntries(memory.slots)).toEqual({ other: 1 });
  });
});
