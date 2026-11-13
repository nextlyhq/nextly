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

import {
  type AdvancedField,
  BUILDER_KIND_NOUN,
  type BuilderConfig,
} from "../builder-config";
import { AdvancedTab } from "../builder-settings-modal/AdvancedTab";
import {
  ICON_PICKER_ICONS,
  IconPicker,
} from "../builder-settings-modal/IconPicker";
import {
  createDefaults,
  normalizedSettings,
  type BuilderSettingsValues,
} from "../BuilderSettingsModal";

import { EntryKindQuestion } from "./EntryKindQuestion";
import { useAddressCheck, type AddressCheckState } from "./useAddressCheck";

type Props = {
  open: boolean;
  config: BuilderConfig;
  onCancel: () => void;
  onCreate: (values: BuilderSettingsValues) => void;
  /**
   * A create is on its way: Create waits for it, so a second click sends no
   * second entity.
   */
  creating?: boolean;
};

/**
 * The options the fold names when they are on, in the words it uses, each with
 * what its switch shows while it holds no value: cache revalidation and webhook
 * recording are drawn on until turned off, so they are named on too.
 */
const OPTION_WORDS: ReadonlyArray<
  [AdvancedField & keyof BuilderSettingsValues, string, boolean]
> = [
  ["status", "drafts and publishing", false],
  ["versions", "version history", false],
  ["i18n", "translation", false],
  ["revalidate", "cache revalidation", true],
  ["webhooks", "webhook recording", true],
];

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
  // Judged here, whatever the check says: when it cannot be asked, a blank
  // address would otherwise reach the create, which derives one from the name.
  if (values.slug.trim() === "") return "Add an API address.";
  if (check.status === "checking") return "Checking the address…";
  if (check.status === "refused") return "Choose another address.";
  return null;
}

