"use client";

/**
 * The frame every schema-builder page draws: the sticky toolbar, the read-only
 * notice a code-first entity gets, the drag context around the field list, and
 * the overlays one of which may be open.
 *
 * What the three kinds actually differ in is their config object, their copy,
 * and one region above the field list — collections and singles put plugin
 * slots there, field groups put a repair notice. That region is the
 * `beforeFieldList` slot, which is why this is a layout with a hole in it
 * rather than a component that branches on `config.kind`: a branch here would
 * have to know about plugin slots and about field-group repair, and neither is
 * the layout's business.
 */
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import type { ReactNode } from "react";

import { PageContainer } from "@admin/components/layout/page-container";

import type { BuilderConfig } from "./builder-config";
import { BuilderFieldList } from "./BuilderFieldList";
import { BuilderOverlays, type ActiveOverlay } from "./BuilderOverlays";
import { BuilderReadOnlyNotice } from "./BuilderReadOnlyNotice";
import type { BuilderSettingsValues } from "./BuilderSettingsModal";
import { BuilderToolbar } from "./BuilderToolbar";
import type { BuilderFieldsApi } from "./types";

type Props = {
  config: BuilderConfig;
  builder: BuilderFieldsApi;
  /** Entity name shown in the toolbar. */
  name: string;
  /** True for a code-first entity: every editing affordance renders disabled. */
  locked: boolean;
  /** Source file of a locked entity, shown in the read-only notice. */
  configPath?: string | null;
  /** Drives the toolbar's Save enable state. */
  unsavedCount: number;
  onSave: () => void;
  settings: BuilderSettingsValues;
  onSettingsChange: (next: BuilderSettingsValues) => void;
  active: ActiveOverlay;
  onActiveChange: (next: ActiveOverlay) => void;
  onDuplicateField: (fieldId: string) => void;
  onRowDragEnd: (event: DragEndEvent) => void;
  /** Rendered between the read-only notice and the field list. */
  beforeFieldList?: ReactNode;
  /** True while a save or a schema apply is in flight. */
  isSaving: boolean;
  /** What the live region announces during that save. */
  savingLabel: string;
  /** Page-owned dialogs — the schema-change confirmations, and any of the
   *  page's own. Mounted inside the frame so they share its stacking context. */
  children?: ReactNode;
};

export function BuilderPageLayout({
  config,
  builder,
  name,
  locked,
  configPath,
  unsavedCount,
  onSave,
  settings,
  onSettingsChange,
  active,
  onActiveChange,
  onDuplicateField,
  onRowDragEnd,
  beforeFieldList,
  isSaving,
  savingLabel,
  children,
}: Props) {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <BuilderToolbar
        config={config}
        name={name}
        locked={locked}
        unsavedCount={unsavedCount}
        onOpenSettings={() => onActiveChange({ kind: "settings" })}
        onSave={onSave}
      />
      <PageContainer className="flex-1 pb-0">
        {locked && (
          <BuilderReadOnlyNotice kind={config.kind} configPath={configPath} />
        )}
        {beforeFieldList}
        <DndContext
          sensors={builder.sensors}
          onDragStart={builder.handleDragStart}
          onDragEnd={onRowDragEnd}
        >
          <BuilderFieldList
            fields={builder.fields}
            readOnly={locked}
            onAddAt={insertAt => onActiveChange({ kind: "picker", insertAt })}
            onEditField={fieldId => onActiveChange({ kind: "edit", fieldId })}
            onDeleteField={fieldId => builder.handleFieldDelete(fieldId)}
            onDuplicateField={onDuplicateField}
            onAddInsideParent={parentId =>
              onActiveChange({
                kind: "picker",
                insertAt: 0,
                parentFieldId: parentId,
              })
            }
            onReorder={() => {
              // Reorder is driven by onRowDragEnd above; the field state lives
              // in useFieldBuilder, so there is nothing to notify here.
            }}
          />
        </DndContext>
      </PageContainer>

      <BuilderOverlays
        active={active}
        onActiveChange={onActiveChange}
        config={config}
        builder={builder}
        settings={settings}
        onSettingsChange={onSettingsChange}
        readOnly={locked}
      />

      {children}

      {/* Mounted whether or not a save is running, and only its text changes.
          A live region inserted at the same moment as its message is not
          reliably announced: several screen readers only watch regions that
          were already present when the text appeared, so a region that arrives
          with its own content can be skipped entirely. */}
      <div aria-live="polite" className="sr-only">
        {isSaving ? savingLabel : ""}
      </div>
    </div>
  );
}
