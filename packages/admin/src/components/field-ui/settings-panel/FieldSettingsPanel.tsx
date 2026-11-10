"use client";

/**
 * The one settings panel every surface uses to add and edit a field.
 *
 * It is the same for a field just added and one that already existed: five
 * tabs (General, Validation, Display, Conditions, Advanced), with the settings
 * that make the field its type first in General. Each change is reported to
 * the host at once, with the whole field, so there is no Apply step and
 * switching to another field keeps what was set; the host decides where the
 * change goes, and the panel writes nothing.
 *
 * A surface configures it rather than forking it (`FieldSettingsSurface`):
 * the plugin types it names, how a label becomes a name, the settings it fixes
 * and why, its own extra settings by tab, and its conditions. Every field type
 * has a settings section: a built-in type's comes from the core table, Blocks
 * included; a plugin's type shows the settings its plugin declared; and a type
 * that declares none still gets every setting fields share, with a line saying
 * it has none of its own.
 */
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from "@nextlyhq/ui";
import type { JSX, ReactNode } from "react";
import { useId, useState } from "react";

import { X } from "@admin/components/icons";
import { useFieldTypeLabel } from "@admin/lib/builder/field-type-label";

import { fieldApiPath } from "./field-api-path";
import { ConditionsTab } from "./tabs/ConditionsTab";
import { DisplayTab } from "./tabs/DisplayTab";
import { GeneralTab } from "./tabs/GeneralTab";
import { ValidationTab } from "./tabs/ValidationTab";
import type {
  FieldSettingsControlProps,
  FieldSettingsPanelProps,
  FieldSettingsSurface,
  FieldSettingsSurfaceControlProps,
  FieldSettingsTab,
  FixedFieldSetting,
} from "./types";
import {
  useFieldTypeSettings,
  type FieldTypeSettingsLookup,
} from "./use-field-type-settings";

const TABS: readonly { value: FieldSettingsTab; label: string }[] = [
  { value: "general", label: "General" },
  { value: "validation", label: "Validation" },
  { value: "display", label: "Display" },
  { value: "conditions", label: "Conditions" },
  { value: "advanced", label: "Advanced" },
];

/** The reason a surface gives for fixing a setting, when it is fixed now. */
function fixedReason(
  fixed: readonly FixedFieldSetting[] | undefined,
  setting: FixedFieldSetting["setting"],
  saved: boolean
): string | undefined {
  return fixed?.find(
    rule => rule.setting === setting && (rule.when === "always" || saved)
  )?.reason;
}

