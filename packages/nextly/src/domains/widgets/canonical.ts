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
  requiredPermission?: string;
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
 * Every widget this install has, from both channels, deduplicated by id.
 *
 * 🔴 A REGISTRATION WINS a collision, which is the same precedence the admin's
 * own resolver applies (`resolve-widgets.ts` reads
 * `registration.defaultOrder ?? contribution.defaultOrder`). The two must agree:
 * if the server resolved a colliding id to the contribution while the admin
 * rendered the registration, the arrangement would order a card by one
 * declaration and draw it from another, and nothing would look wrong.
 *
 * Contributions are taken as already-validated summaries rather than raw
 * declarations, so this module never has to know how a plugin is shaped — and
 * the validation stays where the version boundary is understood.
 */
export function canonicalWidgets(
  contributed: readonly CanonicalWidget[]
): CanonicalWidget[] {
  const byId = new Map<string, CanonicalWidget>();
  // Contributions first, so a registration with the same id overwrites one
  // rather than being dropped by it.
  for (const widget of contributed) {
    if (widget.id) byId.set(widget.id, widget);
  }
  for (const definition of listWidgets()) {
    byId.set(definition.id, fromRegistration(definition));
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
