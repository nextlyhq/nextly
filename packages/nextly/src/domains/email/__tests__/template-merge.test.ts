/**
 * Reviewing an owner's update change by change: what is offered, and what
 * the person's choices produce.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import type { EmailTemplateVersion } from "../../../schemas/email-templates/types";
import { applyOwnerChoices, ownerChanges } from "../template-merge";

const version = (htmlContent: string, subject = "Reset your password") =>
  ({
    subject,
    htmlContent,
    plainTextContent: null,
    preheader: null,
  }) satisfies EmailTemplateVersion;

const lines = (...l: string[]) => l.join("\n");

// The owner's version the site's override started from.
const BASE = version(
  lines(
    "<h1>Reset your password</h1>",
    "<p>Hi {{name}},</p>",
    "<p>Choose a new password:</p>",
    '<a href="{{link}}">Choose</a>',
    "<p>The link works once, for {{expiresIn}}.</p>",
    "<p>If you didn't ask, ignore this email.</p>"
  )
);

describe("ownerChanges", () => {
  it("offers nothing when the owner changed nothing", () => {
    const mine = version(BASE.htmlContent.replace("Hi", "Hello"));
    expect(ownerChanges(BASE, BASE, mine)).toEqual([]);
  });

  it("offers each of two separate owner changes on its own, beside the site's lines", () => {
    const theirs = version(
      BASE.htmlContent
        .replace(
          "<p>Hi {{name}},</p>",
          '<p>Hi {{name | default: "there"}},</p>'
        )
        .replace(
          "<p>The link works once, for {{expiresIn}}.</p>",
          "<p>The link works once and expires in {{expiresIn}}.</p>"
        )
    );
    const changes = ownerChanges(BASE, theirs, BASE);

    expect(changes.map(c => c.id)).toEqual(["htmlContent:0", "htmlContent:1"]);
    expect(changes[0]).toMatchObject({
      conflict: false,
      base: ["<p>Hi {{name}},</p>"],
      theirs: ['<p>Hi {{name | default: "there"}},</p>'],
      mine: ["<p>Hi {{name}},</p>"],
    });
    expect(changes[1].theirs).toEqual([
      "<p>The link works once and expires in {{expiresIn}}.</p>",
    ]);
  });

  it("offers both versions where the site edited the same lines", () => {
    const theirs = version(
      BASE.htmlContent.replace("<p>Hi {{name}},</p>", "<p>Hi there,</p>")
    );
    const mine = version(
      BASE.htmlContent.replace("<p>Hi {{name}},</p>", "<p>Hello {{name}}!</p>")
    );
    const [change, ...rest] = ownerChanges(BASE, theirs, mine);

    expect(rest).toEqual([]);
    expect(change).toMatchObject({
      conflict: true,
      base: ["<p>Hi {{name}},</p>"],
      theirs: ["<p>Hi there,</p>"],
      mine: ["<p>Hello {{name}}!</p>"],
    });
  });

  it("does not offer a change the site already made in exactly the same way", () => {
    const edited = version(BASE.htmlContent.replace("Hi", "Hello"));
    expect(ownerChanges(BASE, edited, edited)).toEqual([]);
  });

  it("offers an added line, and a change to another field, separately", () => {
    const theirs = version(
      BASE.htmlContent.replace(
        "<p>If you didn't ask, ignore this email.</p>",
        "<p>We never ask for your password by email.</p>\n<p>If you didn't ask, ignore this email.</p>"
      ),
      "Reset your password now"
    );
    const changes = ownerChanges(BASE, theirs, BASE);

    expect(changes.map(c => c.field)).toEqual(["subject", "htmlContent"]);
    expect(changes[1]).toMatchObject({
      base: [],
      theirs: ["<p>We never ask for your password by email.</p>"],
      conflict: false,
    });
  });
});

describe("applyOwnerChoices", () => {
  // Two upstream changes, one of them on lines the site edited too.
  const theirs = version(
    BASE.htmlContent
      .replace("<p>Hi {{name}},</p>", '<p>Hi {{name | default: "there"}},</p>')
      .replace(
        "<p>The link works once, for {{expiresIn}}.</p>",
        "<p>The link works once and expires in {{expiresIn}}.</p>"
      )
  );
  const mine = version(
    BASE.htmlContent
      .replace("<p>Hi {{name}},</p>", "<p>Hello {{name}}, it's the shop.</p>")
      .replace(
        "<p>If you didn't ask, ignore this email.</p>",
        "<p>Didn't ask? Write to help@example.com.</p>"
      )
  );

  it("applies a mix of choices together and keeps the site's own other edit", () => {
    const result = applyOwnerChoices(BASE, theirs, mine, {
      "htmlContent:0": { use: "mine" },
      "htmlContent:1": { use: "theirs" },
    });

    expect(result.htmlContent).toBe(
      lines(
        "<h1>Reset your password</h1>",
        "<p>Hello {{name}}, it's the shop.</p>",
        "<p>Choose a new password:</p>",
        '<a href="{{link}}">Choose</a>',
        "<p>The link works once and expires in {{expiresIn}}.</p>",
        "<p>Didn't ask? Write to help@example.com.</p>"
      )
    );
    expect(result.subject).toBe(mine.subject);
  });

  it("uses text the person wrote for overlapping lines", () => {
    const result = applyOwnerChoices(BASE, theirs, mine, {
      "htmlContent:0": {
        use: "edited",
        text: '<p>Hello {{name | default: "there"}}, it\'s the shop.</p>',
      },
      "htmlContent:1": { use: "mine" },
    });

    expect(result.htmlContent.split("\n")[1]).toBe(
      '<p>Hello {{name | default: "there"}}, it\'s the shop.</p>'
    );
    expect(result.htmlContent.split("\n")[4]).toBe(
      "<p>The link works once, for {{expiresIn}}.</p>"
    );
  });

  it("keeps everything the site wrote when every change keeps it", () => {
    const result = applyOwnerChoices(BASE, theirs, mine, {
      "htmlContent:0": { use: "mine" },
      "htmlContent:1": { use: "mine" },
    });
    expect(result).toEqual(mine);
  });

  it("offers an added blank line", () => {
    const base = { ...version("<p>x</p>"), plainTextContent: "a\nb" };
    const theirs = { ...base, plainTextContent: "a\n\nb" };
    const changes = ownerChanges(base, theirs, base);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ theirs: [""], conflict: false });
  });

  it("compares very long versions without a table that grows with their square", () => {
    // 20,000 lines on each side, every one different in the middle: an LCS
    // table would need 400 million cells. The shared first and last lines
    // are set aside, and the middle is offered as one change.
    const many = (prefix: string) =>
      Array.from({ length: 20_000 }, (_, i) => `<p>${prefix} ${i}</p>`);
    const base = version(lines("<h1>Top</h1>", ...many("a"), "<p>End</p>"));
    const theirs = version(lines("<h1>Top</h1>", ...many("b"), "<p>End</p>"));
    const started = Date.now();
    const changes = ownerChanges(base, theirs, base);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ conflict: false });
    expect(changes[0].theirs).toHaveLength(20_000);
  });

  it("refuses a review that leaves a change undecided, or decides one that wasn't offered", () => {
    const missing = () =>
      applyOwnerChoices(BASE, theirs, mine, {
        "htmlContent:0": { use: "mine" },
      });
    expect(missing).toThrow(NextlyError);
    try {
      missing();
    } catch (error) {
      expect((error as NextlyError).publicData).toMatchObject({
        errors: [{ path: "choices.htmlContent:1", code: "REQUIRED" }],
      });
    }

    expect(() =>
      applyOwnerChoices(BASE, theirs, mine, {
        "htmlContent:0": { use: "mine" },
        "htmlContent:1": { use: "mine" },
        "subject:0": { use: "theirs" },
      })
    ).toThrow(NextlyError);
  });
});
