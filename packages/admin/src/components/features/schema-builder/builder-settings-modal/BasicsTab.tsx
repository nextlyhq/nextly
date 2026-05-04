// Why: Basics-tab fields for the BuilderSettingsModal. Renders only the
// fields listed in the per-kind config (config-driven, no kind branching
// inside this component). Auto-derives the slug from the singular name on
// each keystroke until the user explicitly overrides it via SlugInput's
// Edit affordance — once `values.slug` differs from the snake-cased
// singular, we treat that as an override and stop tracking.
import { Input, Label, Textarea } from "@revnixhq/ui";

import { toSnakeName } from "@admin/lib/builder";
import { pluralizeName } from "@admin/lib/builder/pluralize-helper";

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

  // Auto-derive slug AND plural from singular name UNLESS the user has
  // overridden either. Override signal: current value differs from what an
  // auto-derive of the OLD singular would have produced. As soon as the
  // user stamps their own value, the auto-derive stops for that field.
  const setSingular = (singular: string) => {
    const previousAutoSlug = toSnakeName(values.singularName);
    const isStillAutoSlug = !values.slug || values.slug === previousAutoSlug;
    const previousAutoPlural = pluralizeName(values.singularName);
    const isStillAutoPlural =
      !values.pluralName || values.pluralName === previousAutoPlural;
    onChange({
      ...values,
      singularName: singular,
      slug: isStillAutoSlug ? toSnakeName(singular) : values.slug,
      pluralName: isStillAutoPlural
        ? pluralizeName(singular)
        : values.pluralName,
    });
  };

  const hasPlural = fields.includes("pluralName");

  return (
    <div className="space-y-4 py-2">
      {/* PR G feedback 2: when the per-kind config has NO pluralName
          (singles, components), pack singular + slug + icon into a
          single 3-col row. Collections still use the 2x2 layout
          (singular+plural, slug+icon). Collapses sensibly on mobile. */}
      {!hasPlural &&
        (fields.includes("singularName") ||
          fields.includes("slug") ||
          fields.includes("icon")) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
        )}

      {hasPlural &&
        (fields.includes("singularName") || fields.includes("pluralName")) && (
          // Why: collections -- singular + plural visually paired in a
          // 50/50 row per feedback Section 1. Collapses to stacked on
          // mobile.
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          </div>
        )}

      {hasPlural && (fields.includes("slug") || fields.includes("icon")) && (
        // Why: collections -- slug + icon paired in their own 50/50
        // row. Description (full-width) renders below.
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
    </div>
  );
}
