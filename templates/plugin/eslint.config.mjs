import js from "@eslint/js";
import nextly from "@nextlyhq/eslint-plugin";
import tseslint from "typescript-eslint";

/**
 * `nextly.configs.recommended` carries the design-token rules the Nextly admin
 * holds itself to: no fixed palette colours, no hardcoded colour literals, and
 * no inline `style` object that a class could have expressed. Admin UI that
 * follows them inherits light and dark mode and survives a retheme.
 *
 * Mark a genuine exception in place, with a reason, rather than switching a rule
 * off: `// design-lint-ok: <why>` on the line or the line above.
 */
export default tseslint.config(
  { ignores: ["dist", "dev/.next", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextly.configs.recommended
);
