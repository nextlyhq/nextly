"use client";

/**
 * The page's Layout: one picker writing the two stored values together, and
 * the regions the editor draws around the page.
 *
 * A page stores its Layout as a reference (`layout`) and a switch
 * (`noHeaderFooter`), both hidden from the form: an author makes ONE choice,
 * "Site default", a named Layout, or "No header or footer", and this writes
 * both. The same picker sits in the editor's Settings and on the entry form's
 * Page Builder card, so the choice reads the same wherever it is made.
 *
 * @module admin/page-layout
 */
import {
  layoutRelationId,
  regionDocument,
  type BlockDocument,
  type RegionArea,
} from "@nextlyhq/blocks-engine";
import type { CanvasRegion, LayersRegionRow } from "@nextlyhq/builder/shell";
import {
  useDocumentIdentity,
  useDocumentLocale,
  usePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import { Button, Label } from "@nextlyhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type JSX,
} from "react";
import {
  useController,
  useWatch,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import {
  LAYOUT_CHOICES_ROUTE_PATH,
  layoutChoicesPath,
  PAGE_COLLECTION_ROUTE_PATH,
  type LayoutChoicesResponse,
  type PageCollectionResponse,
} from "../layout-choices-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

import { useBuilderRoute } from "./builder-route-read";
import { HeaderFooterMenu, type MenuSearch } from "./header-footer-menu";
import { useSetPictures } from "./header-footer-pictures";
import {
  layoutPickerView,
  layoutValue,
  NO_HEADER_FOOTER_VALUE,
  SITE_DEFAULT_VALUE,
  storedFor,
  type EffectiveLayout,
  type LayoutChoicesState,
  type LayoutPickerView,
  type PickerOption,
} from "./layout-choice-view";
import { useRefreshOnReturn } from "./refresh-on-return";

/** The page's stored Layout reference, as the pages collection names it. */
const LAYOUT_FIELD = "layout";
/** The page's stored switch for no header or footer. */
const SWITCH_FIELD = "noHeaderFooter";

/**
 * The Layout choices, read as the author, with where the read stands.
 *
 * Asked about the page's `selected` Layout by id, so a Layout the list's bound
 * cut is still answered for, and searching titles when `search` is given. A new choice asks again; until the new answer
 * arrives the last one stands, so the picker and canvas never blank between
 * the two.
 */
function useLayoutChoices(
  enabled: boolean,
  selected: string | null,
  ask: { search?: string; pictures?: boolean } = {}
): {
  state: LayoutChoicesState;
  /** Whether `state` is the last answer, held while a new one is asked. */
  stale: boolean;
  retry: () => void;
} {
  // In the language being edited, so the regions read as the page reads.
  const locale = useDocumentLocale()?.code ?? null;
  const { search, pictures } = ask;
  const read = usePluginRoute<LayoutChoicesResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: layoutChoicesPath(selected, {
      locale,
      ...(search === undefined ? {} : { search }),
      ...(pictures === true ? { pictures } : {}),
    }),
    enabled,
    // Asked again on every mount, and when the author comes back to the tab
    // (below): a Layout published or made the default in another tab, from
    // "Edit Layout", is a choice the author should see when they return.
    staleTime: 0,
  });
  // A search's answer belongs to its own query, so a search holds nothing:
  // the last one's matches are not this one's.
  const holds = search === undefined;
  const [held, setHeld] = useState<LayoutChoicesResponse | undefined>(
    undefined
  );
  useEffect(() => {
    if (holds && read.data !== undefined) setHeld(read.data);
  }, [holds, read.data]);
  useRefreshOnReturn(enabled && holds, read.refetch);
  const state = useMemo((): LayoutChoicesState => {
    if (read.data !== undefined) return { kind: "ready", choices: read.data };
    if (read.error !== null) {
      // Refused by the route's gate: the author may not read Layouts, which
      // is a state the picker says rather than an error it reports.
      return (read.error as { status?: unknown }).status === 403
        ? { kind: "forbidden" }
        : { kind: "failed" };
    }
    return held === undefined
      ? { kind: "pending" }
      : { kind: "ready", choices: held };
  }, [read.data, read.error, held]);
  const stale =
    read.data === undefined && read.error === null && held !== undefined;
  return { state, stale, retry: read.refetch };
}

