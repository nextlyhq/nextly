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
  type LayoutSite,
} from "@nextlyhq/blocks-engine";

import type {
  LayoutChoice,
  LayoutChoicesResponse,
} from "../layout-choices-contract";

/** What a Layout the author may not read is called, wherever it is named. */
const UNREADABLE_LAYOUT = "A Layout you can't view";

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

/**
 * The words for one Layout's option. An unpublished one says what a page
 * naming it is drawn inside meanwhile, asked of the rule itself: the site
 * default where one is usable, and otherwise no header or footer.
 */
function optionLabel(item: LayoutChoice, site: LayoutSite): string {
  if (item.published) return item.title;
  const meanwhile = resolvePageLayout(
    { layout: item.id, noHeaderFooter: false },
    site
  );
  return meanwhile.kind === "layout"
    ? `${item.title} (not published: the site default shows until it is)`
    : `${item.title} (not published: no header or footer shows until it is)`;
}

/**
 * The picker's view of `stored`, given where the choices read stands.
 *
 * Every state, in the words the editor uses:
 * - the default: "Site default (Main)", or "Site default (none set)" when the
 *   site has no published default;
 * - a published Layout by its title; an unpublished one marked as such;
 * - a Layout the answer does not hold, hidden from the author or deleted:
 *   "A Layout you can't view, or one that was deleted";
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
  const namedLabel = forbidden ? UNREADABLE_LAYOUT : "The chosen Layout";
  const options: PickerOption[] = [
    { value: SITE_DEFAULT_VALUE, label: "Site default" },
    ...(named === null || switchedOff
      ? []
      : [{ value: layoutValue(named), label: namedLabel }]),
    NONE_OPTION,
  ];
  return {
    options,
    value: storedValue(named, switchedOff),
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
  return named === null ? "Site default" : UNREADABLE_LAYOUT;
}

/** The option the stored values select. */
function storedValue(named: string | null, switchedOff: boolean): string {
  if (switchedOff) return NO_HEADER_FOOTER_VALUE;
  return named === null ? SITE_DEFAULT_VALUE : layoutValue(named);
}

/**
 * What a Layout the answer does not hold is called. The author's own reads
 * did not return it, which happens to a Layout hidden from them and to one
 * that was deleted alike, and the answer does not say which.
 */
const UNKNOWN_LAYOUT = "A Layout you can't view, or one that was deleted";

/**
 * The default, as the rule is asked about it, when one is set that the author
 * cannot read: it stands for "the site's default", whatever that turns out to
 * be, and is never drawn.
 */
const UNREADABLE_DEFAULT = "\u0000unreadable-default";

/** The view once the list has arrived. */
function viewFromList(
  named: string | null,
  switchedOff: boolean,
  choices: LayoutChoicesResponse
): LayoutPickerView {
  const { items, meta } = choices;
  const byId = new Map(items.map(item => [item.id, item]));
  // A named Layout the answer does not hold: nothing more is known of it, so
  // nothing more is said or drawn.
  if (named !== null && !switchedOff && !byId.has(named)) {
    return unknownLayoutView(named, items, meta);
  }
  const site: LayoutSite = {
    defaultLayout: meta.defaultUnreadable
      ? UNREADABLE_DEFAULT
      : meta.defaultLayout,
    isPublished: id =>
      id === UNREADABLE_DEFAULT || byId.get(id)?.published === true,
  };
  const options = choiceOptions(items, meta, site);
  const resolution = resolvePageLayout(
    { layout: named, noHeaderFooter: switchedOff },
    site
  );
  return {
    options,
    value: storedValue(named, switchedOff),
    why: whyLine(resolution, byId, named),
    readOnly: false,
    effective:
      resolution.kind === "layout"
        ? effectiveOf(byId.get(resolution.id))
        : null,
  };
}

/** The options: the default, published Layouts, unpublished ones, then none. */
function choiceOptions(
  items: readonly LayoutChoice[],
  meta: LayoutChoicesResponse["meta"],
  site: LayoutSite
): PickerOption[] {
  const toOption = (item: LayoutChoice): PickerOption => ({
    value: layoutValue(item.id),
    label: optionLabel(item, site),
  });
  return [
    { value: SITE_DEFAULT_VALUE, label: defaultLabel(meta, items) },
    ...items.filter(item => item.published).map(toOption),
    ...items.filter(item => !item.published).map(toOption),
    NONE_OPTION,
  ];
}

/**
 * The view for a page naming a Layout the answer does not hold: the choice is
 * kept and named honestly, and nothing of it is drawn. The published page is
 * drawn by what that Layout resolves to, which this author cannot be told.
 */
function unknownLayoutView(
  named: string,
  items: readonly LayoutChoice[],
  meta: LayoutChoicesResponse["meta"]
): LayoutPickerView {
  const byId = new Map(items.map(item => [item.id, item]));
  const site: LayoutSite = {
    defaultLayout: meta.defaultLayout,
    isPublished: id => byId.get(id)?.published === true,
  };
  const options = choiceOptions(items, meta, site);
  return {
    options: [
      ...options.slice(0, -1),
      { value: layoutValue(named), label: UNKNOWN_LAYOUT },
      NONE_OPTION,
    ],
    value: layoutValue(named),
    why: `${UNKNOWN_LAYOUT}: the published page uses whatever it resolves to`,
    readOnly: false,
    effective: null,
  };
}

/** The default option's words: which Layout it is, or why it is not one. */
function defaultLabel(
  meta: LayoutChoicesResponse["meta"],
  items: readonly LayoutChoice[]
): string {
  if (meta.defaultUnreadable) {
    return "Site default (a Layout you can't view, or one that was deleted)";
  }
  const usable = items.find(item => item.id === meta.defaultLayout);
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

/** The "why" line for a page drawn with no Layout, and the reason. */
function whyNothingShows(
  resolution: Extract<ReturnType<typeof resolvePageLayout>, { kind: "none" }>,
  byId: ReadonlyMap<string, LayoutChoice>
): string {
  if (resolution.reason === "switched-off") return "No header or footer";
  // A named Layout that is not published, with no usable default behind it:
  // the page is drawn with nothing, and the line says so.
  const fellFrom =
    resolution.fellBackFrom === undefined
      ? undefined
      : byId.get(resolution.fellBackFrom);
  return fellFrom === undefined
    ? "No header or footer: the site has no published default Layout"
    : `${fellFrom.title} (not published, so no header or footer shows)`;
}

/** The "why" line: the Layout in effect, and the reason it is that one. */
function whyLine(
  resolution: ReturnType<typeof resolvePageLayout>,
  byId: ReadonlyMap<string, LayoutChoice>,
  named: string | null
): string {
  if (resolution.kind === "none") return whyNothingShows(resolution, byId);
  const title =
    resolution.id === UNREADABLE_DEFAULT
      ? "a Layout you can't view, or one that was deleted"
      : (byId.get(resolution.id)?.title ?? resolution.id);
  if (resolution.source === "page") return title;
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
