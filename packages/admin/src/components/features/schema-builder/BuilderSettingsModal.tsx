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
import { useState } from "react";

import type { BasicsField, BuilderConfig } from "./builder-config";
import { AdvancedTab } from "./builder-settings-modal/AdvancedTab";
import { BasicsTab } from "./builder-settings-modal/BasicsTab";

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
  onCancel: () => void;
  onSubmit: (values: BuilderSettingsValues) => void;
};

const KIND_TITLE: Record<BuilderConfig["kind"], string> = {
  collection: "collection",
  single: "single",
  "field-group": "field group",
};

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
function computeInitialValues(
  mode: "create" | "edit",
  config: BuilderConfig,
  initialValues: BuilderSettingsValues | null
): BuilderSettingsValues {
  if (mode === "edit" && initialValues) return initialValues;
  return {
    ...EMPTY_VALUES,
    ...(config.advancedFields.includes("status") ? { status: true } : {}),
  };
}

export function BuilderSettingsModal({
  open,
  mode,
  config,
  initialValues,
  readOnly = false,
  onCancel,
  onSubmit,
}: Props) {
  const [values, setValues] = useState<BuilderSettingsValues>(() =>
    computeInitialValues(mode, config, initialValues)
  );
  const [tab, setTab] = useState<"basics" | "advanced">("basics");

  const kindLabel = KIND_TITLE[config.kind];
  const title =
    mode === "create"
      ? `New ${kindLabel}`
      : `${values.singularName || "Untitled"} settings`;
  const description = readOnly
    ? `This ${kindLabel} is defined in code and shown read-only.`
    : mode === "create"
      ? `Set up a new ${kindLabel}`
      : `Update settings for this ${kindLabel}`;
  const primaryLabel = mode === "create" ? "Continue" : "Save";

  return (
    <Dialog open={open} onOpenChange={next => !next && onCancel()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="basics">Basics</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
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
              />
            </fieldset>
          </TabsContent>
          <TabsContent value="advanced">
            <fieldset disabled={readOnly} className="min-w-0 border-0 p-0 m-0">
              <AdvancedTab
                fields={config.advancedFields}
                values={values}
                onChange={setValues}
              />
            </fieldset>
          </TabsContent>
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
              <Button onClick={() => onSubmit(values)}>{primaryLabel}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