/**
 * Whether a cached read is one of this plugin's set choices reads, whatever
 * it asked, by the key the admin keeps a plugin route's read under:
 * `["plugin-route", path]`.
 */
function isLayoutChoicesRead(key: readonly unknown[]): boolean {
  const path = key[1];
  return (
    key[0] === "plugin-route" &&
    typeof path === "string" &&
    path.includes(PAGE_BUILDER_PLUGIN_NAME) &&
    path.includes(LAYOUT_CHOICES_ROUTE_PATH)
  );
}

/**
 * Ask every set choices read again, the canvas's own among them: after a
 * write that changes a set, the header and footer the page being edited is
 * drawn inside may have changed with it.
 */
export function useAskChoicesAgain(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({
      predicate: query => isLayoutChoicesRead(query.queryKey),
    });
  }, [queryClient]);
}

/**
 * Whether this form is one of the plugin's pages: the pages collection's own
 * form, by the slug the site resolved, renamed or not.
 *
 * By identity rather than by the form's fields, because another collection
 * may hold a field of the same name; the picker must not draw there, register
 * a `layout` field, or write that collection's own switch.
 */
function useIsPageForm(): boolean {
  const identity = useDocumentIdentity();
  const candidate = identity?.kind === "collection";
  const read = useBuilderRoute<PageCollectionResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: PAGE_COLLECTION_ROUTE_PATH,
    enabled: candidate,
  });
  return candidate && read.data?.pagesCollection === identity.slug;
}

/**
 * The stored values on a page's form, or `undefined` on any other form.
 *
 * Read with `useWatch`, which never registers a field, so asking adds nothing
 * to a form that is not a page's.
 */
function useStoredLayout<T extends FieldValues>(
  control: Control<T>
): { layout: unknown; noHeaderFooter: boolean } | undefined {
  const isPage = useIsPageForm();
  const watched = useWatchedLayout(control);
  return isPage ? watched : undefined;
}

/** The two values as `control` holds them, whatever form it is. */
function useWatchedLayout<T extends FieldValues>(
  control: Control<T>
): { layout: unknown; noHeaderFooter: boolean } {
  const layout: unknown = useWatch({
    control,
    name: LAYOUT_FIELD as Path<T>,
  });
  const noHeaderFooter: unknown = useWatch({
    control,
    name: SWITCH_FIELD as Path<T>,
  });
  // One object per pair of values, so a reader keyed on it recomputes only
  // when the choice changes.
  return useMemo(
    () => ({ layout, noHeaderFooter: noHeaderFooter === true }),
    [layout, noHeaderFooter]
  );
}

/**
 * What a publish of the page puts it inside, as a readiness request names it:
 * the Layout its form names; the site's default when it names none and still
 * draws a header and footer; or neither, for "No header or footer" or a form
 * that is not a page's.
 */
export function usePageLayoutAsk<T extends FieldValues>(
  control: Control<T>
): { layout: string | null; siteDefault: boolean } {
  const stored = useStoredLayout(control);
  return useMemo(() => {
    if (stored === undefined || stored.noHeaderFooter) {
      return { layout: null, siteDefault: false };
    }
    const layout = selectedOf(stored);
    return { layout, siteDefault: layout === null };
  }, [stored]);
}

/** The id the stored values select, which the choices are asked about. */
function selectedOf(
  stored: { layout: unknown; noHeaderFooter: boolean } | undefined
): string | null {
  return stored === undefined ? null : layoutRelationId(stored.layout);
}

/**
 * The page's Layout section for a settings surface, or null for a form that is
 * not a page's.
 *
 * A whole section, heading and description included, so any surface that
 * holds page settings places it without restating its words.
 */
export function usePageLayoutSettings<T extends FieldValues>(
  control: Control<T>
): JSX.Element | null {
  const isPage = useStoredLayout(control) !== undefined;
  return isPage ? <PageLayoutSection control={control} /> : null;
}

/** "Header and footer": what the section says, then the picker. */
function PageLayoutSection<T extends FieldValues>({
  control,
}: {
  control: Control<T>;
}): JSX.Element {
  const titleId = `${useId()}-title`;
  return (
    <section aria-labelledby={titleId} className="space-y-3">
      {/* The heading and its line together, then the picker a step below. */}
      <div className="space-y-1">
        <h3 id={titleId} className="text-sm font-semibold">
          Header and footer
        </h3>
        <p className="text-xs text-muted-foreground">
          Which header & footer set this page is drawn inside.
        </p>
      </div>
      <PageLayoutPicker control={control} />
    </section>
  );
}

