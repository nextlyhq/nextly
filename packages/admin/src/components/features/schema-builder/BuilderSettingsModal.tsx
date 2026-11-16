// Why: single multi-tab modal serves both create and edit for all three kinds
// (collection / single / component). Tab content is config-driven via
// BasicsTab + AdvancedTab so per-kind differences (no plural for singles,
// category instead of admin group for components, etc.) are expressed by the
// page-level config, not by branching inside this component.
//
// Mode contract:
// - "create": title is "New {kind}", primary action says "Continue", initialValues
//   is null (empty form). Pages navigate to the new fields screen on submit.
// - "edit": title is "{singularName} settings", primary action says "Save",
//   initialValues pre-fills the form. Pages update in-memory builder state.
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@nextlyhq/ui";
import type { JSX } from "react";
import { useEffect, useState } from "react";

import type { PendingAddress } from "@admin/services/addressCheckApi";
import type { StoredHookConfig } from "@admin/types/collection";

// The title and description name the kind through the shared table, so the
// modal spells each kind as every other builder message does.
import {
  BUILDER_KIND_NOUN,
  type BasicsField,
  type BuilderConfig,
  type BuilderKind,
} from "./builder-config";
import { AdvancedTab } from "./builder-settings-modal/AdvancedTab";
import { BasicsTab } from "./builder-settings-modal/BasicsTab";
import { StoredHooksView } from "./HooksEditor/StoredHooksView";
import {
  type AddressCheckState,
  useAddressCheck,
} from "./new-entity/useAddressCheck";

/**
 * Form-state shape shared by both modes. Optional fields are present so the
 * type covers all three kinds (Collections use plural, Singles skip it,
 * Components use category, etc.).
 *
 * `useAsTitle` and `timestamps` were removed in PR B per feedback Section
 * 1: the system `title` column is always the display, and timestamps are
 * always emitted. Power users override either via code-first config.
 *
 * removed `adminGroup` and `order` from the modal — server-side
 * `admin.group` / `admin.order` continue to work for code-first config.
 */
/**
 * Basics rows that only make sense while the entity is being created.
 *
 * `startingField` seeds a field on the create call and has no meaning
 * afterwards: shown in edit mode it would offer to choose something already
 * chosen, and choosing again would do nothing. Filtered here rather than in the
 * per-kind config, because the config describes the KIND and this depends on
 * the mode.
 */
const CREATE_ONLY_BASICS: readonly BasicsField[] = ["startingField"];

function basicsFieldsFor(
  mode: "create" | "edit",
  fields: readonly BasicsField[]
): readonly BasicsField[] {
  if (mode === "create") return fields;
  return fields.filter(field => !CREATE_ONLY_BASICS.includes(field));
}

export type BuilderSettingsValues = {
  /**
   * The field type a newly created entity starts with, or undefined for none.
   *
   * Create-only and never persisted: it decides what the create call seeds and
   * has no meaning afterwards, so editing an existing entity neither reads nor
   * writes it. Kept here rather than in a second form state because the Basics
   * tab renders it beside the other create-time answers.
   */
  startingFieldType?: string;
  singularName: string;
  pluralName?: string;
  slug: string;
  description?: string;
  icon: string;
  category?: string;
  status?: boolean;
  i18n?: boolean;
  versions?: boolean;
  // Version retention, meaningful only when `versions` is on. Undefined = the
  // default (keep 50); false = keep unlimited history; a number = keep that many
  // durable versions per document (0 = keep only protected versions).
  versionsMaxPerDoc?: number | false;
  // Cache revalidation. Undefined means on (the default): writes bust the
  // standard tags. False opts the entity out entirely.
  revalidate?: boolean;
  // Webhook recording. Undefined means on (the default): writes are recorded to
  // the outbox and delivered to every subscribed endpoint. False keeps this
  // entity's writes out of the outbox entirely, for content that carries
  // personal data.
  webhooks?: boolean;
};

type Props = {
  open: boolean;
  mode: "create" | "edit";
  config: BuilderConfig;
  initialValues: BuilderSettingsValues | null;
  /** Code-first entities open this dialog to inspect config; every control
   *  is disabled and the footer collapses to a single Close button. */
  readOnly?: boolean;
  /**
   * A collection's stored hooks, shown read-only in a tab of their own when
   * there are any. Nothing in the dialog edits them, and its submit never
   * carries them, so a settings save leaves them as they are stored.
   */
  storedHooks?: readonly StoredHookConfig[];
  /**
   * The entity is not saved yet, so its address can still change: editable,
   * and checked as it is typed against `otherAddresses`, every other unsaved
   * entity's in this tab (its own left out, so it is not used against itself).
   */
  unsavedAddress?: { otherAddresses: readonly PendingAddress[] };
  /**
   * How many places use this field group that the reader can read, counted as
   * its used-by view counts them, said beside its fixed address.
   */
  usedByCount?: number;
  onCancel: () => void;
  onSubmit: (values: BuilderSettingsValues) => void;
};

