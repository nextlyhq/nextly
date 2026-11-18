"use client";

/**
 * Page settings: everything about the page being edited, in one dialog the
 * rail's Settings item opens, with one row of tabs that stays in view while a
 * tab's content scrolls.
 *
 * - **General**: the page's title, its address (the site's address and the
 *   page's part, with copy and edit) and its header & footer, then its
 *   search and sharing, as a plugin that edits SEO says it, or the builder's
 *   own preview where none does (`settings-general`).
 * - **Fields**: every other field of the page, drawn by the entry form's own
 *   renderer (`settings-fields`); left out where nothing is left for it.
 * - Then the tabs other plugins add to the Settings place, in their declared
 *   order, lifted into the same row; a tab that says it does not apply to
 *   this document (`setLeftOut`) is left out of the row, its panel kept.
 *
 * "Site settings ▸" sits apart at the right of the row, only for a role that
 * may change the site's settings: they apply to the live site at once, so
 * they open in their own dialog that says so (`settings-site`). Everything
 * here is saved with the page, as the line at the bottom of every tab says,
 * beside "Open as form".
 *
 * A document that is not a page (a component, a template) keeps its own
 * settings on General, with the place's tabs in the same row.
 *
 * Enter in a field never saves the page: the dialog is drawn inside the page's
 * form. A save the page refused for a field shown here offers "Show me",
 * which opens this dialog on that field's tab with the field focused.
 *
 * @module admin/editor/settings-dialog
 */
import type { DocumentKind } from "@nextlyhq/blocks-engine";
import type { BuilderShellProps } from "@nextlyhq/builder/shell";
import {
  useDocumentField,
  useEntryFieldsLayout,
  usePlaceTabs,
  usePluginRoute,
  useRevealField,
  type PlaceTabEntry,
} from "@nextlyhq/plugin-sdk/admin";
import {
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
import { ChevronRight } from "lucide-react";
import {
  useContext,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";

import {
  PAGE_BUILDER_PLUGIN_NAME,
  SITE_SETTINGS_ROUTE_PATH,
  type SiteSettingsRead,
} from "../../library-contract";
import { PAGE_BUILDER_SETTINGS_PLACE } from "../../settings-place-contract";
import { lazyPart } from "../lazy-part";

import { ManageSetsContext } from "./manage-sets";
import { holdsPageCode, pageCodeShown } from "./page-code-shown";
import type { SettingsAddress } from "./settings-address";
import type { PageCodeTab as PageCodeTabPart } from "./settings-code";
import { PageFieldsTab, usePageFields } from "./settings-fields";
import { DocumentGeneral, PageGeneral } from "./settings-general";
import type { SettingsPlace } from "./settings-place";
import { SettingsTabRequestContext } from "./settings-tab-request";
import {
  keepEnterFromThePage,
  mayOpenSiteSettings,
  SiteSettingsDialog,
  type SettingsBreakpoints,
  type SiteSettingsQuery,
} from "./settings-site";
import {
  CODE_TAB,
  FIELDS_TAB,
  focusFieldIn,
  GENERAL_TAB,
  inEditedField,
  tabForField,
} from "./settings-tabs";
import type { SharePreview } from "./share-preview";

/**
 * The page's Code tab, fetched when it is first drawn rather than with the
 * editor, as Site settings' code is: it carries site code's checks and
 * words, which an author who never opens it has no use for.
 */
const PageCodeTab: typeof PageCodeTabPart = lazyPart(() =>
  import("./settings-code").then(m => m.PageCodeTab)
);

/** What the shell hands the dialog. */
type DialogState = Parameters<
  NonNullable<BuilderShellProps["renderSettings"]>
>[0];

export interface SettingsDialogProps extends DialogState {
  /** Which document is open: a page gets General, Fields and its address. */
  kind: DocumentKind;
  /** The page's title as the author has it now, for the dialog's heading. */
  pageTitle: string | undefined;
  /** The form path of the field the builder edits, which is never drawn. */
  fieldName: string;
  /** The page's header & footer menu, or null for a page without one. */
  headerFooter?: ReactNode | null;
  /**
   * The place other plugins add tabs to, or null for a document that offers
   * none (a Layout, a component).
   */
  place?: SettingsPlace | null;
  /**
   * How a shared link to this page would look. It names no host: the public
   * site may be served from another origin than the admin, and only the
   * server knows which.
   */
  share: SharePreview;
  /** The saved page, for the hint about addresses beneath another page's. */
  address?: SettingsAddress | null;
  breakpoints: SettingsBreakpoints;
  /** Opens the document's form, where the editor offers it. */
  openAsForm?: (() => void) | undefined;
}

/**
 * Counts each close of Page settings with the editor's request, so what its
 * settings decide (a plugin's page checks) is asked again once it closes.
 */
function useNoteClosed(open: boolean): void {
  const request = useContext(SettingsTabRequestContext);
  const noteClosed = useRef(request?.noteClosed);
  noteClosed.current = request?.noteClosed;
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) noteClosed.current?.();
    wasOpen.current = open;
  }, [open]);
  // Drawn afresh for each opening, it may close by going away while open.
  useEffect(
    () => () => {
      if (wasOpen.current) noteClosed.current?.();
    },
    []
  );
}

