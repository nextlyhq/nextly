---
"@revnixhq/admin": minor
"@revnixhq/nextly": minor
---

Validation polish across the renderer and the public field-config types.

- **F1 — optional + pattern no longer rejects empty values.** Optional text,
  textarea, password, and code fields with `validation.pattern` now treat
  empty submissions as "not filled" and skip the regex; required fields
  still enforce the pattern unconditionally. Resolves the surprising
  behaviour where `text({ name: "code", validation: { pattern: "^[A-Z]{3}$" } })`
  rejected blank inputs even when not required.
- **Pattern coverage on password and code.** Both field types now read
  `validation.pattern` and `validation.message` through the same Zod
  pipeline as text and textarea — covering common cases like minimum-strength
  password regexes and hex-colour code values.
- **F2 — public `FieldValidation` interface.** New shared interface in
  `@revnixhq/nextly/config` exposes `validation?: { pattern, message,
minLength, maxLength, min, max, minRows, maxRows }` on TextFieldConfig,
  TextareaFieldConfig, EmailFieldConfig, PasswordFieldConfig,
  CodeFieldConfig, and NumberFieldConfig. Code-first users mirroring the
  Schema Builder's nested form get TypeScript autocomplete and stop needing
  `as` casts.
