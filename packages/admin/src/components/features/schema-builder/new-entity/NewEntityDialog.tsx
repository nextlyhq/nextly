/**
 * One short dialog that creates a collection, Single or field group.
 *
 * What editors will make comes first, where a plugin such as the Page Builder
 * offers a choice; then the icon beside the name, suggested from the name until
 * one is picked; the plural (for a collection) and the API address, derived
 * from the name and editable; and the further options folded under one control
 * that says which are on. The address is checked by the server's own rule as
 * it is typed, so Create is never offered for an address the create refuses.
 * A Single has no plural, and a field group no icon or publishing options.
 *
 * @module components/features/schema-builder/new-entity/NewEntityDialog
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from "@nextlyhq/ui";
import { type JSX, useId, useState } from "react";

import { usePluginFieldTypeEntries } from "@admin/components/field-ui";
import { namesFollowingName } from "@admin/lib/builder/entity-names";
import { suggestIcon } from "@admin/lib/builder/icon-suggestion";
import {
  entryKindChoices,
  hasStartingFieldChoice,
} from "@admin/lib/builder/starting-field";

import { BUILDER_KIND_NOUN, type BuilderConfig } from "../builder-config";
import { AdvancedTab } from "../builder-settings-modal/AdvancedTab";
import {
  ICON_PICKER_ICONS,
  IconPicker,
} from "../builder-settings-modal/IconPicker";
import type { BuilderSettingsValues } from "../BuilderSettingsModal";

import { EntryKindQuestion } from "./EntryKindQuestion";
import { useAddressCheck, type AddressCheckState } from "./useAddressCheck";

type Props = {
  open: boolean;
  config: BuilderConfig;
  onCancel: () => void;
  onCreate: (values: BuilderSettingsValues) => void;
};

/** The options the fold names when they are on, in the words it uses. */
const OPTION_WORDS: ReadonlyArray<[keyof BuilderSettingsValues, string]> = [
  ["status", "drafts and publishing"],
  ["versions", "version history"],
  ["i18n", "translation"],
];

const EMPTY_VALUES: BuilderSettingsValues = {
  singularName: "",
  pluralName: "",
  slug: "",
  icon: "",
  description: "",
};

/** Why Create is not offered yet, or `null` when it is. */
function createBlockedBy(
  values: BuilderSettingsValues,
  hasPlural: boolean,
  check: AddressCheckState
): string | null {
  if (values.singularName.trim() === "") return "Add a name.";
  if (hasPlural && (values.pluralName ?? "").trim() === "") {
    return "Add a plural name.";
  }
  if (check.status === "checking") return "Checking the address…";
  if (check.status === "refused") return "Choose another address.";
  return null;
}

/** The fold's accessible name: which of its options are on. */
function optionsName(values: BuilderSettingsValues): string {
  const on = OPTION_WORDS.filter(([key]) => values[key] === true).map(
    ([, words]) => words
  );
  return on.length === 0
    ? "More options, none on"
    : `More options, on: ${on.join(", ")}`;
}

function iconLabel(name: string): string {
  return ICON_PICKER_ICONS.find(icon => icon.name === name)?.label ?? name;
}

