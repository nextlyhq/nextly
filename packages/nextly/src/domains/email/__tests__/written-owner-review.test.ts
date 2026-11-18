/**
 * An owner's update to a written template, reviewed block by block: each
 * block in plain words, each change the owner made to the blocks (changed,
 * added, removed or moved), and the site's version with the choices applied.
 */
import { describe, expect, it } from "vitest";

import type { EmailTemplateVersion } from "../../../schemas/email-templates/types";
import {
  applyWrittenChoices,
  writtenOwnerChanges,
  type OwnerChangeChoice,
} from "../template-merge";
import { compileWrittenHtml, compileWrittenText } from "../written/compile";
import { describeBlocks } from "../written/describe";
import type { WrittenBlock, WrittenDocument } from "../written/document";

const heading = (text: string): WrittenBlock => ({
  type: "heading",
  text: [{ type: "text", text }],
});
const doc = (...blocks: WrittenBlock[]): WrittenDocument => ({
  version: 1,
  blocks,
});
const version = (subject = "Paid"): EmailTemplateVersion => ({
  subject,
  htmlContent: "",
  plainTextContent: null,
  preheader: null,
});

const A = heading("A");
const B = heading("B");
const C = heading("C");

describe("blocks in plain words", () => {
  it("say what each block is and holds, with its variables named", () => {
    expect(
      describeBlocks([
        heading("Your order"),
        {
          type: "text",
          text: [
            { type: "text", text: "Hi " },
            { type: "chip", variable: "name", fallback: "there" },
            {
              type: "text",
              text: " track it",
              link: { chip: { variable: "trackUrl" } },
            },
          ],
          show: { variable: "shipped", when: "yes" },
        },
        {
          type: "button",
          label: [{ type: "text", text: "View order" }],
          link: { url: "https://shop.example/orders" },
        },
        {
          type: "image",
          src: { url: "https://cdn.example/logo.png" },
          alt: [{ type: "text", text: "Logo" }],
        },
        { type: "divider" },
        { type: "spacer", height: 32 },
        {
          type: "list",
          variable: "lines",
          blocks: [
            { type: "text", text: [{ type: "chip", variable: "item.name" }] },
          ],
          show: { variable: "lines", when: "present" },
        },
      ])
    ).toEqual([
      "Heading: Your order",
      'Text: Hi [name, or "there"] track it (links to [trackUrl]) (shown when shipped is yes)',
      "Button: View order → https://shop.example/orders",
      "Image: Logo (https://cdn.example/logo.png)",
      "Divider",
      "Space (32px)",
      "For each item in lines: (shown when lines has a value)",
      "  Text: [item.name]",
    ]);
  });
});

describe("blocks in plain words, for a change only in how they look", () => {
  it.each<[string, WrittenBlock, string]>([
    [
      "bold and italic runs",
      {
        type: "text",
        text: [
          { type: "text", text: "Pay " },
          { type: "text", text: "now", bold: true },
          { type: "text", text: " or " },
          { type: "chip", variable: "when", italic: true },
          { type: "text", text: " both", bold: true, italic: true },
        ],
      },
      "Text: Pay **now** or _[when]_**_ both_**",
    ],
    [
      "each link after its own run",
      {
        type: "text",
        text: [
          { type: "text", text: "Track", link: { url: "https://a.example" } },
          { type: "text", text: " or " },
          { type: "text", text: "cancel", link: { url: "https://b.example" } },
        ],
      },
      "Text: Track (links to https://a.example) or cancel (links to https://b.example)",
    ],
    [
      "spaces and line breaks as written",
      {
        type: "text",
        text: [{ type: "text", text: "Line  one\nLine two " }],
      },
      "Text: Line  one↵Line two ",
    ],
    [
      "an image's width",
      {
        type: "image",
        src: { url: "https://cdn.example/logo.png" },
        alt: [{ type: "text", text: "Logo" }],
        width: 300,
      },
      "Image: Logo (https://cdn.example/logo.png, 300px wide)",
    ],
    [
      "text that looks like a mark or a variable, as written",
      {
        type: "text",
        text: [{ type: "text", text: "**Pay** [now] _soon_" }],
      },
      "Text: \\*\\*Pay\\*\\* \\[now\\] \\_soon\\_",
    ],
  ])("show %s", (_case, block, line) => {
    expect(describeBlocks([block])).toEqual([line]);
  });
});

