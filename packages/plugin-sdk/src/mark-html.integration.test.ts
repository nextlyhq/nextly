/**
 * Marked email HTML, reached through the SDK.
 *
 * A mark only works if the template engine recognises it, and the engine
 * checks the class's private field, so a mark made by a copy of `markHtml`
 * would be escaped like any string. Asserted through the SDK's own entry
 * points and a real template preview, because a check against core alone
 * would pass while the SDK's export marked nothing.
 */
import * as root from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { markHtml, TrustedHtml } from "./index";
import { createTestNextly, type TestNextly } from "./testing";

describe("markHtml through the plugin SDK", () => {
  let booted: TestNextly | undefined;

  afterEach(async () => {
    await booted?.destroy();
    booted = undefined;
  });

  it("is the nextly root's own markHtml and TrustedHtml", () => {
    expect(markHtml).toBe(root.markHtml);
    expect(TrustedHtml).toBe(root.TrustedHtml);
    expect(TrustedHtml.is(markHtml("<b>x</b>"))).toBe(true);
  });

  it("writes a marked value unescaped and an unmarked one escaped", async () => {
    booted = await createTestNextly();
    const { item } = await booted.nextly.emailTemplates.create({
      data: {
        name: "Marked HTML",
        slug: "marked-html",
        subject: "Hello",
        htmlContent: "<div>{{ built }}</div><div>{{ typed }}</div>",
        useLayout: false,
      },
    });

    const { html } = await booted.nextly.emailTemplates.preview({
      id: item.id,
      data: { built: markHtml("<b>built</b>"), typed: "<b>typed</b>" },
    });

    expect(html).toContain("<div><b>built</b></div>");
    expect(html).toContain("<div>&lt;b&gt;typed&lt;/b&gt;</div>");
  });
});