/**
 * The page's "Header & footer" menu, or nothing for a form that is not a
 * page's.
 *
 * Labelled and described as the admin's own fields are, so it is one product
 * with the form around it. The "why" line under it says which set is in
 * effect and why, and is the menu's description for a screen reader.
 */
export function PageLayoutPicker<T extends FieldValues>({
  control,
  disabled = false,
}: {
  control: Control<T>;
  /** The form cannot be edited (read-only document, no rights). */
  disabled?: boolean;
}): JSX.Element | null {
  const stored = useStoredLayout(control);
  if (stored === undefined) return null;
  return <Picker control={control} stored={stored} disabled={disabled} />;
}

/**
 * The "Header & footer" menu for a page not made yet: the same picker, over
 * the New page dialog's own small form, which holds the two values and is
 * known to make a page. "Manage headers & footers" is left out there, since
 * it would leave the dialog and what is typed in it.
 */
export function NewPageLayoutPicker<T extends FieldValues>({
  control,
}: {
  control: Control<T>;
}): JSX.Element {
  const stored = useWatchedLayout(control);
  return (
    <Picker control={control} stored={stored} disabled={false} manage={false} />
  );
}

/** Above this many sets the menu is searched rather than scrolled. */
const SEARCH_ABOVE = 10;

/**
 * How many sets the site has, as the answer lists them. Counted from the
 * answer rather than the menu's rows: the menu draws the default set as
 * "Site default" and drops its named row, so its rows run one short of the
 * sets whenever the page follows the default. Before an answer, the rows
 * named are all there is to count.
 */
function setCount(state: LayoutChoicesState, view: LayoutPickerView): number {
  if (state.kind === "ready") return state.choices.items.length;
  return view.options.filter(
    option =>
      option.value !== SITE_DEFAULT_VALUE &&
      option.value !== NO_HEADER_FOOTER_VALUE
  ).length;
}

/**
 * Each option's picture. Every listed set's definitions are asked for once
 * the menu first opens, not before, so a page's form opens with the canvas's
 * own read only; until they arrive, the two sets the page can be drawn inside
 * (its own and the default) are drawn from that read.
 */
function useOptionPictures(
  opened: boolean,
  selected: string | null,
  state: LayoutChoicesState,
  /** What a search found, past the list: its sets' definitions, once in. */
  found: LayoutChoicesResponse["meta"]["regionDefinitions"] | undefined
): (option: PickerOption) => JSX.Element {
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (opened) setWanted(true);
  }, [opened]);
  const { state: all } = useLayoutChoices(wanted, selected, {
    pictures: true,
  });
  const listed =
    all.kind === "ready"
      ? all.choices.meta.regionDefinitions
      : state.kind === "ready"
        ? state.choices.meta.regionDefinitions
        : NO_DEFINITIONS;
  // A search's matches can sit past the list, so their definitions come with
  // the search's own answer, drawn beside the list's.
  const definitions = useMemo(
    () => (found === undefined ? listed : { ...listed, ...found }),
    [listed, found]
  );
  // Answered, or failed: a region still without its definition then draws
  // the broken-picture icon rather than waiting on a read that is done.
  const settled = all.kind !== "pending";
  const picture = useSetPictures(definitions, settled);
  return option => <>{picture(option.picture)}</>;
}

const NO_DEFINITIONS: LayoutChoicesResponse["meta"]["regionDefinitions"] = {};

/** Where "Manage headers & footers ↗" opens: the admin's list of sets. */
function manageHrefOf(state: LayoutChoicesState): string | undefined {
  if (state.kind !== "ready") return undefined;
  return `/admin/collections/${encodeURIComponent(state.choices.meta.layoutsCollection)}`;
}

