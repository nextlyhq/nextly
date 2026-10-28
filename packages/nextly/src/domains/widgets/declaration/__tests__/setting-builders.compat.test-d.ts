/**
 * A setting builder's config is still its collection field's config, checked
 * by the compiler.
 *
 * The builders declare their configs structurally rather than picking them
 * from `TextFieldConfig` and its siblings, because the admin's type check
 * reaches the builders and cannot resolve what the field types import. That
 * leaves "a setting's config IS the collection field's config less `name`" an
 * assumption unless something holds it, so this does, from inside the package
 * where the field types resolve: each key a builder takes is a key the
 * collection field takes, of the same type, and each starting value is one the
 * collection field would take too.
 */
import { expectTypeOf } from "vitest";

import type {
  CheckboxFieldConfig,
  DateFieldConfig,
  FieldAdminOptions,
  NumberFieldConfig,
  SelectFieldConfig,
  TextareaFieldConfig,
  TextFieldConfig,
} from "../../../../collections/fields/types";
import type { setting } from "../setting-builders";

type ConfigOf<B extends (config: never) => unknown> = Parameters<B>[0];

type TextConfig = ConfigOf<typeof setting.text>;
type TextareaConfig = ConfigOf<typeof setting.textarea>;
type NumberConfig = ConfigOf<typeof setting.number>;
type CheckboxConfig = ConfigOf<typeof setting.checkbox>;
type SelectConfig = ConfigOf<typeof setting.select>;
type DateConfig = ConfigOf<typeof setting.date>;

// `quick` is the one key a builder takes beyond its field's: the card's header
// reads it, never the field renderer.
type CardOnly = "quick";

// 🔴 No key the collection field does not have: a key spelt the dashboard's
// own way would type-check here and be a second vocabulary.
expectTypeOf<
  Exclude<keyof TextConfig, keyof TextFieldConfig | CardOnly>
>().toBeNever();
expectTypeOf<
  Exclude<keyof TextareaConfig, keyof TextareaFieldConfig | CardOnly>
>().toBeNever();
expectTypeOf<
  Exclude<keyof NumberConfig, keyof NumberFieldConfig | CardOnly>
>().toBeNever();
expectTypeOf<
  Exclude<keyof CheckboxConfig, keyof CheckboxFieldConfig | CardOnly>
>().toBeNever();
expectTypeOf<
  Exclude<keyof SelectConfig, keyof SelectFieldConfig | CardOnly>
>().toBeNever();
expectTypeOf<
  Exclude<keyof DateConfig, keyof DateFieldConfig | CardOnly>
>().toBeNever();

// The control for the six above: a config that resolved to nothing would have
// no keys, and pass them all.
expectTypeOf<keyof NumberConfig>().toEqualTypeOf<
  "label" | "admin" | "defaultValue" | "min" | "max"
>();
expectTypeOf<keyof SelectConfig>().toEqualTypeOf<
  "label" | "admin" | "defaultValue" | "options" | "quick"
>();

// Each key the builder reads, of the collection field's own type.
expectTypeOf<Pick<NumberConfig, "min" | "max">>().toEqualTypeOf<
  Pick<NumberFieldConfig, "min" | "max">
>();
expectTypeOf<Pick<TextareaConfig, "maxLength">>().toEqualTypeOf<
  Pick<TextareaFieldConfig, "maxLength">
>();
expectTypeOf<NonNullable<TextConfig["admin"]>["description"]>().toEqualTypeOf<
  FieldAdminOptions["description"]
>();
expectTypeOf<TextConfig["label"]>().toEqualTypeOf<
  NonNullable<TextFieldConfig["label"]>
>();

// Each starting value, one the collection field would take as its default.
expectTypeOf<TextConfig["defaultValue"]>().toMatchTypeOf<
  NonNullable<TextFieldConfig["defaultValue"]>
>();
expectTypeOf<NonNullable<TextareaConfig["defaultValue"]>>().toMatchTypeOf<
  NonNullable<TextareaFieldConfig["defaultValue"]>
>();
expectTypeOf<NumberConfig["defaultValue"]>().toMatchTypeOf<
  NonNullable<NumberFieldConfig["defaultValue"]>
>();
expectTypeOf<CheckboxConfig["defaultValue"]>().toMatchTypeOf<
  NonNullable<CheckboxFieldConfig["defaultValue"]>
>();
expectTypeOf<NonNullable<DateConfig["defaultValue"]>>().toMatchTypeOf<
  NonNullable<DateFieldConfig["defaultValue"]>
>();
// A select's options are the collection field's own options, read-only.
expectTypeOf<SelectConfig["options"][number]>().toMatchTypeOf<
  SelectFieldConfig["options"][number]
>();
