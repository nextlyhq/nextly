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
import { MOST_USED_FIELD_TYPES } from "nextly/field-catalog";
import type { JSX } from "react";

import {
  FieldTypeChangePicker,
  type FieldPickerChange,
  type TypeChoice,
} from "@admin/components/field-ui/FieldPicker";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useTypeChangeTargets } from "@admin/hooks/queries/useTypeChangeTargets";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import {
  containerChangeRefused,
  settingsFittingType,
  withTypeChanged,
} from "@admin/lib/builder/change-type";
import {
  findFieldPlacement,
  type FieldPlacement,
} from "@admin/lib/builder/field-placement";
import { findFieldById } from "@admin/lib/builder/field-transformers";
import { BUILDER_FIELD_TYPES } from "@admin/lib/builder/offered-field-types";
import type { TypeChangeTarget } from "@admin/services/typeChangeTargetsApi";

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

export function BuilderChangeType({
  config,
  fields,
  fieldId,
  entitySlug,
  savedFields,
  onCancel,
  onChanged,
}: Props): JSX.Element | null {
  const { plugins } = useBranding();
  const field = findFieldById([...fields], fieldId);
  const savedPlacement = savedFields
    ? findFieldPlacement(savedFields, fieldId)
    : null;
  // Asked by value: the query's key is compared by what it holds, not by identity.
  const saved = savedPlacement
    ? { path: savedPathOf(savedPlacement), type: savedPlacement.field.type }
    : null;
  const targets = useTypeChangeTargets({
    kind: config.kind,
    slug: entitySlug,
    saved,
  });
  const fieldGroups = useBuilderFieldGroupChoices(config, entitySlug);
  if (!field) return null;

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
    ...(saved !== null && targets.isPending
      ? { pending: { kind: "loading" as const } }
      : saved !== null && targets.isError
        ? {
            pending: {
              kind: "failed" as const,
              // What failed, then why, as the server or the network said it.
              message: `What each type would do to the saved values could not be checked (${apiErrorMessage(targets.error, "no answer")}). Close and try again.`,
            },
          }
        : {}),
    onChange: ({ type, fieldGroup }) => {
      const next = withTypeChanged(
        field,
        type,
        settingsFittingType(type, { surface: BUILDER_SETTINGS, plugins })
      );
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
      <NewEntityDialog {...fieldGroups.dialog} />
    </>
  );
}
