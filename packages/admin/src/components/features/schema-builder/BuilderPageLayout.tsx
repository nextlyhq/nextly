"use client";

/**
 * The frame every schema-builder page draws: the sticky toolbar, the read-only
 * notice a code-first entity gets, the drag context around the field list, the
 * settings panel docked beside it while a field is edited, and the overlays
 * one of which may be open.
 *
 * What the three kinds actually differ in is their config object, their copy,
 * and one region above the field list — collections and singles put plugin
 * slots there, field groups put a repair notice. That region is the
 * `beforeFieldList` slot, which is why this is a layout with a hole in it
 * rather than a component that branches on `config.kind`: a branch here would
 * have to know about plugin slots and about field-group repair, and neither is
 * the layout's business.
 */
import { DndContext } from "@dnd-kit/core";
import type { JSX, ReactNode } from "react";
import { useMemo } from "react";

import { UnsavedChangesGuard } from "@admin/components/features/entries/EntryForm/UnsavedChangesGuard";
import { PageContainer } from "@admin/components/layout/page-container";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import type { BuilderPendingChanges } from "@admin/hooks/useBuilderEntityState";
import { useMediaQuery } from "@admin/hooks/useMediaQuery";
import { findFieldById } from "@admin/lib/builder";
import { builderAnnouncements } from "@admin/lib/builder/builder-announcements";
import type { DuplicateNaming } from "@admin/lib/builder/duplicate-field";
import { builderFieldErrors } from "@admin/lib/builder/field-validators";
import { judgeMove, moveDestinations } from "@admin/lib/builder/move-rule";
import {
  flattenOutline,
  nodePlacement,
  type FieldGroupsLoad,
  type LoadedFieldGroup,
  type OutlineNode,
} from "@admin/lib/builder/outline/outline-model";
import {
  fieldsWithDeleted,
  markPending,
} from "@admin/lib/builder/outline/pending-rows";
import { navigateTo } from "@admin/lib/navigation";
import type { StoredHookConfig } from "@admin/types/collection";

import type { BuilderConfig } from "./builder-config";
import { BuilderFieldSettings } from "./BuilderFieldSettings";
import { BuilderOverlays, type ActiveOverlay } from "./BuilderOverlays";
import { BuilderReadOnlyNotice } from "./BuilderReadOnlyNotice";
import type { BuilderSettingsValues } from "./BuilderSettingsModal";
import { BuilderToolbar } from "./BuilderToolbar";
import { FormPreview } from "./outline/FormPreview";
import { Outline, type OutlineCallbacks } from "./outline/Outline";
import { useBuilderOutline } from "./outline/useBuilderOutline";
import type { BuilderFieldsApi } from "./types";
import { useMoveContext } from "./useMoveContext";

