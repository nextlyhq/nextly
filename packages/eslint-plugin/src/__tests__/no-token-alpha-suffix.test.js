import rule from "../rules/no-token-alpha-suffix.js";
import { createRuleTester } from "./rule-tester.js";

const ruleTester = createRuleTester();

ruleTester.run("no-token-alpha-suffix", rule, {
  valid: [
    // The correct replacement.
    `const a = { backgroundColor: "color-mix(in oklch, var(--nx-primary) 12%, transparent)" };`,
    "const a = `color-mix(in oklch, ${color} 12%, transparent)`;",
    // A bare token is the whole point of tokens.
    `const a = { backgroundColor: "var(--nx-primary)" };`,
    "const a = { backgroundColor: `${color}` };",
    // A percentage is the CSS-correct way to say "some of this colour", and a
    // space means the suffix is a separate value rather than glued on.
    `const a = "var(--nx-primary) 20%";`,
    // A LENGTH after a token is not an alpha, and must not be mistaken for one.
    `const a = "var(--nx-space)2px";`,
    // Interpolation followed by digits OUTSIDE a colour position is ordinary
    // string building — an id, a count, a class name — and not this defect.
    "const a = `${count}20`;",
    "const a = { title: `${name}20` };",
    // Hex alpha on a hex colour still works and is not what this rule is about.
    `const a = { backgroundColor: "#3b82f620" };`,
    `// design-lint-ok: mirrors a third-party embed that cannot resolve var()
     const a = { backgroundColor: "var(--nx-primary)20" };`,
  ],
  invalid: [
    {
      // The defect that motivated the rule.
      code: "const a = { ringColor: `${color}20` };",
      errors: [{ messageId: "alphaSuffix" }],
    },
    {
      code: "const a = { backgroundColor: `${color}80` };",
      errors: [{ messageId: "alphaSuffix" }],
    },
    {
      // A single-digit alpha, the 4-digit-hex spelling of the same mistake.
      code: "const a = { borderColor: `${color}8` };",
      errors: [{ messageId: "alphaSuffix" }],
    },
    {
      // Completed text, in a plain string.
      code: `const a = "var(--nx-primary)20";`,
      errors: [
        { messageId: "alphaSuffix", data: { literal: "var(--nx-primary)20" } },
      ],
    },
    {
      // Completed text inside a template literal's own chunk.
      code: "const a = `border: 1px solid var(--nx-border)33`;",
      errors: [{ messageId: "alphaSuffix" }],
    },
    {
      // A CSS declaration written inline makes the position a colour one even
      // though no style-object key names it.
      code: "const a = `background-color: ${color}20;`;",
      errors: [{ messageId: "alphaSuffix" }],
    },
    {
      // A literal already naming a token is a colour expression regardless of
      // where it is assigned.
      code: "const a = `var(--nx-ring) ${color}20`;",
      errors: [{ messageId: "alphaSuffix" }],
    },
  ],
});
