import { isExempt } from "../exempt.js";
import {
  createTokenAlphaSuffixPattern,
  isColorValuedProperty,
} from "../vocabulary.js";

/** Hex alpha digits opening a chunk: the `20` in `` `${color}20` ``. */
const LEADING_ALPHA = /^[0-9a-fA-F]{1,2}(?![\w-])/;

/**
 * Reject an alpha suffix appended to a design token.
 *
 * `#3b82f6` + `20` is a real colour at 12.5% alpha, and that idiom was correct
 * for as long as colours were hex. `var(--nx-primary)` + `20` is not a colour:
 * the browser cannot parse it, drops the declaration, and the element renders
 * with nothing where the tint was meant to be. Nothing fails loudly, which is
 * why this survives review — the code reads exactly like the version that
 * worked.
 *
 * Two spellings, decided differently because they are different shapes:
 *
 *   - A completed string — `"var(--nx-primary)20"` — is matched as text.
 *   - A template literal — `` `${color}20` `` — cannot be matched as text at
 *     all, because the token and the suffix are separate AST nodes and never
 *     adjacent in the source. It is decided structurally instead: a chunk that
 *     FOLLOWS an interpolation and opens with hex alpha digits, in a position
 *     that takes a colour.
 *
 * The position requirement is what keeps this quiet. `` `${count}20` `` in
 * ordinary code is not a colour, and only a colour-valued property, a CSS
 * declaration, or an existing `var(` in the same literal makes it one.
 *
 * The replacement is `color-mix(in oklch, var(--token) 12%, transparent)`.
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Blend tokens with color-mix() instead of an alpha suffix",
      url: "https://nextlyhq.com/docs/plugins",
    },
    schema: [],
    messages: {
      alphaSuffix:
        "`{{literal}}` appends an alpha suffix to a token, which is not valid CSS — the browser drops it. Use color-mix(in oklch, var(--token) N%, transparent).",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    function report(node, literal) {
      if (isExempt(sourceCode, node)) return;
      context.report({ node, messageId: "alphaSuffix", data: { literal } });
    }

    /**
     * Whether a property name takes a colour.
     *
     * The shared list holds REAL CSS properties. This also accepts any name
     * ending in `color`, because the instance that motivated the rule was
     * `ringColor` — which is not a CSS property at all, so it is correctly
     * absent from that list while being unmistakably a colour by intent. An
     * invalid property is its own defect; it should not also buy exemption
     * from this one.
     */
    function takesColor(key) {
      return (
        typeof key === "string" &&
        (isColorValuedProperty(key) || /colou?r$/i.test(key))
      );
    }

    /** Whether this template literal sits somewhere that takes a colour. */
    function inColorPosition(node) {
      const parent = node.parent;
      if (
        parent?.type === "Property" &&
        !parent.computed &&
        parent.value === node
      ) {
        const key =
          parent.key.type === "Identifier" ? parent.key.name : parent.key.value;
        if (takesColor(key)) return true;
      }
      // A CSS declaration written inline, or a literal already naming a token:
      // both make the surrounding string a colour expression regardless of
      // where the value is being assigned. The opening delimiter counts as a
      // boundary — `getText` returns the backtick too, and without it a
      // declaration at position 0 is unreachable.
      const raw = sourceCode.getText(node);
      return (
        /var\(\s*--/.test(raw) || /(?:^|[;{\s`'"])[a-z-]*colou?r\s*:/i.test(raw)
      );
    }

    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        const match = createTokenAlphaSuffixPattern().exec(node.value);
        if (match) report(node, match[0]);
      },
      TemplateLiteral(node) {
        // The completed-text form can still appear inside one chunk.
        for (const quasi of node.quasis) {
          const text = quasi.value.cooked ?? quasi.value.raw;
          const match = createTokenAlphaSuffixPattern().exec(text ?? "");
          if (match) {
            report(node, match[0]);
            return;
          }
        }

        if (node.expressions.length === 0) return;
        if (!inColorPosition(node)) return;

        // `quasis[i + 1]` is the chunk that follows `expressions[i]`, so this
        // asks: did an interpolated value get hex alpha digits stuck onto it?
        for (let i = 0; i < node.expressions.length; i += 1) {
          const next = node.quasis[i + 1];
          if (!next) continue;
          const text = next.value.cooked ?? next.value.raw ?? "";
          const match = LEADING_ALPHA.exec(text);
          if (match) {
            const expr = sourceCode.getText(node.expressions[i]);
            report(node, `\${${expr}}${match[0]}`);
            return;
          }
        }
      },
    };
  },
};
