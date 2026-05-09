// Why: type-only acceptance test that locks the public FieldValidation
// interface surface. Code-first users need to be able to write
// `validation: { pattern, message }` on text-like field types without
// TypeScript errors and without `as` casts. This file is type-checked but
// not executed (no runtime asserts).
import type {
  CodeFieldConfig,
  EmailFieldConfig,
  FieldValidation,
  NumberFieldConfig,
  PasswordFieldConfig,
  TextFieldConfig,
  TextareaFieldConfig,
} from "../index";

// Each fixture type-checks the field config interface accepts the nested
// `validation` shape directly (no cast).

const _text: TextFieldConfig = {
  type: "text",
  name: "slug",
  required: true,
  validation: {
    pattern: "^[a-z-]+$",
    message: "Slug must be lowercase with hyphens only",
    minLength: 3,
    maxLength: 64,
  },
};

const _textarea: TextareaFieldConfig = {
  type: "textarea",
  name: "bio",
  validation: { pattern: "^.{0,500}$", maxLength: 500 },
};

const _email: EmailFieldConfig = {
  type: "email",
  name: "email",
  required: true,
  validation: { pattern: "@example\\.com$", message: "Must be example.com" },
};

const _password: PasswordFieldConfig = {
  type: "password",
  name: "password",
  required: true,
  validation: { pattern: "^.{12,}$", minLength: 12 },
};

const _code: CodeFieldConfig = {
  type: "code",
  name: "snippet",
  validation: { pattern: "^[\\s\\S]+$" },
};

const _number: NumberFieldConfig = {
  type: "number",
  name: "qty",
  validation: { min: 0, max: 100 },
};

// Standalone interface usability — users can build a FieldValidation literal
// and pass it around.
const _validation: FieldValidation = {
  pattern: "^[A-Z]+$",
  message: "Uppercase only",
  minLength: 2,
};

// Suppress unused-variable noise — these only need to compile.
void _text;
void _textarea;
void _email;
void _password;
void _code;
void _number;
void _validation;
