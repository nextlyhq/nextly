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
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type JSX } from "react";
import {
  useController,
  useWatch,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import {
  layoutChoicesPath,
  PAGE_COLLECTION_ROUTE_PATH,
  type LayoutChoicesResponse,
  type PageCollectionResponse,
} from "../layout-choices-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

import {
  layoutPickerView,
  layoutValue,
  storedFor,
  type EffectiveLayout,
  type LayoutChoicesState,
  type LayoutPickerView,
  type PickerOption,
} from "./layout-choice-view";

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
  search?: string
): {
  state: LayoutChoicesState;
  /** Whether `state` is the last answer, held while a new one is asked. */
  stale: boolean;
  retry: () => void;
} {
  // In the language being edited, so the regions read as the page reads.
  const locale = useDocumentLocale()?.code ?? null;
  const read = usePluginRoute<LayoutChoicesResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: layoutChoicesPath(
      selected,
      search === undefined ? { locale } : { locale, search }
    ),
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
 * Ask again when the author returns to this tab: on window focus, and when
 * the page becomes visible. The admin turns refetch-on-focus off for every
 * read, so this one read asks for it itself.
 */
function useRefreshOnReturn(enabled: boolean, refetch: () => void): void {
  // The newest `refetch`, without re-attaching the listeners on each render:
  // the read hands out a new function every time.
  const latest = useRef(refetch);
  useEffect(() => {
    latest.current = refetch;
  });
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => latest.current();
    const onVisible = () => {
      if (document.visibilityState !== "hidden") latest.current();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
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
  const read = usePluginRoute<PageCollectionResponse>({
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
    () =>
      isPage ? { layout, noHeaderFooter: noHeaderFooter === true } : undefined,
    [isPage, layout, noHeaderFooter]
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
          Which Layout this page is drawn inside.
        </p>
      </div>
      <PageLayoutPicker control={control} />
    </section>
  );
}

/**
 * The page's Layout picker, or nothing for a form that is not a page's.
 *
 * Drawn with the admin's own Select, label and button, so it is one product
 * with the form around it. The "why" line under it says which Layout is in
 * effect and why, and is the picker's description for a screen reader.
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

function Picker<T extends FieldValues>({
  control,
  stored,
  disabled,
}: {
  control: Control<T>;
  stored: { layout: unknown; noHeaderFooter: boolean };
  disabled: boolean;
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
  const { state, retry } = useLayoutChoices(true, selectedOf(stored));
  const view = layoutPickerView(stored, state);
  const id = useId();
  const whyId = `${id}-why`;
  const errorId = `${id}-error`;
  // A save the server refused for this field, such as a Layout being removed.
  // The `layout` field is hidden from the form, so this picker is the only
  // place the reason can be shown.
  const refused = fieldState.error?.message;
  const describedBy = describedByOf(whyId, errorId, refused);

  const choose = (value: string) => {
    const next = storedFor(value, stored);
    layoutField.onChange(next.layout);
    switchField.onChange(next.noHeaderFooter);
  };

  // More Layouts than one answer lists: the rest are reached by title, so the
  // picker searches. Otherwise the plain dropdown, which lists them all.
  const capped = state.kind === "ready" && state.choices.meta.more;

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-slot="page-layout">
      <Label htmlFor={id}>Layout</Label>
      {capped ? (
        <SearchingPicker
          id={id}
          whyId={describedBy}
          view={view}
          stored={stored}
          disabled={disabled || view.readOnly}
          onChoose={choose}
        />
      ) : (
        <Select
          value={view.value}
          onValueChange={choose}
          disabled={disabled || view.readOnly || state.kind === "pending"}
        >
          {/* One line, cut with an ellipsis: a long Layout title or the
            deleted-choice wording must not grow the control, and the line
            under it says the whole of it. Styled through the trigger, since
            the value element takes no class of its own. */}
          <SelectTrigger
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalidOf(refused)}
            className="[&>span]:min-w-0 [&>span]:truncate [&>span]:text-left"
          >
            <SelectValue
              placeholder={
                state.kind === "pending" ? "Loading Layouts…" : undefined
              }
            />
          </SelectTrigger>
          <SelectContent>
            {view.options.map(option => (
              <SelectItem
                key={option.value}
                value={option.value}
                disabled={option.disabled === true}
                {...optionDescription(option)}
              >
                <OptionText option={option} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <WhyLine id={whyId} view={view} state={state} retry={retry} />
      <RefusedLine id={errorId} refused={refused} />
    </div>
  );
}

/**
 * An option's words: its label, and a short note muted after it when it
 * has one (the default Layout's name, or why a Layout behind Remove Layout's
 * fence is not offered).
 */
function OptionText({ option }: { option: PickerOption }): JSX.Element {
  if (option.note === undefined) return <>{option.label}</>;
  return (
    <>
      {option.label}
      <span className="text-muted-foreground"> · {option.note}</span>
    </>
  );
}

/** An option's whole reason, as its tooltip and accessible description. */
function optionDescription(option: PickerOption): {
  title?: string;
  "aria-description"?: string;
} {
  return option.description === undefined
    ? {}
    : { title: option.description, "aria-description": option.description };
}

/** The picker's description: why the Layout applies, and a refusal if any. */
function describedByOf(
  whyId: string,
  errorId: string,
  refused: string | undefined
): string {
  return refused === undefined ? whyId : `${whyId} ${errorId}`;
}

/** `aria-invalid` while a refusal stands. */
function invalidOf(refused: string | undefined): true | undefined {
  return refused === undefined ? undefined : true;
}

/** The server's reason a save was refused for this field, under the picker. */
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

/** How long typing pauses before Layout titles are searched again. */
const SEARCH_PAUSE_MS = 200;

/** The words under a capped list, saying how to reach the rest. */
const CAPPED_NOTE = "Showing the first 200; search to find more.";

/**
 * A capped list's search: what is typed, the server's answer for it once the
 * typing pauses, and the options to show.
 *
 * Searching from the first keystroke: what is typed is the query, and until
 * its own answer arrives nothing shown may claim to match it. A search's
 * answer belongs to its own query, so the last one's matches are never shown
 * for the next.
 */
function useLayoutSearch(
  open: boolean,
  stored: { layout: unknown; noHeaderFooter: boolean },
  view: LayoutPickerView
) {
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
    search
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
  return { typed, setTyped, searching, answered, failed, options, retry };
}

/**
 * The options a search found: exactly the rows the server says matched.
 *
 * The answer also carries rows the route adds whatever the query (the page's
 * own Layout and the default), and the view adds the default and "No header
 * or footer" to every list; none of those matched, so none is a result, and
 * "No Layouts match" can say so. Which rows matched is the server's answer
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

/** What the list says when it shows no Layouts: why, and what to do. */
function SearchNote({
  searching,
  answered,
  failed,
  retry,
}: {
  searching: boolean;
  answered: boolean;
  failed: boolean;
  retry: () => void;
}): JSX.Element {
  if (failed) {
    return (
      <span className="flex items-center justify-center gap-2">
        Couldn&apos;t search Layouts
        <Button type="button" variant="ghost" size="sm" onClick={retry}>
          Try again
        </Button>
      </span>
    );
  }
  return <>{searching && !answered ? "Searching…" : "No Layouts match."}</>;
}

/**
 * The picker for a site with more Layouts than one answer lists: the same
 * choices behind a search field, as the admin's other searchable choices are
 * drawn. Titles are searched on the server, so every Layout the author may
 * read can be found and chosen.
 */
function SearchingPicker({
  id,
  whyId,
  view,
  stored,
  disabled,
  onChoose,
}: {
  id: string;
  whyId: string;
  view: LayoutPickerView;
  stored: { layout: unknown; noHeaderFooter: boolean };
  disabled: boolean;
  onChoose: (value: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const { typed, setTyped, searching, answered, failed, options, retry } =
    useLayoutSearch(open, stored, view);
  const current = view.options.find(option => option.value === view.value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-describedby={whyId}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="min-w-0 truncate text-left">
            {current === undefined ? (
              "Choose a Layout"
            ) : (
              <OptionText option={current} />
            )}
          </span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        // As wide as the trigger, whatever the titles: a long one is cut
        // to its row rather than widening the list.
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        {/* Filtered by the server, not here: the list holds only the first
            answer, and a Layout past it is found only by asking. */}
        {/* The menu's label names its search field, which the field
            reads by reference rather than by a label of its own. */}
        <Command shouldFilter={false} label="Search Layouts">
          <CommandInput
            placeholder="Search Layouts"
            value={typed}
            onValueChange={setTyped}
          />
          <CommandList>
            <CommandEmpty>
              <SearchNote
                searching={searching}
                answered={answered}
                failed={failed}
                retry={retry}
              />
            </CommandEmpty>
            <CommandGroup>
              {options.map(option => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled === true}
                  {...optionDescription(option)}
                  onSelect={() => {
                    onChoose(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <OptionText option={option} />
                  </span>
                  {option.value === view.value ? (
                    <Check aria-hidden="true" className="h-4 w-4" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {searching ? null : (
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              {CAPPED_NOTE}
            </p>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Which Layout is in effect and why; or the read's own state. */
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
        Couldn&apos;t load Layouts
        <Button type="button" variant="ghost" size="sm" onClick={retry}>
          Try again
        </Button>
      </p>
    );
  }
  return (
    <p id={id} className="text-xs text-muted-foreground" aria-live="polite">
      {state.kind === "pending" ? "Loading Layouts…" : view.why}
    </p>
  );
}

/** The area's name, as a region is called in the editor. */
function areaName(area: RegionArea): string {
  return area === "header" ? "Header" : "Footer";
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
): { canvas: readonly CanvasRegion[]; layers: readonly LayersRegionRow[] } {
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
const NOTHING_DRAWN: {
  canvas: readonly CanvasRegion[];
  layers: readonly LayersRegionRow[];
} = { canvas: [], layers: [] };

/** The regions to draw for `stored`, and their Layers rows. */
function regionsOf(
  stored: { layout: unknown; noHeaderFooter: boolean } | undefined,
  state: LayoutChoicesState,
  canvasRoot: HTMLElement | null
): { canvas: readonly CanvasRegion[]; layers: readonly LayersRegionRow[] } {
  if (stored === undefined || state.kind !== "ready") {
    return { canvas: NO_REGIONS, layers: NO_ROWS };
  }
  const effective = layoutPickerView(stored, state).effective;
  if (effective === null || effective.regions.length === 0) {
    return { canvas: NO_REGIONS, layers: NO_ROWS };
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
      label: `${areaName(region.area)}, from Layout ${effective.title}`,
      badge: `${areaName(region.area)} · from Layout`,
      ...editOf(effective, meta),
      ...noteOf(effective, region, meta),
    })
  );
  const layers = effective.regions.map(
    (region): LayersRegionRow => ({
      area: region.area,
      name: areaName(region.area),
      origin: `from Layout ${effective.title}`,
      onActivate: () => {
        // Shown and focused on the canvas, where its tag says the rest.
        const drawn = canvasRoot?.querySelector<HTMLElement>(
          `[data-nx-region="${region.area}"]`
        );
        drawn?.scrollIntoView({ block: "nearest" });
        drawn?.focus();
      },
    })
  );
  return { canvas, layers };
}

/** The way to edit the Layout, for an author who may: a new tab. */
function editOf(
  effective: EffectiveLayout,
  meta: LayoutChoicesResponse["meta"]
): Pick<CanvasRegion, "edit"> {
  if (!meta.canUpdateLayouts) return {};
  return {
    edit: {
      href: `/admin/collections/${encodeURIComponent(meta.layoutsCollection)}/${encodeURIComponent(effective.id)}`,
      text: "Edit Layout ↗",
      name: `Edit Layout ${effective.title} (opens in a new tab)`,
    },
  };
}

/** Which part has changes a visitor does not see yet, when one does. */
function noteOf(
  effective: EffectiveLayout,
  region: EffectiveLayout["regions"][number],
  meta: LayoutChoicesResponse["meta"]
): Pick<CanvasRegion, "note"> {
  if (effective.draftChangesNotLive) {
    return { note: `Draft changes not live: Layout ${effective.title}` };
  }
  return meta.regionComponents[region.componentId]?.draftChangesNotLive === true
    ? { note: `Draft changes not live: ${region.area} component` }
    : {};
}

const NO_REGIONS: readonly CanvasRegion[] = [];
const NO_ROWS: readonly LayersRegionRow[] = [];