describe("a variable's fallback in words", () => {
  it("can't be read as the end of one variable and the start of another", () => {
    const one: WrittenBlock = {
      type: "heading",
      text: [{ type: "chip", variable: "v", fallback: 'a"][w, or "b' }],
    };
    const two: WrittenBlock = {
      type: "heading",
      text: [
        { type: "chip", variable: "v", fallback: "a" },
        { type: "chip", variable: "w", fallback: "b" },
      ],
    };
    expect(describeBlocks([one])).not.toEqual(describeBlocks([two]));
  });
});

describe("an owner's changes to written blocks", () => {
  const changes = (
    theirs: WrittenDocument,
    mine: WrittenDocument = doc(A, B, C),
    theirSubject = "Paid"
  ) =>
    writtenOwnerChanges(version(), version(theirSubject), version(), {
      base: doc(A, B, C),
      theirs,
      mine,
    });

  it.each([
    [
      "changed",
      doc(A, heading("B2"), C),
      "change",
      ["Heading: B"],
      ["Heading: B2"],
    ],
    ["added", doc(A, B, heading("X"), C), "insert", [], ["Heading: X"]],
    ["removed", doc(A, C), "delete", ["Heading: B"], []],
  ] as const)(
    "offers a block the owner %s, in plain words",
    (_case, theirs, kind, base, theirLines) => {
      expect(changes(theirs)).toEqual([
        expect.objectContaining({
          id: "blocks:0",
          field: "blocks",
          kind,
          conflict: false,
          base,
          theirs: theirLines,
        }),
      ]);
    }
  );

  it("offers a block the owner moved as one change", () => {
    const [move, ...rest] = changes(doc(B, A, C));
    expect(rest).toEqual([]);
    expect(move).toMatchObject({
      id: "blocks:0",
      kind: expect.stringMatching(/^move$/),
      conflict: false,
    });
  });

  it.each([
    ["edited the moved block", doc(A, B, heading("C3")), ["Heading: C3"]],
    [
      "added a block where it moves to",
      doc(heading("X"), A, B, C),
      ["Heading: X", "Heading: C"],
    ],
  ] as const)(
    "offers a block the owner moved as one conflicted change when the site %s",
    (_case, mine, mineLines) => {
      expect(changes(doc(C, A, B), mine)).toEqual([
        expect.objectContaining({
          id: "blocks:0",
          kind: "move",
          conflict: true,
          base: [expect.stringContaining("Heading: C (")],
          theirs: [expect.stringContaining("Heading: C (")],
          mine: mineLines,
        }),
      ]);
    }
  );

  it("says where a moved block was and where it goes", () => {
    const [move] = changes(doc(B, A, C));
    expect(move.kind).toBe("move");
    expect(move.base).toHaveLength(1);
    expect(move.theirs).toHaveLength(1);
    expect(move.base[0]).not.toBe(move.theirs[0]);
    expect([move.base[0], move.theirs[0]].join(" ")).toMatch(
      /at the start|after "Heading: [ABC]"/
    );
  });

  it("offers both sides where the site edited the same block", () => {
    expect(changes(doc(A, heading("B2"), C), doc(A, heading("B3"), C))).toEqual(
      [
        expect.objectContaining({
          kind: "change",
          conflict: true,
          theirs: ["Heading: B2"],
          mine: ["Heading: B3"],
        }),
      ]
    );
  });

  it("offers only the block the owner changed, beside the next one only the site changed", () => {
    // The site rewrote A and B, the owner only A: B stays the site's, unasked.
    expect(
      changes(doc(heading("A2"), B, C), doc(heading("A3"), heading("B3"), C))
    ).toEqual([
      expect.objectContaining({
        kind: "change",
        conflict: true,
        base: ["Heading: A"],
        theirs: ["Heading: A2"],
        mine: ["Heading: A3"],
      }),
    ]);
  });

  it("offers nothing for a block the site already changed the same way", () => {
    const same = doc(A, heading("B2"), C);
    expect(changes(same, same)).toEqual([]);
  });

  it("offers a subject change by line, beside the blocks", () => {
    expect(
      changes(doc(A, heading("B2"), C), doc(A, B, C), "Paid, thanks")
    ).toEqual([
      expect.objectContaining({ id: "subject:0", field: "subject" }),
      expect.objectContaining({ id: "blocks:0", field: "blocks" }),
    ]);
  });
});

