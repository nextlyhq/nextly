/**
 * "Turn into" for the selected block, as every surface offers and runs it:
 * which types a block may become, each open or closed with why, what each
 * removes, and the verb that turns it as one undo step and says so.
 *
 * Asked with the core library registered, so the converters are the blocks'
 * own and the words are the ones an author reads.
 */
import {
  applyOp,
  clearBlocks,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  TEXT_FORMAT,
  type BlockDocument,
  type BlockNode,
  type BuilderOp,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toolbarActions } from "./canvas/toolbar-actions";
import {
  isTurnIntoAction,
  runTurnInto,
  turnIntoOffers,
  type TurnIntoEditor,
} from "./turn-into-verb";

beforeEach(() => {
  registerBlocks(coreBlocks as never, { source: "core" });
  // A container whose one region holds Text only, for the placement rule.
  registerBlocks(
    [
      {
        name: "acme/notes",
        version: 1,
        description: "Notes, in Text only.",
        example: { props: {} },
        render: () => null,
        slots: { children: { allow: ["core/text"] } },
      },
    ] as never,
    { source: "turn-into-test" }
  );
});
afterEach(() => clearBlocks());

const words = (text: string, format = 0) => ({ type: "text", text, format });
const paragraph = (...children: unknown[]) => ({
  type: "paragraph",
  children,
});
const rich = (...blocks: unknown[]) => ({
  root: { type: "root", children: blocks },
});

/** "Read the bold news.", with "bold" bold. */
const MARKED = rich(
  paragraph(
    words("Read the "),
    words("bold", TEXT_FORMAT.BOLD),
    words(" news.")
  )
);

function text(over: Partial<BlockNode> = {}): BlockNode {
  return {
    id: "t1",
    type: "core/text",
    version: 2,
    props: { text: MARKED },
    ...over,
  };
}

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