/** Said once at the top while the page takes no edits. */
const READ_ONLY_NOTE =
  "You can't change this page right now, so its settings are read-only. The note above the editor says why.";

/** The dialog's heading: the page's settings, named by the page's title. */
function headingOf(kind: DocumentKind, title: string | undefined): string {
  if (kind !== "page") return "Settings";
  const named = title?.trim() ?? "";
  return `Page settings · ${named === "" ? "Untitled" : named}`;
}

/**
 * The tab chosen, and the field "Show me" asked to focus once its tab is
 * drawn. The tab shown is the one chosen while it is offered: one no longer
 * offered (Fields emptied, a plugin's tab gone) gives General back rather
 * than a blank dialog.
 */
function useChosenTab() {
  // A tab asked for before it opened (a page check's fix) is its first.
  const request = useContext(SettingsTabRequestContext);
  const [chosen, setChosen] = useState(() => request?.take() ?? GENERAL_TAB);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  return {
    chosen,
    choose: setChosen,
    focusPath,
    show: (tab: string, path: string): void => {
      setChosen(tab);
      setFocusPath(path);
    },
    focused: (): void => setFocusPath(null),
  };
}

/**
 * The dialog's tabs: Fields where a page has anything left for it, the
 * place's tabs after it, which one is shown, and "Show me" for a field the
 * page refused to save, which opens the dialog on that field's tab.
 */
