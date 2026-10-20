/**
 * The decisions one request has already made, kept for the rest of it.
 *
 * A decision about a whole collection or Single depends only on the actor,
 * the action and the target, so within one request it is made once and
 * reused. It is kept under the actor it was made for: a narrower actor in the
 * same request, such as a service call made as someone else, is a different
 * actor object, so an answer reached for a broader caller is never handed to
 * a narrower one.
 *
 * Only whole-target decisions belong here. A field rule may depend on the
 * entry it is judging, so it is never kept across entries.
 *
 * A memo lives as long as the request that made it, and nothing is kept
 * between requests.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { NextlyError } from "../../errors/nextly-error";

import type { AccessAction, Actor } from "./actor";
import type { AccessTarget, Decision } from "./decide";

/** A decision being made: the memo entry it will fill, and its key. */
interface Deciding {
  readonly decisions: Map<string, Promise<Decision>>;
  readonly key: string;
  /**
   * True until the decision settles. Work the decision started and left
   * running keeps its call chain afterwards, and an ask it makes then is not
   * recursion: it is answered from the memo like any other.
   */
  pending: boolean;
}

/**
 * The decisions being made in the current call chain. A decision whose work
 * asks for the same decision again, such as a rule that calls a service that
 * asks about the same caller and target, would wait on itself; it is refused
 * instead. Two separate asks at once are not in each other's chain, and share
 * one decision.
 */
const deciding = new AsyncLocalStorage<readonly Deciding[]>();

export class DecisionMemo {
  // Keyed by the actor object itself, so two actors never share an entry.
  private readonly byActor = new WeakMap<
    Actor,
    Map<string, Promise<Decision>>
  >();

  /**
   * The decision for `action` on `target` as `actor`, made by `decide` the
   * first time it is asked in this memo and reused after. The pending promise
   * is kept, so two asks at once share one decision. A decision that fails is
   * not kept, so the next ask makes it again.
   */
  remember(
    actor: Actor,
    action: AccessAction,
    target: AccessTarget,
    decide: () => Promise<Decision>
  ): Promise<Decision> {
    const decisions = this.decisionsOf(actor);
    const key = `${target.kind}\u0000${target.slug}\u0000${action}`;
    const chain = deciding.getStore() ?? [];
    if (
      chain.some(e => e.pending && e.decisions === decisions && e.key === key)
    ) {
      return Promise.reject(
        NextlyError.internal({
          logContext: {
            reason: "an access decision asked for itself",
            action,
            target: target.slug,
          },
        })
      );
    }
    const known = decisions.get(key);
    if (known) return known;
    const marker: Deciding = { decisions, key, pending: true };
    const made = deciding.run([...chain, marker], decide);
    decisions.set(key, made);
    made.then(
      () => {
        marker.pending = false;
      },
      () => {
        marker.pending = false;
        decisions.delete(key);
      }
    );
    return made;
  }

  private decisionsOf(actor: Actor): Map<string, Promise<Decision>> {
    const known = this.byActor.get(actor);
    if (known) return known;
    const made = new Map<string, Promise<Decision>>();
    this.byActor.set(actor, made);
    return made;
  }
}