function Picker<T extends FieldValues>({
  control,
  stored,
  disabled,
  manage = true,
}: {
  control: Control<T>;
  stored: { layout: unknown; noHeaderFooter: boolean };
  disabled: boolean;
  /** Whether the menu offers "Manage headers & footers". */
  manage?: boolean;
}): JSX.Element {
  // Registered only here, once the form is known to hold both fields.
  const { field: layoutField, fieldState } = useController({
    control,
    name: LAYOUT_FIELD as Path<T>,
  });
  const { field: switchField } = useController({
    control,
    name: SWITCH_FIELD as Path<T>,
  });
  const selected = selectedOf(stored);
  const { state, retry } = useLayoutChoices(true, selected);
  const view = layoutPickerView(stored, state);
  const [open, setOpen] = useState(false);
  const id = useId();
  const whyId = `${id}-why`;
  const errorId = `${id}-error`;
  // A save the server refused for this field, such as a set being removed.
  // The `layout` field is hidden from the form, so this menu is the only
  // place the reason can be shown.
  const refused = fieldState.error?.message;

  const choose = (value: string) => {
    const next = storedFor(value, stored);
    layoutField.onChange(next.layout);
    switchField.onChange(next.noHeaderFooter);
  };

  // More sets than ten, or than one answer lists: the menu searches titles on
  // the server, so every set the author may read can be found and chosen.
  const capped = state.kind === "ready" && state.choices.meta.more;
  const searchable = capped || setCount(state, view) > SEARCH_ABOVE;
  const { definitions: foundDefinitions, ...search } = useLayoutSearch(
    open && searchable,
    stored,
    view
  );
  const picture = useOptionPictures(open, selected, state, foundDefinitions);

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-slot="page-layout">
      <Label htmlFor={id}>Header & footer</Label>
      <HeaderFooterMenu
        id={id}
        describedBy={describedByOf(whyId, errorId, refused)}
        invalid={refused !== undefined}
        view={view}
        pending={state.kind === "pending"}
        disabled={disabled || view.readOnly}
        open={open}
        onOpenChange={setOpen}
        onChoose={choose}
        picture={picture}
        {...(searchable
          ? { search: { ...search, ...(capped ? { note: CAPPED_NOTE } : {}) } }
          : {})}
        {...(manage ? withManage(manageHrefOf(state)) : {})}
      />
      <WhyLine id={whyId} view={view} state={state} retry={retry} />
      <RefusedLine id={errorId} refused={refused} />
    </div>
  );
}

/** The menu's "Manage headers & footers ↗", where there is a list to open. */
function withManage(href: string | undefined): { manageHref?: string } {
  return href === undefined ? {} : { manageHref: href };
}

/** The menu's description: why the set applies, and a refusal if any. */
function describedByOf(
  whyId: string,
  errorId: string,
  refused: string | undefined
): string {
  return refused === undefined ? whyId : `${whyId} ${errorId}`;
}

/** The server's reason a save was refused for this field, under the menu. */
function RefusedLine({
  id,
  refused,
}: {
  id: string;
  refused: string | undefined;
}): JSX.Element | null {
  if (refused === undefined) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {refused}
    </p>
  );
}

/** How long typing pauses before set titles are searched again. */
const SEARCH_PAUSE_MS = 200;

/** The words under a capped list, saying how to reach the rest. */
const CAPPED_NOTE = "Showing the first 200; search to find more.";

/**
 * The menu's search: what is typed, the server's answer for it once the
 * typing pauses, and the options to show.
 *
 * Searching from the first keystroke: what is typed is the query, and until
 * its own answer arrives nothing shown may claim to match it. A search's
 * answer belongs to its own query, so the last one's matches are never shown
 * for the next. Titles are matched by the database, by its own collation, so
 * a search finds what the site's own search would.
 */
function useLayoutSearch(
  open: boolean,
  stored: { layout: unknown; noHeaderFooter: boolean },
  view: LayoutPickerView
): MenuSearch & {
  /** The answered search's set definitions, for its matches' pictures. */
  definitions: LayoutChoicesResponse["meta"]["regionDefinitions"] | undefined;
} {
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [typed]);
  const searching = typed.trim() !== "";
  const { state: found, retry } = useLayoutChoices(
    open && search !== "",
    selectedOf(stored),
    // With the pictures of what it finds, which may be past the list.
    { search, pictures: true }
  );
  const current = searching && search === typed.trim();
  const answered = current && found.kind === "ready";
  const failed =
    current && (found.kind === "failed" || found.kind === "forbidden");
  const options = !searching
    ? view.options
    : found.kind === "ready" && answered
      ? matchingOptions(stored, found)
      : [];
  const definitions =
    answered && found.kind === "ready"
      ? found.choices.meta.regionDefinitions
      : undefined;
  return {
    typed,
    setTyped,
    searching,
    answered,
    failed,
    options,
    retry,
    definitions,
  };
}