describe("turnIntoOffers", () => {
  it("offers a Text Rich text and Heading, saying what Heading removes", () => {
    const offers = turnIntoOffers(page(text()), "t1");
    expect(
      offers.map(({ label, enabled, note }) => ({ label, enabled, note }))
    ).toEqual([
      { label: "Turn into Rich text", enabled: true, note: undefined },
      {
        label: "Turn into Heading",
        enabled: true,
        note: "Bold and links are removed",
      },
    ]);
  });

  it("offers a Rich text of two paragraphs nothing it can take, with why", () => {
    const passage: BlockNode = {
      id: "r1",
      type: "core/rich-text",
      version: 1,
      props: {
        content: rich(paragraph(words("One")), paragraph(words("Two"))),
      },
    };
    const offers = turnIntoOffers(page(passage), "r1");
    expect(offers.map(offer => [offer.label, offer.enabled])).toEqual([
      ["Turn into Text", false],
      ["Turn into Heading", false],
    ]);
    expect(offers[0]?.reason).toBe(
      "Only a Rich text with one paragraph or one heading can become Text."
    );
  });

  it("offers a Heading Text and Rich text", () => {
    const title: BlockNode = {
      id: "h1",
      type: "core/heading",
      version: 1,
      props: { text: "Our team", level: "h2" },
    };
    expect(turnIntoOffers(page(title), "h1").map(offer => offer.label)).toEqual(
      ["Turn into Text", "Turn into Rich text"]
    );
  });

  it("offers nothing for a block that turns into nothing", () => {
    const divider: BlockNode = {
      id: "d1",
      type: "core/divider",
      version: 1,
      props: {},
    };
    expect(turnIntoOffers(page(divider), "d1")).toEqual([]);
    expect(turnIntoOffers(page(text()), "gone")).toEqual([]);
  });

  it("says a binding the new block cannot show is removed", () => {
    const bound = text({ bindings: { text: { $bind: "title" } } });
    const [toRichText, toHeading] = turnIntoOffers(page(bound), "t1");
    expect(toRichText?.note).toBe("Its bound field is removed");
    // A Heading shows the field's words, so its binding moves with it.
    expect(toHeading?.note).toBe("Bold and links are removed");
  });

  it("says when part of a block style gives way to a shared style", () => {
    const library = [
      {
        id: "look-lead",
        slug: "lead",
        orderIndex: 0,
        blockType: "core/text",
        styles: { base: { desktop: { color: "#0a0" } } },
      },
      {
        id: "brand",
        slug: "brand",
        orderIndex: 1,
        styles: { base: { mobile: { color: "#00a" } } },
      },
    ];
    const worn = text({
      classes: ["look-lead", "brand"],
      props: { text: rich(paragraph(words("Plain"))) },
    });
    const [toRichText] = turnIntoOffers(page(worn), "t1", { library });
    expect(toRichText?.note).toBe(
      "Part of its block style gives way to its other styles"
    );
  });

  it("judges the placement rule on a page the editor's own size limits allow", () => {
    // A page past the default cap, which this host's limits allow, with the
    // Text in a region that holds Text only.
    const big = text({ id: "big", props: { text: "x".repeat(2_200_000) } });
    const notes: BlockNode = {
      id: "n1",
      type: "acme/notes",
      version: 1,
      props: {},
      slots: { children: [text()] },
    };
    const document = page(notes, big);
    const host = { ...DEFAULT_LIMITS, maxBytes: 8 * 1024 * 1024 };
    const [judged] = turnIntoOffers(document, "t1", {
      planned: true,
      limits: host,
    });
    expect(judged?.enabled).toBe(false);
    expect(judged?.reason).toMatch(/Rich text/);
    // Past the limits it is given, the trial cannot be judged here, so the
    // choice is left to the editor's own apply rather than dimmed wrongly.
    const [unjudged] = turnIntoOffers(document, "t1", { planned: true });
    expect(unjudged?.enabled).toBe(true);
  });

  it("judges the placement rule over the whole of a page the editor's limits allow", () => {
    // More blocks than the default count, with the Text-only region last.
    const many = Array.from({ length: DEFAULT_LIMITS.maxNodes + 10 }, (_, i) =>
      text({ id: `x${i}`, props: { text: "x" } })
    );
    const notes: BlockNode = {
      id: "n1",
      type: "acme/notes",
      version: 1,
      props: {},
      slots: { children: [text()] },
    };
    const document = page(...many, notes);
    const host = { ...DEFAULT_LIMITS, maxNodes: DEFAULT_LIMITS.maxNodes * 4 };
    const [toRichText] = turnIntoOffers(document, "t1", {
      planned: true,
      limits: host,
    });
    expect(toRichText?.enabled).toBe(false);
  });

  it("says when the block style changes to the new type's default", () => {
    const library = [
      {
        id: "heading-star",
        slug: "heading-star",
        orderIndex: 0,
        blockType: "core/heading",
        starred: true as const,
        styles: { base: { desktop: { color: "#0a0" } } },
      },
    ];
    const plainText = text({
      props: { text: rich(paragraph(words("Plain"))) },
    });
    const [toRichText, toHeading] = turnIntoOffers(page(plainText), "t1", {
      library,
    });
    expect(toHeading?.note).toBe(
      "Its block style changes to Heading's default"
    );
    expect(toRichText?.note).toBeUndefined();
  });

  it("dims every turn of a locked block, with the lock's words", () => {
    const offers = turnIntoOffers(
      page(text({ locked: true, name: "Intro" })),
      "t1"
    );
    for (const offer of offers) {
      expect(offer.enabled).toBe(false);
      expect(offer.reason).toMatch(/Intro/);
      expect(offer.reason).toMatch(/locked/i);
    }
  });

  it("dims a turn the editor's lock question refuses, once judged in full", () => {
    const ask = vi.fn((_ops: readonly BuilderOp[]) => ({
      code: "locked-slot-altered" as const,
      holderType: "core/section",
      lock: "all" as const,
      childType: undefined,
    }));
    expect(
      turnIntoOffers(page(text()), "t1", { ask }).every(offer => offer.enabled)
    ).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    const judged = turnIntoOffers(page(text()), "t1", { ask, planned: true });
    expect(judged.every(offer => !offer.enabled)).toBe(true);
    expect(ask.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ kind: "turnInto", id: "t1" }),
    ]);
  });

  it("dims a turn the placement rule refuses where the block stands, once judged in full", () => {
    const notes: BlockNode = {
      id: "n1",
      type: "acme/notes",
      version: 1,
      props: {},
      slots: { children: [text()] },
    };
    const [toRichText] = turnIntoOffers(page(notes), "t1", { planned: true });
    expect(toRichText?.enabled).toBe(false);
    expect(toRichText?.reason).toMatch(/Rich text/);
    // Not judged as the selection changes: the verb judges it when run.
    expect(turnIntoOffers(page(notes), "t1")[0]?.enabled).toBe(true);
  });
});

/** An editor over a document, applying what it is handed. */
function editorOver(document: BlockDocument): TurnIntoEditor & {
  readonly applied: BuilderOp[];
} {
  const applied: BuilderOp[] = [];
  return {
    document,
    applied,
    apply: op => {
      applied.push(op);
      return applyOp(document, op).document;
    },
  };
}