function useSettingsTabs({
  page,
  fieldName,
  place,
  showsCode,
  onOpenChange,
}: {
  page: boolean;
  fieldName: string;
  place: SettingsPlace | null;
  /** Whether the Code tab ends the row. */
  showsCode: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pageFields = usePageFields(fieldName);
  const fields = page ? pageFields : null;
  const tabs = useChosenTab();
  const placeTabs = usePlaceTabs(
    placeTabsOf(place, () => tabs.choose(GENERAL_TAB))
  );
  // A tab left out of the row is never shown: General comes back instead.
  const offered = placeTabs.filter(tab => !tab.leftOut);
  const ids = [
    GENERAL_TAB,
    ...(fields === null ? [] : [FIELDS_TAB]),
    ...offered.map(tab => tab.id),
    ...(showsCode ? [CODE_TAB] : []),
  ];
  const contentTab = contentTabOf(page, fields !== null);
  useShowMe({
    fieldName,
    contentTab,
    placeTabs: offered,
    show: (tab, path) => {
      tabs.show(tab, path);
      onOpenChange(true);
    },
  });
  return {
    fields,
    placeTabs,
    offered,
    shown: ids.includes(tabs.chosen) ? tabs.chosen : GENERAL_TAB,
    choose: tabs.choose,
    focusPath: tabs.focusPath,
    focused: tabs.focused,
  };
}

export function SettingsDialog({
  open,
  onOpenChange,
  returnFocus,
  kind,
  pageTitle,
  fieldName,
  headerFooter = null,
  place = null,
  share,
  address = null,
  breakpoints,
  openAsForm,
}: SettingsDialogProps): JSX.Element {
  const page = kind === "page";
  const site = useSiteSettingsEntry(open);
  const { showsCode, holdsHiddenCode, codeBody } = usePageCode(
    page,
    fieldName,
    place,
    site.read
  );
  const tabs = useSettingsTabs({
    page,
    fieldName,
    place,
    showsCode,
    onOpenChange,
  });
  useNoteClosed(open);
  const leaveToSets = useLeaveToSets(onOpenChange);
  const body = useRef<HTMLDivElement | null>(null);
  useFocusShownField(open, tabs.shown, tabs.focusPath, body, tabs.focused);
  return (
    // The header & footer menu's "Manage headers & footers" and Site
    // settings' default line leave through here for the Pages panel's sets.
    <ManageSetsContext.Provider value={leaveToSets}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          // One height for every tab, so moving between them never resizes
          // the dialog under the pointer.
          className="flex h-[min(85vh,720px)] max-w-[680px] flex-col gap-0 p-0"
          data-page-settings=""
          onKeyDown={keepEnterFromThePage}
          onEscapeKeyDown={leaveEscapeToItsControl}
          // "Show me" focuses its field once the tab is drawn.
          onOpenAutoFocus={event => keepFocusFor(event, tabs.focusPath)}
          onCloseAutoFocus={event => returnFocusTo(event, returnFocus())}
        >
          <DialogHeader className="px-6 pt-6">
            <DialogTitle className="truncate">
              {headingOf(kind, pageTitle)}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {"This page's settings, in tabs."}
            </DialogDescription>
          </DialogHeader>
          <Tabs
            value={tabs.shown}
            onValueChange={tabs.choose}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabRow
              showsFields={tabs.fields !== null}
              // A tab that left the row keeps its panel below, hidden.
              placeTabs={tabs.offered}
              showsCode={showsCode}
              site={site.offer}
            />
            <ReadOnlyNote />
            <SettingsBody
              bodyRef={body}
              tabs={tabs}
              general={
                <GeneralTab
                  page={page}
                  fieldName={fieldName}
                  headerFooter={headerFooter}
                  share={share}
                  place={place}
                  address={address}
                  open={open}
                  // Said, never shown, to someone who may not see it.
                  holdsHiddenCode={holdsHiddenCode}
                />
              }
              code={codeBody}
            />
          </Tabs>
          <SavedWithThePage openAsForm={openAsForm} />
        </DialogContent>
      </Dialog>
      <SiteSettingsDialog
        open={site.open && open}
        onOpenChange={site.setOpen}
        site={site.read}
        breakpoints={breakpoints}
      />
    </ManageSetsContext.Provider>
  );
}

/**
 * The editor's way to its list of sets, closing Page settings first: it
 * holds no draft of its own (its changes are the page's, kept unsaved), and
 * Site settings over it asks first about its own. Null where the editor
 * offers none.
 */
function useLeaveToSets(
  onOpenChange: (open: boolean) => void
): (() => void) | null {
  const openSets = useContext(ManageSetsContext);
  if (openSets === null) return null;
  return () => {
    onOpenChange(false);
    openSets();
  };
}

/**
 * The tabs' content, the one part of the dialog that scrolls: the row of
 * tabs above it stays in view.
 */
function SettingsBody({
  bodyRef,
  tabs,
  general,
  code,
}: {
  bodyRef: { current: HTMLDivElement | null };
  tabs: ReturnType<typeof useSettingsTabs>;
  general: ReactNode;
  /** The Code tab's body, or null where the row has no Code tab. */
  code: ReactNode | null;
}): JSX.Element {
  return (
    <div
      ref={bodyRef}
      className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4"
      data-settings-body=""
    >
      <TabPanel value={GENERAL_TAB} shown={tabs.shown}>
        {general}
      </TabPanel>
      {tabs.fields === null ? null : (
        <TabPanel value={FIELDS_TAB} shown={tabs.shown}>
          <PageFieldsTab page={tabs.fields} />
        </TabPanel>
      )}
      {tabs.placeTabs.map(tab => (
        <TabPanel key={tab.id} value={tab.id} shown={tabs.shown}>
          {tab.panel}
        </TabPanel>
      ))}
      {code === null ? null : (
        <TabPanel value={CODE_TAB} shown={tabs.shown}>
          {code}
        </TabPanel>
      )}
    </div>
  );
}

/**
 * Where the page's own content is shown here: on Fields for a page, on
 * General for a document that is not one, and nowhere for a page with
 * nothing left for Fields.
 */
function contentTabOf(page: boolean, showsFields: boolean): string | null {
  if (!page) return GENERAL_TAB;
  return showsFields ? FIELDS_TAB : null;
}

/**
 * What the place's tabs are read with: the document's context, and the
 * page's props with a way back to General; none for a document that offers
 * no place.
 */
function placeTabsOf(
  place: SettingsPlace | null,
  openGeneral: () => void
): Parameters<typeof usePlaceTabs>[0] {
  if (place === null) {
    return { place: PAGE_BUILDER_SETTINGS_PLACE, context: null };
  }
  return {
    place: PAGE_BUILDER_SETTINGS_PLACE,
    context: place.context,
    tabProps: { ...place.tabProps, openGeneral },
  };
}

/**
 * The site's settings read, while Page settings is open, and whether Site
 * settings is open over it: offered to a role that may change them. Closed
 * with Page settings, from wherever that closes (the editor giving way to
 * its narrow-window notice among them), so it never comes back by itself.
 */
function useSiteSettingsEntry(open: boolean) {
  const read = usePluginRoute<SiteSettingsRead>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: SITE_SETTINGS_ROUTE_PATH,
    staleTime: 0,
    enabled: open,
  });
  const [siteOpen, setOpen] = useState(false);
  if (!open && siteOpen) setOpen(false);
  return {
    read,
    open: siteOpen,
    setOpen,
    offer: mayOpenSiteSettings(read) ? () => setOpen(true) : undefined,
  };
}

