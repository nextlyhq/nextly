"use client";

/**
 * Settings: this page's configuration and the site's, in one dialog the
 * rail's Settings item opens.
 *
 * Two tabs, because the two save differently and an author must be able to
 * tell which is which:
 *
 * - **This page** is the entry's own fields, drawn by the admin as the entry
 *   form draws them, with a preview of how a shared link would look. It saves
 *   with the page, from the top bar's Save or Publish.
 * - **Site** applies to the live site at once, and says so. It is offered only
 *   to a role that may manage the site's settings: its breakpoints, and with
 *   the Layout rights, its default Layout.
 *
 * Enter in a field never saves the page: the dialog is drawn inside the page's
 * form, where Enter would submit it.
 *
 * @module admin/editor/settings-dialog
 */
import type { BreakpointSet } from "@nextlyhq/blocks-engine";
import {
  BASE_DEVICE_LABEL,
  BreakpointManager,
  EDITOR_WORDS,
  type BuilderShellProps,
} from "@nextlyhq/builder/shell";
import { PlaceTabs, usePluginRoute } from "@nextlyhq/plugin-sdk/admin";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@nextlyhq/ui";
import { AlertCircle, TriangleAlert } from "lucide-react";
import {
  useEffect,
  useState,
  type ComponentProps,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  PAGE_COLLECTION_ROUTE_PATH,
  type PageCollectionResponse,
} from "../../layout-choices-contract";
import {
  PAGE_BUILDER_PLUGIN_NAME,
  SITE_SETTINGS_ROUTE_PATH,
  type SiteSettingsRead,
} from "../../library-contract";
import { PAGE_BUILDER_SETTINGS_PLACE } from "../../settings-place-contract";
import { lazyPart } from "../lazy-part";

import { RemovalStatusRow, RemovalStepPanel } from "./breakpoint-removal-step";
import { undoableHint } from "./breakpoint-undo-flow";
import { UndoStatusRow, UndoStepPanel } from "./breakpoint-undo-step";
import { useSavedAddress, type SettingsAddress } from "./settings-address";
import type { SettingsPlace } from "./settings-place";
import type { SharePreview } from "./share-preview";
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
 * The site's code, fetched when the Site tab first draws it rather than with
 * the editor: it carries the code's own checks and words, which an author
 * who never opens the tab has no use for.
 */
const SiteCodeSection: typeof SiteCodeSectionPart = lazyPart(() =>
  import("./site-code-settings").then(m => m.SiteCodeSection)
);

/** What the shell hands the dialog. */
type DialogState = Parameters<
  NonNullable<BuilderShellProps["renderSettings"]>
>[0];

export interface SettingsDialogProps extends DialogState {
  /** The entry's own fields, drawn by the admin, or null where there are none. */
  pageFields: ReactNode | null;
  /**
   * The place other plugins add tabs to, beside the page's own settings, or
   * null for a document that offers none (a Layout, a component).
   */
  place?: SettingsPlace | null;
  /**
   * The page's Layout section, heading and all, or null for a document that
   * is not a page drawn inside a Layout. Drawn as given.
   */
  pageLayout?: ReactNode | null;
  /**
   * How a shared link to this page would look. It names no host: the public
   * site may be served from another origin than the admin, and only the
   * server knows which.
   */
  share: SharePreview;
  /**
   * Whether the page has the SEO plugin's fields. Where it does, they are among
   * the page's fields above; where it does not, the preview is all there is,
   * and a line says the SEO plugin adds them.
   */
  seoFields: boolean;
  /**
   * The page whose address to show, or null for a page never saved, which
   * has no address to read yet.
   */
  address?: SettingsAddress | null;
  /**
   * The site's breakpoints: what is saved, how to save, whether it is read,
   * and how to read the site's style again once a removal has changed it.
   */
  breakpoints: Pick<
    ComponentProps<typeof BreakpointManager>,
    "value" | "onSave" | "status"
  > & { refresh: () => void };
}

/**
 * Enter in a field submits the form it sits in, and this dialog is drawn inside
 * the page's form. Stopped once the field has had its turn, so a control that
 * uses Enter itself still does.
 */
function keepEnterFromThePage(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Enter") return;
  // An IME uses Enter to accept a candidate; that is not a submission.
  if (event.nativeEvent.isComposing) return;
  if (event.target instanceof HTMLInputElement) event.preventDefault();
}

