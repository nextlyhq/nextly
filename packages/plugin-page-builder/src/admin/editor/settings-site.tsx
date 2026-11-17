"use client";

/**
 * Site settings: the site's breakpoints and its code, which apply to the live
 * site at once and say so. Its own dialog, opened from Page settings' "Site
 * settings ▸" for a role that may manage the site, kept apart from the
 * page's settings because the two save differently: the page's with the
 * page, the site's straight away.
 *
 * Leaving while a breakpoint or the code is being edited asks first, and
 * nothing closes while a save of either is in flight. Enter in a field never
 * saves the page: the dialog is drawn inside the page's form.
 *
 * @module admin/editor/settings-site
 */
import type { BreakpointSet } from "@nextlyhq/blocks-engine";
import { BASE_DEVICE_LABEL, BreakpointManager } from "@nextlyhq/builder/shell";
import { usePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@nextlyhq/ui";
import { AlertCircle, TriangleAlert } from "lucide-react";
import {
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type JSX,
  type KeyboardEvent,
} from "react";

import {
  PAGE_COLLECTION_ROUTE_PATH,
  type PageCollectionResponse,
} from "../../layout-choices-contract";
import {
  PAGE_BUILDER_PLUGIN_NAME,
  type SiteSettingsRead,
} from "../../library-contract";
import { lazyPart } from "../lazy-part";

import { RemovalStatusRow, RemovalStepPanel } from "./breakpoint-removal-step";
import { undoableHint } from "./breakpoint-undo-flow";
import { UndoStatusRow, UndoStepPanel } from "./breakpoint-undo-step";
import { ManageSetsContext } from "./manage-sets";
import type { SiteCodeSection as SiteCodeSectionPart } from "./site-code-settings";
import {
  useBreakpointRemoval,
  type BreakpointRemoval,
} from "./use-breakpoint-removal";
import {
  useBreakpointUndo,
  type BreakpointUndo,
  type UndoStep,
} from "./use-breakpoint-undo";

/**
 * The site's code, fetched when Site settings first draws it rather than with
 * the editor: it carries the code's own checks and words, which an author
 * who never opens it has no use for.
 */
const SiteCodeSection: typeof SiteCodeSectionPart = lazyPart(() =>
  import("./site-code-settings").then(m => m.SiteCodeSection)
);

/** The site's settings read, as Page settings asks for it. */
export type SiteSettingsQuery = ReturnType<
  typeof usePluginRoute<SiteSettingsRead>
>;

/**
 * The site's breakpoints: what is saved, how to save, whether it is read,
 * and how to read the site's style again once a removal has changed it.
 */
export type SettingsBreakpoints = Pick<
  ComponentProps<typeof BreakpointManager>,
  "value" | "onSave" | "status"
> & { refresh: () => void };

/**
 * Whether the person may change the site's settings, as the read answers:
 * also when the read failed, so a failure does not look like a missing
 * permission, and Site settings can say it could not load.
 */
export function mayOpenSiteSettings(site: SiteSettingsQuery): boolean {
  return site.data?.mayManageSite === true || site.error !== null;
}

/**
 * Enter in a field submits the form it sits in, and this dialog is drawn inside
 * the page's form. Stopped once the field has had its turn, so a control that
 * uses Enter itself still does.
 */
export function keepEnterFromThePage(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Enter") return;
  // An IME uses Enter to accept a candidate; that is not a submission.
  if (event.nativeEvent.isComposing) return;
  if (event.target instanceof HTMLInputElement) event.preventDefault();
}

export interface SiteSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The site's settings read, which Page settings holds while it is open. */
  site: SiteSettingsQuery;
  breakpoints: SettingsBreakpoints;
}