/** General: a page's own, or the settings another document keeps. */
function GeneralTab({
  page,
  fieldName,
  headerFooter,
  share,
  place,
  address,
  open,
  holdsHiddenCode,
}: {
  page: boolean;
  fieldName: string;
  headerFooter: ReactNode | null;
  share: SharePreview;
  place: SettingsPlace | null;
  address: SettingsAddress | null;
  open: boolean;
  /** Whether the page adds code this reader may not see. */
  holdsHiddenCode: boolean;
}): JSX.Element {
  if (!page) {
    return (
      <DocumentGeneral fieldName={fieldName} share={share} place={place} />
    );
  }
  return (
    <PageGeneral
      fieldName={fieldName}
      headerFooter={headerFooter}
      share={share}
      place={place}
      address={address}
      open={open}
      holdsHiddenCode={holdsHiddenCode}
    />
  );
}

/** The dialog's own first focus gives way to the field "Show me" focuses. */
function keepFocusFor(event: Event, path: string | null): void {
  if (path !== null) event.preventDefault();
}

/** Focus goes back to what opened the dialog, where the shell names it. */
function returnFocusTo(event: Event, target: HTMLElement | null): void {
  if (target === null) return;
  event.preventDefault();
  target.focus();
}

/**
 * One tab's content, mounted while another is shown and only hidden: a
 * plugin's tab keeps its count current and what it holds, and the form's
 * fields stay where "Show me" finds them.
 */
function TabPanel({
  value,
  shown,
  children,
}: {
  value: string;
  shown: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <TabsContent value={value} forceMount hidden={shown !== value}>
      {children}
    </TabsContent>
  );
}

/**
 * Said once at the top while the page takes no edits: the title's own rule
 * says whether it does now (a past version, a colleague's claim, a reader).
 */
function ReadOnlyNote(): JSX.Element | null {
  const readOnly = useDocumentField("title")?.writable === false;
  if (!readOnly) return null;
  return (
    <p
      role="note"
      className="mx-6 mt-3 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
    >
      {READ_ONLY_NOTE}
    </p>
  );
}

/**
 * The one row of tabs: General, Fields, then the place's tabs in their
 * declared order, and "Site settings ▸" apart at its right. Arrow keys move
 * between the tabs; the Site settings button is not one of them.
 */
