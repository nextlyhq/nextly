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
  usePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { useEffect, useId, useMemo, useState, type JSX } from "react";
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
  storedFor,
  type EffectiveLayout,
  type LayoutChoicesState,
  type LayoutPickerView,
} from "./layout-choice-view";

/** The page's stored Layout reference, as the pages collection names it. */
const LAYOUT_FIELD = "layout";
/** The page's stored switch for no header or footer. */
const SWITCH_FIELD = "noHeaderFooter";

/**
 * The Layout choices, read as the author, with where the read stands.
 *
 * Asked about the page's `selected` Layout by id, so a Layout the list's bound
 * cut is still answered for. A new choice asks again; until the new answer
 * arrives the last one stands, so the picker and canvas never blank between
 * the two.
 */
function useLayoutChoices(
  enabled: boolean,
  selected: string | null
): {
  state: LayoutChoicesState;
  retry: () => void;
} {
  const read = usePluginRoute<LayoutChoicesResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: layoutChoicesPath(selected),
    enabled,
    // Asked again on every mount: a Layout published or made the default in
    // another tab is a choice the author should see when they come back.
    staleTime: 0,
  });
  const [held, setHeld] = useState<LayoutChoicesResponse | undefined>(
    undefined
  );
  useEffect(() => {
    if (read.data !== undefined) setHeld(read.data);
  }, [read.data]);
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
  return { state, retry: read.refetch };
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
  const { field: layoutField } = useController({
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

  const choose = (value: string) => {
    const next = storedFor(value, stored);
    layoutField.onChange(next.layout);
    switchField.onChange(next.noHeaderFooter);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-slot="page-layout">
      <Label htmlFor={id}>Layout</Label>
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
          aria-describedby={whyId}
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
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <WhyLine id={whyId} view={view} state={state} retry={retry} />
    </div>
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
  const { state } = useLayoutChoices(stored !== undefined, selectedOf(stored));
  return useMemo(
    () => regionsOf(stored, state, canvasRoot),
    [stored, state, canvasRoot]
  );
}

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