describe("runTurnInto", () => {
  it("turns the block with one op and says what it removed", () => {
    const editor = editorOver(page(text()));
    const say = vi.fn();
    expect(runTurnInto(editor, "t1", "core/heading", say)).toBe(true);
    expect(editor.applied).toHaveLength(1);
    expect(editor.applied[0]).toMatchObject({
      kind: "turnInto",
      id: "t1",
      node: { type: "core/heading", props: { text: "Read the bold news." } },
    });
    expect(say).toHaveBeenCalledWith(
      "Turned into Heading. Bold and links are removed"
    );
  });

  it("says only that it turned when nothing is removed", () => {
    const say = vi.fn();
    runTurnInto(editorOver(page(text())), "t1", "core/rich-text", say);
    expect(say).toHaveBeenCalledWith("Turned into Rich text");
  });

  it("applies nothing and says why when the turn is refused", () => {
    const passage: BlockNode = {
      id: "r1",
      type: "core/rich-text",
      version: 1,
      props: {
        content: rich(paragraph(words("One")), paragraph(words("Two"))),
      },
    };
    const editor = editorOver(page(passage));
    const say = vi.fn();
    expect(runTurnInto(editor, "r1", "core/text", say)).toBe(false);
    expect(editor.applied).toEqual([]);
    expect(say).toHaveBeenCalledWith(
      "Only a Rich text with one paragraph or one heading can become Text."
    );
  });

  it("says the page refused when the editor does not take the op", () => {
    const say = vi.fn();
    const editor: TurnIntoEditor = {
      document: page(text()),
      apply: () => null,
    };
    expect(runTurnInto(editor, "t1", "core/heading", say)).toBe(false);
    expect(say).toHaveBeenCalledWith(
      "The page refused this edit, so nothing changed."
    );
  });
});

describe("the block menu", () => {
  it("lists the turns after the copy verbs, as menu verbs, before the conversions", () => {
    const actions = toolbarActions(page(text()), "t1");
    const ids = actions.map(action => action.id);
    const at = ids.indexOf("turn-into-rich-text");
    expect(ids.slice(at - 1, at + 3)).toEqual([
      "paste",
      "turn-into-rich-text",
      "turn-into-heading",
      "save-as-pattern",
    ]);
    const heading = actions.find(action => action.id === "turn-into-heading");
    expect(heading).toMatchObject({
      label: "Turn into Heading",
      inMenu: true,
      enabled: true,
      note: "Bold and links are removed",
    });
  });

  it("says in the menu what a block style gives way to, from the site's styles", () => {
    const library = [
      {
        id: "look-lead",
        slug: "lead",
        orderIndex: 0,
        blockType: "core/text",
        styles: { base: { desktop: { color: "#0a0" } } },
      },
      {
        id: "brand",
        slug: "brand",
        orderIndex: 1,
        styles: { base: { mobile: { color: "#00a" } } },
      },
    ];
    const worn = text({
      classes: ["look-lead", "brand"],
      props: { text: rich(paragraph(words("Plain"))) },
    });
    const actions = toolbarActions(
      page(worn),
      "t1",
      ["t1"],
      undefined,
      true,
      undefined,
      undefined,
      false,
      { library, mayChange: true }
    );
    expect(
      actions.find(action => action.id === "turn-into-rich-text")?.note
    ).toBe("Part of its block style gives way to its other styles");
  });

  it("judges the turns by the placement rules the menu is given", () => {
    // A host whose rules put a Heading only inside a Section: a Text at the
    // top of the page may not become one there.
    const nesting = {
      parentsOf: (type: string) =>
        type === "core/heading" ? ["core/section"] : undefined,
    };
    const actions = toolbarActions(page(text()), "t1", ["t1"], nesting);
    const heading = actions.find(action => action.id === "turn-into-heading");
    expect(heading?.enabled).toBe(false);
    expect(heading?.reason).toMatch(/Heading/);
    expect(
      actions.find(action => action.id === "turn-into-rich-text")?.enabled
    ).toBe(true);
  });

  it("judges the turns under the editor's limits it is given", () => {
    // More blocks than the default count, with the Text-only region last.
    const many = Array.from({ length: DEFAULT_LIMITS.maxNodes + 10 }, (_, i) =>
      text({ id: `x${i}`, props: { text: "x" } })
    );
    const notes: BlockNode = {
      id: "n1",
      type: "acme/notes",
      version: 1,
      props: {},
      slots: { children: [text()] },
    };
    const host = { ...DEFAULT_LIMITS, maxNodes: DEFAULT_LIMITS.maxNodes * 4 };
    const actions = toolbarActions(
      page(...many, notes),
      "t1",
      ["t1"],
      undefined,
      true,
      undefined,
      undefined,
      false,
      undefined,
      true,
      host
    );
    expect(
      actions.find(action => action.id === "turn-into-rich-text")?.enabled
    ).toBe(false);
  });

  it("offers no turn for several blocks at once, nor for a block that turns into nothing", () => {
    const two = page(text(), text({ id: "t2" }));
    expect(
      toolbarActions(two, "t1", ["t1", "t2"]).some(action =>
        isTurnIntoAction(action.id)
      )
    ).toBe(false);
    const divider = page({
      id: "d1",
      type: "core/divider",
      version: 1,
      props: {},
    });
    expect(
      toolbarActions(divider, "d1").some(action => isTurnIntoAction(action.id))
    ).toBe(false);
  });
});
