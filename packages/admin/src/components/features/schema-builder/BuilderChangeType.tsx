"use client";

/**
 * "Change type…" for a field in the Schema Builder: the shared field picker opened to change the
 * field's type, each type marked as the change would go.
 *
 * A field not saved yet may become any type the Builder offers, as often as wanted. A saved field
 * may become what the server says its saved values allow (`useTypeChangeTargets`): each other type
 * unavailable with the save's own reason, or marked by what the change does to the values; its
 * type as saved is always offered, since changing back changes nothing. Either way, a group or
 * repeating rows holding fields becomes only the other, which keeps them.
 *
 * The change is the host's: it is handed the field as the new type keeps it (`withTypeChanged`).
 */
import type { UseQueryResult } from "@tanstack/react-query";
import { MOST_USED_FIELD_TYPES } from "nextly/field-catalog";
import type { JSX } from "react";

import {
  FieldTypeChangePicker,
  type FieldPickerChange,
  type TypeChoice,
} from "@admin/components/field-ui/FieldPicker";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useTypeChangeTargets } from "@admin/hooks/queries/useTypeChangeTargets";
import { apiErrorMessage, isApiError } from "@admin/lib/api/parseApiError";
import {
  containerChangeRefused,
  settingsFittingType,
  withSavedTypeRestored,
  withTypeChanged,
} from "@admin/lib/builder/change-type";
import {
  findFieldPlacement,
  type FieldPlacement,
} from "@admin/lib/builder/field-placement";
import {
  convertToFieldDefinition,
  findFieldById,
} from "@admin/lib/builder/field-transformers";
import {
  BUILDER_FIELD_TYPES,
  builderOfferedTypes,
} from "@admin/lib/builder/offered-field-types";
import { pluginFieldTypeCatalogEntries } from "@admin/lib/builder/plugin-field-type-entries";
import type {
  SavedFieldSettings,
  TypeChangeQuestion,
  TypeChangeTarget,
} from "@admin/services/typeChangeTargetsApi";
import type { PluginMetadata } from "@admin/types/branding";

import { pickerExcludedTypes, type BuilderConfig } from "./builder-config";
import { useBuilderFieldGroupChoices } from "./BuilderFieldPicker";
import { NewEntityDialog } from "./new-entity/NewEntityDialog";
import type { BuilderField } from "./types";

/** The Builder's settings panel, as a type change asks which settings a type shows. */
const BUILDER_SETTINGS = { surface: "entries" } as const;

/**
 * Why the server says a saved field cannot become a type, where it gives no words of the save's
 * own: by the conversion rules' reason (`PairBlockReason`).
 */
const BLOCKED_WORDS: Readonly<Record<string, string>> = {
  "never-held": "No value it holds could be kept as this type.",
  relationship: "What it links to, or how its links are kept, would change.",
  container:
    "A field moves into or out of a group with Move to…, and a saved group or repeating rows keeps its type.",
  password: "A stored password can't be read back as another value.",
  unloaded: "The plugin this type comes from is not loaded.",
  "leaves-translation-inside":
    "Its text is kept in each language inside its group or repeating rows, and this type would leave that text behind. Add a new field beside it instead.",
  "joins-translation-inside":
    "Every language shares its value inside its group or repeating rows, and this type would be translated there: the next save in one language would take the value from the others. Turn off Localized on the field and save, then change its type.",
  "unjudged-inside":
    "Its text is kept in each language inside its group or repeating rows, and this change can't be checked there yet. Add a new field beside it instead.",
  "no-rule": "No rule says what this type would do to the saved values.",
};

/** The path the server finds a saved field by: its named holders' names, then its own. */
function savedPathOf(placement: FieldPlacement): string[] {
  return [
    ...placement.ancestors
      .filter(ancestor => Boolean(ancestor.name))
      .map(ancestor => ancestor.name),
    placement.field.name,
  ];
}

/** A server answer for one type, as the picker shows it. */
function choiceFromTarget(target: TypeChangeTarget | undefined): TypeChoice {
  if (target === undefined) {
    return { available: false, reason: BLOCKED_WORDS["no-rule"] };
  }
  if (target.blocked !== null) {
    return {
      available: false,
      reason: target.refusal
        ? [target.refusal.reason, ...target.refusal.steps].join(" ")
        : (BLOCKED_WORDS[target.blocked] ?? BLOCKED_WORDS["no-rule"]),
    };
  }
  return target.outcome === null
    ? { available: true }
    : { available: true, mark: target.outcome };
}

/**
 * `field` as picking `type` makes it: back to its type as saved, the saved field with the person's
 * edits since; to another, what the new type keeps of it.
 */
function changedTo(
  field: BuilderField,
  saved: BuilderField | null,
  type: string,
  plugins: PluginMetadata[] | undefined
): BuilderField {
  if (saved !== null && type === saved.type) {
    return withSavedTypeRestored(field, saved);
  }
  return withTypeChanged(
    field,
    type,
    settingsFittingType(type, { surface: BUILDER_SETTINGS, plugins })
  );
}

