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
} from "@revnixhq/ui";
import { useState } from "react";

import type { BuilderConfig } from "./builder-config";
import { AdvancedTab } from "./builder-settings-modal/AdvancedTab";
import { BasicsTab } from "./builder-settings-modal/BasicsTab";

/**
 * Form-state shape shared by both modes. Optional fields are present so the
 * type covers all three kinds (Collections use plural, Singles skip it,
 * Components use category instead of adminGroup, etc.).
 *
 * `useAsTitle` and `timestamps` were removed in PR B per feedback Section
 * 1: the system `title` column is always the display, and timestamps are
 * always emitted. Power users override either via code-first config.
 */
export type BuilderSettingsValues = {
  singularName: string;
  pluralName?: string;
  slug: string;
  description?: string;
  icon: string;
  adminGroup?: string;
  category?: string;
  order?: number;
  status?: boolean;
  i18n?: boolean;
};

type Props = {
  open: boolean;
  mode: "create" | "edit";
  config: BuilderConfig;
  initialValues: BuilderSettingsValues | null;
  onCancel: () => void;
  onSubmit: (values: BuilderSettingsValues) => void;
};

const KIND_TITLE: Record<BuilderConfig["kind"], string> = {
  collection: "collection",
  single: "single",
  component: "component",
};

const EMPTY_VALUES: BuilderSettingsValues = {
  singularName: "",
  pluralName: "",
  slug: "",
  description: "",
  icon: "FileText",
};

export function BuilderSettingsModal({
  open,
  mode,
  config,
  initialValues,
  onCancel,
  onSubmit,
}: Props) {
  const [values, setValues] = useState<BuilderSettingsValues>(
    initialValues ?? EMPTY_VALUES
  );
  const [tab, setTab] = useState<"basics" | "advanced">("basics");

  const kindLabel = KIND_TITLE[config.kind];
  const title =
    mode === "create"
      ? `New ${kindLabel}`
      : `${values.singularName || "Untitled"} settings`;
  const description =
    mode === "create"
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
            <BasicsTab
              fields={config.basicsFields}
              values={values}
              onChange={setValues}
            />
          </TabsContent>
          <TabsContent value="advanced">
            <AdvancedTab
              fields={config.advancedFields}
              values={values}
              onChange={setValues}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(values)}>{primaryLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
