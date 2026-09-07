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
import type { WidgetSetting } from "../settings";

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
