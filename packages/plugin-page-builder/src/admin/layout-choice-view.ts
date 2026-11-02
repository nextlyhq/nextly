/**
 * What the page's Layout picker says, and which regions the page is drawn
 * inside, from the two stored values and the Layout choices.
 *
 * Pure, so every state the picker can be in is a unit-tested answer rather
 * than a branch in a component. The RULE for which Layout a page gets is the
 * engine's `resolvePageLayout`, shared with the published route; this only
 * words its answer and lists the choices.
 *
 * @module admin/layout-choice-view
 */
import {
  layoutRelationId,
  resolvePageLayout,
  type LayoutRegion,
} from "@nextlyhq/blocks-engine";

import type {
  LayoutChoice,
  LayoutChoicesResponse,
} from "../layout-choices-contract";

/** The picker's value for "use the site's default Layout". */
export const SITE_DEFAULT_VALUE = "site-default";
/** The picker's value for "no header or footer". */
export const NO_HEADER_FOOTER_VALUE = "no-header-footer";
/** The picker's value for one named Layout. */
export function layoutValue(id: string): string {
  return `layout:${id}`;
}

/** Where the Layout choices read stands. */
export type LayoutChoicesState =
  | { readonly kind: "pending" }
  | { readonly kind: "ready"; readonly choices: LayoutChoicesResponse }
  /** The author may not read Layouts: the picker is read-only. */
  | { readonly kind: "forbidden" }
  | { readonly kind: "failed" };

/** What the page stores about its Layout, as the form holds it. */
export interface StoredLayoutChoice {
  /** The relationship value: an id, a populated row, or nothing. */
  readonly layout: unknown;
  readonly noHeaderFooter: boolean;
}

/** One option in the picker. */
export interface PickerOption {
  readonly value: string;
  readonly label: string;
}

/** The Layout a page is drawn inside, as the editor shows it. */
export interface EffectiveLayout {
  readonly id: string;
  readonly title: string;
  readonly draftChangesNotLive: boolean;
  /** The published regions, in drawing order. */
  readonly regions: readonly LayoutRegion[];
}

/** Everything the picker draws, and what the canvas draws around the page. */
export interface LayoutPickerView {
  /** The options, in order: the default, Layouts, then no header or footer. */
  readonly options: readonly PickerOption[];
  /** The option the stored values select. */
  readonly value: string;
  /**
   * Which Layout is in effect, and why, in a line the author reads beside
   * the picker. Empty while the choices are loading.
   */
  readonly why: string;
  /** Whether the picker cannot be changed: the author may not read Layouts. */
  readonly readOnly: boolean;
  /** The Layout the page is drawn inside, or null for none. */
  readonly effective: EffectiveLayout | null;
}

/** The words for one Layout's option. */
function optionLabel(item: LayoutChoice): string {
  return item.published
    ? item.title
    : `${item.title} (not published: the site default shows until it is)`;
}

/**
 * The picker's view of `stored`, given where the choices read stands.
 *
 * Every state, in the words the editor uses:
 * - the default: "Site default (Main)", or "Site default (none set)" when the
 *   site has no published default;
 * - a published Layout by its title; an unpublished one marked as such;
 * - a Layout that no longer exists: "Site default (the chosen Layout was
 *   deleted)";
 * - "No header or footer";
 * - without the right to read Layouts, read-only: "A Layout you can't view".
 */
export function layoutPickerView(
  stored: StoredLayoutChoice,
  state: LayoutChoicesState
): LayoutPickerView {
  const named = layoutRelationId(stored.layout);
  return state.kind === "ready"
    ? viewFromList(named, stored.noHeaderFooter, state.choices)
    : viewWithoutList(named, stored.noHeaderFooter, state.kind === "forbidden");
}

/** The option for "no header or footer", the same in every state. */
const NONE_OPTION: PickerOption = {
  value: NO_HEADER_FOOTER_VALUE,
  label: "No header or footer",
};

/**
 * The view before the list arrives, or when it never will: the picker can
 * only say what is stored.
 */
function viewWithoutList(
  named: string | null,
  switchedOff: boolean,
  forbidden: boolean
): LayoutPickerView {
  // Only a refusal says the author can't view it; while the list is still
  // on its way the stored Layout is named without a claim about access.
  const namedLabel = forbidden
    ? "A Layout you can't view"
    : "The chosen Layout";
  const options: PickerOption[] = [
    { value: SITE_DEFAULT_VALUE, label: "Site default" },
    ...(named === null || switchedOff
      ? []
      : [{ value: layoutValue(named), label: namedLabel }]),
    NONE_OPTION,
  ];
  return {
    options,
    value: storedValue(named, switchedOff, false),
    why: whyWithoutList(named, switchedOff, forbidden),
    readOnly: forbidden,
    effective: null,
  };
}

