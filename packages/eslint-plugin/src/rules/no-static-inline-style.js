import { isExempt } from "../exempt.js";

/**
 * Reject a JSX `style` object whose every value is a constant.
 *
 * An inline style with only constants is a utility class written the long way:
 * it bypasses the spacing and colour scales, so it does not move with the theme
 * and does not respond to density or radius. The same declaration expressed as a
 * class, or as a `@nextlyhq/ui` component, inherits all of that.
 *
 * The rule is deliberately narrow. Inline style is the correct and only tool for
 * a value computed at run time — a drag transform, a measured offset, a
 * percentage from data — and those are exactly the cases where a class cannot
 * express the value. Reporting only the all-constant object separates "could
 * have been a class" from "had to be a style" without an allowlist to maintain,
 * because the distinguishing property is in the code rather than in a list of
 * blessed files.
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Express constant styling as classes or @nextlyhq/ui components rather than inline style",
      url: "https://nextlyhq.com/docs/plugins",
    },
    schema: [],
    messages: {
      staticInlineStyle:
        "This `style` object is entirely constant — use design-token utility classes or a @nextlyhq/ui component instead.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /**
     * A value a class could have expressed.
     *
     * `UnaryExpression` is included because a negative number parses as an
     * operator applied to a literal rather than as one — without it,
     * `marginTop: -4` would read as dynamic and the object would escape.
     * A template literal counts only when it interpolates nothing, since one
     * with expressions is computed at run time.
     */
    function isStaticValue(node) {
      if (node.type === "Literal") return true;
      if (
        node.type === "UnaryExpression" &&
        (node.operator === "-" || node.operator === "+")
      ) {
        return isStaticValue(node.argument);
      }
      if (node.type === "TemplateLiteral") return node.expressions.length === 0;
      return false;
    }

    return {
      JSXAttribute(node) {
        if (node.name?.name !== "style") return;
        if (node.value?.type !== "JSXExpressionContainer") return;

        const expression = node.value.expression;
        if (expression.type !== "ObjectExpression") return;
        // An empty object styles nothing, so there is no class to prefer.
        if (expression.properties.length === 0) return;

        const everyValueIsConstant = expression.properties.every(
          property =>
            property.type === "Property" && isStaticValue(property.value)
        );
        if (!everyValueIsConstant) return;
        if (isExempt(sourceCode, node)) return;

        context.report({ node, messageId: "staticInlineStyle" });
      },
    };
  },
};
