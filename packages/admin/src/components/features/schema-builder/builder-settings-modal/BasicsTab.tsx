// Why: Basics-tab fields for the BuilderSettingsModal. Renders only the
// fields listed in the per-kind config (config-driven). Auto-derives the
// slug from the singular name on each keystroke until the user explicitly
// overrides it via SlugInput's Edit affordance — once `values.slug` differs
// from the auto-derived form, we treat that as an override and stop tracking.
// Slug case is per-kind: singles use kebab (the entry-form slug validator is
// kebab-only); collections and components keep snake to match their backend
// validators. This is the one place the shared modal needs a per-kind branch
// because the slug-case decision is genuinely kind-specific.
import { Input, Label, Textarea } from "@nextlyhq/ui";

import { usePluginFieldTypeEntries } from "@admin/components/field-ui";
import { toKebabName, toSnakeName } from "@admin/lib/builder";
import { pluralizeName } from "@admin/lib/builder/pluralize-helper";
import {
  hasStartingFieldChoice,
  startingFieldChoices,
} from "@admin/lib/builder/starting-field";
import { cn } from "@admin/lib/utils";

import type { BasicsField, BuilderKind } from "../builder-config";
import type { BuilderSettingsValues } from "../BuilderSettingsModal";

import { IconPicker } from "./IconPicker";
import { SlugInput } from "./SlugInput";

type Props = {
  fields: readonly BasicsField[];
  kind: BuilderKind;
  values: BuilderSettingsValues;
  onChange: (next: BuilderSettingsValues) => void;
};

export function BasicsTab({ fields, kind, values, onChange }: Props) {
  // Singles' entry-form slug field validates as kebab-case only, so the
  // auto-derived default in the create popup must also be kebab. Collections
  // and components keep snake_case to match their respective backend rules.
  const toSlug = kind === "single" ? toKebabName : toSnakeName;
  const set = <K extends keyof BuilderSettingsValues>(
    key: K,
    value: BuilderSettingsValues[K]
  ) => onChange({ ...values, [key]: value });

  // Auto-derive slug AND plural from singular name UNLESS the user has
  // overridden either. Override signal: current value differs from what an
  // auto-derive of the OLD singular would have produced. As soon as the
  // user stamps their own value, the auto-derive stops for that field.
  const setSingular = (singular: string) => {
    const previousAutoSlug = toSlug(values.singularName);
    const isStillAutoSlug = !values.slug || values.slug === previousAutoSlug;
    const previousAutoPlural = pluralizeName(values.singularName);
    const isStillAutoPlural =
      !values.pluralName || values.pluralName === previousAutoPlural;
    onChange({
      ...values,
      singularName: singular,
      slug: isStillAutoSlug ? toSlug(singular) : values.slug,
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

      {fields.includes("startingField") && (
        <StartingFieldChoice
          value={values.startingFieldType}
          onChange={next => set("startingFieldType", next)}
        />
      )}
    </div>
  );
}

/**
 * How this entity is edited, asked while it is being created.
 *
 * Renders nothing when no plugin contributes a field type for this surface: the
 * remaining option is the default, and a control offering one answer asks a
 * question that has already been settled.
 *
 * Radio rather than a select. The options differ in what they DO rather than in
 * a value being picked from a list, each carries a sentence explaining it, and
 * both need to be readable at once for the choice to be an informed one — a
 * select hides every option but the chosen one behind a click.
 */
function StartingFieldChoice({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}) {
  const pluginEntries = usePluginFieldTypeEntries("entries");
  const choices = startingFieldChoices(pluginEntries);
  if (!hasStartingFieldChoice(choices)) return null;

  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium leading-none">
        How is this edited?
      </legend>
      <p className="text-sm text-muted-foreground">
        You can change this later by adding or removing fields.
      </p>
      <div className="grid gap-2 pt-1">
        {choices.map(choice => {
          const id = `starting-field-${choice.type ?? "none"}`;
          const checked = (value ?? null) === choice.type;
          return (
            <label
              key={id}
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                checked
                  ? "border-primary bg-accent"
                  : "border-border hover:bg-accent/50"
              )}
            >
              <input
                type="radio"
                id={id}
                name="starting-field"
                className="mt-1 accent-[color:var(--nx-primary)]"
                checked={checked}
                // `undefined` rather than null: the value is optional on the
                // form shape, and writing null would send a key the create
                // payload has no meaning for.
                onChange={() => onChange(choice.type ?? undefined)}
              />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium text-foreground">
                  {choice.label}
                </span>
                {choice.hint !== "" && (
                  <span className="block text-sm text-muted-foreground">
                    {choice.hint}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