/**
 * The options a search found: exactly the rows the server says matched.
 *
 * The answer also carries rows the route adds whatever the query (the page's
 * own set and the default), and the view adds the default and "None" to
 * every list; none of those matched, so none is a result, and "No header &
 * footer sets match." can say so. Which rows matched is the server's answer
 * alone: the database compares by its own collation ("cafe" finds "Café" on
 * one dialect), which no comparison here could repeat. The current choice
 * stays in the trigger.
 */
function matchingOptions(
  stored: { layout: unknown; noHeaderFooter: boolean },
  found: Extract<LayoutChoicesState, { kind: "ready" }>
): PickerOption[] {
  const matched = new Set(found.choices.meta.matched.map(layoutValue));
  return layoutPickerView(stored, found).options.filter(option =>
    matched.has(option.value)
  );
}

/** Which set is in effect and why; or the read's own state. */
function WhyLine({
  id,
  view,
  state,
  retry,
}: {
  id: string;
  view: LayoutPickerView;
  state: LayoutChoicesState;
  retry: () => void;
}): JSX.Element {
  if (state.kind === "failed") {
    return (
      <p
        id={id}
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        Couldn&apos;t load headers & footers
        <Button type="button" variant="ghost" size="sm" onClick={retry}>
          Try again
        </Button>
      </p>
    );
  }
  return (
    <p id={id} className="text-xs text-muted-foreground" aria-live="polite">
      {state.kind === "pending" ? "Loading headers & footers…" : view.why}
    </p>
  );
}

/**
 * What the sidebar card for a selected header or footer is drawn from: the
 * component the region places, the set it comes from, whether it is the
 * site's untouched starter, and which part has changes a visitor does not
 * see yet.
 */
export interface RegionCardFacts {
  readonly area: RegionArea;
  readonly componentId: string;
  /** The header & footer set the region comes from, by id. */
  readonly setId: string;
  /** The title of the header & footer set the region comes from. */
  readonly setTitle: string;
  readonly starter: boolean;
  readonly note?: string;
}

/** The regions drawn around the page, their Layers rows and their cards. */
export interface PageLayoutRegions {
  readonly canvas: readonly CanvasRegion[];
  readonly layers: readonly LayersRegionRow[];
  readonly cards: readonly RegionCardFacts[];
}

/** What a header or footer is called in the editor. */
export function siteRegionName(area: RegionArea): string {
  return area === "header" ? "Site header" : "Site footer";
}

/**
 * The regions the editor draws around the page, from the unsaved values.
 *
 * Read from the form as it stands, so changing the picker redraws the canvas
 * at once, before anything is saved. Drawn from the PUBLISHED Layout and
 * components the choices read returned: the canvas shows what a visitor gets.
 */
export function usePageLayoutRegions<T extends FieldValues>(
  control: Control<T>,
  canvasRoot: HTMLElement | null
): PageLayoutRegions {
  const stored = useStoredLayout(control);
  const { state, stale } = useLayoutChoices(
    stored !== undefined,
    selectedOf(stored)
  );
  // Nothing new while the answer for a new choice is on its way: the held one
  // lacks the new Layout's definitions, so drawing from it would show its
  // regions as missing components for a moment. The last regions drawn stay.
  const fresh = useMemo(
    () => (stale ? undefined : regionsOf(stored, state, canvasRoot)),
    [stale, stored, state, canvasRoot]
  );
  const [shown, setShown] = useState(NOTHING_DRAWN);
  useEffect(() => {
    if (fresh !== undefined) setShown(fresh);
  }, [fresh]);
  return fresh ?? shown;
}

/** What is drawn before any answer has arrived. */
const NOTHING_DRAWN: PageLayoutRegions = { canvas: [], layers: [], cards: [] };

