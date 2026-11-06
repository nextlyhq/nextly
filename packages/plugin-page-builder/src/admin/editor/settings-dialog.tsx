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
import {
  BASE_DEVICE_LABEL,
  BreakpointManager,
  EDITOR_WORDS,
  type BuilderShellProps,
} from "@nextlyhq/builder/shell";
import { usePluginRoute, writePluginRoute } from "@nextlyhq/plugin-sdk/admin";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@nextlyhq/ui";
import { AlertCircle, Check, Loader2, TriangleAlert } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  PAGE_BUILDER_PLUGIN_NAME,
  SITE_SETTINGS_ROUTE_PATH,
  type SiteSettingsRead,
} from "../../library-contract";
import {
  pageAddressPath,
  type PageAddressResponse,
} from "../../pages-search-contract";
import type { PublishReadinessResponse } from "../../publish-readiness-contract";
import {
  askReadiness,
  publishChosen,
  PublishOfferDialog,
  reportLeftUnpublished,
  type PublishChoice,
} from "../publish-offer";

import { RemovalStatusRow, RemovalStepPanel } from "./breakpoint-removal-step";
import type { SettingsAddress } from "./settings-address";
import type { SharePreview } from "./share-preview";
import { useBreakpointRemoval } from "./use-breakpoint-removal";

/** What the shell hands the dialog. */
type DialogState = Parameters<
  NonNullable<BuilderShellProps["renderSettings"]>
>[0];

export interface SettingsDialogProps extends DialogState {
  /** The entry's own fields, drawn by the admin, or null where there are none. */
  pageFields: ReactNode | null;
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
              Discard your breakpoint changes?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They have not been saved. The site keeps the breakpoints it has.
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

/** A way out of the breakpoint editor: closing Settings, or another tab. */
type Leave = { kind: "close" } | { kind: "tab"; to: string };

/**
 * Leaving the Site tab while its breakpoints are being edited asks first, by
 * closing Settings or by switching tabs alike, since either takes the draft
 * away. While a save of them is in flight, neither happens: the write must
 * answer on screen, and a "discard" could not stop it reaching the site.
 */
function useLeaveGuard(onOpenChange: (open: boolean) => void, open: boolean) {
  const [tab, setTab] = useState("page");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Leave | null>(null);
  // Closed from outside (the editor giving way to its narrow-window notice),
  // the editor's draft went with the dialog, so nothing is left to guard.
  useEffect(() => {
    if (open) return;
    setEditing(false);
    setSaving(false);
    setPending(null);
  }, [open]);
  const go = (leave: Leave): void => {
    if (leave.kind === "close") onOpenChange(false);
    else setTab(leave.to);
  };
  return {
    tab,
    asking: pending !== null,
    setEditing,
    setSaving,
    request: (leave: Leave): void => {
      if (saving) return;
      if (leave.kind === "tab" && leave.to === tab) return;
      if (editing && tab === "site") {
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
  onClose,
}: {
  site: ReturnType<typeof usePluginRoute<SiteSettingsRead>>;
  breakpoints: SettingsDialogProps["breakpoints"];
  onEditingBreakpoints: (editing: boolean) => void;
  onSavingBreakpoints: (saving: boolean) => void;
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
  const read = usePluginRoute<PageAddressResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: pageAddressPath(address.page, address.locale),
    staleTime: 0,
    enabled: open,
  });
  // Read again after each save, whichever field it changed: the host's path
  // can name more than the slug, and the query's own key would not move.
  const { refetch } = read;
  const revisionSeen = useRef(address.savedRevision);
  useEffect(() => {
    if (revisionSeen.current === address.savedRevision) return;
    revisionSeen.current = address.savedRevision;
    void refetch();
  }, [address.savedRevision, refetch]);
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
  onClose,
}: {
  read: SiteSettingsRead;
  reread: () => void;
  breakpoints: SettingsDialogProps["breakpoints"];
  onEditingBreakpoints: (editing: boolean) => void;
  onSavingBreakpoints: (saving: boolean) => void;
  onClose: () => void;
}): JSX.Element {
  const { refresh, ...manager } = breakpoints;
  const removal = useBreakpointRemoval({
    current: manager.value,
    save: async next => {
      const answer = await manager.onSave(next);
      return typeof answer === "string" ? answer : undefined;
    },
    removals: read.removals,
    reread,
    refreshStyle: refresh,
  });
  // The editor's own save is hidden under a removal's steps while they ask
  // before saving: then leaving waits only on a request a step has out, and
  // a confirmation on screen can be left, asking first as a draft is.
  const [editorSaving, setEditorSaving] = useState(false);
  const saving = removal.takesOver ? removal.inFlight : editorSaving;
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
      >
        <h3 id="settings-breakpoints-title" className="text-sm font-semibold">
          Breakpoints
        </h3>
        <p className="text-sm text-muted-foreground">
          Widths your styles can change at. Each applies at that width and
          below.
        </p>
        {removal.takesOver ? (
          <RemovalStepPanel
            removal={steps}
            current={manager.value}
            baseLabel={BASE_DEVICE_LABEL}
            onClose={onClose}
          />
        ) : (
          <RemovalStatusRow removal={steps} />
        )}
        {/* Kept mounted under a step, so Back returns to the draft as it was. */}
        <div hidden={removal.takesOver}>
          <BreakpointManager
            key={removal.generation}
            {...manager}
            onSave={removal.save}
            {...(removal.blocked === undefined
              ? {}
              : { blocked: removal.blocked })}
            onEditingChange={editing => {
              onEditingBreakpoints(editing);
              removal.editing(editing);
            }}
            onSavingChange={setEditorSaving}
          />
        </div>
      </section>
      {/* The step has the tab to itself while it asks or works. */}
      {removal.takesOver ? null : <DefaultLayout read={read} reread={reread} />}
    </div>
  );
}

