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
  BreakpointManager,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@nextlyhq/ui";
import { AlertCircle, Check, Loader2, TriangleAlert } from "lucide-react";
import {
  useEffect,
  useId,
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

import type { SharePreview } from "./share-preview";

/** What the shell hands the dialog. */
type DialogState = Parameters<
  NonNullable<BuilderShellProps["renderSettings"]>
>[0];

export interface SettingsDialogProps extends DialogState {
  /** The entry's own fields, drawn by the admin, or null where there are none. */
  pageFields: ReactNode | null;
  /** How a shared link to this page would look. */
  share: SharePreview;
  /** Where the site is served, as a shared link names it. */
  host: string;
  /** The site's breakpoints: what is saved, how to save, whether it is read. */
  breakpoints: Pick<
    ComponentProps<typeof BreakpointManager>,
    "value" | "onSave" | "status"
  >;
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
  share,
  host,
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
          className="flex max-h-[85vh] max-w-[680px] flex-col gap-0 p-0"
          onCloseAutoFocus={event => {
            const target = returnFocus();
            if (target === null) return;
            event.preventDefault();
            target.focus();
          }}
        >
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Settings</DialogTitle>
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
              <ThisPage pageFields={pageFields} share={share} host={host} />
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
                />
              </TabsContent>
            ) : null}
          </Tabs>
          <p className="border-t px-6 py-3 text-xs text-muted-foreground">
            {
              "This page's settings save with the page, from Save or Publish in the top bar. Site settings save as you change them."
            }
          </p>
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
}: {
  site: ReturnType<typeof usePluginRoute<SiteSettingsRead>>;
  breakpoints: SettingsDialogProps["breakpoints"];
  onEditingBreakpoints: (editing: boolean) => void;
  onSavingBreakpoints: (saving: boolean) => void;
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
        status: "ready",
        onSave: async next => {
          const answer = await breakpoints.onSave(next);
          site.refetch();
          return typeof answer === "string" ? answer : undefined;
        },
      }}
      onEditingBreakpoints={onEditingBreakpoints}
      onSavingBreakpoints={onSavingBreakpoints}
    />
  );
}

/** The page's own fields, then how a shared link to it would look. */
function ThisPage({
  pageFields,
  share,
  host,
}: Pick<SettingsDialogProps, "pageFields" | "share" | "host">): JSX.Element {
  return (
    <div className="space-y-6 pt-4">
      {pageFields === null ? null : <section>{pageFields}</section>}
      <section aria-labelledby="settings-share-title" className="space-y-2">
        <h3 id="settings-share-title" className="text-sm font-semibold">
          Search and sharing
        </h3>
        <SharePreviewCard share={share} host={host} />
        <p className="text-xs text-muted-foreground">
          {"Approximate: your site's metadata may differ."}
        </p>
      </section>
    </div>
  );
}

/** How a shared link would look: image, address, title and description. */
function SharePreviewCard({
  share,
  host,
}: {
  share: SharePreview;
  host: string;
}): JSX.Element {
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
          Image from the media library
        </div>
      )}
      <figcaption className="grid gap-0.5 px-3 py-2.5">
        <span className="text-xs text-muted-foreground">{host}</span>
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
}: {
  read: SiteSettingsRead;
  reread: () => void;
  breakpoints: SettingsDialogProps["breakpoints"];
  onEditingBreakpoints: (editing: boolean) => void;
  onSavingBreakpoints: (saving: boolean) => void;
}): JSX.Element {
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
        <BreakpointManager
          {...breakpoints}
          onEditingChange={onEditingBreakpoints}
          onSavingChange={onSavingBreakpoints}
        />
      </section>
      <DefaultLayout read={read} reread={reread} />
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
  const shown =
    chosen !== null && chosen !== read.defaultLayout
      ? chosen
      : read.defaultLayout;
  const choose = (id: string): void => {
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
        <select
          id={selectId}
          value={shown ?? ""}
          disabled={!read.mayChooseDefaultLayout || save.kind === "saving"}
          onChange={event => choose(event.target.value)}
          className="h-9 min-w-56 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {read.defaultLayout === null ? <option value="">None</option> : null}
          {read.layouts.map(layout => (
            <option key={layout.id} value={layout.id}>
              {layout.title}
            </option>
          ))}
        </select>
        <SaveWords save={save} />
      </div>
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