/** The regions to draw for `stored`, their Layers rows and their cards. */
function regionsOf(
  stored: { layout: unknown; noHeaderFooter: boolean } | undefined,
  state: LayoutChoicesState,
  canvasRoot: HTMLElement | null
): PageLayoutRegions {
  if (stored === undefined || state.kind !== "ready") return NOTHING_DRAWN;
  const effective = layoutPickerView(stored, state).effective;
  if (effective === null || effective.regions.length === 0) {
    return NOTHING_DRAWN;
  }
  const { meta } = state.choices;
  const definitions = new Map<string, BlockDocument>(
    Object.entries(meta.regionDefinitions)
  );
  const canvas = effective.regions.map(
    (region): CanvasRegion => ({
      area: region.area,
      document: regionDocument([region]),
      definitions,
      ...regionWords(effective, region, meta),
      ...editOf(effective, meta),
    })
  );
  const layers = effective.regions.map(
    (region): LayersRegionRow => ({
      area: region.area,
      name: regionWords(effective, region, meta).name,
      origin: `${effective.title} header & footer`,
      onActivate: () => {
        // Shown and focused on the canvas, where it is selected.
        const drawn = canvasRoot?.querySelector<HTMLElement>(
          `[data-nx-region="${region.area}"]`
        );
        drawn?.scrollIntoView({ block: "nearest" });
        drawn?.focus();
      },
    })
  );
  const cards = effective.regions.map(
    (region): RegionCardFacts => ({
      area: region.area,
      componentId: region.componentId,
      setId: effective.id,
      setTitle: effective.title,
      starter: starterOf(region, meta) === region.area,
      ...noteOf(effective, region, meta),
    })
  );
  return { canvas, layers, cards };
}

/** The area the region's component is the untouched starter for, if any. */
function starterOf(
  region: EffectiveLayout["regions"][number],
  meta: LayoutChoicesResponse["meta"]
): RegionArea | undefined {
  return meta.regionComponents[region.componentId]?.untouchedStarter;
}

/**
 * What a region is called on the canvas: where it comes from, or, while it
 * shows the site's starter header or footer as seeded, that it is the
 * starter, so an author knows it is theirs to edit or replace.
 */
function regionWords(
  effective: EffectiveLayout,
  region: EffectiveLayout["regions"][number],
  meta: LayoutChoicesResponse["meta"]
): Pick<CanvasRegion, "label" | "badge" | "name"> {
  const from = `from the ${effective.title} header & footer`;
  const starter = starterOf(region, meta);
  if (starter === region.area) {
    return {
      label: `${STARTER_NAMES[starter]}, ${from}`,
      badge: STARTER_BADGES[starter],
      name: STARTER_NAMES[starter],
    };
  }
  const name = siteRegionName(region.area);
  return {
    label: `${name}, ${from}`,
    badge: `${name} · ${effective.title}`,
    name,
  };
}

/** The starter's names, as its region is called. */
const STARTER_NAMES: Readonly<Record<RegionArea, string>> = {
  header: "Starter header",
  footer: "Starter footer",
};

/** The starter's short tags on the canvas. */
const STARTER_BADGES: Readonly<Record<RegionArea, string>> = {
  header: "Starter header · edit or replace",
  footer: "Starter footer",
};

/** The way to edit the Layout, for an author who may: a new tab. */
function editOf(
  effective: EffectiveLayout,
  meta: LayoutChoicesResponse["meta"]
): Pick<CanvasRegion, "edit"> {
  if (!meta.canUpdateLayouts) return {};
  return {
    edit: {
      href: `/admin/collections/${encodeURIComponent(meta.layoutsCollection)}/${encodeURIComponent(effective.id)}`,
      text: "Edit header & footer set ↗",
      name: `Edit header & footer set ${effective.title} (opens in a new tab)`,
    },
  };
}

/** Which part has changes a visitor does not see yet, when one does. */
function noteOf(
  effective: EffectiveLayout,
  region: EffectiveLayout["regions"][number],
  meta: LayoutChoicesResponse["meta"]
): Pick<RegionCardFacts, "note"> {
  if (effective.draftChangesNotLive) {
    return {
      note: `Draft changes not live: header & footer set ${effective.title}`,
    };
  }
  return meta.regionComponents[region.componentId]?.draftChangesNotLive === true
    ? { note: `Draft changes not live: ${region.area} component` }
    : {};
}
