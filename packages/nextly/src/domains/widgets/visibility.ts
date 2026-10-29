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
import { collectionSettingsToken } from "./collection-cards";
import { refreshContentSources } from "./content-sources";
import { holdsWidgetPermission, requiredPermissionSlugs } from "./gate";
import { visibilityToken } from "./layout";
import { keptOffBySite } from "./site-rules";
import { listSources, sourceTarget } from "./sources";

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
async function decide(caller: ReadAccessCaller): Promise<{
  visible: CanonicalWidget[];
  verdicts: Map<string, boolean>;
  readableCollections: ReadonlySet<string>;
}> {
  // The same freshness on every surface that asks. Sources read on some
  // earlier request would offer a collection deleted since to a card's
  // Collection setting, and none created since -- and in production "the
  // next restart" means the next deploy.
  await refreshContentSources();
  const all = allWidgets();
  // The collections a card may be set to: each one with a content source,
  // which a collection kept off the dashboard never has. Taken in the same
  // span, from the same refresh.
  const offeredCollections = listSources()
    .filter(source => source.kind === "collection")
    .map(source => sourceTarget(source.id));

  const verdicts = await permissionVerdicts(
    all.map(widget => widget.requiredPermission),
    caller
  );

  // 🔴 Which collections this reader may read is asked through the entity
  // read gate (`readableEntities`, which runs `canReadEntity`), not through
  // `callerHoldsPermission`: the second judges an API key on its stamped
  // grant alone, while the first also evaluates the collection's code-defined
  // rules, and the widget query endpoint asks the first. Answered the other
  // way, a key those rules reject would be offered a collection whose every
  // query is refused. Asked once per offered collection.
  const readable = await readableEntities(
    [...new Set(offeredCollections)],
    caller
  );

  // Every widget is a declared one, gated by the permission it declares; a
  // card's collection is judged per card, by `unreadableCollectionCard`. What
  // the site keeps off the dashboard is kept off it for everyone, before any
  // reader's verdict: hidden, a built-in an alternative replaces, or an
  // alternative not put anywhere.
  const visible = all.filter(
    widget =>
      !keptOffBySite(widget.id) &&
      holdsWidgetPermission(widget.requiredPermission, verdicts)
  );
  return {
    visible,
    verdicts,
    readableCollections: new Set(
      offeredCollections.filter(slug => readable.has(slug))
    ),
  };
}

/**
 * What ONE reader may be told: the cards, and what the workspace payload
 * ships for them.
 *
 * ONE decision for the two surfaces that ask. The layout endpoint places and
 * offers `visible`; the admin's workspace payload reads the declarations from
 * two places -- each plugin's `widgets`, and the registry's own list -- and
 * matches both against `declared` by id. And a declaration is not
 * all-or-nothing: an `actions` widget's
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
  /**
   * A token of this whole answer -- the visible cards and the shortcut gates
   * held inside them -- carried by the workspace payload AND the layout read.
   *
   * 🔴 The admin holds the workspace payload for minutes and must know when
   * it describes a different audience from the layout it is drawing. Comparing
   * one layout read with the previous one could not tell it that on a first
   * read: a payload cached before a grant met a layout taken after it, and the
   * first token seen was assumed to describe the cached payload. Both
   * responses carrying the token of the audience they were built from lets the
   * admin compare the two things that must agree. Taken before the condition
   * pass, because the payload is: it ships every card the reader may see, and
   * whether a transient card is worth showing is the layout's business alone.
   */
  token: string;
  /**
   * The collections this reader may read that a card may be set to: each
   * collection with a content source the entity read gate admits them to.
   * From the same refresh as `visible`.
   *
   * 🔴 The ONE readable verdict the dashboard asks: which cards set to a
   * collection are withheld, which collections a card's content settings may
   * name, and which Collection defaults the workspace payload ships. Asked of
   * the collections themselves, the ones a card may be set to.
   */
  readableCollections: ReadonlySet<string>;
}

export async function widgetAudience(
  caller: ReadAccessCaller
): Promise<WidgetAudience> {
  const { visible, verdicts, readableCollections } = await decide(caller);
  // Derived from `visible`, the one answer, so the payload's matching and the
  // layout's placing read the same set of ids.
  const declared = new Set(visible.map(widget => widget.id));
  // The gates inside the cards that will ship, resolved beside the cards'
  // own. Only the visible cards': a withheld card ships no actions to gate.
  const inner = await permissionVerdicts(
    visible.flatMap(widget => widget.actionGates ?? []),
    caller
  );
  const every = new Map([...verdicts, ...inner]);
  const heldActionGates = new Set(
    [...inner].filter(([, held]) => held).map(([slug]) => slug)
  );
  return {
    visible,
    declared,
    holds: requiredPermission =>
      holdsWidgetPermission(requiredPermission, every),
    heldActionGates,
    readableCollections,
    // Over what the workspace payload is built from beyond the ids and gates:
    // the readable collections, which decide the Collection defaults it ships,
    // and each Collection setting whole, which the settings sheet draws. A
    // change to either leaves every id and gate as it was.
    token: visibilityToken(
      visible.map(widget => widget.id),
      heldActionGates,
      readableCollections,
      collectionSettingsToken(visible)
    ),
  };
}