/** The settings `saved` was saved with that decide what another type does to its values. */
function savedSettingsOf(saved: BuilderField): SavedFieldSettings {
  return {
    hasMany: saved.hasMany === true,
    unique: saved.advanced?.unique === true,
    localized:
      typeof saved.advanced?.localized === "boolean"
        ? saved.advanced.localized
        : undefined,
    options: (saved.options ?? [])
      .map(option => option.value)
      .filter(value => typeof value === "string"),
    validation: { ...saved.validation },
  };
}

/**
 * What the picker asks the server of the saved field `saved`: its settings as saved, and every type
 * it offers, a plugin's among them, each with the field as picking it would be saved
 * (`convertToFieldDefinition`), so the server judges the field the save would write.
 */
function questionOf(
  config: BuilderConfig,
  field: BuilderField,
  saved: FieldPlacement,
  plugins: PluginMetadata[] | undefined
): TypeChangeQuestion {
  const offered = builderOfferedTypes(
    config,
    pluginFieldTypeCatalogEntries(plugins, "entries")
  );
  const candidates = [...offered]
    .filter(type => type !== saved.field.type)
    .map(type => ({
      type,
      field: convertToFieldDefinition(
        changedTo(field, saved.field, type, plugins)
      ),
    }));
  return {
    path: savedPathOf(saved),
    type: saved.field.type,
    saved: savedSettingsOf(saved.field),
    candidates,
  };
}

type Props = {
  config: BuilderConfig;
  fields: readonly BuilderField[];
  fieldId: string;
  /** The address of the entity being edited: none for one not saved yet. */
  entitySlug?: string;
  /** The fields as last saved; a field among them is judged by the server. */
  savedFields?: readonly BuilderField[];
  onCancel: () => void;
  /** Called with the field as its new type keeps it. */
  onChanged: (next: BuilderField) => void;
};

export function BuilderChangeType(props: Props): JSX.Element | null {
  const field = findFieldById([...props.fields], props.fieldId);
  return field ? <ChangeTypeOf {...props} field={field} /> : null;
}

function ChangeTypeOf({
  config,
  fieldId,
  entitySlug,
  savedFields,
  onCancel,
  onChanged,
  field,
}: Props & { field: BuilderField }): JSX.Element {
  const { plugins } = useBranding();
  const savedPlacement = savedFields
    ? findFieldPlacement(savedFields, fieldId)
    : null;
  const saved = savedPlacement?.field ?? null;
  const targets = useTypeChangeTargets({
    kind: config.kind,
    slug: entitySlug,
    question: savedPlacement
      ? questionOf(config, field, savedPlacement, plugins)
      : null,
  });
  const fieldGroups = useBuilderFieldGroupChoices(config, entitySlug);

  const choiceOf = (type: string): TypeChoice => {
    const holding = containerChangeRefused(field, type);
    if (holding) {
      return {
        available: false,
        reason: `It holds ${holding.holds} ${holding.holds === 1 ? "field" : "fields"}, which only a group or repeating rows keeps.`,
      };
    }
    if (saved === null) return { available: true };
    // Back to its type as saved: nothing about its values changes.
    if (type === saved.type) return { available: true, mark: "keeps" };
    return choiceFromTarget(targets.data?.find(target => target.type === type));
  };
  const change: FieldPickerChange = {
    current: field.type,
    choiceOf,
    ...pendingOf(saved, targets),
    onChange: ({ type, fieldGroup }) => {
      const next = changedTo(field, saved, type, plugins);
      onChanged(fieldGroup ? { ...next, component: fieldGroup } : next);
    },
  };

  return (
    <>
      <FieldTypeChangePicker
        open
        title={`Change the type of ${field.label || field.name || "this field"}`}
        config={{
          surface: "entries",
          types: BUILDER_FIELD_TYPES,
          exclude: pickerExcludedTypes(config),
          mostUsed: MOST_USED_FIELD_TYPES,
          // No label is asked when a type changes: the field keeps its own.
          deriveName: () => field.name,
          fieldGroups: fieldGroups.config,
        }}
        change={change}
        onCancel={onCancel}
      />
      <NewEntityDialog key={fieldGroups.dialogKey} {...fieldGroups.dialog} />
    </>
  );
}

/** What the picker waits on, for a saved field: the server's answer, or why it could not be asked. */
function pendingOf(
  saved: BuilderField | null,
  targets: UseQueryResult<TypeChangeTarget[]>
): Pick<FieldPickerChange, "pending"> {
  if (saved === null) return {};
  if (targets.isPending) return { pending: { kind: "loading" } };
  if (!targets.isError) return {};
  const { error } = targets;
  // The saved field has changed since the page loaded it, which the server's words say and how to
  // go on: trying again would ask about the same earlier definition.
  if (isApiError(error) && error.code === "CONFLICT") {
    return { pending: { kind: "failed", message: error.message } };
  }
  return {
    pending: {
      kind: "failed",
      // What failed, then why, as the server or the network said it.
      message: `What each type would do to the saved values could not be checked (${apiErrorMessage(error, "no answer")}). Close and try again.`,
    },
  };
}
