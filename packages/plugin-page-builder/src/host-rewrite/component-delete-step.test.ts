/**
 * The component-delete step against the step contract: `unchanged` with no
 * copy, `rewritten` with every copy converted (and then `unchanged` on its own
 * result), `refuse` where the engine refuses or cannot read to the end.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  componentDeleteStep,
  definitionsAlikeInEveryLanguage,
} from "./component-delete-step";
import type { StoredForm } from "./contract";

const text = (id: string, mark: string): BlockNode => ({
  id,
  type: "core/text",
  version: 1,
  props: { mark },
});

const copy = (id: string, componentId: string): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
});

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

const card: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [text("c1", "card-body")],
};

const form: StoredForm = {
  host: { kind: "collection", slug: "pages", id: "p1", path: ["content"] },
  form: "published",
};

function stepWith(definitions: ReadonlyMap<string, BlockDocument>) {
  const asked: string[][] = [];
  const step = componentDeleteStep({
    componentId: "card",
    definitions: async ids => {
      asked.push([...ids]);
      return { kind: "definitions" as const, byId: definitions };
    },
    nesting: { parentsOf: () => undefined },
    blocks: { get: () => undefined },
    limits: DEFAULT_LIMITS,
  });
  return { step, asked };
}

const marks = (value: unknown): unknown[] =>
  (value as BlockDocument).nodes.map(node => node.props?.mark ?? node.type);

describe("the component-delete step", () => {
  it("answers unchanged for a form without a copy, reading no definition", async () => {
    const { step, asked } = stepWith(new Map([["card", card]]));

    expect(await step(page([text("t", "own")]), form)).toEqual({
      kind: "unchanged",
    });
    expect(asked).toEqual([]);
  });

  it("turns every copy into the blocks it draws, leaving other components linked", async () => {
    const { step, asked } = stepWith(new Map([["card", card]]));

    const outcome = await step(
      page([copy("i1", "card"), copy("i2", "other"), copy("i3", "card")]),
      form
    );

    expect(outcome.kind).toBe("rewritten");
    if (outcome.kind !== "rewritten") return;
    expect(marks(outcome.value)).toEqual([
      "card-body",
      COMPONENT_INSTANCE_TYPE,
      "card-body",
    ]);
    // Every component the document places is asked for, not only this one.
    expect(asked[0]).toEqual(expect.arrayContaining(["card", "other"]));
    // Idempotent: its own result needs nothing more.
    expect(await step(outcome.value, form)).toEqual({ kind: "unchanged" });
  });

  it("keeps a value stored as text as text", async () => {
    const { step } = stepWith(new Map([["card", card]]));

    const outcome = await step(
      JSON.stringify(page([copy("i1", "card")])),
      form
    );

    expect(outcome.kind === "rewritten" && typeof outcome.value).toBe("string");
  });

  it("refuses a copy whose definition is missing rather than dropping it", async () => {
    const { step } = stepWith(new Map());

    const outcome = await step(page([copy("i1", "card")]), form);

    expect(outcome.kind).toBe("refuse");
  });

  it("refuses a value it cannot read, never reading it as unused", async () => {
    const { step } = stepWith(new Map([["card", card]]));

    expect((await step({ not: "a document" }, form)).kind).toBe("refuse");
    expect(
      (await step({ ...page([copy("i1", "card")]), formatVersion: 999 }, form))
        .kind
    ).toBe("refuse");
  });

  it("refuses, with the reason given, when its definitions cannot be settled", async () => {
    const step = componentDeleteStep({
      componentId: "card",
      definitions: async () => ({
        kind: "refuse",
        reason: "differs by language",
      }),
      nesting: { parentsOf: () => undefined },
      blocks: { get: () => undefined },
      limits: DEFAULT_LIMITS,
    });

    expect(await step(page([copy("i1", "card")]), form)).toEqual({
      kind: "refuse",
      reason: "differs by language",
    });
  });
});

describe("definitions for a value every language shares", () => {
  const german: BlockDocument = {
    ...card,
    nodes: [text("c1", "karte")],
  };

  it("uses them when every language defines each component alike", () => {
    const answer = definitionsAlikeInEveryLanguage(
      [new Map([["card", card]]), new Map([["card", structuredClone(card)]])],
      ["card", "missing"]
    );

    expect(answer).toEqual({
      kind: "definitions",
      byId: new Map([["card", card]]),
    });
  });

  it("refuses when one language defines a component differently", () => {
    const answer = definitionsAlikeInEveryLanguage(
      [new Map([["card", card]]), new Map([["card", german]])],
      ["card"]
    );

    expect(answer.kind).toBe("refuse");
  });

  it("refuses when a component is defined in one language and not another", () => {
    const answer = definitionsAlikeInEveryLanguage(
      [new Map(), new Map([["card", card]])],
      ["card"]
    );

    expect(answer.kind).toBe("refuse");
  });
});
