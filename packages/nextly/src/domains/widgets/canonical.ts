/**
 * ONE answer to "which widgets exist", for every server-side question that
 * needs one.
 *
 * 🔴 A widget reaches the dashboard by TWO channels — `registerWidget`, which
 * writes the imperative registry, and `contributes.admin.widgets`, which a
 * plugin declares and which never touches that registry at all. The admin grid
 * has always resolved both. The layout store, written later, read only the
 * first, and the two consequences were invisible while nothing consumed it:
 * a contributed widget was absent from the default arrangement and from
 * `available`, and every write naming one was refused as unavailable. So a
 * plugin using the documented contribution surface could render a card that
 * could never be arranged, hidden, or added.
 *
 * The fix is not for the layout endpoint to learn about contributions — that
 * would be a third place answering the same question. It is for the question to
 * have one implementation that both channels feed.
 *
 * ## Why this is a SUMMARY and not a `WidgetDefinition`
 *
 * The two channels do not carry the same shape and cannot be made to. A
 * registration is a resolved widget and requires `title` and `defaultSize`; a
 * contribution may omit both, and resolution fills them in downstream. Forcing
 * a contribution into `WidgetDefinition` here would mean inventing the missing
 * fields server-side and then disagreeing with whatever the admin invented.
 *
 * Layout resolution needs four things and none of them are the missing ones:
 * which ids exist, which permission gates each, where it sits by default, and
 * what geometry it starts with. That is what this carries. Rendering still
 * reads the full declaration through the channel it came from.
 *
 * @module domains/widgets/canonical
 */

import {
  generatedCollectionSlug,
  generatedWidgets,
} from "./collection-widgets";
import type { WidgetDefinition } from "./definition";
import { listWidgets } from "./registry";

/**
 * The part of a widget that layout resolution needs, from either channel.
 *
 * `defaultSize` and `defaultHeight` are `string`, not the enums, for the reason
 * every other layout type is: a contribution may come from a plugin built
 * against a newer core, and a value outside this core's vocabulary is a shape
 * to survive rather than one to refuse.
 */
export interface CanonicalWidget {
  id: string;
  /**
   * Whether core DERIVED this card rather than an author declaring it.
   *
   * 🔴 It decides one thing: a derived card is offered and never placed. The
   * default arrangement is materialized from the widgets an install DECLARES,
   * and a generated set is unbounded in the install's own content -- forty
   * collections would open onto eighty cards nobody asked for, and could fill
   * the submission cap before the reader chose anything.
   *
   * Set only where the generated channel is the one that supplied the entry. A
   * contribution or a registration claiming the same id has DECLARED that
   * widget, so it is placed like any other: the flag describes where the
   * surviving declaration came from, not which ids core can generate.
   */
  generated?: boolean;
  /**
   * The collection a GENERATED card reads, when it is one.
   *
   * Carried because access to such a card is a question about that collection
   * rather than about a declared permission — it has none — and the summary is
   * what layout resolution filters. Taken from the definition's QUERY where the
   * generated channel supplies it, so the value names the thing actually read
   * rather than a slug recovered from a display identity.
   */
  collection?: string;
  requiredPermission?: string | readonly string[];
  defaultSize?: string;
  defaultHeight?: string;
  defaultOrder?: number;
}

/** The summary of one registered widget. */
function fromRegistration(definition: WidgetDefinition): CanonicalWidget {
  return {
    id: definition.id,
    ...(definition.requiredPermission === undefined
      ? {}
      : { requiredPermission: definition.requiredPermission }),
    ...(definition.defaultSize === undefined
      ? {}
      : { defaultSize: definition.defaultSize }),
    ...(definition.defaultHeight === undefined
      ? {}
      : { defaultHeight: definition.defaultHeight }),
    ...(definition.defaultOrder === undefined
      ? {}
      : { defaultOrder: definition.defaultOrder }),
  };
}

/**
 * One id declared through BOTH channels, as the single summary it describes.
 *
 * 🔴 MERGED FIELD BY FIELD, not substituted, because that is what the admin
 * does and the two must agree. `resolve-widgets.ts` reads
 * `registration.defaultOrder ?? contribution.defaultOrder`; a wholesale replace
 * here dropped a contributed order that the admin kept, so the server built the
 * default arrangement from one declaration while the grid drew it from another
 * — a card sorted into a position the reader never sees, with nothing visibly
 * wrong to say so.
 *
 * `requiredPermission` deliberately does NOT fall back, and the asymmetry is
 * the point rather than an omission. The registry is the override channel —
 * `overrideWidget` and `extendWidget` exist so a later plugin can correct an
 * earlier widget — so a registration that states no permission has STATED that,
 * and the admin reads it exactly that way. A `??` here would gate a card the
 * admin renders ungated: the reader would see it and the server would refuse
 * every write naming it, which is the same disagreement in the other direction.
 *
 * `defaultSize` needs no fallback either, for a duller reason: `WidgetDefinition`
 * requires it and `validateWidgetDefinition` enforces it, so a registration
 * always states one.
 *
 * What is left is the two fields a registration may legally omit and a
 * contribution may legally state, and for those the contribution is read.
 */
