/**
 * Which widgets a reader may be told exist.
 *
 * ONE implementation, because two surfaces ask it and a disagreement between
 * them is a disclosure rather than a cosmetic difference. The layout endpoint
 * asks so it can place and offer; the admin's workspace payload asks so it can
 * ship the declarations -- and a declaration is not only a name. A `text`
 * widget carries its prose and an `actions` widget its links, so a payload
 * that shipped every declaration and left the browser to hide the gated ones
 * would hand a reader the contents of a card they may not see: the payload is
 * JSON, and reading it is the bypass. A copy in the second surface that drifted
 * from the first would publish the existence and the slug of every collection
 * an install has, and the body of every gated card, to a reader the first was
 * hiding them from.
 *
 * @module domains/widgets/visibility
 */

import {
  authorizationGroups,
  callerHoldsPermission,
  readableEntities,
  type ReadAccessCaller,
} from "../../auth/entity-read-access";

import { allWidgets, type CanonicalWidget } from "./canonical";
import {
  generatedWidgets,
  refreshCollectionWidgets,
} from "./collection-widgets";
import type { WidgetDefinition } from "./definition";
import { holdsWidgetPermission, requiredPermissionSlugs } from "./gate";

// Re-exported from its own module rather than moved-and-forgotten: this is
// where every caller already reaches for the gate, and the decision now lives
// beside the reader it is built from.
export { holdsWidgetPermission, requiredPermissionSlugs } from "./gate";

/**
 * A decision per permission slug, taken in the bounded rounds the query batch
 * already prescribes.
 *
 * Memoized per SLUG, not per widget: several widgets commonly name the same
 * permission, and a permission check resolves a session caller through a
 * per-user TTL cache, so asking twice is two database reads for one answer.
 */
export async function permissionVerdicts(
  gates: readonly unknown[],
  caller: ReadAccessCaller
): Promise<Map<string, boolean>> {
  // Read through the SAME function the gate below reads with, so the set
  // resolved here and the set asked about there cannot come apart. A gate may
  // now name several slugs, so this flattens rather than filters -- collecting
  // only the first of an any-of array would leave the others unresolved, and an
  // unresolved slug is a missing verdict, which denies.
  const distinct = [
    ...new Set(gates.flatMap(gate => requiredPermissionSlugs(gate) ?? [])),
  ];

  const verdicts = new Map<string, boolean>();
  for (const group of authorizationGroups(distinct)) {
    const settled = await Promise.allSettled(
      group.map(slug => callerHoldsPermission(slug, caller))
    );
    group.forEach((slug, index) => {
      const outcome = settled[index];
      // A rejected decision DENIES. A permission check that threw has told us
      // nothing, and "nothing" must not read as "allowed" -- the same
      // fail-closed direction `canReadEntity` takes when RBAC is unreachable.
      verdicts.set(slug, outcome.status === "fulfilled" && outcome.value);
    });
  }
  return verdicts;
}

/**
 * The cards this caller may see, with the verdicts they were decided on.
 *
 * A widget with no `requiredPermission` is visible to any authenticated
 * reader -- that is what omitting it means, and it is what core's own four
 * cards rely on. A widget that declares one is asked about, and the decision is
 * taken through the same bounded rounds `authorizationGroups` prescribes for
 * the query batch: a permission check resolves a session caller through a
 * per-user TTL cache, so firing thirty of them at once makes every one a miss.
 *
 * Judged on the CANONICAL set, so a colliding pair is one card with one gate:
 * a registration that tightened the permission on a contributed id tightens it
 * for both copies, and the workspace payload withholds the contribution's
 * prose along with the registration's rather than shipping the copy that
 * happened to carry no gate of its own.
 *
 * The verdicts travel out with the cards because {@link widgetAudience} asks
 * about the gates INSIDE them next, and a second pass would be two RBAC reads
 * per slug for one answer.
 */
