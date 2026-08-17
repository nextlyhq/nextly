import rule from "../rules/no-palette-classes.js";
import { createRuleTester } from "./rule-tester.js";

const ruleTester = createRuleTester();

ruleTester.run("no-palette-classes", rule, {
  valid: [
    // Semantic scales and neutral tokens are the point of the system.
    `const a = <div className="bg-background text-foreground" />;`,
    `const a = <div className="border-border text-muted-foreground" />;`,
    `const a = <div className="bg-success-100 text-destructive-600" />;`,
    // A fraction utility contains a hue substring ("translate-x" ends in
    // "late-x") and must not be read as one.
    `const a = <div className="translate-x-1/2 -translate-y-1/2" />;`,
    // A hue name with no utility prefix styles nothing.
    `const a = "the red team";`,
    // A shade with no hue is not a palette utility.
    `const a = <div className="gap-500" />;`,
    // An exemption is marked in place, with a reason.
    `// design-lint-ok: matches an external brand swatch
       const a = <div className="bg-red-500" />;`,
  ],
  invalid: [
    {
      code: `const a = <div className="bg-red-500" />;`,
      errors: [
        {
          messageId: "paletteClass",
          data: { className: "bg-red-500", advice: "use destructive-*" },
        },
      ],
    },
    {
      // Assembled through a helper rather than written on the attribute.
      code: `const a = cn("text-green-600", isOn && "p-2");`,
      errors: [
        {
          messageId: "paletteClass",
          data: { className: "text-green-600", advice: "use success-*" },
        },
      ],
    },
    {
      // A variant prefix precedes the utility.
      code: `const a = <div className="dark:bg-slate-800" />;`,
      errors: 1,
    },
    {
      // An opacity suffix follows it.
      code: `const a = <div className="bg-amber-500/40" />;`,
      errors: [
        {
          messageId: "paletteClass",
          data: { className: "bg-amber-500/40", advice: "use warning-*" },
        },
      ],
    },
    {
      // Inside a template literal, which the line-based guard also reads but
      // which a naive AST rule that only visits `Literal` would miss.
      code: "const a = `p-2 ${x} bg-rose-200`;",
      errors: 1,
    },
    {
      // A neutral hue has no dedicated scale, so the advice is the general form.
      code: `const a = <div className="text-zinc-400" />;`,
      errors: [
        {
          messageId: "paletteClass",
          data: {
            className: "text-zinc-400",
            advice:
              "use a semantic scale (success-*/warning-*/destructive-*/primary-*) or a neutral token",
          },
        },
      ],
    },
    {
      // Two in one string are two violations, not one.
      code: `const a = <div className="bg-red-500 text-blue-300" />;`,
      errors: 2,
    },
  ],
});
