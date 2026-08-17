import { isExempt } from "../exempt.js";
import { createPaletteClassPattern, paletteAdvice } from "../vocabulary.js";

/**
 * Reject a Tailwind palette utility where a semantic scale belongs.
 *
 * A palette hue is a fixed colour: it does not move when the theme moves, so an
 * admin surface painted with one keeps its light-mode appearance in dark mode
 * while everything around it changes. The semantic scales derive from tokens and
 * follow the theme, which is the whole reason the token system exists.
 *
 * String VALUES are inspected rather than `className` attributes specifically,
 * because the class list is assembled in too many shapes to enumerate — a bare
 * attribute, a `cn()` / `clsx()` argument, a variant map, a constant lifted to
 * module scope. Matching the value catches all of them; the class-list boundary
 * in the pattern is what keeps prose from matching.
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Use Nextly's semantic colour scales instead of Tailwind palette utilities",
      url: "https://nextlyhq.com/docs/plugins",
    },
    schema: [],
    messages: {
      paletteClass: "`{{className}}` is a fixed palette colour — {{advice}}.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /** Report every palette utility inside one string value. */
    function check(node, text) {
      if (typeof text !== "string" || text.length === 0) return;
      // A fresh pattern per call: a `g`-flagged regex reused across nodes carries
      // `lastIndex`, so the second node would start scanning mid-string.
      const pattern = createPaletteClassPattern({ global: true });
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (isExempt(sourceCode, node)) return;
        context.report({
          node,
          messageId: "paletteClass",
          data: { className: match[1], advice: paletteAdvice(match[1]) },
        });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};