function mergeCanonical(
  contribution: CanonicalWidget,
  registration: CanonicalWidget
): CanonicalWidget {
  const defaultOrder = registration.defaultOrder ?? contribution.defaultOrder;
  const defaultHeight =
    registration.defaultHeight ?? contribution.defaultHeight;
  return {
    // The registration wholesale first: id, `requiredPermission` and
    // `defaultSize` are its to state, including by stating nothing.
    ...registration,
    ...(defaultOrder === undefined ? {} : { defaultOrder }),
    ...(defaultHeight === undefined ? {} : { defaultHeight }),
  };
}

/**
 * Every widget this install has, from both channels, deduplicated by id.
 *
 * 🔴 A REGISTRATION WINS a collision, which is the same precedence the admin's
 * own resolver applies — field by field, through {@link mergeCanonical}, rather
 * than by replacing the contribution outright. The two must agree: if the
 * server resolved a colliding id differently from the admin, the arrangement
 * would order a card by one declaration and draw it from another, and nothing
 * would look wrong.
 *
 * Contributions are taken as already-validated summaries rather than raw
 * declarations, so this module never has to know how a plugin is shaped — and
 * the validation stays where the version boundary is understood.
 */
export function canonicalWidgets(
  contributed: readonly CanonicalWidget[]
): CanonicalWidget[] {
  const byId = new Map<string, CanonicalWidget>();
  // Contributions first, so a registration with the same id merges over one
  // rather than being dropped by it.
  //
  // 🔴 FIRST WINS among contributions, which is the admin's rule and was not
  // this one's. Widget ids are plugin-local, so two enabled plugins can ship the
  // same one; `resolveDashboardWidgets` walks declarations in order and keeps
  // the first renderable, while `set` here kept the LAST. Where the two
  // declarations differ in permission, size or order, the layout endpoint then
  // filtered and placed one plugin's widget while the grid drew the other's --
  // a card taking another plugin's geometry, or vanishing.
  for (const widget of contributed) {
    if (widget.id && !byId.has(widget.id)) byId.set(widget.id, widget);
  }
  // Generated cards sit BETWEEN the two declared channels. A contribution
  // already holding the id keeps it -- a plugin that declared that widget meant
  // it, and core's derived guess must not displace it -- while a registration
  // below still merges over whichever of the two is here, for the same reason.
  for (const definition of generatedWidgets()) {
    if (!byId.has(definition.id)) {
      const collection = generatedCollectionSlug(definition);
      byId.set(definition.id, {
        ...fromRegistration(definition),
        generated: true,
        ...(collection === undefined ? {} : { collection }),
      });
    }
  }
  for (const definition of listWidgets()) {
    const registration = fromRegistration(definition);
    const contribution = byId.get(definition.id);
    byId.set(
      definition.id,
      contribution ? mergeCanonical(contribution, registration) : registration
    );
  }
  return [...byId.values()];
}

/**
 * The contributed half, pinned where the registry itself is pinned.
 *
 * On `globalThis`, like every other boot-time widget store, so it survives the
 * module re-evaluation Next.js and Turbopack perform — and so a hot reload that
 * re-registers the same plugins replaces the set rather than accumulating it.
 *
 * Written at boot rather than read from the route handler's config on demand,
 * which is what an earlier version did. Reaching from `api/` into
 * `route-handler/` for boot state inverts the layering — the request path
 * should not have to know how boot stores anything — and it made this question
 * unanswerable in any test that had not mocked the boot module. Populated
 * where every other widget store is populated, it is a plain domain question
 * again.
 */
const globalForContributed = globalThis as unknown as {
  __nextly_contributedWidgets?: CanonicalWidget[];
};

/**
 * The contributed set, for a caller that needs to know which ids a PLUGIN
 * claimed rather than merely which ids exist.
 *
 * The workspace payload asks: a generated card published under an id a plugin
 * declared would be read by the admin as a registration, and the merge gives a
 * registration authority over the contribution's title, archetype and query.
 */
export function contributedWidgets(): CanonicalWidget[] {
  return [...(globalForContributed.__nextly_contributedWidgets ?? [])];
}

/** Replace the contributed set. Called once per boot, beside the registry. */
export function setContributedWidgets(
  widgets: readonly CanonicalWidget[]
): void {
  globalForContributed.__nextly_contributedWidgets = [...widgets];
}

/**
 * Every widget this install has, from both channels.
 *
 * The question every server-side consumer should ask. `listWidgets()` answers
 * only the imperative registry and is the reason a contributed widget could
 * render and never be arranged.
 */
export function allWidgets(): CanonicalWidget[] {
  return canonicalWidgets(
    globalForContributed.__nextly_contributedWidgets ?? []
  );
}

/**
 * The widgets an install DECLARES, which is what a default arrangement is built
 * from.
 *
 * DERIVED from {@link allWidgets} rather than assembled separately, so the two
 * cannot disagree about which widgets exist: this is the same set, less the
 * cards core generated for content the reader has not asked to see.
 *
 * The distinction is not cosmetic. `defaultPlacements` positions a card by its
 * index in the sorted set, and a generated card that appeared here would both
 * take a position and consume one of the placements a caller may submit --
 * so an install with many collections would open onto a dashboard nobody chose
 * and, past the cap, one they could not add to.
 */
export function declaredWidgets(): CanonicalWidget[] {
  return allWidgets().filter(widget => widget.generated !== true);
}
