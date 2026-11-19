/**
 * The shared inline editor held to ONE paragraph, as a Text is edited: what
 * the selection holds, for the format bar. Enter as a line break and a paste
 * restricted to words need a browser's own input events, which jsdom does not
 * produce, and are asserted in the browser (`e2e/tests/builder-text-marks`).
 *
 * @module lib/rich-text/inline-editor-paragraph.test
 */
import { describe, expect, it } from "vitest";

import {
  loadInlineRichTextEditor,
  type InlineAttachOptions,
  type InlineRichTextSession,
} from "../inline-editor";

const words = (text: string) => ({ type: "text", text, format: 0 });

const one = (...children: unknown[]) => ({
  root: { type: "root", children: [{ type: "paragraph", children }] },
});

/** A restriction that keeps whatever it is given. */
const restrict = (value: unknown) => ({ value, dropped: false });

async function attach(
  value: unknown,
  options?: InlineAttachOptions
): Promise<{ session: InlineRichTextSession; element: HTMLElement }> {
  const editor = await loadInlineRichTextEditor();
  const element = document.createElement("p");
  document.body.append(element);
  const attachment = editor.attach(element, value, options);
  if (attachment.status === "refused")
    throw new Error(`the editor refused this passage: ${attachment.reason}`);
  return { session: attachment.session, element };
}

describe("a passage held to one paragraph", () => {
  it("reports what the selection holds", async () => {
    const { session } = await attach(one(words("Hello")), {
      paragraph: { restrict },
    });
    session.focus(2);
    expect(session.selection()).toEqual({
      collapsed: true,
      bold: false,
      italic: false,
      link: null,
      block: "paragraph",
    });
    session.detach();
    // A superseded session answers nothing.
    expect(session.selection()).toBeUndefined();
  });
});
