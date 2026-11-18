/**
 * A change a route stores, made as a step of the editor's history: the
 * route takes a turn on the section's chain of writes, so the writes before
 * it have answered first and those after it wait for it, and its step holds
 * the two halves the route answered.
 *
 * Typed by shape alone, so the site style client imports this and nothing
 * here imports the client.
 *
 * @module admin/site-style-route-step
 */

/** A section as a route found it stored and as its write left it. */
export interface StoredHalves {
  readonly before: unknown;
  readonly after: unknown;
}

/** A section's chain of writes, as `site-style-client` keeps it. */
interface Chain {
  tail: Promise<unknown>;
  pending: number;
  held: unknown;
}

/** A place taken in the editor's history. */
interface Slot {
  readonly cancel: () => void;
  readonly stored: (before: unknown, after: unknown) => void;
}

/**
 * A turn on a section's chain for a write made elsewhere, a route's: the
 * writes after it wait for it, as for one of this editor's own, and build
 * on what it says the section holds once it has answered.
 */
function routeTurn(chain: Chain): {
  prior: Promise<unknown>;
  settle: (holds: unknown) => void;
} {
  const prior = chain.tail;
  chain.pending += 1;
  let settle: (holds: unknown) => void = () => {};
  const answered = new Promise<unknown>(resolve => {
    settle = resolve;
  });
  chain.tail = answered.then(holds => {
    chain.pending -= 1;
    if (chain.pending === 0) chain.held = holds;
    return holds;
  });
  return { prior, settle };
}

/**
 * A route's change, run in turn on the section's chain, after the writes
 * before it and before those after it, and filled into the place taken for
 * it with the halves the route answered: given up when it stored nothing or
 * refused. Outside the editor it is no step.
 */
export async function changedThrough<S, K>(
  editor: {
    readonly history: { readonly settled: S } | null;
    /** Takes a change's place in the history. */
    readonly reserve: (section: K) => Slot;
    /** A section's chain of writes in this editor. */
    readonly chainOf: (settled: S, section: K) => Chain;
  },
  section: K,
  change: () => Promise<StoredHalves | undefined>
): Promise<void> {
  const { history } = editor;
  if (history === null) {
    await change();
    return;
  }
  const slot = editor.reserve(section);
  // A turn of its own, so a save made while the route runs waits for it.
  const turn = routeTurn(editor.chainOf(history.settled, section));
  let holds: unknown;
  try {
    holds = await turn.prior;
    const halves = await change();
    if (halves === undefined) slot.cancel();
    else {
      slot.stored(halves.before, halves.after);
      holds = halves.after;
    }
  } catch (refused) {
    slot.cancel();
    throw refused;
  } finally {
    turn.settle(holds);
  }
}
