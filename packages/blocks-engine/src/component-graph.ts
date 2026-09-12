/**
 * Whether one component's references lead back to itself.
 *
 * A component may place other components, so the library is a directed graph
 * over stored documents. A cycle in it is not a crash: the resolver detects one
 * and stops, drawing the content it reached and leaving a single unresolved
 * node where the loop closes, reported as `reason: "cycle"`. What an author
 * gets is a gap in the middle of otherwise-correct content, on every page that
 * places any component on the loop — and nothing says how it got there.
 *
 * Two surfaces need this question answered and they are asking it at different
 * moments, which is why the answer is a verdict rather than a boolean. An
 * insert panel asks it of a candidate it is about to OFFER, and cannot tell
 * whether a definition it could not read reaches back; withholding one tile is
 * the right cost there. A write asks it of a document about to be SAVED, where
 * the same uncertainty would refuse the save. Deciding that here would make one
 * of them wrong, so `unknown` is its own answer and each caller spends it.
 *
 * @module component-graph
 */

/**
 * What one component places directly, by id — or `undefined` when that cannot
 * be established.
 *
 * `undefined` is not "places nothing". A definition nobody could read, and one
 * a bounded walk could only read a prefix of, both name no component as far as
 * the reader can see; reported as an empty list they would answer the question
 * with a fact nobody has.
 */
export type ComponentPlacements = (id: string) => readonly string[] | undefined;

/** Whether a component's references lead back to it, and how. */
export type ComponentReach =
  | {
      /** No chain of references leads back, and every definition was read. */
      readonly kind: "none";
    }
  | {
      /** A chain leads back, named in {@link path}. */
      readonly kind: "cycle";
      /**
       * The loop, starting and ending at the subject: `["A", "B", "A"]` for a
       * component that places B while B places A, and `["A", "A"]` for one
       * that places itself.
       *
       * Carried because it is what a person can act on. "This would reference
       * itself" leaves an author looking for which of twenty placements did
       * it; naming the chain points at the one to remove.
       *
       * The FIRST chain found, not the shortest and not all of them. One loop
       * is one thing to fix, and an author who removes it can ask again.
       */
      readonly path: readonly string[];
    }
  | {
      /**
       * A definition on the way could not be read, so no chain was found and
       * none can be ruled out.
       */
      readonly kind: "unknown";
      /** The component whose placements could not be established. */
      readonly at: string;
    };

/**
 * Whether saving `self` with these placements would close a loop.
 *
 * `places` is what the document being judged places DIRECTLY — the ids in the
 * document in hand, which for a save is the version about to be written rather
 * than the one stored. That is the whole reason this takes a list instead of
 * reading `self` through `placedBy`: at save time the stored copy is the old
 * one, and asking it would answer about the document being replaced.
 *
 * The walk follows each placement through `placedBy` until it meets `self`,
 * runs out, or meets a definition it cannot read. Every component is followed
 * ONCE per question, which is what makes a graph that already contains loops
 * among OTHER components finite here: a loop between B and C ends where it
 * began rather than running forever while the caller waits on a write.
 *
 * A direct self-placement is a cycle like any other and needs no special case:
 * `self` appearing in `places` is met on the first step.
 */
export function componentReach(args: {
  /** The ids the document in hand places directly, or `undefined` when unread. */
  readonly places: readonly string[] | undefined;
  /** The id the document is, or will be, stored under. */
  readonly self: string;
  /** What every OTHER component places. */
  readonly placedBy: ComponentPlacements;
}): ComponentReach {
  const { places, self, placedBy } = args;
  if (places === undefined) return { kind: "unknown", at: self };

  // Each entry is a component to visit and the chain that reached it, so the
  // answer can name the loop rather than only report that there is one.
  const pending: { id: string; via: readonly string[] }[] = places.map(id => ({
    id,
    via: [self],
  }));
  const followed = new Set<string>();

  for (let step = pending.shift(); step !== undefined; step = pending.shift()) {
    const path = [...step.via, step.id];
    if (step.id === self) return { kind: "cycle", path };
    if (followed.has(step.id)) continue;
    followed.add(step.id);

    const named = placedBy(step.id);
    if (named === undefined) return { kind: "unknown", at: step.id };
    for (const id of named) pending.push({ id, via: path });
  }

  return { kind: "none" };
}