/** The fold's accessible name: which of the options it holds are on. */
function optionsName(
  config: BuilderConfig,
  values: BuilderSettingsValues
): string {
  const on = OPTION_WORDS.filter(
    ([key, , onWhenUnset]) =>
      config.advancedFields.includes(key) &&
      (values[key] ?? onWhenUnset) === true
  ).map(([, words]) => words);
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
  creating = false,
}: Props): JSX.Element {
  const kind = config.kind;
  const ids = useId();
  // The settings modal's create defaults, so drafts and publishing start on
  // for a kind that has them, as they did there.
  const [values, setValues] = useState<BuilderSettingsValues>(() =>
    createDefaults(config)
  );
  // Until the person picks an icon, the name suggests one.
  const [pickedIcon, setPickedIcon] = useState<string | null>(null);

  const pluginEntries = usePluginFieldTypeEntries("entries");
  const kindChoices = entryKindChoices(pluginEntries);
  const asksKind =
    config.basicsFields.includes("startingField") &&
    hasStartingFieldChoice(kindChoices);
  const hasPlural = config.basicsFields.includes("pluralName");
  // Each kind whose settings hold an icon picks it here; a field group's shows
  // in its list and the navigation, as a collection's and a Single's do.
  const hasIcon = config.basicsFields.includes("icon");
  const icon = pickedIcon ?? suggestIcon(values.singularName);

  // The address as Create sends it, so the check judges what the create gets.
  const check = useAddressCheck(kind, values.slug.trim());
  // Nothing typed yet is not a refusal to show.
  const typed = values.singularName !== "" || values.slug !== "";
  const blockedBy = createBlockedBy(values, hasPlural, check);

  const set = <K extends keyof BuilderSettingsValues>(
    key: K,
    value: BuilderSettingsValues[K]
  ) => setValues(current => ({ ...current, [key]: value }));

  const create = () => {
    if (blockedBy !== null || creating) return;
    // Trimmed by the settings modal's own rule (the description), and the
    // names and address as the check judged them.
    onCreate(
      normalizedSettings({
        ...values,
        singularName: values.singularName.trim(),
        pluralName: hasPlural ? values.pluralName?.trim() : undefined,
        slug: values.slug.trim(),
        icon: hasIcon ? icon : "",
      })
    );
  };

  return (
    <Dialog open={open} onOpenChange={next => !next && onCancel()}>
      {/* Capped to the viewport and scrolled inside, so Create stays reachable
          on a short screen with the options open. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
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

          <NameRow
            ids={ids}
            icon={hasIcon ? icon : null}
            onPickIcon={setPickedIcon}
            name={values.singularName}
            onName={name =>
              setValues(current => ({
                ...current,
                ...namesFollowingName(kind, current, name),
              }))
            }
          />

          {hasPlural && (
            <div className="space-y-1">
              <Label htmlFor={`${ids}-plural`}>Plural name</Label>
              <Input
                id={`${ids}-plural`}
                required
                value={values.pluralName ?? ""}
                onChange={e => set("pluralName", e.target.value)}
              />
            </div>
          )}

          <AddressField
            ids={ids}
            value={values.slug}
            note={addressNoteOf(check, typed)}
            onChange={next => set("slug", next)}
          />

          <MoreOptions
            ids={ids}
            config={config}
            values={values}
            onChange={setValues}
          />
        </div>

        <CreateFooter
          ids={ids}
          blockedBy={blockedBy}
          creating={creating}
          onCancel={onCancel}
          onCreate={create}
        />
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

/** The icon, beside the name; a kind with no icon shows the name alone. */
function NameRow({
  ids,
  icon,
  onPickIcon,
  name,
  onName,
}: {
  ids: string;
  icon: string | null;
  onPickIcon: (icon: string) => void;
  name: string;
  onName: (name: string) => void;
}): JSX.Element {
  return (
    <div className="flex items-end gap-2">
      {icon !== null && (
        <div className="w-40 shrink-0">
          <IconPicker
            value={icon}
            onChange={onPickIcon}
            accessibleName={`Icon: ${iconLabel(icon)}`}
          />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <Label htmlFor={`${ids}-name`}>Name</Label>
        <Input
          id={`${ids}-name`}
          required
          value={name}
          onChange={e => onName(e.target.value)}
        />
      </div>
    </div>
  );
}

/** The API address, with the server's answer about it said beneath it. */
function AddressField({
  ids,
  value,
  note,
  onChange,
}: {
  ids: string;
  value: string;
  note: { text: string; refused: boolean };
  onChange: (next: string) => void;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <Label htmlFor={`${ids}-address`}>API address</Label>
      <Input
        id={`${ids}-address`}
        className="font-mono"
        value={value}
        aria-invalid={note.refused}
        aria-describedby={`${ids}-address-note`}
        onChange={e => onChange(e.target.value)}
      />
      {/* A live region: the check answers after typing stops, so its answer
          is announced when it arrives, not only read with the field. */}
      <p
        id={`${ids}-address-note`}
        role="status"
        aria-live="polite"
        className={
          note.refused
            ? "text-xs text-destructive"
            : "text-xs text-muted-foreground"
        }
      >
        {note.text}
      </p>
    </div>
  );
}

/** The further options, folded under one control that names those that are on. */
function MoreOptions({
  ids,
  config,
  values,
  onChange,
}: {
  ids: string;
  config: BuilderConfig;
  values: BuilderSettingsValues;
  onChange: (next: BuilderSettingsValues) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-label={optionsName(config, values)}
        onClick={() => setOpen(current => !current)}
      >
        More options
      </Button>
      {open && (
        <div className="space-y-4 rounded-md border border-border p-3">
          <div className="space-y-1">
            <Label htmlFor={`${ids}-description`}>Description</Label>
            <Textarea
              id={`${ids}-description`}
              rows={2}
              value={values.description ?? ""}
              onChange={e =>
                onChange({ ...values, description: e.target.value })
              }
            />
          </div>
          <AdvancedTab
            fields={config.advancedFields.filter(
              field => field !== "showSystemFields"
            )}
            kind={config.kind}
            values={values}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
}

/** Cancel and Create, with the reason Create is not offered yet beside them. */
function CreateFooter({
  ids,
  blockedBy,
  creating,
  onCancel,
  onCreate,
}: {
  ids: string;
  blockedBy: string | null;
  creating: boolean;
  onCancel: () => void;
  onCreate: () => void;
}): JSX.Element {
  return (
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
        disabled={blockedBy !== null || creating}
        aria-describedby={
          blockedBy !== null ? `${ids}-create-blocked` : undefined
        }
        onClick={onCreate}
      >
        {creating ? "Creating…" : "Create"}
      </Button>
    </DialogFooter>
  );
}