export function SettingsDialog({
  open,
  onOpenChange,
  returnFocus,
  pageFields,
  place = null,
  pageLayout = null,
  share,
  seoFields,
  address = null,
  breakpoints,
}: SettingsDialogProps): JSX.Element {
  const site = usePluginRoute<SiteSettingsRead>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: SITE_SETTINGS_ROUTE_PATH,
    staleTime: 0,
    enabled: open,
  });
  const leave = useLeaveGuard(onOpenChange, open);
  // The Site tab is offered to a manager, and also when the read failed: a
  // failure must not look like a missing permission.
  const siteTab = site.data?.mayManageSite === true || site.error !== null;
  // A tab that went away (a retry that answered "not yours") is not left on
  // screen as a blank dialog.
  useEffect(() => {
    if (!siteTab) leave.leaveSite();
  }, [siteTab, leave]);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={next =>
          next ? onOpenChange(true) : leave.request({ kind: "close" })
        }
      >
        <DialogContent
          // One height for both tabs, so moving between them never resizes
          // the dialog under the pointer.
          className="flex h-[min(85vh,720px)] max-w-[680px] flex-col gap-0 p-0"
          onCloseAutoFocus={event => {
            const target = returnFocus();
            if (target === null) return;
            event.preventDefault();
            target.focus();
          }}
        >
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>{EDITOR_WORDS.settings}</DialogTitle>
            <DialogDescription className="sr-only">
              {"This page's settings, and the site's."}
            </DialogDescription>
          </DialogHeader>
          <Tabs
            value={leave.tab}
            onValueChange={next => leave.request({ kind: "tab", to: next })}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList className="mx-6 mt-3 w-fit">
              <TabsTrigger value="page">This page</TabsTrigger>
              {siteTab ? <TabsTrigger value="site">Site</TabsTrigger> : null}
            </TabsList>
            <TabsContent
              value="page"
              className="min-h-0 flex-1 overflow-y-auto px-6 pb-6"
            >
              <PlaceTabsOf place={place}>
                <ThisPage
                  pageFields={pageFields}
                  pageLayout={pageLayout}
                  share={share}
                  seoFields={seoFields}
                  address={
                    address === null ? null : (
                      <AddressLine address={address} open={open} />
                    )
                  }
                />
              </PlaceTabsOf>
            </TabsContent>
            {siteTab ? (
              <TabsContent
                value="site"
                className="min-h-0 flex-1 overflow-y-auto px-6 pb-6"
                // The Site tab's own fields (the breakpoints). This page's are
                // the entry's, which keep Enter from the page themselves.
                onKeyDown={keepEnterFromThePage}
              >
                <SiteTab
                  site={site}
                  breakpoints={breakpoints}
                  onEditingBreakpoints={leave.setEditing}
                  onSavingBreakpoints={leave.setSaving}
                  onEditingCode={leave.setEditingCode}
                  onSavingCode={leave.setSavingCode}
                  onClose={() => leave.request({ kind: "close" })}
                />
              </TabsContent>
            ) : null}
          </Tabs>
          {/* Per tab, one line: This page says when its settings save. Site
              has its own banner saying it applies at once, so it adds none. */}
          {leave.tab === "page" ? (
            <p className="border-t px-6 py-3 text-xs text-muted-foreground">
              Saved with the page when you Save or Publish.
            </p>
          ) : null}
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
    </>
  );
}

/**
 * The page's own settings, with the tabs other plugins add beside them under
 * General; the settings alone where nothing is added or the document offers
 * no place.
 */
