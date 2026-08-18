import rule from "../rules/no-hardcoded-colors.js";
import { createRuleTester } from "./rule-tester.js";

const ruleTester = createRuleTester();

ruleTester.run("no-hardcoded-colors", rule, {
  valid: [
    `const a = "var(--nx-border)";`,
    `const a = "color-mix(in oklch, var(--nx-primary) 40%, transparent)";`,
    // Mode-invariant colours are the same in light and dark, so a themed token
    // would claim a variation that does not exist.
    `const a = "#fff";`,
    `const a = "#000000";`,
    `const a = "rgba(0, 0, 0, 0.5)";`,
    `const a = "rgb(255,255,255)";`,
    // A scrim's two-digit alpha on black stays exempt.
    `const a = "#00000033";`,
    // `#RGB` takes a ONE-digit alpha, so the four-digit spelling of the same
    // mode-invariant colours is exempt for the same reason the others are.
    `const a = "#0000";`,
    `const a = "#fff8";`,
    `const a = "#ffff";`,
    `const a = "#0008";`,
    // Token indirection is the correct form and must stay clean even though
    // the token it resolves to is itself an OKLCH colour.
    `const a = "oklch(from var(--nx-primary) l c h)";`,
    `const a = "var(--nx-primary)";`,
    // A data URI's payload is content, not styling.
    `const a = "url(data:image/svg+xml;base64,PHN2ZyBmaWxsPScjZmYwMDAwJy8+)";`,
    // A colour NAME is an ordinary word too, so it is only a violation in a
    // position that makes it a colour. None of these is one.
    `const a = "the red team won";`,
    `const a = { fruit: "plum", wood: "teal" };`,
    `const a = "scarlet: red";`,
    `const a = { label: "Tomato", description: "a salmon dish" };`,
    // A colour-valued property pointing at a token is the correct form.
    `const a = { backgroundColor: "var(--nx-primary)" };`,
    `const a = { color: "inherit" };`,
    // Mode-invariant names stay exempt, as their hex spellings are.
    `const a = { backgroundColor: "white" };`,
    `const a = { color: "black" };`,
    `const a = { backgroundColor: "transparent" };`,
    // A hex that is not a colour at all.
    `const a = "commit 1f4b";`,
    `// design-lint-ok: mirrors a third-party embed's fixed palette
       const a = "#ff0000";`,
    // A directive annotates the CONSTRUCT it precedes, so a named palette does
    // not need the reason repeated on every line inside it.
    `// design-lint-ok: an email client cannot resolve custom properties
     const palette = {
       text: "#e5e7eb",
       background: "#0b0b0f",
       muted: "#9ca3af",
     };`,
    // A trailing directive on the violation's own line.
    `const a = "#ff0000"; // design-lint-ok: matches an external embed`,
  ],
  invalid: [
    {
      // The defect that motivated this: a fixed colour on a drop indicator,
      // invisible to a rule that already caught hex, rgb() and oklch().
      code: `const a = { backgroundColor: "deepskyblue" };`,
      errors: [{ messageId: "namedColor", data: { literal: "deepskyblue" } }],
    },
    {
      code: `const a = <div style={{ color: "tomato" }} />;`,
      errors: [{ messageId: "namedColor" }],
    },
    {
      // Kebab-case, inside a CSS string rather than a style object.
      code: `const a = "<p style='color: crimson'>hi</p>";`,
      errors: [{ messageId: "namedColor" }],
    },
    {
      code: "const a = `.warn { background-color: gold; }`;",
      errors: [{ messageId: "namedColor" }],
    },
    {
      // An SVG presentation attribute takes a colour too.
      code: `const a = { fill: "rebeccapurple" };`,
      errors: [{ messageId: "namedColor" }],
    },
    {
      // The reach is BOUNDED: a directive above a function does not exempt
      // everything inside it, which would be a blanket disable by another name.
      code: `// design-lint-ok: blanket attempt
             function paint() { return "#ff0000"; }`,
      errors: 1,
    },
    {
      code: `const a = "#ff0000";`,
      errors: [{ messageId: "hardcodedColor", data: { literal: "#ff0000" } }],
    },
    {
      code: `const a = { color: "#1a2b3c" };`,
      errors: 1,
    },
    {
      // Tokens are OKLCH, so a literal in the same colour space is the modern
      // spelling of the defect this rule exists for.
      code: `const a = "oklch(0.6 0.2 30)";`,
      errors: 1,
    },
    {
      code: `const a = "oklab(0.6 0.1 -0.1)";`,
      errors: 1,
    },
    {
      code: `const a = "rgb(12, 34, 56)";`,
      errors: [
        { messageId: "hardcodedColor", data: { literal: "rgb(12, 34, 56)" } },
      ],
    },
    {
      code: `const a = "hsl(210, 50%, 40%)";`,
      errors: 1,
    },
    {
      // A non-exempt colour beside an exempt one still reports: stripping the
      // legitimate pieces must not take the violation with them.
      code: `const a = "1px solid #ff0000, 0 0 0 rgba(0,0,0,0.2)";`,
      errors: 1,
    },
    {
      code: "const a = `border: 1px solid #abcdef`;",
      errors: 1,
    },
  ],
});