export function NewEntityDialog({
  open,
  config,
  onCancel,
  onCreate,
}: Props): JSX.Element {
  const kind = config.kind;
  const ids = useId();
  const [values, setValues] = useState<BuilderSettingsValues>(EMPTY_VALUES);
  // Until the person picks an icon, the name suggests one.
  const [pickedIcon, setPickedIcon] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const pluginEntries = usePluginFieldTypeEntries("entries");
  const kindChoices = entryKindChoices(pluginEntries);
  const asksKind =
    config.basicsFields.includes("startingField") &&
    hasStartingFieldChoice(kindChoices);
  const hasPlural = config.basicsFields.includes("pluralName");
  // A field group is placed inside other fields, never listed in the sidebar,
  // so it has no icon.
  const hasIcon = kind !== "field-group";
  const icon = pickedIcon ?? suggestIcon(values.singularName);

  const check = useAddressCheck(kind, values.slug);
  // Nothing typed yet is not a refusal to show.
  const typed = values.singularName !== "" || values.slug !== "";
  const blockedBy = createBlockedBy(values, hasPlural, check);

  const set = <K extends keyof BuilderSettingsValues>(
    key: K,
    value: BuilderSettingsValues[K]
  ) => setValues(current => ({ ...current, [key]: value }));

  const create = () => {
    if (blockedBy !== null) return;
    onCreate({
      ...values,
      singularName: values.singularName.trim(),
      pluralName: hasPlural ? values.pluralName?.trim() : undefined,
      slug: values.slug.trim(),
      icon: hasIcon ? icon : "",
    });
  };

  const addressNote = addressNoteOf(check, typed);

  return (
    <Dialog open={open} onOpenChange={next => !next && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New {BUILDER_KIND_NOUN[kind]}</DialogTitle>
          <DialogDescription>
            Name it; the rest can be changed in its settings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {asksKind && (
            <EntryKindQuestion
              choices={kindChoices}
              value={values.startingFieldType}
              onChange={next => set("startingFieldType", next)}
            />
          )}

          <div className="flex items-end gap-2">
            {hasIcon && (
              <div className="w-40 shrink-0">
                <IconPicker
                  value={icon}
                  onChange={setPickedIcon}
                  accessibleName={`Icon: ${iconLabel(icon)}`}
                />
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor={`${ids}-name`}>Name</Label>
              <Input
                id={`${ids}-name`}
                value={values.singularName}
                onChange={e =>
                  setValues(current => ({
                    ...current,
                    ...namesFollowingName(kind, current, e.target.value),
                  }))
                }
              />
            </div>
          </div>

          {hasPlural && (
            <div className="space-y-1">
              <Label htmlFor={`${ids}-plural`}>Plural name</Label>
              <Input
                id={`${ids}-plural`}
                value={values.pluralName ?? ""}
                onChange={e => set("pluralName", e.target.value)}
              />
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor={`${ids}-address`}>API address</Label>
            <Input
              id={`${ids}-address`}
              className="font-mono"
              value={values.slug}
              aria-invalid={typed && check.status === "refused"}
              aria-describedby={`${ids}-address-note`}
              onChange={e => set("slug", e.target.value)}
            />
            <p
              id={`${ids}-address-note`}
              className={
                addressNote.refused
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {addressNote.text}
            </p>
          </div>

          <div className="space-y-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={optionsOpen}
              aria-label={optionsName(values)}
              onClick={() => setOptionsOpen(current => !current)}
            >
              More options
            </Button>
            {optionsOpen && (
              <div className="space-y-4 rounded-md border border-border p-3">
                <div className="space-y-1">
                  <Label htmlFor={`${ids}-description`}>Description</Label>
                  <Textarea
                    id={`${ids}-description`}
                    rows={2}
                    value={values.description ?? ""}
                    onChange={e => set("description", e.target.value)}
                  />
                </div>
                <AdvancedTab
                  fields={config.advancedFields.filter(
                    field => field !== "showSystemFields"
                  )}
                  kind={kind}
                  values={values}
                  onChange={setValues}
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="items-center gap-2">
          {blockedBy !== null && (
            <p
              id={`${ids}-create-blocked`}
              className="text-xs text-muted-foreground sm:mr-auto"
            >
              {blockedBy}
            </p>
          )}
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={blockedBy !== null}
            aria-describedby={
              blockedBy !== null ? `${ids}-create-blocked` : undefined
            }
            onClick={create}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What is said under the address: the server's refusal beside it as typed, or
 * what the address is for while there is nothing to refuse.
 */
function addressNoteOf(
  check: AddressCheckState,
  typed: boolean
): { text: string; refused: boolean } {
  if (typed && check.status === "refused") {
    return { text: check.message, refused: true };
  }
  if (typed && check.status === "unknown") {
    return { text: check.message, refused: false };
  }
  return {
    text: "Its API routes use this address. It cannot be changed once saved.",
    refused: false,
  };
}