/**
 * What can be said without the list: the switch, and, to an author who may
 * not read Layouts, what the page names in the words they can see.
 */
function whyWithoutList(
  named: string | null,
  switchedOff: boolean,
  forbidden: boolean
): string {
  if (switchedOff) return "No header or footer";
  if (!forbidden) return "";
  return named === null ? "Site default" : "A Layout you can't view";
}

/** The option the stored values select; a deleted Layout selects the default. */
function storedValue(
  named: string | null,
  switchedOff: boolean,
  deleted: boolean
): string {
  if (switchedOff) return NO_HEADER_FOOTER_VALUE;
  return named === null || deleted ? SITE_DEFAULT_VALUE : layoutValue(named);
}

/** The view once the list has arrived. */
function viewFromList(
  named: string | null,
  switchedOff: boolean,
  choices: LayoutChoicesResponse
): LayoutPickerView {
  const { items, meta } = choices;
  const byId = new Map(items.map(item => [item.id, item]));
  const isPublished = (id: string) => byId.get(id)?.published === true;
  // A named Layout the answer does not hold is gone: the route answers for
  // the page's selected Layout however far past its bound it sorts.
  const deleted = named !== null && !byId.has(named) && !switchedOff;

  const options: PickerOption[] = [
    {
      value: SITE_DEFAULT_VALUE,
      label: defaultLabel(deleted, meta.defaultLayout, byId),
    },
    ...items.filter(item => item.published).map(toOption),
    ...items.filter(item => !item.published).map(toOption),
    NONE_OPTION,
  ];

  const resolution = resolvePageLayout(
    { layout: named, noHeaderFooter: switchedOff },
    { defaultLayout: meta.defaultLayout, isPublished }
  );
  return {
    options,
    value: storedValue(named, switchedOff, deleted),
    why: whyLine(resolution, byId, named, deleted),
    readOnly: false,
    effective:
      resolution.kind === "layout"
        ? effectiveOf(byId.get(resolution.id))
        : null,
  };
}

/** The default option's words: which Layout it is, or why it is not one. */
function defaultLabel(
  deleted: boolean,
  defaultLayout: string | null,
  byId: ReadonlyMap<string, LayoutChoice>
): string {
  if (deleted) return "Site default (the chosen Layout was deleted)";
  const usable = defaultLayout === null ? undefined : byId.get(defaultLayout);
  return usable?.published === true
    ? `Site default (${usable.title})`
    : "Site default (none set)";
}

/** The Layout the page is drawn inside, from its listed row. */
function effectiveOf(item: LayoutChoice | undefined): EffectiveLayout | null {
  if (item === undefined) return null;
  return {
    id: item.id,
    title: item.title,
    draftChangesNotLive: item.draftChangesNotLive,
    regions: item.regions,
  };
}

function toOption(item: LayoutChoice): PickerOption {
  return { value: layoutValue(item.id), label: optionLabel(item) };
}

/** The "why" line: the Layout in effect, and the reason it is that one. */
function whyLine(
  resolution: ReturnType<typeof resolvePageLayout>,
  byId: ReadonlyMap<string, LayoutChoice>,
  named: string | null,
  deleted: boolean
): string {
  if (resolution.kind === "none") {
    return resolution.reason === "switched-off"
      ? "No header or footer"
      : "No header or footer: the site has no published default Layout";
  }
  const title = byId.get(resolution.id)?.title ?? resolution.id;
  if (resolution.source === "page") return title;
  if (deleted) return `Site default: ${title} (the chosen Layout was deleted)`;
  const fellFrom = named === null ? undefined : byId.get(named);
  return fellFrom === undefined
    ? `Site default: ${title}`
    : `${fellFrom.title} (not published, so the site default shows)`;
}

/**
 * What the picker writes for a chosen option: both stored values, together.
 *
 * Picking a Layout or the site default clears the switch, so the choice the
 * author made is the one in effect. Picking "No header or footer" keeps the
 * named Layout, which the switch outranks while it is on.
 */
export function storedFor(
  value: string,
  current: StoredLayoutChoice
): { layout: string | null; noHeaderFooter: boolean } {
  if (value === NO_HEADER_FOOTER_VALUE) {
    return { layout: layoutRelationId(current.layout), noHeaderFooter: true };
  }
  if (value.startsWith("layout:")) {
    return { layout: value.slice("layout:".length), noHeaderFooter: false };
  }
  return { layout: null, noHeaderFooter: false };
}
