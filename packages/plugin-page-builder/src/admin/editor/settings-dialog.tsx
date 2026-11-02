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
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement
  ) {
    event.preventDefault();
  }
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
  // Whether the breakpoints are mid-edit: leaving then asks first.
  const [editingBreakpoints, setEditingBreakpoints] = useState(false);
  const [askingToDiscard, setAskingToDiscard] = useState(false);

  const requestOpenChange = (next: boolean): void => {
    if (!next && editingBreakpoints) {
      setAskingToDiscard(true);
      return;
    }
    onOpenChange(next);
  };
  const mayManageSite = site.data?.mayManageSite === true;

  return (
    <>
      <Dialog open={open} onOpenChange={requestOpenChange}>
        <DialogContent
          className="flex max-h-[85vh] max-w-[680px] flex-col gap-0 p-0"
          onKeyDown={keepEnterFromThePage}
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
          <Tabs defaultValue="page" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mx-6 mt-3 w-fit">
              <TabsTrigger value="page">This page</TabsTrigger>
              {mayManageSite ? (
                <TabsTrigger value="site">Site</TabsTrigger>
              ) : null}
            </TabsList>
            <TabsContent
              value="page"
              className="min-h-0 flex-1 overflow-y-auto px-6 pb-6"
            >
              <ThisPage pageFields={pageFields} share={share} host={host} />
            </TabsContent>
            {mayManageSite && site.data !== undefined ? (
              <TabsContent
                value="site"
                className="min-h-0 flex-1 overflow-y-auto px-6 pb-6"
              >
                <SiteSettings
                  read={site.data}
                  reread={site.refetch}
                  breakpoints={breakpoints}
                  onEditingBreakpoints={setEditingBreakpoints}
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
      <AlertDialog open={askingToDiscard} onOpenChange={setAskingToDiscard}>
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
            <AlertDialogAction
              onClick={() => {
                setEditingBreakpoints(false);
                onOpenChange(false);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
}: {
  read: SiteSettingsRead;
  reread: () => void;
  breakpoints: SettingsDialogProps["breakpoints"];
  onEditingBreakpoints: (editing: boolean) => void;
}): JSX.Element {
  return (
    <div className="space-y-6 pt-4">
      <p className="flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm font-medium text-warning-foreground">
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        Changes here apply to the live site immediately.
      </p>
      <section
        aria-labelledby="settings-breakpoints-title"
        className="space-y-2"
      >
        <h3 id="settings-breakpoints-title" className="text-sm font-semibold">
          Breakpoints
        </h3>
        <p className="text-sm text-muted-foreground">
          The device buttons in the top bar are these. A style set under a
          breakpoint applies up to its width.
        </p>
        <BreakpointManager
          {...breakpoints}
          onEditingChange={onEditingBreakpoints}
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
  const choose = (id: string): void => {
    setSave({ kind: "saving" });
    writePluginRoute({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: `/layouts/${encodeURIComponent(id)}/make-default`,
      body: {},
    }).then(
      () => {
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
  const current = read.layouts.find(layout => layout.id === read.defaultLayout);
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
          value={read.defaultLayout ?? ""}
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