/**
 * Why a saved address is fixed: what refers to it, which changing it would
 * break. A collection's or Single's routes and the clients that call them; a
 * field group's, the fields that use it, counted where the page knows.
 */
function fixedAddressNote(kind: BuilderKind, usedByCount?: number): string {
  if (kind !== "field-group") {
    return "Fixed once saved: its API routes, and every client that calls them, use this address.";
  }
  const used =
    usedByCount === undefined
      ? ""
      : ` Used in ${usedByCount} ${usedByCount === 1 ? "place" : "places"} you can read.`;
  return `Fixed once saved: the fields that use this field group refer to it by this address.${used}`;
}

/** What is said under an unsaved entity's address, from its check. */
function unsavedAddressNote(check: AddressCheckState): {
  text: string;
  refused: boolean;
} {
  if (check.status === "refused") return { text: check.message, refused: true };
  if (check.status === "unknown")
    return { text: check.message, refused: false };
  return {
    text: "Its API routes use this address. It can be changed until the first save.",
    refused: false,
  };
}

/**
 * What the dialog does with the address, decided once: editable while the
 * entity is created or not saved yet; the note said under it (why a saved
 * one is fixed, what the check says of an unsaved one); and whether Save
 * waits for the check, which it does while an unsaved address is refused or
 * still being checked.
 */
function addressState(
  mode: "create" | "edit",
  kind: BuilderKind,
  unsaved: boolean,
  check: AddressCheckState,
  usedByCount: number | undefined
): {
  editable: boolean;
  note: { text: string; refused: boolean } | undefined;
  held: boolean;
} {
  if (mode === "create")
    return { editable: true, note: undefined, held: false };
  if (!unsaved) {
    return {
      editable: false,
      note: { text: fixedAddressNote(kind, usedByCount), refused: false },
      held: false,
    };
  }
  return {
    editable: true,
    note: unsavedAddressNote(check),
    held: check.status === "checking" || check.status === "refused",
  };
}

/**
 * The live check of an unsaved entity's address, drawn only for one: a saved
 * entity's address is fixed and asked about nothing. Hands its answer up.
 */
function UnsavedAddressCheck({
  kind,
  address,
  otherAddresses,
  onAnswer,
}: {
  kind: BuilderKind;
  address: string;
  otherAddresses: readonly PendingAddress[];
  onAnswer: (state: AddressCheckState) => void;
}): null {
  const state = useAddressCheck(kind, address, otherAddresses);
  // Handed up when what it says changes, not on every render: the check
  // answers "checking" as a new object each time it is drawn.
  const said = JSON.stringify(state);
  useEffect(
    () => onAnswer(JSON.parse(said) as AddressCheckState),
    [said, onAnswer]
  );
  return null;
}

/**
 * The answers as everything downstream should see them.
 *
 * 🔴 Normalised HERE, at the one boundary the values cross, rather than by each
 * consumer. A settings save fans out to two writes — the create/update request
 * and the `ui-schema.json` projection — and they describe the same entity. When
 * only one of them trimmed, a description typed with trailing spaces was stored
 * one way in the row and another in the file, and replaying the manifest
 * visibly changed the value a person had saved.
 *
 * 🔴 TRIMMED, and nothing else. An emptied box stays `""` and must not become
 * `undefined`: the update handlers all read `description !== undefined` as "the
 * caller is not talking about this field", and `JSON.stringify` drops an
 * undefined property entirely — so clearing a description would leave the old
 * one in the database while the manifest's full replace dropped it, with the
 * interface reporting success either way. `""` is a person saying "remove it",
 * which is a different message from not mentioning it, and only the request can
 * carry that difference.
 *
 * What the MANIFEST does with an empty description is the manifest's own
 * question, answered where its entity is built.
 */
export function normalizedSettings(
  values: BuilderSettingsValues
): BuilderSettingsValues {
  return {
    ...values,
    description: values.description?.trim(),
    // The address as it is checked: the check asks about it trimmed, so the
    // one that moves the entity, names its route and creates it is the same.
    slug: values.slug.trim(),
  };
}

const EMPTY_VALUES: BuilderSettingsValues = {
  singularName: "",
  pluralName: "",
  slug: "",
  description: "",
  icon: "FileText",
};

