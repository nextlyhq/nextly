/**
 * Turns what plugins DECLARED into what the grid can render.
 *
 * A `PluginWidgetMeta` is almost entirely optional — a widget may legally be
 * nothing but an id and a component path — while `DashboardWidget` is the shape
 * the renderer works from, with no field it would have to invent a default for.
 * Closing that gap in ONE function is what keeps the defaults out of the
 * renderer, where "title ?? id" would end up written once per archetype and
 * would drift.
 *
 * @module components/features/widgets/resolve-widgets
 */

import type {
  WidgetAction,
  WidgetArchetype,
  WidgetHeight,
  WidgetQuery,
  WidgetSize,
  WidgetStatCell,
  WidgetChrome,
} from "nextly/config";

import type {
  PluginMetadata,
  RegisteredWidgetMeta,
} from "@admin/types/branding";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { coreDraws } from "./outcome";
import { legacySizeToWidgetSize } from "./sizes";

/**
 * A widget's shortcuts, less the ones this reader may not use.
 *
 * Gated HERE because this is the one place holding `hasPermission`, and the
 * same place the card's own `requiredPermission` is judged -- two gates for one
 * question drift, and the renderer would need the predicate threaded through
 * its signature to ask again.
 *
 * The two gates answer different questions and both are needed. The card's
 * permission decides whether the widget appears at all; an item's decides
 * whether that shortcut does. A card of five shortcuts where the reader may use
 * two should show two, not disappear -- and a shortcut to something they may
 * not do is worse than no shortcut, because it advertises a capability, costs a
 * click, and answers with a refusal screen.
 */
function readableActions(
  actions: WidgetAction[] | undefined,
  hasPermission: (permission: string) => boolean
): WidgetAction[] | undefined {
  if (!actions) return undefined;
  return actions.filter(
    action =>
      !action.requiredPermission || hasPermission(action.requiredPermission)
  );
}

/**
 * A contributed widget as this file READS it, which is deliberately not how a
 * plugin author WRITES it.
 *
 * `PluginWidgetMeta` is a union: either a component-bearing widget or an
 * archetype-and-query one. That union is an authoring contract — it exists so a
 * plugin author cannot declare a widget describing no body, and so the mistake
 * is a compile error at the point it is made.
 *
 * A reader wants the opposite. Nothing here branches on which arm a declaration
 * came from; every field is read, each is handled when absent, and the values
 * arrive over the wire from a server that may be a different version and from
 * plugins that may not be TypeScript at all. Reading through the union would
 * mean narrowing at every access to recover facts this code does not use, and
 * `mergeCollision` cannot satisfy either arm at the type level anyway: it
 * composes a registration and a contribution, and only the two together are
 * known to describe a body.
 *
 * Strict to write, permissive to read, with the boot check and the resolver
 * below as the things that actually refuse a declaration that says nothing.
 */
export interface ReadableWidgetDeclaration {
  id: string;
  size?: "full" | "half";
  requiredPermission?: string;
  title?: string;
  description?: string;
  icon?: string;
  category?: string;
  archetype?: WidgetArchetype;
  defaultSize?: WidgetSize;
  defaultHeight?: WidgetHeight;
  minSize?: WidgetSize;
  maxSize?: WidgetSize;
  query?: WidgetQuery;
  component?: string;
  actions?: WidgetAction[];
  /** Present for `stats`: the numbers the card draws, each with its own query. */
  cells?: WidgetStatCell[];
  link?: { label: string; href: string };
  defaultOrder?: number;
  chrome?: WidgetChrome;
}

