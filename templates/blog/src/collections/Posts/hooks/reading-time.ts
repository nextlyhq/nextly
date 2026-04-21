/**
 * `beforeChange` hook that derives word count + reading time from the
 * post's rich text content. Stores both on the document so cards and
 * headers can render them without re-parsing on every render.
 *
 * Uses 225 WPM, the commonly cited average adult reading speed for the
 * web. Handles three content shapes so it's resilient across Lexical
 * versions and the `richTextFormat: 'html'` fetch mode.
 */
import type { HookHandler } from "@revnixhq/nextly/config";

export const computeReadingTime: HookHandler = async ({ data }) => {
  if (!data) return data;
  const content = data.content;
  if (!content) return data;

  let text = "";
  if (typeof content === "string") {
    // HTML string: strip tags.
    text = content.replace(/<[^>]*>/g, " ");
  } else if (typeof content === "object") {
    // Lexical JSON tree: walk for text nodes.
    const walk = (node: unknown): string => {
      if (!node || typeof node !== "object") return "";
      const n = node as {
        text?: string;
        children?: unknown[];
        root?: unknown;
      };
      if (typeof n.text === "string") return n.text;
      if (Array.isArray(n.children)) return n.children.map(walk).join(" ");
      if (n.root) return walk(n.root);
      return "";
    };
    text = walk(content);
  }

  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return {
    ...data,
    wordCount: words,
    readingTime: Math.max(1, Math.ceil(words / 225)),
  };
};
