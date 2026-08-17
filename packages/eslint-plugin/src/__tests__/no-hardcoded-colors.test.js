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
    // A data URI's payload is content, not styling.
    `const a = "url(data:image/svg+xml;base64,PHN2ZyBmaWxsPScjZmYwMDAwJy8+)";`,
    // A hex that is not a colour at all.
    `const a = "commit 1f4b";`,
    `// design-lint-ok: mirrors a third-party embed's fixed palette
       const a = "#ff0000";`,
  ],
  invalid: [
    {
      code: `const a = "#ff0000";`,
      errors: [{ messageId: "hardcodedColor", data: { literal: "#ff0000" } }],
    },
    {
      code: `const a = { color: "#1a2b3c" };`,
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
