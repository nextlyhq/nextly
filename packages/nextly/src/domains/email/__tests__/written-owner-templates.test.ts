/**
 * Written templates an owner contributes: how the registry records them, how
 * their version is known, and how an owner's update to a written override is
 * reviewed (as a whole, the site's version or the owner's).
 */
import { describe, expect, it } from "vitest";

import type { PluginEmailTemplate } from "../../../plugins/contributions";
import { BUILT_IN_TEMPLATES } from "../services/templates";
import {
  WHOLE_TEMPLATE,
  wholeTemplateChange,
  wholeTemplateChoice,
} from "../template-merge";
import {
  buildTemplateOwnerRegistry,
  isOwnersVersion,
  versionDigest,
  writtenVersionDigest,
} from "../template-ownership";
import { compileWrittenHtml, compileWrittenText } from "../written/compile";
import type { WrittenDocument } from "../written/document";

const BLOCKS: WrittenDocument = {
  version: 1,
  blocks: [
    { type: "heading", text: [{ type: "text", text: "Payment received" }] },
    {
      type: "text",
      text: [
        { type: "text", text: "We received " },
        { type: "chip", variable: "amount", fallback: "your payment" },
        { type: "text", text: "." },
      ],
    },
  ],
};

const paid = (
  extra: Partial<PluginEmailTemplate> = {}
): PluginEmailTemplate => ({
  slug: "orders-paid",
  name: "Order paid",
  subject: "Thanks for your payment",
  blocks: BLOCKS,
  ...extra,
});

function register(template: PluginEmailTemplate) {
  return buildTemplateOwnerRegistry({
    builtIns: BUILT_IN_TEMPLATES,
    plugins: [{ name: "@acme/plugin-orders", templates: [template] }],
    complete: true,
  });
}

describe("a plugin's written template in the registry", () => {
  it("is registered written, its HTML and plain text written from its blocks", () => {
    const entry = register(paid()).registry.owned.get("orders-paid");
    expect(entry?.blocks).toEqual(BLOCKS);
    expect(entry?.defaults).toMatchObject({
      format: "written",
      blocks: BLOCKS,
      htmlContent: compileWrittenHtml(BLOCKS),
      plainTextContent: compileWrittenText(BLOCKS),
    });
    expect(entry?.version.htmlContent).toBe(compileWrittenHtml(BLOCKS));
  });

  it("is known by its subject, preheader and blocks, not the HTML they are written as", () => {
    const entry = register(paid()).registry.owned.get("orders-paid")!;
    expect(entry.digest).toBe(writtenVersionDigest(entry.version, BLOCKS));
    // As stored by an earlier release that wrote blocks as other markup.
    const olderMarkup = { ...entry.version, htmlContent: "<h1>Payment</h1>" };
    expect(isOwnersVersion(entry, olderMarkup, BLOCKS)).toBe(true);
    // The same blocks, their keys stored in another order (PostgreSQL jsonb).
    const reordered = {
      blocks: BLOCKS.blocks.map(block =>
        Object.fromEntries(Object.entries(block).reverse())
      ),
      version: 1,
    } as WrittenDocument;
    expect(isOwnersVersion(entry, entry.version, reordered)).toBe(true);
    // Other blocks, no blocks, or another subject are the site's.
    const edited: WrittenDocument = { version: 1, blocks: [BLOCKS.blocks[0]] };
    expect(isOwnersVersion(entry, entry.version, edited)).toBe(false);
    expect(isOwnersVersion(entry, entry.version, null)).toBe(false);
    expect(
      isOwnersVersion(entry, { ...entry.version, subject: "Paid" }, BLOCKS)
    ).toBe(false);
  });

  it.each([
    [
      "both HTML and blocks",
      paid({ htmlContent: "<p>Paid</p>" }),
      "gives both HTML and blocks",
    ],
    ["neither", paid({ blocks: undefined }), "gives neither HTML nor blocks"],
    [
      "blocks that don't pass the written rules",
      paid({ blocks: { version: 2 } as unknown as WrittenDocument }),
      "blocks that don't pass the written rules",
    ],
    [
      "blocks on the legacy engine",
      paid({ engine: "legacy" }),
      'leave out engine "legacy"',
    ],
  ])("is refused, and not registered, with %s", (_case, template, why) => {
    const { registry, refused } = register(template);
    expect(registry.owned.has("orders-paid")).toBe(false);
    expect(refused).toEqual([
      expect.objectContaining({
        slug: "orders-paid",
        plugin: "@acme/plugin-orders",
        reason: expect.stringContaining(why),
      }),
    ]);
  });

  it("leaves a coded contribution as it was", () => {
    // The control: a coded template is still known by its text.
    const entry = register(
      paid({ blocks: undefined, htmlContent: "<p>Paid</p>" })
    ).registry.owned.get("orders-paid")!;
    expect(entry.blocks).toBeUndefined();
    expect(entry.defaults.format).toBeUndefined();
    expect(entry.digest).toBe(versionDigest(entry.version));
  });
});

describe("an owner's update to a written override", () => {
  const version = (htmlContent: string) => ({
    subject: "Paid",
    htmlContent,
    plainTextContent: null,
    preheader: null,
  });

  it("is offered as one change for the whole template", () => {
    expect(
      wholeTemplateChange(
        version("<p>Old</p>"),
        version("<p>New</p>\n<p>Thanks</p>"),
        version("<p>Mine</p>")
      )
    ).toEqual({
      id: WHOLE_TEMPLATE,
      field: "htmlContent",
      conflict: false,
      base: ["<p>Old</p>"],
      theirs: ["<p>New</p>", "<p>Thanks</p>"],
      mine: ["<p>Mine</p>"],
    });
  });

  it("keeps the site's version or takes the owner's", () => {
    expect(
      wholeTemplateChoice({ [WHOLE_TEMPLATE]: { use: "theirs" } }, true)
    ).toBe("theirs");
    expect(
      wholeTemplateChoice({ [WHOLE_TEMPLATE]: { use: "mine" } }, true)
    ).toBe("mine");
    // Nothing offered: the site's version stands, and no choice is asked.
    expect(wholeTemplateChoice({}, false)).toBe("mine");
  });

  it.each([
    ["no choice", {}, true, "REQUIRED"],
    [
      "written text",
      { [WHOLE_TEMPLATE]: { use: "edited", text: "x" } },
      true,
      "INVALID",
    ],
    [
      "a choice for a change it wasn't offered",
      { "htmlContent:0": { use: "mine" } },
      true,
      "INVALID",
    ],
    [
      "a choice when nothing was offered",
      { [WHOLE_TEMPLATE]: { use: "theirs" } },
      false,
      "INVALID",
    ],
  ] as const)("refuses %s", (_case, choices, offered, code) => {
    expect(() => wholeTemplateChoice(choices, offered)).toThrow(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: expect.arrayContaining([expect.objectContaining({ code })]),
        },
      })
    );
  });
});