function TabRow({
  showsFields,
  placeTabs,
  showsCode,
  site,
}: {
  showsFields: boolean;
  placeTabs: readonly PlaceTabEntry[];
  /** Whether the Code tab ends the row: the riskiest tab last. */
  showsCode: boolean;
  site: (() => void) | undefined;
}): JSX.Element {
  return (
    <div className="mx-6 mt-3 flex min-w-0 items-end">
      <div className="min-w-0 flex-1">
        <TabsList scrollable className="justify-start">
          <TabsTrigger value={GENERAL_TAB}>General</TabsTrigger>
          {showsFields ? (
            <TabsTrigger value={FIELDS_TAB}>Fields</TabsTrigger>
          ) : null}
          {placeTabs.map(tab => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              {...(tab.accessibleName === undefined
                ? {}
                : { "aria-label": tab.accessibleName })}
            >
              {tab.trigger}
            </TabsTrigger>
          ))}
          {showsCode ? <TabsTrigger value={CODE_TAB}>Code</TabsTrigger> : null}
        </TabsList>
      </div>
      {site === undefined ? null : (
        // On the same rail as the tabs, so the row reads as one line.
        <div className="flex h-10 shrink-0 items-center border-b border-border pl-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={site}
            aria-label="Site settings"
          >
            Site settings
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}

/** The line every tab ends with, and the way to the document's form. */
function SavedWithThePage({
  openAsForm,
}: {
  openAsForm: (() => void) | undefined;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-6 py-3">
      <p className="text-xs text-muted-foreground">
        Saved with the page when you Save or Publish.
      </p>
      {openAsForm === undefined ? null : (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="ml-auto h-auto px-0"
          onClick={openAsForm}
        >
          Open as form
        </Button>
      )}
    </div>
  );
}

/**
 * A control that answers Escape itself (the address's in-place edit puts the
 * address back) keeps it: the dialog closes on Escape everywhere else.
 */
function leaveEscapeToItsControl(event: KeyboardEvent): void {
  const target = event.target;
  if (target instanceof Element && target.closest("[data-own-escape]")) {
    event.preventDefault();
  }
}

/**
 * Tell the editor how to show a field the page refused to save: on the tab
 * that holds it here, found by where the entry page draws it. A field this
 * dialog does not show, the builder's own among them, is left to the
 * message's usual link.
 */
function useShowMe({
  fieldName,
  contentTab,
  placeTabs,
  show,
}: {
  fieldName: string;
  contentTab: string | null;
  placeTabs: readonly PlaceTabEntry[];
  show: (tab: string, path: string) => void;
}): void {
  const layout = useEntryFieldsLayout();
  const placeIds = placeTabs.map(tab => tab.id);
  useRevealField(path => {
    if (inEditedField(path, fieldName)) return null;
    const tab = tabForField(layout?.tabOf(path) ?? null, {
      contentTab,
      placeTabs: placeIds,
    });
    return tab === null ? null : () => show(tab, path);
  });
}

/**
 * Focus the field at `path` in the tab's content, or, where it cannot take
 * the focus, the tab it is on: the dialog's own first focus was kept back
 * for the field, so focus never stays outside the dialog.
 */
function focusShownField(body: HTMLElement, path: string): void {
  if (focusFieldIn(body, path)) return;
  body
    .closest('[role="dialog"]')
    ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    ?.focus();
}

/**
 * Focus the field "Show me" asked for, once its tab is drawn in the open
 * dialog: on the next frame, after the dialog's own first focus.
 */
function useFocusShownField(
  open: boolean,
  shown: string,
  path: string | null,
  body: { current: HTMLDivElement | null },
  focused: () => void
): void {
  const done = useRef(focused);
  done.current = focused;
  useEffect(() => {
    if (!open || path === null) return;
    const frame = requestAnimationFrame(() => {
      if (body.current !== null) focusShownField(body.current, path);
      done.current();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, shown, path, body]);
}

/**
 * The Code tab's body: the page's own code, held as the title is while the
 * page takes no edits.
 */
function PageCodeTabBody({
  pageCode,
}: {
  pageCode: SettingsPlace["pageCode"];
}): JSX.Element {
  const writable = useDocumentField("title")?.writable !== false;
  return (
    <PageCodeTab
      value={pageCode.value}
      set={pageCode.set}
      writable={writable}
    />
  );
}

/**
 * The page's own code in Page settings: its tab, last, for someone who may
 * change the site's settings, whose permission the server holds every change
 * to; and, for anyone else, whether General says the page adds code. Only a
 * page's own top-level field holds code (`holdsPageCode`).
 */
function usePageCode(
  page: boolean,
  fieldName: string,
  place: SettingsPlace | null,
  site: SiteSettingsQuery
): { showsCode: boolean; holdsHiddenCode: boolean; codeBody: ReactNode } {
  const pageCode =
    page && place !== null && holdsPageCode(fieldName) ? place.pageCode : null;
  const shown =
    pageCode === null || site.data === undefined
      ? "none"
      : pageCodeShown({
          held: pageCode.value,
          mayManageSite: site.data.mayManageSite,
        });
  return {
    showsCode: shown === "tab",
    holdsHiddenCode: shown === "line",
    codeBody:
      shown === "tab" && pageCode !== null ? (
        <PageCodeTabBody pageCode={pageCode} />
      ) : null,
  };
}
