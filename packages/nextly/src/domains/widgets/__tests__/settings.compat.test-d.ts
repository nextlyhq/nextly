/**
 * A widget setting is still a field config, checked by the compiler.
 *
 * `WidgetSetting` is declared structurally rather than as the collections field
 * union, because importing that union drags `collections/fields/types/base`
 * into the type graph of every package that reads a widget definition — and the
 * admin is one, where that module's own imports do not resolve. The whole
 * benefit of the structural declaration is that the admin can still draw a
 * setting with `FieldRenderer`, which takes a `FieldConfig`.
 *
 * That benefit is an assumption the moment nothing checks it. This checks it,
 * from inside the package where the field types DO resolve: every variant must
 * remain assignable to `FieldConfig`, so a field added to one side or a type
 * narrowed on the other fails here rather than in the admin at runtime.
 */
import { expectTypeOf } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import type { AnyWidgetSetting, WidgetSetting } from "../settings";

// Each variant, named individually: a union asserted as a whole passes when
// only one member matches, which is exactly the drift worth catching.
type TextSetting = Extract<WidgetSetting, { type: "text" }>;
type NumberSetting = Extract<WidgetSetting, { type: "number" }>;
type CheckboxSetting = Extract<WidgetSetting, { type: "checkbox" }>;
type SelectSetting = Extract<WidgetSetting, { type: "select" }>;

expectTypeOf<TextSetting>().toMatchTypeOf<FieldConfig>();
expectTypeOf<NumberSetting>().toMatchTypeOf<FieldConfig>();
expectTypeOf<CheckboxSetting>().toMatchTypeOf<FieldConfig>();
expectTypeOf<SelectSetting>().toMatchTypeOf<FieldConfig>();

/*
 * The positive control. `Extract` returning `never` would satisfy every
 * assertion above — `never` is assignable to anything — so a renamed or
 * removed variant would pass silently. These say the variants exist.
 */
expectTypeOf<TextSetting>().not.toBeNever();
expectTypeOf<NumberSetting>().not.toBeNever();
expectTypeOf<CheckboxSetting>().not.toBeNever();
expectTypeOf<SelectSetting>().not.toBeNever();

/*
 * 🔴 Assignability is not enough, and the gap is not academic: `toMatchTypeOf`
 * permits EXTRA properties, so every assertion above passed while `description`
 * sat at the top level — where `FieldWrapper`, which reads help text from
 * `field.admin.description`, never looks. The setting was a valid field config
 * AND its description was silently undrawable, which is precisely the state
 * this file exists to make impossible.
 *
 * So each variant is also required to introduce NO top-level key its field
 * counterpart lacks. A property in the wrong PLACE is a key the field type does
 * not have, so it fails here rather than by never rendering.
 */
type TextField = Extract<FieldConfig, { type: "text" }>;
type NumberField = Extract<FieldConfig, { type: "number" }>;
type CheckboxField = Extract<FieldConfig, { type: "checkbox" }>;
type SelectField = Extract<FieldConfig, { type: "select" }>;

expectTypeOf<Exclude<keyof TextSetting, keyof TextField>>().toBeNever();
expectTypeOf<Exclude<keyof NumberSetting, keyof NumberField>>().toBeNever();
expectTypeOf<Exclude<keyof CheckboxSetting, keyof CheckboxField>>().toBeNever();
expectTypeOf<Exclude<keyof SelectSetting, keyof SelectField>>().toBeNever();

/*
 * The control for the four above, and it is a different one from the control
 * for assignability. `Extract` resolving to `never` makes `keyof` the set of
 * ALL property names, so `Exclude` would be enormous rather than empty and the
 * assertions would fail loudly — but `keyof never` is `string | number | symbol`
 * only because `never` is the empty union, and a reader has no reason to know
 * which way that falls. These say the field side resolved to something real.
 */
expectTypeOf<TextField>().not.toBeNever();
expectTypeOf<NumberField>().not.toBeNever();
expectTypeOf<CheckboxField>().not.toBeNever();
expectTypeOf<SelectField>().not.toBeNever();

/*
 * The other side of the same promise. The content settings (`collection`,
 * `filter`, `sort`, `groupBy`) are core's rules' too, but no field config draws
 * a collection picker or a filter builder, so they stay out of the published
 * `WidgetSetting` that the settings sheet hands to `FieldRenderer`. Joined to it
 * before the sheet draws them, every assertion above would still pass while a
 * registered widget's sheet crashed. Each is checked present in the wider type
 * the rules read, and not assignable to the published one, so neither side can
 * drift alone.
 *
 * 🔴 Assignability, not an `Extract` of the published union. `Extract` keeps a
 * member only when it is wholly assignable to `{ type: "collection" }`, so a
 * member typed `{ type: string }` or `{ type: "text" | "collection" }` came out
 * as `never` and read as "absent" while accepting a collection setting. Each
 * concrete content setting is asked here whether `WidgetSetting` takes it,
 * which is the question the sheet's prop answers.
 */
expectTypeOf<
  Extract<AnyWidgetSetting, { type: "collection" }>
>().not.toExtend<WidgetSetting>();
expectTypeOf<
  Extract<AnyWidgetSetting, { type: "filter" }>
>().not.toExtend<WidgetSetting>();
expectTypeOf<
  Extract<AnyWidgetSetting, { type: "sort" }>
>().not.toExtend<WidgetSetting>();
expectTypeOf<
  Extract<AnyWidgetSetting, { type: "groupBy" }>
>().not.toExtend<WidgetSetting>();
expectTypeOf<
  Extract<AnyWidgetSetting, { type: "collection" }>
>().not.toBeNever();
expectTypeOf<Extract<AnyWidgetSetting, { type: "filter" }>>().not.toBeNever();
expectTypeOf<Extract<AnyWidgetSetting, { type: "sort" }>>().not.toBeNever();
expectTypeOf<Extract<AnyWidgetSetting, { type: "groupBy" }>>().not.toBeNever();
