// Why: Basics-tab fields for the BuilderSettingsModal. Renders only the
// fields listed in the per-kind config (config-driven, no kind branching
// inside this component). Auto-derives the slug from the singular name on
// each keystroke until the user explicitly overrides it via SlugInput's
// Edit affordance — once `values.slug` differs from the snake-cased
// singular, we treat that as an override and stop tracking.
import { Input, Label, Textarea } from "@revnixhq/ui";

import { toSnakeName } from "@admin/lib/builder";

import type { BasicsField } from "../builder-config";
import type { BuilderSettingsValues } from "../BuilderSettingsModal";

import { IconPicker } from "./IconPicker";
import { SlugInput } from "./SlugInput";

type Props = {
  fields: readonly BasicsField[];
  values: BuilderSettingsValues;
  onChange: (next: BuilderSettingsValues) => void;
};

export function BasicsTab({ fields, values, onChange }: Props) {
  const set = <K extends keyof BuilderSettingsValues>(
    key: K,
    value: BuilderSettingsValues[K]
  ) => onChange({ ...values, [key]: value });

  // Auto-derive slug from singular name on every change UNLESS the user has
  // overridden it. The override signal is `values.slug !== toSnakeName(prev
  // singular)` — if the current slug doesn't match what an auto-derive
  // would have produced, the user has stamped their own value, leave alone.
  const setSingular = (singular: string) => {
    const previousAutoSlug = toSnakeName(values.singularName);
    const isStillAuto = !values.slug || values.slug === previousAutoSlug;
    onChange({
      ...values,
      singularName: singular,
      slug: isStillAuto ? toSnakeName(singular) : values.slug,
    });
  };

  return (
    <div className="space-y-4 py-2">
      {fields.includes("singularName") && (
        <div className="space-y-1">
          <Label htmlFor="singularName">Singular name</Label>
          <Input
            id="singularName"
            value={values.singularName}
            onChange={e => setSingular(e.target.value)}
          />
        </div>
      )}

      {fields.includes("pluralName") && (
        <div className="space-y-1">
          <Label htmlFor="pluralName">Plural name</Label>
          <Input
            id="pluralName"
            value={values.pluralName ?? ""}
            onChange={e => set("pluralName", e.target.value)}
          />
        </div>
      )}

      {fields.includes("slug") && (
        <div className="space-y-1">
          <Label>Slug</Label>
          <SlugInput
            singular={values.singularName}
            value={values.slug}
            onChange={next => set("slug", next)}
          />
        </div>
      )}

      {fields.includes("description") && (
        <div className="space-y-1">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={values.description ?? ""}
            onChange={e => set("description", e.target.value)}
            rows={2}
          />
        </div>
      )}

      {fields.includes("icon") && (
        <div className="space-y-1">
          <Label>Icon</Label>
          <IconPicker
            value={values.icon}
            onChange={next => set("icon", next)}
          />
        </div>
      )}
    </div>
  );
}