/**
 * The archetype a declaration means, or `undefined` when it means nothing
 * renderable.
 *
 * A widget with neither an archetype nor a component describes no body at all.
 * It is skipped rather than rendered as an empty card: a definition whose
 * plugin half has gone missing must never break the grid, and a card with a
 * title and nothing under it reads as a product bug rather than as a missing
 * plugin.
 *
 * A declared archetype does NOT automatically win, and that is the case worth
 * reading twice. Core draws every archetype but `custom` FROM A QUERY RESULT,
 * so a declaration describes a body core cannot produce in two ways, and a
 * component the author shipped beats both.
 *
 * It may declare no query where its archetype needs one: no request is made for
 * it, no slot ever arrives, and the card reads that absence as "still loading"
 * for the life of the page. A component-bearing widget may pair any archetype
 * with any query, so this declaration is legal and the component is there to
 * draw instead.
 *
 * The component is NO LONGER always there. `component` became conditional when
 * a widget gained the ability to declare an archetype and a query and let the
 * host draw it, so this branch stops firing for a declarative widget -- which
 * is correct: there is nothing to fall back to, and the card says by name that
 * the archetype is not drawn yet.
 *
 * Or it may name an archetype THIS RELEASE DOES NOT DRAW. `list`, `table`,
 * `text` and `actions` are declarable today and none of them has a renderer, so
 * a widget naming one had its component discarded in favour of the sentence
 * "the list widget archetype is not rendered yet" -- an error where a working
 * card was available. Asked of `coreDraws` rather than listed here, so the
 * fallback stops applying on its own the day core learns to draw one -- and
 * asked of the whole DECLARATION, because a renderer that refuses this
 * particular widget leaves the contributed component the only thing that can
 * draw it, exactly as a missing renderer does.
 */
function resolveArchetype(
  meta: ReadableWidgetDeclaration
): DashboardWidget["archetype"] | undefined {
  if (meta.archetype) {
    // ONE question, asked once. This used to be `!meta.query || !coreDraws(meta)`,
    // and the first half was wrong the moment an archetype was drawn WITHOUT a
    // query: `actions` is queryless by design, so the query test called every
    // actions widget undrawable and handed one carrying a component fallback to
    // that component -- bypassing the host renderer and its per-item permission
    // gating. Each archetype states its own precondition now, so `coreDraws`
    // already knows a metric needs a query and an actions card does not.
    const undrawable = !coreDraws(meta);
    if (meta.archetype !== "custom" && undrawable && meta.component) {
      return "custom";
    }
    return meta.archetype;
  }
  return meta.component ? "custom" : undefined;
}

/**
 * A title with visible text, falling back to the widget's id.
 *
 * TRIMMED, not merely nullish-checked. `title: ""` and `title: "   "` are legal
 * for a contributed widget -- boot requires a usable `id` and a describable
 * body, never a title -- and both pass a `??`. The title is the card region's `aria-labelledby`
 * target, so an empty one makes a landmark with no accessible name, which is
 * worse for a screen-reader user than having no landmark at all. The id is a
 * poor title and it NAMES the widget, which is the one thing a card in that
 * state has to be able to do.
 */
function resolveTitle(title: string | undefined, id: string): string {
  const trimmed = title?.trim();
  return trimmed ? trimmed : id;
}

/**
 * Every widget declared by any plugin, flattened, with no filtering.
 *
 * Separate from the decisions below so the two `?? []` defaults — a project
 * with no plugins, a plugin with no widgets — sit in the one place that is
 * about SHAPE rather than about visibility.
 */
function declaredWidgets(
  plugins: PluginMetadata[] | undefined
): ReadableWidgetDeclaration[] {
  return (plugins ?? []).flatMap(plugin => plugin.widgets ?? []);
}

/**
 * One declaration as the grid renders it, or `undefined` when it is not
 * renderable at all.
 *
 * `hasPermission` is the `useCurrentUserPermissions` predicate, which is
 * closed-until-loaded: an undeclared permission renders, a declared one does
 * not render until the grant is known. Gating HERE rather than inside the card
 * is what keeps a denied widget's query out of the batch — a card that is never
 * mounted must not cause a request on the user's behalf.
 */
