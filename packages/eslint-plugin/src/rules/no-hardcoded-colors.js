import { isExempt } from "../exempt.js";
import {
  createColorLiteralPattern,
  createNamedColorDeclarationPattern,
  isColorValuedProperty,
  isNamedColor,
  stripExemptColorPieces,
} from "../vocabulary.js";

/**
 * Reject a hardcoded colour where a token belongs.
 *
 * A literal colour is frozen at the value someone typed, so it neither follows a
 * retheme nor flips between light and dark. Tokens are complete OKLCH colours
 * and can be referenced directly — `var(--nx-border)` — or blended with
 * `color-mix(...)`.
 *
 * Detection runs on text with the legitimate cases removed rather than on the
 * raw text, so black, white, transparent, `url(...)` payloads and `placeholder`
 * examples never reach the pattern. Those are mode-invariant or are content, and
 * routing them through a themed token would claim a variation that does not
 * exist.
 *
 * NAMED colours are decided differently, and deliberately so. `deepskyblue` is
 * an ordinary English word as well as a colour, so matching it anywhere would
 * report prose, seed data and identifiers. What makes it a colour is the
 * POSITION: the value of a colour-valued style property, or the right-hand side
 * of a CSS declaration. Both of those are checked; a bare occurrence is not.
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Use design tokens instead of hardcoded colour values",
      url: "https://nextlyhq.com/docs/plugins",
    },
    schema: [],
    messages: {
      hardcodedColor:
        "`{{literal}}` is a hardcoded colour — use var(--token) or color-mix(...).",
      namedColor:
        "`{{literal}}` is a fixed CSS colour — it ignores the theme and dark mode. Use var(--token) or a semantic utility.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /**
     * The literal to name in the message.
     *
     * Detection deliberately matches only a colour function's opening channel,
     * which is enough to decide but reads badly in a message, so the whole call
     * is recovered here. This is presentation only — what counts as a violation
     * stays in the shared vocabulary.
     */
    function display(text) {
      return (
        /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\([^)]*\)?/.exec(
          text
        )?.[0] ?? text.trim()
      );
    }

    function check(node, text) {
      if (typeof text !== "string" || text.length === 0) return;
      const stripped = stripExemptColorPieces(text);
      if (!createColorLiteralPattern().test(stripped)) return;
      if (isExempt(sourceCode, node)) return;
      context.report({
        node,
        messageId: "hardcodedColor",
        data: { literal: display(stripped) },
      });
    }

    /** A CSS declaration assigning a named colour, inside any string. */
    function checkDeclaration(node, text) {
      if (typeof text !== "string" || text.length === 0) return;
      const match = createNamedColorDeclarationPattern().exec(text);
      if (!match) return;
      if (isExempt(sourceCode, node)) return;
      context.report({
        node,
        messageId: "namedColor",
        data: { literal: `${match[1]}: ${match[2]}` },
      });
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") {
          check(node, node.value);
          checkDeclaration(node, node.value);
        }
      },
      TemplateElement(node) {
        const text = node.value.cooked ?? node.value.raw;
        check(node, text);
        checkDeclaration(node, text);
      },
      /**
       * A style object entry whose KEY takes a colour and whose value is a
       * named one — `{ backgroundColor: "deepskyblue" }`. The key is what makes
       * the string a colour rather than a word.
       */
      Property(node) {
        if (node.computed) return;
        const key =
          node.key.type === "Identifier" ? node.key.name : node.key.value;
        if (!isColorValuedProperty(key)) return;
        if (node.value.type !== "Literal") return;
        if (!isNamedColor(node.value.value)) return;
        if (isExempt(sourceCode, node)) return;
        context.report({
          node: node.value,
          messageId: "namedColor",
          data: { literal: String(node.value.value) },
        });
      },
    };
  },
};