// when creating a status-enabled kind (collection or
// single), Draft/Published lifecycle should default to ON so the user
// doesn't have to flip the switch every time. We key off advancedFields
// instead of `kind` so this stays correct if a future kind opts in or
// out of the status flag. Edit mode preserves whatever value was loaded.
export function createDefaults(config: BuilderConfig): BuilderSettingsValues {
  return {
    ...EMPTY_VALUES,
    ...(config.advancedFields.includes("status") ? { status: true } : {}),
  };
}

function computeInitialValues(
  mode: "create" | "edit",
  config: BuilderConfig,
  initialValues: BuilderSettingsValues | null
): BuilderSettingsValues {
  if (mode === "edit" && initialValues) return initialValues;
  return createDefaults(config);
}

/**
 * What the dialog says in each mode: creating names the kind, editing names the
 * entity by its singular name, and a code-first entity is said to be read-only.
 */
function dialogWording(
  mode: "create" | "edit",
  readOnly: boolean,
  kindLabel: string,
  singularName: string | undefined
): { title: string; description: string; primaryLabel: string } {
  if (mode === "create") {
    return {
      title: `New ${kindLabel}`,
      description: readOnly
        ? `This ${kindLabel} is defined in code and shown read-only.`
        : `Set up a new ${kindLabel}`,
      primaryLabel: "Continue",
    };
  }
  return {
    title: `${singularName || "Untitled"} settings`,
    description: readOnly
      ? `This ${kindLabel} is defined in code and shown read-only.`
      : `Update settings for this ${kindLabel}`,
    primaryLabel: "Save",
  };
}

export function BuilderSettingsModal({
  open,
  mode,
  config,
  initialValues,
  readOnly = false,
  storedHooks,
  unsavedAddress,
  usedByCount,
  onCancel,
  onSubmit,
}: Props): JSX.Element {
  const [values, setValues] = useState<BuilderSettingsValues>(() =>
    computeInitialValues(mode, config, initialValues)
  );
  // An unsaved entity's address is checked as it is typed; until answered it
  // reads as being checked, so Save waits for the answer.
  const [addressCheck, setAddressCheck] = useState<AddressCheckState>({
    status: "checking",
  });
  const address = addressState(
    mode,
    config.kind,
    unsavedAddress !== undefined,
    addressCheck,
    usedByCount
  );
  const [tab, setTab] = useState<"basics" | "advanced" | "hooks">("basics");
  const hookCount = storedHooks?.length ?? 0;

  const { title, description, primaryLabel } = dialogWording(
    mode,
    readOnly,
    BUILDER_KIND_NOUN[config.kind],
    values.singularName
  );

  return (
    <Dialog open={open} onOpenChange={next => !next && onCancel()}>
      {unsavedAddress && (
        <UnsavedAddressCheck
          kind={config.kind}
          address={values.slug.trim()}
          otherAddresses={unsavedAddress.otherAddresses}
          onAnswer={setAddressCheck}
        />
      )}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="basics">Basics</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
            {hookCount > 0 && (
              <TabsTrigger value="hooks">Hooks ({hookCount})</TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="basics">
            {/* A disabled fieldset natively disables every descendant control
                (inputs + Radix Select/Switch triggers) so read-only mode needs
                no per-field wiring; the tab triggers stay outside it. */}
            <fieldset disabled={readOnly} className="min-w-0 border-0 p-0 m-0">
              <BasicsTab
                fields={basicsFieldsFor(mode, config.basicsFields)}
                kind={config.kind}
                values={values}
                onChange={setValues}
                // Editable only while the entity is being created. Afterwards
                // the slug addresses its route, its table and every record
                // stored under it, and no save sends a changed one — every
                // update call takes the slug from the route instead. Left
                // editable it accepts a value that is silently dropped, and
                // for the kinds whose dirty check compares it, enables Save
                // and re-pins the baseline as though it had been written.
                // An unsaved entity's has nothing under it yet, so it stays
                // editable until the first save.
                slugEditable={address.editable}
                slugNote={address.note}
              />
            </fieldset>
          </TabsContent>
          <TabsContent value="advanced">
            <fieldset disabled={readOnly} className="min-w-0 border-0 p-0 m-0">
              <AdvancedTab
                fields={config.advancedFields}
                kind={config.kind}
                values={values}
                onChange={setValues}
              />
            </fieldset>
          </TabsContent>
          {hookCount > 0 && (
            <TabsContent value="hooks">
              <StoredHooksView hooks={storedHooks} />
            </TabsContent>
          )}
        </Tabs>

        <DialogFooter>
          {readOnly ? (
            <Button variant="outline" onClick={onCancel}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                disabled={address.held}
                onClick={() => onSubmit(normalizedSettings(values))}
              >
                {primaryLabel}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