type DefaultLayoutSave =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; message: string; retry: () => void };

/** The site's default Layout: chosen here, or read here without the rights. */
function DefaultLayout({
  read,
  reread,
}: {
  read: SiteSettingsRead;
  reread: () => void;
}): JSX.Element {
  const selectId = useId();
  const [save, setSave] = useState<DefaultLayoutSave>({ kind: "idle" });
  // The Layout just made the default, held until the read says so too, so the
  // select never shows the old default beside "Saved".
  const [chosen, setChosen] = useState<string | null>(null);
  const shown = chosen ?? read.defaultLayout;
  // Once the read says so too, the read is the answer again: a later change
  // made elsewhere must show.
  useEffect(() => {
    if (chosen !== null && read.defaultLayout === chosen) setChosen(null);
  }, [chosen, read.defaultLayout]);
  // A Layout about to wrap every page that names none, asked about first:
  // the components its areas place that are not live, with the offer to
  // publish them before it becomes the default. Never a refusal.
  const [offer, setOffer] = useState<{
    id: string;
    readiness: PublishReadinessResponse;
  } | null>(null);
  const choose = (id: string): void => {
    setSave({ kind: "saving" });
    void askReadiness({ documents: [], layout: id }).then(readiness => {
      if (
        readiness === null ||
        (readiness.dependencies.length === 0 && readiness.missing === 0)
      ) {
        makeDefault(id);
        return;
      }
      setSave({ kind: "idle" });
      setOffer({ id, readiness });
    });
  };
  const answer = (choice: PublishChoice): void => {
    const asked = offer;
    setOffer(null);
    if (asked === null || choice.kind === "cancel") return;
    if (choice.kind === "only") {
      makeDefault(asked.id);
      return;
    }
    setSave({ kind: "saving" });
    publishChosen(choice.dependencies).then(
      result => {
        reportLeftUnpublished(result, asked.readiness, "Layout");
        makeDefault(asked.id);
      },
      (reason: unknown) => {
        setSave({
          kind: "failed",
          message:
            reason instanceof Error
              ? reason.message
              : "The components could not be published.",
          retry: () => choose(asked.id),
        });
      }
    );
  };
  const makeDefault = (id: string): void => {
    setSave({ kind: "saving" });
    writePluginRoute({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: `/layouts/${encodeURIComponent(id)}/make-default`,
      body: {},
    }).then(
      () => {
        setChosen(id);
        setSave({ kind: "saved" });
        reread();
      },
      (reason: unknown) => {
        setSave({
          kind: "failed",
          message:
            reason instanceof Error
              ? reason.message
              : "The default Layout could not be changed.",
          retry: () => choose(id),
        });
      }
    );
  };
  const current = read.layouts.find(layout => layout.id === shown);
  return (
    <section aria-labelledby={`${selectId}-title`} className="space-y-2">
      <h3 id={`${selectId}-title`} className="text-sm font-semibold">
        Default Layout
      </h3>
      <label htmlFor={selectId} className="block text-sm">
        Pages without a Layout of their own use
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          {...(shown === null ? {} : { value: shown })}
          disabled={!read.mayChooseDefaultLayout || save.kind === "saving"}
          onValueChange={choose}
        >
          <SelectTrigger id={selectId} className="w-56">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            {read.layouts.map(layout => (
              <SelectItem key={layout.id} value={layout.id}>
                {layout.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SaveWords save={save} />
      </div>
      <PublishOfferDialog
        readiness={offer?.readiness ?? null}
        subject="Layout"
        onAnswer={answer}
        onlyLabel="Make default anyway"
        withLabel={count =>
          count === 1
            ? "Publish it, then make default"
            : `Publish ${String(count)}, then make default`
        }
      />
      {read.mayChooseDefaultLayout ? null : (
        <p className="text-xs text-muted-foreground">
          {current === undefined ? "" : `${current.title}. `}You can see the
          default but not change it: that needs the rights to update and publish
          Layouts.
        </p>
      )}
    </section>
  );
}

/** A site setting's save, in the save chip's words. */
function SaveWords({ save }: { save: DefaultLayoutSave }): JSX.Element {
  return (
    <span
      role="status"
      className="flex items-center gap-1.5 text-sm text-muted-foreground"
    >
      {save.kind === "saving" ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Saving…
        </>
      ) : save.kind === "saved" ? (
        <>
          <Check className="size-4 text-success" aria-hidden="true" />
          Saved
        </>
      ) : save.kind === "failed" ? (
        <>
          <AlertCircle className="size-4 text-destructive" aria-hidden="true" />
          <span className="text-destructive">Not saved</span>
          <span className="sr-only">{save.message}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title={save.message}
            onClick={save.retry}
          >
            Retry
          </Button>
        </>
      ) : null}
    </span>
  );
}
