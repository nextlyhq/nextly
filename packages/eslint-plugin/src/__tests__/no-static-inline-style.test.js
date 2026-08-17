import rule from "../rules/no-static-inline-style.js";
import { createRuleTester } from "./rule-tester.js";

const ruleTester = createRuleTester();

ruleTester.run("no-static-inline-style", rule, {
  valid: [
    // Computed at run time — a class cannot express it, which is exactly the
    // case inline style exists for.
    "const a = ({x}) => <div style={{ transform: `translate(${x}px)` }} />;",
    `const a = ({x}) => <div style={{ top: x }} />;`,
    // Mixed: one dynamic value means the object as a whole had to be a style.
    `const a = ({x}) => <div style={{ padding: 24, top: x }} />;`,
    // Not an object literal, so there is nothing to convert.
    `const a = ({s}) => <div style={s} />;`,
    // A spread carries values this rule cannot see.
    `const a = ({rest}) => <div style={{ ...rest }} />;`,
    `const a = ({rest}) => <div style={{ padding: 24, ...rest }} />;`,
    // Empty styles nothing.
    `const a = <div style={{}} />;`,
    // A different attribute entirely.
    `const a = <div className="p-6" />;`,
    `// design-lint-ok: the embed's host requires an inline width
       const a = <div style={{ width: 320 }} />;`,
  ],
  invalid: [
    {
      // The shape the plugin scaffold shipped.
      code: `const a = <div style={{ padding: 24 }}>x</div>;`,
      errors: [{ messageId: "staticInlineStyle" }],
    },
    {
      // A negative number parses as an operator applied to a literal, so a
      // rule that only accepted `Literal` would let this through.
      code: `const a = <div style={{ marginTop: -4 }} />;`,
      errors: [{ messageId: "staticInlineStyle" }],
    },
    {
      code: `const a = <div style={{ display: "flex", gap: 8 }} />;`,
      errors: [{ messageId: "staticInlineStyle" }],
    },
    {
      // A template literal that interpolates nothing is still a constant.
      code: "const a = <div style={{ width: `100%` }} />;",
      errors: [{ messageId: "staticInlineStyle" }],
    },
  ],
});