function resolveOne(
  meta: ReadableWidgetDeclaration,
  hasPermission: (permission: string) => boolean
): DashboardWidget | undefined {
  if (meta.requiredPermission && !hasPermission(meta.requiredPermission)) {
    return undefined;
  }
  const archetype = resolveArchetype(meta);
  if (!archetype) return undefined;

  return {
    id: meta.id,
    title: resolveTitle(meta.title, meta.id),
    description: meta.description,
    icon: meta.icon,
    archetype,
    // `defaultSize` is the enum; `size` is the deprecated two-value alias. The
    // enum wins where both are declared, because a plugin that adopted the new
    // field meant it.
    size: meta.defaultSize ?? legacySizeToWidgetSize(meta.size),
    ...(meta.defaultHeight === undefined ? {} : { height: meta.defaultHeight }),
    query: meta.query,
    component: meta.component,
    actions: readableActions(meta.actions, hasPermission),
    cells: meta.cells,
    link: meta.link,
    defaultOrder: meta.defaultOrder,
    chrome: meta.chrome,
  };
}

/**
 * One REGISTERED widget as the grid renders it, or `undefined` when the user
 * may not see it.
 *
 * Separate from `resolveOne` above rather than folded into it, because the two
 * inputs are different contracts rather than two spellings of one. A
 * contribution is almost entirely optional and needs every default that
 * function supplies; a registered definition passed `validateWidgetDefinition`,
 * which requires the title, the archetype and the size, requires a query for
 * every data archetype and a component for `custom`, and forbids each where it
 * does not belong. Nothing here has a default to invent, and giving it one
 * would quietly accept a definition the registry would have refused.
 *
 * The permission gate IS shared, and deliberately: a denied widget's query must
 * stay out of the batch whichever channel declared it.
 */
function resolveRegistered(
  meta: RegisteredWidgetMeta,
  hasPermission: (permission: string) => boolean
): DashboardWidget | undefined {
  if (meta.requiredPermission && !hasPermission(meta.requiredPermission)) {
    return undefined;
  }

  return {
    id: meta.id,
    // Through the same helper as a contribution, though `validateWidgetDefinition`
    // already rejects a blank title: the card must not have two ideas about what
    // its region is named depending on which channel declared it.
    title: resolveTitle(meta.title, meta.id),
    description: meta.description,
    icon: meta.icon,
    archetype: meta.archetype,
    size: meta.defaultSize,
    ...(meta.defaultHeight === undefined ? {} : { height: meta.defaultHeight }),
    query: meta.query,
    component: meta.component,
    actions: readableActions(meta.actions, hasPermission),
    cells: meta.cells,
    link: meta.link,
    defaultOrder: meta.defaultOrder,
    chrome: meta.chrome,
  };
}

/**
 * One widget declared through BOTH channels, as the single declaration it
 * describes.
 *
 * MERGED rather than substituted, and the difference is a regression that
 * substitution caused. `WidgetDefinition` forbids `component` on every
 * archetype but `custom`, so a registered `list` widget structurally cannot
 * carry one -- and replacing the contribution with it discarded the only thing
 * on either side that could draw the card. What had rendered the plugin's UI
 * rendered the sentence "the list widget archetype is not rendered yet"
 * instead. The registry cannot supply that field, so taking it as authoritative
 * over that field is taking it as authoritative over nothing.
 *
 * The REGISTRY decides everything it can actually state: the permission gate,
 * the query, the archetype, the title, and its declared size. The CONTRIBUTION
 * supplies what a registration has no way to carry -- the component -- and is
 * read for the optional trimmings the registration left out. The result goes
 * through `resolveOne` like any other declaration, so the archetype fallback,
 * the title fallback, the size fallback and the permission gate are the same
 * code in both paths rather than a second copy that can drift.
 */
/**
 * The registration's value where it states one, else the contribution's.
 *
 * A named function rather than `??` repeated down the merge table. The table is
 * a list of FIELDS, and spelling the same fallback beside each one turns a
 * lookup into a chain of decisions -- which is what the complexity gate
 * objected to before a reader would have. One rule, stated once, applied by
 * name at each field it governs.
 */
function preferRegistered<T>(
  registered: T | undefined,
  contributed: T | undefined
): T | undefined {
  return registered ?? contributed;
}