export function SiteSettingsDialog({
  open,
  onOpenChange,
  site,
  breakpoints,
}: SiteSettingsDialogProps): JSX.Element {
  const leave = useLeaveGuard(onOpenChange, open);
  const leaveToSets = useLeaveToSets(leave.request);
  // A permission that went away (a retry that answered "not yours") closes
  // the dialog rather than leaving it on screen blank.
  const allowed = mayOpenSiteSettings(site);
  useEffect(() => {
    if (open && !allowed) onOpenChange(false);
  }, [open, allowed, onOpenChange]);
  return (
    <ManageSetsContext.Provider value={leaveToSets}>
      <Dialog
        open={open}
        onOpenChange={next =>
          next ? onOpenChange(true) : leave.request({ kind: "close" })
        }
      >
        <DialogContent
          className="flex h-[min(85vh,720px)] max-w-[680px] flex-col gap-0 p-0"
          // The site's own fields (the breakpoints, the code).
          onKeyDown={keepEnterFromThePage}
        >
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Site settings</DialogTitle>
            <DialogDescription className="sr-only">
              {
                "The site's breakpoints and code, which apply to the live site at once."
              }
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            <SiteTab
              site={site}
              breakpoints={breakpoints}
              onEditingBreakpoints={leave.setEditing}
              onSavingBreakpoints={leave.setSaving}
              onEditingCode={leave.setEditingCode}
              onSavingCode={leave.setSavingCode}
              onClose={() => leave.request({ kind: "close" })}
            />
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={leave.asking}
        onOpenChange={asking => {
          if (!asking) leave.keepEditing();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {DISCARD_WORDS[leave.discarding].title}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {DISCARD_WORDS[leave.discarding].description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={leave.discard}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ManageSetsContext.Provider>
  );
}

/**
 * Where leaving goes: closing, and then, where asked, somewhere else in the
 * editor, such as the Pages panel's sets.
 */
interface Leave {
  kind: "close";
  then?: () => void;
}

/**
 * The editor's way to its list of sets, taken only as the dialog may be
 * left: a breakpoint or code draft asks first, and a save running keeps it.
 * Null where the editor offers none.
 */
function useLeaveToSets(request: (leave: Leave) => void): (() => void) | null {
  const openSets = useContext(ManageSetsContext);
  return openSets === null
    ? null
    : () => request({ kind: "close", then: openSets });
}

/** What leaving would discard, and how the question says so. */
const DISCARD_WORDS = {
  breakpoints: {
    title: "Discard your breakpoint changes?",
    description:
      "They have not been saved. The site keeps the breakpoints it has.",
  },
  code: {
    title: "Discard your code changes?",
    description: "They have not been saved. The site keeps the code it has.",
  },
  both: {
    title: "Discard your breakpoint and code changes?",
    description:
      "Neither has been saved. The site keeps the breakpoints and the code it has.",
  },
} as const;

/** Which drafts leaving would discard. */
function discardingOf(
  breakpoints: boolean,
  code: boolean
): keyof typeof DISCARD_WORDS {
  if (breakpoints && code) return "both";
  return code ? "code" : "breakpoints";
}

/**
 * Closing Site settings while its breakpoints or its code are being edited
 * asks first, since closing takes the draft away. While a save of either is
 * in flight it does not close: the write must answer on screen, and a
 * "discard" could not stop it reaching the site.
 */
function useLeaveGuard(onOpenChange: (open: boolean) => void, open: boolean) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingCode, setEditingCode] = useState(false);
  const [savingCode, setSavingCode] = useState(false);
  const [pending, setPending] = useState<Leave | null>(null);
  // Closed from outside (the editor giving way to its narrow-window notice),
  // the editor's draft went with the dialog, so nothing is left to guard.
  useEffect(() => {
    if (open) return;
    setEditing(false);
    setSaving(false);
    setEditingCode(false);
    setSavingCode(false);
    setPending(null);
  }, [open]);
  const go = (leave: Leave): void => {
    onOpenChange(false);
    leave.then?.();
  };
  return {
    asking: pending !== null,
    // What a discard would throw away: both drafts where both are open, as a
    // breakpoint draft stays while the code is open over it.
    discarding: discardingOf(editing, editingCode),
    setEditing,
    setSaving,
    setEditingCode,
    setSavingCode,
    request: (leave: Leave): void => {
      if (saving || savingCode) return;
      if (editing || editingCode) {
        setPending(leave);
        return;
      }
      go(leave);
    },
    keepEditing: (): void => setPending(null),
    discard: (): void => {
      setEditing(false);
      setEditingCode(false);
      if (pending !== null) go(pending);
      setPending(null);
    },
  };
}

/** The Site tab: what the read answered, or why it could not answer. */
function SiteTab({
  site,
  breakpoints,
  onEditingBreakpoints,
  onSavingBreakpoints,
  onEditingCode,
  onSavingCode,
  onClose,
}: {
  site: SiteSettingsQuery;
  breakpoints: SettingsBreakpoints;
  onEditingBreakpoints: (editing: boolean) => void;
  onSavingBreakpoints: (saving: boolean) => void;
  onEditingCode: (editing: boolean) => void;
  onSavingCode: (saving: boolean) => void;
  onClose: () => void;
}): JSX.Element | null {
  if (site.data === undefined) {
    return site.error === null ? null : (
      <div className="flex items-center gap-3 pt-4 text-sm">
        <AlertCircle
          className="size-4 shrink-0 text-destructive"
          aria-hidden="true"
        />
        <span>{"The site's settings could not be loaded."}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={site.refetch}
        >
          Retry
        </Button>
      </div>
    );
  }
  const read = site.data;
  return (
    <SiteSettings
      read={read}
      reread={site.refetch}
      breakpoints={{
        // Read with the site permission, as their write is, so a role that
        // may manage them sees them without Design's read.
        value: read.breakpoints ?? breakpoints.value,
        // Not while the read is refreshing: a cached set opened as a draft
        // and saved later would overwrite a newer one.
        status: site.fetching ? "loading" : "ready",
        onSave: async next => {
          const answer = await breakpoints.onSave(next);
          site.refetch();
          return typeof answer === "string" ? answer : undefined;
        },
        refresh: breakpoints.refresh,
      }}
      onEditingBreakpoints={onEditingBreakpoints}
      onSavingBreakpoints={onSavingBreakpoints}
      onEditingCode={onEditingCode}
      onSavingCode={onSavingCode}
      onClose={onClose}
    />
  );
}

/** The site's settings: live at once, and said to be. */
function SiteSettings({
  read,
  reread,
  breakpoints,
  onEditingBreakpoints,
  onSavingBreakpoints,
  onEditingCode,
  onSavingCode,
  onClose,
}: {
  read: SiteSettingsRead;
  reread: () => void;
  breakpoints: SettingsBreakpoints;
  onEditingBreakpoints: (editing: boolean) => void;
  onSavingBreakpoints: (saving: boolean) => void;
  onEditingCode: (editing: boolean) => void;
  onSavingCode: (saving: boolean) => void;
  onClose: () => void;
}): JSX.Element {
  // While the code is open the other sections step aside, as they do for a
  // breakpoint removal's steps.
  const [codeOpen, setCodeOpen] = useState(false);
  const { refresh, ...manager } = breakpoints;
  const removal = useBreakpointRemoval({
    current: manager.value,
    save: async next => {
      const answer = await manager.onSave(next);
      return typeof answer === "string" ? answer : undefined;
    },
    removals: read.removals,
    undoable: read.undoable,
    reread,
    refreshStyle: refresh,
  });
  const undo = useBreakpointUndo({
    undoable: read.undoable,
    removals: read.removals,
    reread,
    refreshStyle: refresh,
  });
  // A step that asks or works has the tab to itself: a removal's first, then
  // an undo's.
  const takesOver = removal.takesOver || undo.takesOver;
  // Counted up to open the breakpoint editor from a step, once it gives way.
  const [editRequest, setEditRequest] = useState(0);
  // The editor's own save is hidden under a removal's steps while they ask
  // before saving: then leaving waits only on a request a step has out, and
  // a confirmation on screen can be left, asking first as a draft is.
  const [editorSaving, setEditorSaving] = useState(false);
  const saving = takesOver ? removal.inFlight || undo.inFlight : editorSaving;
  useEffect(() => {
    onSavingBreakpoints(saving);
  }, [saving, onSavingBreakpoints]);
  // Reloaded, the editor starts again from the stored set, with no draft.
  const steps = {
    ...removal,
    reload: (): void => {
      onEditingBreakpoints(false);
      removal.reload();
    },
  };
  return (
    <div className="space-y-6 pt-2">
      <Alert variant="warning">
        <TriangleAlert className="size-4" aria-hidden="true" />
        <AlertDescription>
          Changes here apply to the live site immediately.
        </AlertDescription>
      </Alert>
      <section
        aria-labelledby="settings-breakpoints-title"
        className="space-y-2"
        // Kept mounted while the code is open, so a breakpoint draft stays.
        hidden={codeOpen}
      >
        <h3 id="settings-breakpoints-title" className="text-sm font-semibold">
          Breakpoints
        </h3>
        <p className="text-sm text-muted-foreground">
          Widths your styles can change at. Each applies at that width and
          below.
        </p>
        <BreakpointSteps
          removal={steps}
          undo={undo}
          current={manager.value}
          onClose={onClose}
          onEditBreakpoints={() => setEditRequest(value => value + 1)}
        />
        {/* Kept mounted under a step, so Back returns to the draft as it was. */}
        <div hidden={takesOver}>
          <BreakpointManager
            key={removal.generation}
            {...manager}
            onSave={removal.save}
            {...(removal.blocked === undefined
              ? {}
              : { blocked: removal.blocked })}
            tags={undo.putBack}
            editRequest={editRequest}
            onEditingChange={editing => {
              onEditingBreakpoints(editing);
              removal.editing(editing);
              undo.editing(editing);
            }}
            onSavingChange={setEditorSaving}
          />
        </div>
      </section>
      {/* The step has the tab to itself while it asks or works. */}
      {takesOver ? null : (
        <LaterSections
          read={read}
          codeOpen={codeOpen}
          code={{
            onEditingChange: onEditingCode,
            onSavingChange: onSavingCode,
            onOpenChange: setCodeOpen,
          }}
        />
      )}
    </div>
  );
}

/**
 * The Site sections after the breakpoints: the site default's line, which
 * steps aside while the code is open, and the code.
 */
function LaterSections({
  read,
  codeOpen,
  code,
}: {
  read: SiteSettingsRead;
  codeOpen: boolean;
  code: ComponentProps<typeof SiteCodeSection>;
}): JSX.Element {
  return (
    <>
      {codeOpen ? null : <SiteDefaultLine read={read} />}
      <SiteCodeSection {...code} />
    </>
  );
}

/** Whether an undo, going or finished, puts back removal `runId`. */
function undoes(step: UndoStep, runId: string): boolean {
  return (
    (step.kind === "undoing" ||
      step.kind === "undone" ||
      step.kind === "left") &&
    step.undoes === runId
  );
}

/**
 * What the Site tab shows of a removal and its undo above the breakpoint
 * list: the step that takes the list's place while one asks or works (a
 * removal's first), else their rows. The removal's own finished row offers
 * its undo where it is the one on offer; otherwise the undo's row does.
 */
function BreakpointSteps({
  removal,
  undo,
  current,
  onClose,
  onEditBreakpoints,
}: {
  removal: BreakpointRemoval;
  undo: BreakpointUndo;
  current: BreakpointSet;
  onClose: () => void;
  onEditBreakpoints: () => void;
}): JSX.Element {
  if (removal.takesOver) {
    return (
      <RemovalStepPanel
        removal={removal}
        current={current}
        baseLabel={BASE_DEVICE_LABEL}
        onClose={onClose}
      />
    );
  }
  if (undo.takesOver) {
    return (
      <UndoStepPanel
        undo={undo}
        onClose={onClose}
        onEditBreakpoints={onEditBreakpoints}
      />
    );
  }
  const shownRun =
    removal.step.kind === "done" || removal.step.kind === "left"
      ? removal.step.runId
      : undefined;
  const offered = undo.offered;
  // A finished removal this tab saw gives way to its undo, going or done, so
  // the tab never says at once that a breakpoint was removed and is back.
  const undoneHere = shownRun !== undefined && undoes(undo.step, shownRun);
  return (
    <>
      {undoneHere ? null : (
        <RemovalStatusRow
          removal={removal}
          {...(offered !== undefined && shownRun === offered.runId
            ? {
                offer: {
                  hint: undoableHint(offered),
                  undo: () => undo.ask(offered),
                },
              }
            : {})}
        />
      )}
      <UndoStatusRow
        undo={undo}
        offerHere={shownRun === undefined && removal.step.kind !== "resumed"}
      />
    </>
  );
}

/** Where "Change in Pages ▸ Header & footer" opens: the list of sets. */
function useSetListHref(): string | undefined {
  const read = usePluginRoute<PageCollectionResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: PAGE_COLLECTION_ROUTE_PATH,
  });
  const slug = read.data?.layoutsCollection;
  return slug === undefined
    ? undefined
    : `/admin/collections/${encodeURIComponent(slug)}`;
}

/**
 * The site default, named, and where it is changed: the Header & footer
 * list's "Make site default", the one place the default is set. Opened in a
 * new tab, so the page being edited and its undo history stay as they are.
 */
function SiteDefaultLine({ read }: { read: SiteSettingsRead }): JSX.Element {
  const href = useSetListHref();
  // Inside the builder, the list of sets is the Pages panel, in this window:
  // Site settings and Page settings close, and the panel opens on its sets.
  const openSets = useContext(ManageSetsContext);
  const name =
    read.layouts.find(layout => layout.id === read.defaultLayout)?.title ??
    "none set";
  return (
    <section
      aria-label="Site default header & footer"
      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"
    >
      <p>
        <span className="text-muted-foreground">
          Site default header & footer:
        </span>{" "}
        <span className="font-medium">{name}</span>
      </p>
      {openSets !== null ? (
        <button
          type="button"
          onClick={openSets}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Change in Pages ▸ Header & footer
        </button>
      ) : href === undefined ? null : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Change in Pages ▸ Header & footer
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </section>
  );
}