describe("the site's written version with the choices applied", () => {
  const apply = (
    theirs: WrittenDocument,
    choices: Record<string, OwnerChangeChoice>,
    mine: WrittenDocument = doc(A, B, C)
  ) =>
    applyWrittenChoices(
      version(),
      version(),
      version(),
      { base: doc(A, B, C), theirs, mine },
      choices
    );

  it("takes the owner's blocks or keeps the site's, change by change, and writes the HTML from them", () => {
    const theirs = doc(heading("A2"), B, heading("C2"));
    const result = apply(theirs, {
      "blocks:0": { use: "theirs" },
      "blocks:1": { use: "mine" },
    });
    expect(result.blocks).toEqual(doc(heading("A2"), B, C));
    expect(result.version.htmlContent).toBe(compileWrittenHtml(result.blocks));
    expect(result.version.plainTextContent).toBe(
      compileWrittenText(result.blocks)
    );
  });

  it("keeps a block only the site changed when the owner's next one is taken", () => {
    const result = apply(
      doc(heading("A2"), B, C),
      { "blocks:0": { use: "theirs" } },
      doc(heading("A3"), heading("B3"), C)
    );
    expect(result.blocks).toEqual(doc(heading("A2"), heading("B3"), C));
  });

  it("moves a block in both places, or in neither", () => {
    expect(
      apply(doc(B, A, C), { "blocks:0": { use: "theirs" } }).blocks
    ).toEqual(doc(B, A, C));
    expect(apply(doc(B, A, C), { "blocks:0": { use: "mine" } }).blocks).toEqual(
      doc(A, B, C)
    );
  });

  it("moves a block the site edited in both places, or in neither, never sending it twice", () => {
    const edited = doc(A, B, heading("C3"));
    expect(
      apply(doc(C, A, B), { "blocks:0": { use: "theirs" } }, edited).blocks
    ).toEqual(doc(C, A, B));
    expect(
      apply(doc(C, A, B), { "blocks:0": { use: "mine" } }, edited).blocks
    ).toEqual(edited);
  });

  it.each([
    ["the owner's", "theirs", "B2"],
    ["the site's", "mine", "B3"],
  ] as const)("resolves an edit both made to %s", (_case, use, text) => {
    const result = apply(
      doc(A, heading("B2"), C),
      { "blocks:0": { use } },
      doc(A, heading("B3"), C)
    );
    expect(result.blocks).toEqual(doc(A, heading(text), C));
  });

  it.each([
    ["no choice", {}, "REQUIRED"],
    [
      "written text, which blocks take none of",
      { "blocks:0": { use: "edited", text: "x" } },
      "INVALID",
    ],
    [
      "a choice for a change it wasn't offered",
      { "blocks:9": { use: "mine" } },
      "INVALID",
    ],
  ] as const)("refuses %s", (_case, choices, code) => {
    expect(() => apply(doc(A, heading("B2"), C), choices)).toThrow(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: expect.arrayContaining([expect.objectContaining({ code })]),
        },
      })
    );
  });
});

