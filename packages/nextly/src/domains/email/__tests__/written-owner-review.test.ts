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