export function FieldSettingsPanel({
  surface,
  field,
  ancestors,
  siblings,
  saved,
  readOnly = false,
  onChange,
  onClose,
  actions,
}: FieldSettingsPanelProps): JSX.Element {
  const [tab, setTab] = useState<FieldSettingsTab>("general");
  const headingId = useId();
  const typeLabel = useFieldTypeLabel(surface.surface)(field.type);
  const lookup = useFieldTypeSettings(field.type, surface.typeSettings);
  const typeSettings = lookup.status === "known" ? lookup.settings : undefined;
  const typeFixedReason = fixedReason(surface.fixed, "type", saved);

  const control: FieldSettingsControlProps = { field, readOnly, onChange };
  const surfaceControl = { ...control, ancestors, siblings };

  // What the type and the surface add to one tab, the type's first.
  const additions = (which: FieldSettingsTab): ReactNode[] => {
    const TypeControl = typeSettings?.tabs?.[which];
    const SurfaceControl = surface.extraSettings?.[which];
    return [
      TypeControl && (
        <TypeOwnSettings key="type" readOnly={readOnly}>
          <TypeControl {...control} />
        </TypeOwnSettings>
      ),
      SurfaceControl && <SurfaceControl key="surface" {...surfaceControl} />,
    ].filter(Boolean);
  };

  const Defining = typeSettings?.defining;
  const advanced = additions("advanced");

  return (
    <section
      aria-labelledby={headingId}
      className="flex h-full min-h-0 flex-col bg-background"
    >
      <header className="flex items-start justify-between gap-2 border-b border-border p-4">
        <div className="min-w-0">
          <h2 id={headingId} className="truncate text-base font-semibold">
            {field.label || "Untitled field"}
          </h2>
          <p className="text-xs text-muted-foreground">
            <span className="opacity-70">Type:</span> {typeLabel}
          </p>
          {typeFixedReason && (
            <p className="text-xs text-muted-foreground">{typeFixedReason}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close field settings"
              className="h-7 w-7"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={value => setTab(value as FieldSettingsTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="mt-3 w-full justify-start px-4">
          {TABS.map(each => (
            <TabsTrigger key={each.value} value={each.value}>
              {each.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Keyed by the field, so the controls' own state (a number's typed
            text, a list's unsent entry) starts from the field shown even for
            a host that hands this panel another field without remounting it:
            otherwise one field's text could be written into the next. */}
        <div key={field.id} className="flex-1 overflow-y-auto p-4">
          <TabsContent value="general">
            <GeneralTab
              field={field}
              readOnly={readOnly}
              onChange={onChange}
              saved={saved}
              deriveName={surface.deriveName}
              nameFixedReason={fixedReason(surface.fixed, "name", saved)}
              apiPath={fieldApiPath(ancestors, field)}
              defining={
                Defining && (
                  <TypeOwnSettings readOnly={readOnly}>
                    <Defining {...control} />
                  </TypeOwnSettings>
                )
              }
              definingLabel={`${typeLabel} settings`}
            >
              <TypeSettingsNote lookup={lookup} typeLabel={typeLabel} />
              {additions("general")}
            </GeneralTab>
          </TabsContent>
          <TabsContent value="validation">
            <div className="space-y-4">
              <ValidationTab
                field={field}
                readOnly={readOnly}
                onChange={onChange}
                narrow={surface.validationRules}
              />
              {additions("validation")}
            </div>
          </TabsContent>
          <TabsContent value="display">
            <DisplayTab
              field={field}
              readOnly={readOnly}
              onChange={onChange}
              switches={surface.displaySwitches !== false}
            >
              {additions("display")}
            </DisplayTab>
          </TabsContent>
          <TabsContent value="conditions">
            <div className="space-y-4">
              <ConditionsContent
                conditions={surface.conditions}
                control={surfaceControl}
              />
              {additions("conditions")}
            </div>
          </TabsContent>
          <TabsContent value="advanced">
            {advanced.length > 0 ? (
              <div className="space-y-4">{advanced}</div>
            ) : (
              <p className="text-sm text-muted-foreground">
                This field has no advanced settings here.
              </p>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </section>
  );
}

/**
 * The Conditions tab's body. A surface with its own conditions editor draws the
 * whole tab, so no shared builder or "always shown" line sits beside it; any
 * other surface gets the shared tab in its mode.
 */
function ConditionsContent({
  conditions,
  control,
}: {
  conditions: FieldSettingsSurface["conditions"];
  control: FieldSettingsSurfaceControlProps;
}): JSX.Element {
  if (typeof conditions === "function") {
    const SurfaceConditions = conditions;
    return <SurfaceConditions {...control} />;
  }
  return (
    <ConditionsTab
      field={control.field}
      siblings={control.siblings}
      conditions={conditions}
      readOnly={control.readOnly}
      onChange={control.onChange}
    />
  );
}

/**
 * A type's own settings, disabled together while the panel is read-only. The
 * editors behind them take one callback per setting and no disabled state of
 * their own, so a fieldset is what greys out every input, switch and button
 * inside them at once, rather than leaving controls that look editable and
 * quietly change nothing.
 */
function TypeOwnSettings({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
      {children}
    </fieldset>
  );
}

/**
 * The line under General's settings for a type without settings of its own,
 * or whose settings cannot be known yet. Only a settled plugin list proves a
 * plugin's type declares none; until it arrives, or when it never could, the
 * panel says so instead, so a missing list never reads as an empty one.
 */
function TypeSettingsNote({
  lookup,
  typeLabel,
}: {
  lookup: FieldTypeSettingsLookup;
  typeLabel: string;
}): JSX.Element | null {
  switch (lookup.status) {
    case "loading":
      return (
        <p className="text-sm text-muted-foreground">
          Loading this type&apos;s settings…
        </p>
      );
    case "unavailable":
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <p>
            {typeLabel}&apos;s own settings could not be loaded; the settings
            every field has are above and in the other tabs.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={lookup.retry}
          >
            Retry
          </Button>
        </div>
      );
    case "known":
      return lookup.settings === undefined ? (
        <p className="text-sm text-muted-foreground">
          {typeLabel} has no settings of its own; the settings every field has
          are above and in the other tabs.
        </p>
      ) : null;
  }
}