function mergeCollision(
  contribution: ReadableWidgetDeclaration,
  registration: RegisteredWidgetMeta
): ReadableWidgetDeclaration {
  return {
    id: registration.id,
    // Named field by field rather than spread. `{ ...contribution,
    // ...registration }` reads as the same intent and is not: a registration
    // whose `component` is `undefined` -- which is every non-custom one --
    // would overwrite the contributed component with that `undefined`, which is
    // the exact defect this function exists to close.
    title: registration.title,
    description: preferRegistered(
      registration.description,
      contribution.description
    ),
    icon: preferRegistered(registration.icon, contribution.icon),
    archetype: registration.archetype,
    defaultSize: registration.defaultSize,
    // The registry wins where it states one, exactly as `defaultOrder` and
    // `chrome` do below. Named in this list rather than left out because the
    // list IS the contract: a field missing from it is dropped silently, and a
    // merged widget would lose the height its contribution declared.
    defaultHeight: preferRegistered(
      registration.defaultHeight,
      contribution.defaultHeight
    ),
    minSize: registration.minSize,
    maxSize: registration.maxSize,
    // The contributed size is the FALLBACK, read only when the registration
    // declares no `defaultSize`. `resolveOne` prefers the enum over this alias.
    size: contribution.size,
    requiredPermission: registration.requiredPermission,
    query: registration.query,
    link: preferRegistered(registration.link, contribution.link),
    component: preferRegistered(registration.component, contribution.component),
    actions: preferRegistered(registration.actions, contribution.actions),
    // 🔴 NOT `preferRegistered`. The archetype comes from the registration, so
    // a contributed stats card colliding with a registered metric would hand
    // its cells to a widget drawn from one query -- and the batch prefers cells
    // over that query, so no answer is ever filed under the widget's own id and
    // the card loads forever. Cells travel only with the archetype that draws
    // them.
    cells: registration.archetype === "stats" ? registration.cells : undefined,
    // Both channels can state these, and the registry wins where it does --
    // the rule `defaultSize` already follows above. Rebuilt field by field
    // here, so a field added to the contract and not to THIS list is dropped
    // silently: the merged widget loses its declared position, and an unframed
    // custom widget is wrapped in the card it asked not to have.
    defaultOrder: preferRegistered(
      registration.defaultOrder,
      contribution.defaultOrder
    ),
    chrome: preferRegistered(registration.chrome, contribution.chrome),
  };
}

/**
 * The visible widgets, each id appearing once: contributions in declaration
 * order, then the registrations that no contribution already placed.
 *
 * BOTH channels, because they are two ways into the same grid and neither
 * subsumes the other. `contributes.admin.widgets` is declarative and travels
 * with the plugin's config; `registerWidget` is the imperative API the widget
 * registry exists for. Reading only the first left an app that used the public
 * registration API invisible to the renderer built around that registry.
 *
 * An id declared through both is MERGED, with the registry authoritative over
 * every field it can state -- see `mergeCollision`. The registry is, in
 * `publishableWidgets`' own words, "the single place that knows which widgets
 * exist in a running app", and `overrideWidget` and `extendWidget` exist so a
 * later plugin can correct an earlier widget. Reading the contribution instead
 * discarded every one of those corrections silently.
 *
 * `requiredPermission` is what makes that more than a tidiness argument. The
 * corrections a registry patch is FOR include tightening one, and a tightened
 * permission that loses to the contributed copy is a widget the operator
 * believes they restricted and did not -- a card drawn, and its query put in the
 * batch, for a user the running configuration says may not see it. A silently
 * ignored override is the one failure shape a permission must never have.
 *
 * ORDER stays with the contribution, so a card does not jump across the grid
 * the day someone registers an id that was already contributed. Its SIZE does
 * not: `defaultSize` is a statement the registration made, and the card is as
 * wide as the authoritative definition says.
 */