describe("a block moved on either side is never sent twice or lost", () => {
  const D = heading("D");
  const divider: WrittenBlock = { type: "divider" };
  const review = (
    base: WrittenDocument,
    theirs: WrittenDocument,
    mine: WrittenDocument
  ) => ({
    changes: writtenOwnerChanges(version(), version(), version(), {
      base,
      theirs,
      mine,
    }),
    apply: (choices: Record<string, OwnerChangeChoice>) =>
      applyWrittenChoices(
        version(),
        version(),
        version(),
        { base, theirs, mine },
        choices
      ).blocks,
  });

  it.each([
    [
      "the site edited every block the owner reordered",
      doc(A, B, C, D),
      doc(A, C, B, D),
      doc(heading("A3"), heading("B3"), heading("C3"), heading("D3")),
    ],
    [
      "both moved the same block to different places",
      doc(A, B, C, D),
      doc(A, C, B, D),
      doc(C, A, B, D),
    ],
    [
      "the site moved a block the owner edited",
      doc(A, B, C),
      doc(heading("A2"), B, C),
      doc(B, C, A),
    ],
  ] as const)(
    "offers one change, taken or kept whole, when %s",
    (_case, base, theirs, mine) => {
      const { changes, apply } = review(base, theirs, mine);
      expect(changes).toEqual([
        expect.objectContaining({ id: "blocks:0", conflict: true }),
      ]);
      expect(apply({ "blocks:0": { use: "theirs" } })).toEqual(theirs);
      expect(apply({ "blocks:0": { use: "mine" } })).toEqual(mine);
    }
  );

  it("keeps a site's edit outside the moves it can't keep apart as the site's", () => {
    const E = heading("E");
    const { changes, apply } = review(
      doc(A, B, C, D, E),
      doc(A, C, B, D, E),
      doc(C, A, B, D, heading("E2"))
    );
    expect(changes).toEqual([
      expect.objectContaining({ id: "blocks:0", conflict: true }),
    ]);
    expect(apply({ "blocks:0": { use: "theirs" } })).toEqual(
      doc(A, C, B, D, heading("E2"))
    );
    expect(apply({ "blocks:0": { use: "mine" } })).toEqual(
      doc(C, A, B, D, heading("E2"))
    );
  });

  it("keeps a site-only edit between a move's two places as the site's", () => {
    const { changes, apply } = review(
      doc(A, B, C),
      doc(C, A, heading("B2")),
      doc(heading("A3"), B, C)
    );
    expect(changes).toHaveLength(1);
    expect(apply({ "blocks:0": { use: "theirs" } })).toEqual(
      doc(C, heading("A3"), heading("B2"))
    );
    expect(apply({ "blocks:0": { use: "mine" } })).toEqual(
      doc(heading("A3"), B, C)
    );
  });

  it("keeps the site's move apart from the owner's change to another block", () => {
    const { changes, apply } = review(
      doc(A, B, C, D),
      doc(A, B, C, heading("D2")),
      doc(B, C, A, D)
    );
    expect(changes).toEqual([
      expect.objectContaining({ kind: "change", conflict: false }),
    ]);
    expect(apply({ "blocks:0": { use: "theirs" } })).toEqual(
      doc(B, C, A, heading("D2"))
    );
  });

  it("reads a second divider the owner added as an addition, not a move", () => {
    const { changes, apply } = review(
      doc(A, divider, B),
      doc(A, divider, B, divider),
      doc(heading("A2"), divider, B)
    );
    expect(changes).toEqual([
      expect.objectContaining({ kind: "insert", conflict: false }),
    ]);
    expect(apply({ "blocks:0": { use: "theirs" } })).toEqual(
      doc(heading("A2"), divider, B, divider)
    );
  });
});
