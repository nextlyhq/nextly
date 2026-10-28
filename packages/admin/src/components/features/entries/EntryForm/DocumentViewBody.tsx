"use client";

/**
 * A plugin's document view, drawn as the body of the document's own editor.
 *
 * The entry and Single editors render this in place of their form body when
 * the route names a document view, and nothing else about them changes: the
 * unsaved-work guard, the lock claim, the recovery offer, the save shortcut and
 * the entry contexts are the editor's own and stay mounted around it. The view
 * draws what the author works on; the admin keeps every fact about the
 * document.
 *
 * ## No `<form>` above the view
 *
 * The editor's form body sits inside `EntryFormProvider`'s
 * `<form onSubmit={save}>`. React dispatches a synthetic `submit` along the
 * React tree, portals included, so any `<form>` a plugin renders below that
 * element — a search box, a settings dialog — would save the document when it
 * submits. This body is therefore a SIBLING of that element rather than inside
 * it, and gives the view the document form through react-hook-form's own
 * `FormProvider`, which renders no element at all.
 *
 * @module components/features/entries/EntryForm/DocumentViewBody
 */

import type { FieldConfig } from "nextly/config";
import type { JSX, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { FormProvider, type UseFormReturn } from "react-hook-form";

import type { ViewedVersion } from "@admin/components/features/versions/document-history-context";
import { useSuppressAdminChrome } from "@admin/components/layout/ChromeSuppression";
import { PluginSlot } from "@admin/components/shared/plugin-slot";
import type { UseAutosaveRecoveryResult } from "@admin/hooks/useAutosaveRecovery";
import { useSearchParams } from "@admin/hooks/useSearchParams";
import { setSearchParam } from "@admin/lib/navigation";
import type { DocumentViewProps } from "@admin/lib/plugins/component-registry";
import {
  resolveViewField,
  viewFieldCandidates,
  type ViewFieldResolution,
} from "@admin/lib/plugins/document-view-registry";

import { LiveDocumentRecoveryOffer } from "./AutosaveRecoveryBanner";
import {
  useConditionValues,
  viewFieldRefusal,
  type ViewFieldRefusal,
} from "./document-view-field-gate";
import { DocumentLockBanner } from "./DocumentLockBanner";
import { DocumentViewFieldChooser } from "./DocumentViewFieldChooser";
import { DocumentViewFieldRefused } from "./DocumentViewFieldRefused";
import { FormErrorSummary } from "./FormErrorSummary";
import { MissingDocumentViewComponent } from "./MissingDocumentViewComponent";
import type { DocumentLockSurface } from "./useDocumentLockSurface";

/** The view the route names, as the page hands it to the editor. */
export interface DocumentViewMount {
  /** Component path of the view, resolved through the component registry. */
  component: string;
  /** Navigate to the document's own edit address. */
  onExit: () => void;
  /** For a view offered on a field type: that type, whose field it edits. */
  fieldType?: string;
}

/** Which document the view is of, in the props the view receives. */
export type DocumentViewTarget = Pick<
  DocumentViewProps,
  "collectionSlug" | "singleSlug" | "entryId"
>;

export interface DocumentViewBodyProps {
  view: DocumentViewMount;
  target: DocumentViewTarget;
  /** The editor's own form: what the view writes is what the editor saves. */
  form: UseFormReturn<Record<string, unknown>>;
  /** The editor's own claim on the document. */
  lock: DocumentLockSurface;
  /** The editor's own recovery state. */
  recovery: UseAutosaveRecoveryResult;
  /** The past version on screen, which withholds the recovery offer. */
  viewingVersion: ViewedVersion | null;
  /** The document's top-level fields, from which a field-type view's is chosen. */
  fields?: readonly FieldConfig[];
  /**
   * Whether a refused publish's recovery is taking the live values: the view
   * is read-only through the lock meanwhile, and marked busy for assistive
   * technology. The recovery's own toast says so to everyone.
   */
  recovering?: boolean;
  /**
   * A strip about the whole document, such as its scheduled release, drawn
   * first among the view's banners: inside the frame that shares the screen
   * between them and the view, so the view keeps the rest of the height.
   */
  banner?: ReactNode;
}

/**
 * Keep the address naming the field being edited.
 *
 * Where the document has one field the view could edit, a missing or stale
 * `?field=` still opens it — the author's intent is unambiguous — and the
 * address is corrected IN PLACE, so a reload or a shared link then reaches
 * exactly what is on screen, and Back does not return to the stale address.
 */
function useFieldInAddress(
  editing: ReturnType<typeof resolveViewField>,
  requested: string | string[] | undefined
): void {
  const named = editing.kind === "field" ? editing.name : undefined;
  useEffect(() => {
    if (named !== undefined && named !== requested) {
      setSearchParam("field", named, { replace: true });
    }
  }, [named, requested]);
}

/**
 * The recovery offer as the view body presents it, with a restore that also
 * draws the view afresh.
 *
 * A restore replaces the document's values from outside the view, and a view
 * may keep a working copy of what it edits, read once when it mounts — the Page
 * Builder keeps its own document state. Nothing tells such a view the form
 * changed under it, so it would go on showing, and then saving, the work the
 * author just chose to replace. Counting restores and keying the view by the
 * count gives it a new mount that reads the restored values.
 *
 * In three steps rather than one: the view goes, then the values are replaced,
 * then a fresh view comes. A view may hand its unsaved work to the form as it
 * unmounts — the Page Builder does, so a takeover keeps it — and replacing the
 * values first would let that hand-over write the old copy over the restored
 * one. Gone first, its hand-over lands before the restore and is replaced by
 * it.
 */
function useRestoreRemount(recovery: UseAutosaveRecoveryResult): {
  recovery: UseAutosaveRecoveryResult;
  generation: number;
  /** True for the one commit between the view leaving and the restore. */
  withdrawn: boolean;
} {
  const [generation, setGeneration] = useState(0);
  const [withdrawn, setWithdrawn] = useState(false);
  const { restore } = recovery;
  useEffect(() => {
    if (!withdrawn) return;
    restore();
    setGeneration(count => count + 1);
    setWithdrawn(false);
  }, [withdrawn, restore]);
  const offered = useMemo(
    () => ({ ...recovery, restore: () => setWithdrawn(true) }),
    [recovery]
  );
  return { recovery: offered, generation, withdrawn };
}

/**
 * Which field the view edits, from the address, and whether it may.
 *
 * Read here rather than by the view, so the rule the admin applies to the
 * address is the one answer. The gates are the field's own and those of the
 * groups around it, as the form applies them: an address reaches a field the
 * form would not let the author edit, and the view is refused rather than
 * trusted to refuse.
 */
function useViewField(
  fieldType: string | undefined,
  fields: readonly FieldConfig[] | undefined,
  form: UseFormReturn<Record<string, unknown>>
) {
  const requested = useSearchParams().field;
  // Every field the view could edit has its condition watched, not only the
  // one open: which fields the question offers depends on them all.
  const valueAt = useConditionValues(
    fieldType === undefined ? [] : viewFieldCandidates(fieldType, fields),
    form.control
  );
  const editing = resolveViewField(
    fieldType,
    fields,
    typeof requested === "string" ? requested : undefined,
    candidate => viewFieldRefusal(candidate, valueAt) === null
  );
  useFieldInAddress(editing, requested);
  const refusal =
    editing.kind === "field" ? viewFieldRefusal(editing, valueAt) : null;
  return { editing, refusal };
}

/**
 * What fills the view's area: the question of which field, the reason a field
 * may not be edited, or the view itself — absent for the one commit a restore
 * withdraws it, and keyed by the restore count so it reads restored values.
 */
function ViewArea({
  editing,
  refusal,
  withdrawn,
  generation,
  component,
  viewProps,
}: {
  editing: ViewFieldResolution<FieldConfig>;
  refusal: ViewFieldRefusal | null;
  withdrawn: boolean;
  generation: number;
  component: string;
  viewProps: DocumentViewProps;
}): React.JSX.Element | null {
  if (editing.kind === "choose") {
    return <DocumentViewFieldChooser candidates={editing.candidates} />;
  }
  if (refusal !== null) {
    return (
      <DocumentViewFieldRefused reason={refusal} onExit={viewProps.exit} />
    );
  }
  if (withdrawn) return null;
  return (
    <PluginSlot
      key={generation}
      path={component}
      props={viewProps}
      fallback={<MissingDocumentViewComponent path={component} />}
    />
  );
}

export function DocumentViewBody({
  view,
  target,
  form,
  lock,
  recovery,
  viewingVersion,
  fields,
  recovering = false,
  banner,
}: DocumentViewBodyProps): JSX.Element {
  /*
   * The view takes the window, less the primary rail. `canExit` is false
   * because this body renders no way back of its own — the view is handed
   * `exit` and decides where to draw it, which nothing here can verify — so the
   * admin keeps its navigation. A view that does render an exit asks for the
   * rail itself.
   */
  useSuppressAdminChrome({
    layers: ["subSidebar", "header", "pageFrame"],
    canExit: false,
  });

  /*
   * Leaving the view for the edit screen is not leaving the document: both
   * addresses render the same page component, so the editor and its form stay
   * mounted. The guard knows that move stays on the document and lets it
   * through, so nothing is switched off for it — a suppression would also wave
   * through whatever navigation came next, with the work still unsaved.
   */
  const exit = view.onExit;
  const offered = useRestoreRemount(recovery);

  const { editing, refusal } = useViewField(view.fieldType, fields, form);

  const { errors, submitCount } = form.formState;
  const viewProps: DocumentViewProps = {
    ...target,
    control: form.control,
    readOnly: lock.readOnly,
    exit,
    ...(editing.kind === "field" ? { field: editing.declaration } : {}),
  };

  return (
    <FormProvider {...form}>
      <div
        data-testid="document-view-frame"
        className="flex h-dvh min-h-0 flex-col bg-background"
      >
        {/* Above the view, in the editor's order: a document somebody else is
            in changes what the view's edits mean, so it is read before the
            offer to restore work into it. A save the shortcut attempted and
            validation refused is said here too, since none of the fields it
            names are on screen to say it themselves. */}
        <div className="shrink-0">
          {banner}
          <DocumentLockBanner
            notice={lock.notice}
            onTakeOver={lock.takeOver}
            onRequestAccess={lock.requestAccess}
          />
          <LiveDocumentRecoveryOffer
            recovery={offered.recovery}
            viewingVersion={viewingVersion}
            className="mx-6 mt-3"
          />
          <FormErrorSummary
            errors={errors}
            submitCount={submitCount}
            className="mx-6 mt-3"
          />
        </div>
        {/* The view fills what is left. Boxed so a view rooted in bare text
            or `display: contents` still has an element taking the height. */}
        <div className="min-h-0 flex-1" aria-busy={recovering || undefined}>
          <ViewArea
            editing={editing}
            refusal={refusal}
            withdrawn={offered.withdrawn}
            generation={offered.generation}
            component={view.component}
            viewProps={viewProps}
          />
        </div>
      </div>
    </FormProvider>
  );
}