export function resolveDashboardWidgets(
  plugins: PluginMetadata[] | undefined,
  registered: RegisteredWidgetMeta[] | undefined,
  hasPermission: (permission: string) => boolean
): DashboardWidget[] {
  // Widget ids are plugin-local, so two plugins can ship the same one -- and a
  // registration can collide with a contribution. The id is what keys a batch
  // result back to its card, so a duplicate would hand both widgets the same
  // slot -- one of them showing the other's number, with nothing visibly wrong.
  // One cell per id, and the rest are dropped.
  const seen = new Set<string>();

  // The registry indexed by id. First wins: the registry is a map keyed by id
  // and cannot hold two, but this list arrived over the wire and a malformed
  // payload is not the place to start trusting that.
  //
  // BOTH loops below read the widget through this map rather than through the
  // array they are iterating, so the first-wins rule applies once. Resolving
  // the array member directly let a second entry for an id whose first entry
  // was withheld by permission render in its place -- the deduplication and the
  // permission gate disagreeing about which of the two the payload meant.
  const canonical = new Map<string, RegisteredWidgetMeta>();
  for (const meta of registered ?? []) {
    if (!canonical.has(meta.id)) canonical.set(meta.id, meta);
  }

  const take = (
    id: string,
    resolve: () => DashboardWidget | undefined
  ): DashboardWidget[] => {
    if (seen.has(id)) return [];
    // 🔴 The id is CLAIMED before the resolver runs, so a declaration that is
    // declined still consumes it and no later declaration takes its place.
    //
    // The previous rule let a decline pass the id on, and that is a permission
    // SHADOWING hole: widget ids are plugin-local, so a second plugin
    // contributing the same id with no `requiredPermission` rendered exactly
    // where the first plugin's gated widget had been withheld. Nothing else
    // enforced agreement between the two declarations -- the registration merge
    // closes that case and two contributions have no merge to close it.
    //
    // It is also what makes this agree with the server. `canonicalWidgets`
    // resolves a collision by declaration order alone, and it MUST: positions
    // in the default arrangement come from a placement's index in the
    // whole-registry materialization, so a canonical set that varied per caller
    // would move every reader's cards relative to each other. Deciding identity
    // here by anything the caller affects would put the two back out of step,
    // with the server placing one declaration and the grid drawing another.
    //
    // So: one id names one declaration, chosen without reference to who is
    // asking or to whether the declaration turned out to be renderable.
    seen.add(id);
    const widget = resolve();
    return widget ? [widget] : [];
  };

  const contributed = declaredWidgets(plugins).flatMap(meta => {
    const registration = canonical.get(meta.id);
    return take(meta.id, () =>
      resolveOne(
        registration ? mergeCollision(meta, registration) : meta,
        hasPermission
      )
    );
  });

  const registrations = (registered ?? []).flatMap(meta =>
    take(meta.id, () =>
      // Through `canonical`, not `meta`: see the map's own comment.
      resolveRegistered(canonical.get(meta.id) ?? meta, hasPermission)
    )
  );

  // ONE sort over both channels, after the merge and the permission gate, so a
  // widget's position does not depend on which of the two declared it. That
  // dependency was the defect: registrations are appended after contributions,
  // so a card crossed the grid when its author moved it between channels
  // without changing anything about the card.
  //
  // The sentinel is INFINITY, not `MAX_SAFE_INTEGER`. `validateDefaultOrder`
  // accepts any finite number, and `Number.MAX_VALUE` is finite and far above
  // `MAX_SAFE_INTEGER` -- so that sentinel let a widget with a perfectly valid
  // order sort BELOW widgets claiming none, contradicting the one guarantee
  // this field makes. Infinity is above the whole accepted range by
  // construction, and nothing can tie with it because non-finite values are
  // refused at declaration.
  //
  // STABLE, which `Array.prototype.sort` has guaranteed since ES2019 and which
  // the whole compatibility story rests on: every widget shipping today states
  // no order, so they all compare equal and keep the arrangement they have.
  // Sorting by `?? 0` instead would order them against each other arbitrarily
  // -- rearranging every existing dashboard while every assertion about a
  // STATED order still passed.
  return [...contributed, ...registrations].sort(
    (a, b) =>
      (a.defaultOrder ?? Number.POSITIVE_INFINITY) -
      (b.defaultOrder ?? Number.POSITIVE_INFINITY)
  );
}