function PlaceTabsOf({
  place,
  children,
}: {
  place: SettingsPlace | null;
  children: ReactNode;
}): JSX.Element {
  // The tab shown, held here so a tab can show General (`openGeneral`).
  const [open, setOpen] = useState<string | null>(null);
  if (place === null) return <>{children}</>;
  return (
    <PlaceTabs
      place={PAGE_BUILDER_SETTINGS_PLACE}
      context={place.context}
      tabProps={{ ...place.tabProps, openGeneral: () => setOpen(null) }}
      openTab={open}
      onOpenTabChange={setOpen}
      contentLabel="General"
      className="pt-4"
    >
      {children}
    </PlaceTabs>
  );
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

/** A way out of the breakpoint editor: closing Settings, or another tab. */
type Leave = { kind: "close" } | { kind: "tab"; to: string };

/** Which drafts leaving would discard. */
function discardingOf(
  breakpoints: boolean,
  code: boolean
): keyof typeof DISCARD_WORDS {
  if (breakpoints && code) return "both";
  return code ? "code" : "breakpoints";
}

/**
 * Leaving the Site tab while its breakpoints or its code are being edited
 * asks first, by closing Settings or by switching tabs alike, since either
 * takes the draft away. While a save of either is in flight, neither happens:
 * the write must answer on screen, and a "discard" could not stop it reaching
 * the site.
 */
function useLeaveGuard(onOpenChange: (open: boolean) => void, open: boolean) {
  const [tab, setTab] = useState("page");
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
    if (leave.kind === "close") onOpenChange(false);
    else setTab(leave.to);
  };
  return {
    tab,
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
      if (leave.kind === "tab" && leave.to === tab) return;
      if ((editing || editingCode) && tab === "site") {
        setPending(leave);
        return;
      }
      go(leave);
    },
    keepEditing: (): void => setPending(null),
    leaveSite: (): void => {
      if (tab === "site") setTab("page");
    },
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
  site: ReturnType<typeof usePluginRoute<SiteSettingsRead>>;
  breakpoints: SettingsDialogProps["breakpoints"];
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

/**
 * Where the page is served, as it is saved: read from the server, which
 * resolves it as the pages search does, never built here from the slug, so
 * it names the address visitors reach rather than a guess at it.
 *
 * A slug changed since the last save does not move it: the line says this is
 * the saved address and that it changes when the page is saved. Nothing shows
 * while it is read, or where the page has no address (another collection, a
 * site that states none, a page whose fields cannot fill it yet).
 */
function AddressLine({
  address,
  open,
}: {
  address: SettingsAddress;
  open: boolean;
}): JSX.Element | null {
  const read = useSavedAddress(address, open);
  if (read.data === undefined) {
    return read.error === null ? null : (
      <p className="text-xs text-muted-foreground">
        {"This page's address could not be read."}
      </p>
    );
  }
  const path = read.data.path;
  if (path === null) return null;
  return (
    // Drawn as the Address field's own line, right under it, rather than as
    // a section of its own: it is the same address, written out in full.
    <section
      aria-label="Address on your site"
      className="space-y-1 text-xs text-muted-foreground"
    >
      <p>
        On your site:{" "}
        <span
          className="break-all font-mono text-sm text-foreground"
          data-page-address=""
        >
          {path}
        </span>
      </p>
      {address.slugChanged ? (
        <p role="status">
          This is the saved address. It changes when you save the page.
        </p>
      ) : null}
      {/* Only the plugin's own Pages have this line, and their addresses
          may sit beneath another page's, which nothing else says. */}
      <p>
        To put this page beneath another, use / in its address, as in{" "}
        <span className="font-mono">docs/getting-started</span>.
      </p>
    </section>
  );
}

/**
 * The page's own fields, its address, the Layout it is drawn inside, then how
 * a shared link to it would look.
 */
function ThisPage({
  pageFields,
  pageLayout,
  share,
  seoFields,
  address,
}: Pick<
  SettingsDialogProps,
  "pageFields" | "pageLayout" | "share" | "seoFields"
> & {
  /** The page's address line, or null where it has none to show. */
  address: ReactNode | null;
}): JSX.Element {
  return (
    <div className="space-y-6 pt-4">
      {/* The address line sits with the page's own fields, under the
          Address field it writes out. */}
      {pageFields === null && address === null ? null : (
        <section className="space-y-2">
          {pageFields}
          {address}
        </section>
      )}
      {pageLayout ?? null}
      <section aria-labelledby="settings-share-title" className="space-y-2">
        <h3 id="settings-share-title" className="text-sm font-semibold">
          Search and sharing
        </h3>
        <SharePreviewCard share={share} />
        <p className="text-xs text-muted-foreground">
          {"Approximate: your site's metadata may differ."}
        </p>
        {seoFields ? null : (
          <p className="text-sm text-muted-foreground">
            {
              "Built from this page's title, first heading and first image. The SEO plugin adds fields to set the title, description and image yourself."
            }
          </p>
        )}
      </section>
    </div>
  );
}

/** How a shared link would look: image, title and description. */
function SharePreviewCard({ share }: { share: SharePreview }): JSX.Element {
  return (
    <figure
      aria-label="Share preview"
      className="max-w-[420px] overflow-hidden rounded-md border border-border"
    >
      {share.image === undefined ? null : share.image.kind === "url" ? (
        <img
          src={share.image.url}
          alt=""
          className="h-40 w-full border-b border-border object-cover"
        />
      ) : (
        <div className="flex h-40 items-center justify-center border-b border-border bg-muted text-xs text-muted-foreground">
          {share.image.kind === "media"
            ? "Image from the media library"
            : "Image from another site"}
        </div>
      )}
      <figcaption className="grid gap-0.5 px-3 py-2.5">
        <span className="text-sm font-semibold">{share.title}</span>
        {share.description === undefined ? null : (
          <span className="line-clamp-2 text-sm text-muted-foreground">
            {share.description}
          </span>
        )}
      </figcaption>
    </figure>
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
  breakpoints: SettingsDialogProps["breakpoints"];
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
    <div className="space-y-6 pt-4">
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
      {href === undefined ? null : (
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