type Props = {
  config: BuilderConfig;
  builder: BuilderFieldsApi;
  /** The entity's slug: what its outline's fold state is remembered under. */
  entitySlug: string;
  /** Entity name shown in the toolbar. */
  name: string;
  /** True for a code-first entity: every editing affordance renders disabled. */
  locked: boolean;
  /** Source file of a locked entity, shown in the read-only notice. */
  configPath?: string | null;
  /** How many changes are unsaved: shown in the toolbar, and what enables Save. */
  unsavedCount: number;
  /** The pending changes the toolbar's Undo, Redo and Discard all act on. */
  pending: BuilderPendingChanges;
  /** Fields saved before, whose names no longer follow their labels. */
  savedFieldIds: ReadonlySet<string>;
  onSave: () => void;
  settings: BuilderSettingsValues;
  onSettingsChange: (next: BuilderSettingsValues) => void;
  /** A collection's stored hooks, shown read-only in its settings modal. */
  storedHooks?: readonly StoredHookConfig[];
  active: ActiveOverlay;
  onActiveChange: (next: ActiveOverlay) => void;
  /** Copy a field to right after itself, named clear of what is beside it. */
  onDuplicateField: (fieldId: string, naming?: DuplicateNaming) => void;
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

export function BuilderPageLayout(props: Props): JSX.Element {
  // Only what the frame itself draws is named here; the outline and the panel
  // take the rest through the workspace.
  const {
    config,
    builder,
    name,
    locked,
    unsavedCount,
    pending,
    onSave,
    settings,
    onSettingsChange,
    storedHooks,
    active,
    onActiveChange,
    isSaving,
    savingLabel,
    children,
  } = props;
  // While changes are pending, every way out asks first: an in-app link, the
  // field group's editor, the browser's back, a reload and closing the tab.
  // The guard is the admin's one, which entries use too. A read-only entity
  // holds no changes to lose, and while a save is on its way the guard offers
  // no Discard Changes, so leaving cannot drop what the save is writing.
  return (
    <UnsavedChangesGuard
      isDirty={unsavedCount > 0}
      disabled={locked}
      busy={isSaving}
    >
      <div className="flex flex-col min-h-screen bg-background">
        <BuilderToolbar
          config={config}
          name={name}
          locked={locked}
          saving={isSaving}
          unsavedCount={unsavedCount}
          pending={pending}
          onAddField={() => onActiveChange({ kind: "picker", position: {} })}
          onOpenSettings={() => onActiveChange({ kind: "settings" })}
          onSave={onSave}
        />
        <BuilderWorkspace {...props} />

        <BuilderOverlays
          active={active}
          onActiveChange={onActiveChange}
          config={config}
          builder={builder}
          settings={settings}
          onSettingsChange={onSettingsChange}
          readOnly={locked}
          storedHooks={storedHooks}
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
    </UnsavedChangesGuard>
  );
}

/**
 * The outline and, while a field is edited, its settings, side by side. The
 * outline is built once here, so the two read the same rows.
 */
function BuilderWorkspace(
  props: Pick<
    Props,
    | "config"
    | "builder"
    | "entitySlug"
    | "locked"
    | "configPath"
    | "beforeFieldList"
    | "active"
    | "onActiveChange"
    | "onDuplicateField"
    | "savedFieldIds"
    | "settings"
    | "pending"
  >
): JSX.Element {
  const { builder, pending } = props;
  // Drawn with every pending delete shown where it was saved, marked, so a
  // delete stays in sight until it is saved or undone. Only drawn: the save
  // sends the builder's fields as they are.
  const shown = useMemo(
    () => fieldsWithDeleted(builder.fields, pending.saved),
    [builder.fields, pending.saved]
  );
  const {
    outline: built,
    fieldGroups,
    fieldGroupsLoad,
  } = useBuilderOutline(shown, props.locked, props.settings.i18n === true);
  const outline = useMemo(
    () => markPending(built, pending.marks, pending.changes),
    [built, pending.marks, pending.changes]
  );
  // Leaves for a field group's own editor, where its fields are changed. The
  // page's guard asks first while changes are pending, as it does for every
  // other way out.
  const openFieldGroup = (slug: string) => {
    navigateTo(buildRoute(ROUTES.BUILDER_FIELD_GROUPS_EDIT, { slug }));
  };
  return (
    <div className="flex flex-1 items-start">
      <FieldListRegion
        {...props}
        outline={outline}
        fieldGroups={fieldGroups}
        fieldGroupsLoad={fieldGroupsLoad}
        openFieldGroup={openFieldGroup}
      />
      <EditedFieldSettings
        {...props}
        outline={outline}
        openFieldGroup={openFieldGroup}
      />
    </div>
  );
}

/** Wide enough to dock the settings panel beside the field list. */
const DOCKED_PANEL_QUERY = "(min-width: 1024px)";

/**
 * The settings panel for the field being edited, if one is: docked beside the
 * list, writing each change straight to the builder, and closing when its
 * field is deleted.
 */
function EditedFieldSettings({
  active,
  onActiveChange,
  config,
  builder,
  outline,
  savedFieldIds,
  locked,
  openFieldGroup,
}: Pick<
  Props,
  | "active"
  | "onActiveChange"
  | "config"
  | "builder"
  | "savedFieldIds"
  | "locked"
> & {
  outline: readonly OutlineNode[];
  openFieldGroup: (slug: string) => void;
}): JSX.Element | null {
  // Asked here, where the page keeps it from its first render, so the panel
  // a field opens in is docked from its first frame on a wide screen.
  const docked = useMediaQuery(DOCKED_PANEL_QUERY);
  const byId = useMemo(
    () => new Map(flattenOutline(outline).map(node => [node.id, node])),
    [outline]
  );
  if (active.kind !== "edit") return null;
  const close = () => onActiveChange({ kind: "none" });
  const node = byId.get(active.fieldId);
  return (
    <BuilderFieldSettings
      // Keyed by the field, so its tab and any half-typed list entry start
      // fresh when another field is selected.
      key={active.fieldId}
      kind={config.kind}
      fields={builder.fields}
      fieldId={active.fieldId}
      savedFieldIds={savedFieldIds}
      readOnly={locked}
      docked={docked}
      // The outline's answer, so the panel and the row never disagree about
      // whether a field can change; and for a field group's field, which the
      // Builder does not hold, where the outline places it.
      readOnlyReason={node?.readOnly}
      fallbackPlacement={
        node && !node.own ? nodePlacement(node, byId, outline) : undefined
      }
      onOpenFieldGroup={openFieldGroup}
      onFieldChange={builder.handleFieldUpdate}
      onFieldDelete={fieldId => {
        builder.handleFieldDelete(fieldId);
        close();
      }}
      onClose={close}
    />
  );
}

/**
 * The field list and what sits above it: the read-only notice a code-first
 * entity gets, the page's own region, and the drag context around the list.
 */
function FieldListRegion({
  config,
  builder,
  entitySlug,
  outline,
  fieldGroups,
  fieldGroupsLoad,
  locked,
  configPath,
  beforeFieldList,
  active,
  onActiveChange,
  onDuplicateField,
  pending,
  openFieldGroup,
}: Pick<
  Props,
  | "config"
  | "builder"
  | "entitySlug"
  | "locked"
  | "configPath"
  | "beforeFieldList"
  | "active"
  | "onActiveChange"
  | "onDuplicateField"
  | "pending"
> & {
  outline: readonly OutlineNode[];
  fieldGroups: ReadonlyMap<string, LoadedFieldGroup>;
  fieldGroupsLoad: FieldGroupsLoad;
  openFieldGroup: (slug: string) => void;
}): JSX.Element {
  const selectedId = active.kind === "edit" ? active.fieldId : null;
  // The same map the save's refusal is read from, so a row marked with an
  // error is a row the save refuses.
  const errors = useMemo(
    () => builderFieldErrors(builder.fields.filter(field => !field.isSystem)),
    [builder.fields]
  );
  const systemFields = useMemo(
    () => builder.fields.filter(field => field.isSystem),
    [builder.fields]
  );

  // What the move rule needs beyond the fields, for every way of moving one.
  const moveContext = useMoveContext({
    config,
    locked,
    fields: builder.fields,
    saved: pending.saved,
    outline,
    fieldGroups,
  });

  const callbacks: OutlineCallbacks = {
    select: fieldId => onActiveChange({ kind: "edit", fieldId }),
    addAt: position => onActiveChange({ kind: "picker", position }),
    fields: builder.fields,
    judgeMove: (fieldId, target) =>
      judgeMove(builder.fields, fieldId, target, moveContext),
    moveDestinations: fieldId =>
      moveDestinations(builder.fields, fieldId, moveContext),
    // One change for undo, as every other edit is.
    commitMove: fields => builder.setFields(fields),
    duplicate: fieldId =>
      onDuplicateField(fieldId, {
        heldNames: moveContext.heldNames,
        topLevelReservesNames: moveContext.topLevelReservesNames,
      }),
    remove: fieldId => {
      builder.handleFieldDelete(fieldId);
      // A field deleted while its settings are open closes them too.
      if (selectedId === fieldId) onActiveChange({ kind: "none" });
    },
    setHidden: (fieldId, hidden) => {
      const field = findFieldById(builder.fields, fieldId);
      if (!field) return;
      builder.handleFieldUpdate({
        ...field,
        admin: { ...field.admin, hidden },
      });
    },
    openFieldGroup,
  };

  const foldKey = `nextly:admin:builder-fold:${config.kind}:${entitySlug}`;

  return (
    <PageContainer className="flex-1 min-w-0 pb-0">
      {locked && (
        <BuilderReadOnlyNotice kind={config.kind} configPath={configPath} />
      )}
      {beforeFieldList}
      <DndContext
        sensors={builder.sensors}
        onDragStart={builder.handleDragStart}
        accessibility={{
          announcements: builderAnnouncements(builder.fields),
        }}
      >
        {/* Keyed by the entity, so what is folded is read afresh for each
            one rather than carried over from the last. */}
        <Outline
          key={foldKey}
          kind={config.kind}
          nodes={outline}
          systemFields={systemFields}
          errors={errors}
          foldKey={foldKey}
          selectedId={selectedId}
          readOnly={locked}
          callbacks={callbacks}
          renderPreview={() => (
            <FormPreview
              kind={config.kind}
              fields={builder.fields}
              fieldGroups={fieldGroups}
              fieldGroupsLoad={fieldGroupsLoad}
            />
          )}
        />
      </DndContext>
    </PageContainer>
  );
}