async function decide(
  caller: ReadAccessCaller
): Promise<{ visible: CanonicalWidget[]; verdicts: Map<string, boolean> }> {
  // The same freshness on every surface that asks. A set derived on some
  // earlier request would offer a card for a collection deleted since and
  // refuse it on save, and have no card at all for one created since -- and
  // in production "the next restart" means the next deploy.
  await refreshCollectionWidgets();
  const all = allWidgets();

  const verdicts = await permissionVerdicts(
    all.map(widget => widget.requiredPermission),
    caller
  );

  // 🔴 A GENERATED card is gated on the entity it reads -- a collection or a
  // single -- not on a declared permission; it carries none.
  // `callerHoldsPermission` judges an API key on its stamped grant alone,
  // while `canReadEntity` also evaluates the entity's code-defined rules, and
  // the widget query endpoint asks the second. A key those rules reject had
  // the card offered here and every query for it refused. The same question,
  // asked once per entity.
  const readable = await readableEntities(
    all
      .map(widget => widget.collection)
      .filter((slug): slug is string => slug !== undefined),
    caller
  );

  const visible = all.filter(widget => {
    if (widget.generated === true) {
      // A generated card that names no entity cannot be checked against one,
      // so it is withheld rather than published. Unreachable today -- every
      // such card is built from a `collection:` or `single:` source -- and
      // free, since it decides from a value already in hand.
      return widget.collection !== undefined && readable.has(widget.collection);
    }
    return holdsWidgetPermission(widget.requiredPermission, verdicts);
  });
  return { visible, verdicts };
}

/**
 * What ONE reader may be told: the cards, and what the workspace payload
 * ships for them.
 *
 * ONE decision for the two surfaces that ask. The layout endpoint places and
 * offers `visible`; the admin's workspace payload reads DECLARED widgets from
 * two places -- each plugin's `widgets`, and the registry's own list -- and
 * matches both against `declared` by id. A generated card travels as its full
 * definition instead, because the admin holds no copy of it to match: core
 * derived it on the server, and this is the only route by which it reaches
 * the browser. And a declaration is not all-or-nothing: an `actions` widget's
 * shortcuts each carry a gate of their own, so `holds` answers for those
 * before the declaration ships with them.
 *
 * `heldActionGates` is the part of that answer the cards alone cannot carry.
 * The layout's scope token is what tells a client its view has moved, and a
 * token of the visible ids alone stood still when a reader gained only a
 * shortcut's permission -- so the workspace payload, fetched for the earlier
 * verdicts and held fresh for minutes, kept the shortcut withheld until some
 * unrelated refresh. The token is taken over these as well.
 */
export interface WidgetAudience {
  /** The cards this reader may see, in canonical order. */
  visible: CanonicalWidget[];
  /** Ids of the declared widgets -- contributed or registered -- this reader may see. */
  declared: ReadonlySet<string>;
  /** The cards core derived that this reader may see. */
  generated: WidgetDefinition[];
  /**
   * Whether a gate INSIDE a visible declaration holds for this reader.
   *
   * The same reading as the card's own gate -- absent admits, unusable
   * refuses, an array is any-of -- against verdicts resolved for every gate
   * the visible declarations carry. A slug nobody resolved refuses.
   */
  holds: (requiredPermission: unknown) => boolean;
  /**
   * The permission slugs, named by a gate inside a visible declaration, that
   * this reader holds -- the verdicts `holds` answers from, as a set.
   */
  heldActionGates: ReadonlySet<string>;
}

export async function widgetAudience(
  caller: ReadAccessCaller
): Promise<WidgetAudience> {
  const { visible, verdicts } = await decide(caller);
  const declared = new Set<string>();
  const generatedIds = new Set<string>();
  for (const widget of visible) {
    // Split on the flag, not on membership of the generated set: a generated
    // id a plugin also declared survives the canonical merge as the PLUGIN's
    // card, and core's derived copy must not ship beside it under the same id.
    (widget.generated === true ? generatedIds : declared).add(widget.id);
  }
  // The gates inside the cards that will ship, resolved beside the cards'
  // own. Only the visible cards': a withheld card ships no actions to gate.
  const inner = await permissionVerdicts(
    visible.flatMap(widget => widget.actionGates ?? []),
    caller
  );
  const every = new Map([...verdicts, ...inner]);
  return {
    visible,
    declared,
    generated: generatedWidgets().filter(widget => generatedIds.has(widget.id)),
    holds: requiredPermission =>
      holdsWidgetPermission(requiredPermission, every),
    heldActionGates: new Set(
      [...inner].filter(([, held]) => held).map(([slug]) => slug)
    ),
  };
}
