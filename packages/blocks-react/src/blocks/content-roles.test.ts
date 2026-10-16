/**
 * Which props of the core blocks are content.
 *
 * Inside a slot locked `contentOnly`, only the props a block declares with
 * `role: "content"` can change. A core block that declared none would be
 * frozen whole there, its text and links included, which makes the lock
 * useless with the library it ships beside. Content is what a block SAYS:
 * text, media, links, and the accessible text that goes with them. What it
 * looks like or how it is configured is not.
 */
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./index";

/** The content props of each core block that has any. */
const CONTENT: Record<string, readonly string[]> = {
  "core/heading": ["text", "href"],
  "core/text": ["text"],
  "core/rich-text": ["content"],
  "core/image": ["mediaId", "src", "alt", "caption"],
  "core/button": ["label", "href", "entryCollection", "entryId", "ariaLabel"],
  "core/quote": ["text", "attribution", "source", "citeUrl"],
  "core/list": ["items"],
  "core/embed": ["src", "title"],
  "core/accordion-item": ["title"],
  "core/form": ["submitText"],
};

function contentPropsOf(block: (typeof coreBlocks)[number]): string[] {
  const props = (block as { props?: Record<string, { role?: unknown }> }).props;
  return Object.entries(props ?? {})
    .filter(([, schema]) => schema?.role === "content")
    .map(([name]) => name)
    .sort();
}

describe("the core blocks' content", () => {
  it.each(Object.entries(CONTENT))("%s declares its content", (name, props) => {
    const block = coreBlocks.find(entry => entry.name === name);
    expect(block, name).toBeDefined();
    expect(contentPropsOf(block!)).toEqual([...props].sort());
  });

  it("declares no content on a block that only arranges or configures", () => {
    for (const block of coreBlocks) {
      if (block.name in CONTENT) continue;
      expect(contentPropsOf(block), block.name).toEqual([]);
    }
  });
});
