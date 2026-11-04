/**
 * The frames an adapter keeps for the transactions an async flow runs inside,
 * and the pure steps that open, close and judge them.
 *
 * @remarks
 * A frame is one outermost transaction, or one part joined to it as a
 * savepoint. The adapter keeps the calling flow's frame in an
 * AsyncLocalStorage, so a `transaction()` call made from inside another's work
 * can find the transaction it would join, and an effect registered from inside
 * it can be held until that transaction commits.
 *
 * @packageDocumentation
 */

import type { TransactionContext, TransactionOptions } from "./types";

/** One transaction, or one part joined to it, as the calls made inside it see it. */
export interface TransactionFrame {
  /** 0 for an outermost transaction; each joined part is one deeper. */
  depth: number;
  /** The frame this part joined; none for an outermost transaction. */
  parent: TransactionFrame | undefined;
  /**
   * For an outermost transaction, the frame the flow that opened it was
   * inside, if any: one that had already finished, or a transaction of its
   * own on another connection.
   */
  enclosing: TransactionFrame | undefined;
  /** False once the frame has closed to new joined calls: finished, or finishing. */
  active: boolean;
  /** True once this part, or this outermost transaction, rolled back. */
  rolledBack: boolean;
  /** True once this outermost transaction has committed or rolled back. */
  finished: boolean;
  /**
   * How many `transaction()` calls this frame's context has made since it
   * closed, each running somewhere else: an effect registered after one of
   * them may announce a write this frame's rollback did not undo.
   */
  writesAfterClosing: number;
  /**
   * Effects held from any frame of the outermost transaction, in
   * registration order. Only the outermost transaction's list is used.
   */
  held: HeldEffect[];
  /** Serializes the calls joined directly to this frame. */
  queue: Promise<unknown>;
  /**
   * The frames open on this connection, outermost first, shared by the
   * transaction and every part joined to it. Each runs inside the one before
   * it: a frame runs one joined call at a time, so the frames still running
   * form a single chain and the last one open is the innermost.
   */
  open: TransactionFrame[];
  /**
   * True once the outermost transaction holds a connection of its own. From
   * then on anything the flow takes from the pool runs outside it.
   */
  connected: boolean;
  /** The connection the transaction runs on, once the adapter knows it. */
  connection: unknown;
  /** The options the transaction, or the part, was opened with. */
  options: TransactionOptions | undefined;
  /**
   * The stack that opened an outermost transaction, kept only while a test
   * harness observes escapes. A statement that escapes is often reached
   * through a query builder awaited as a thenable, and V8 links no caller
   * across that, so where its transaction was opened is the code it can still
   * be traced to.
   */
  openedAt: string | undefined;
}

/** An effect held until the outermost transaction commits. */
export interface HeldEffect {
  effect: () => unknown;
  onDeferredFailure: ((error: unknown) => void) | undefined;
  /** The frame it was registered from; it is dropped if that one is undone. */
  frame: TransactionFrame;
  /** `frame.writesAfterClosing` when it was registered. */
  writesBefore: number;
}

/** What a committed outermost transaction hands back: its result and the effects to run. */
export interface Committed<T> {
  result: T;
  effects: HeldEffect[];
}

/**
 * The statements one transaction, or one part joined to it, runs on its
 * connection. Each returns nothing when the driver is synchronous, so the
 * work starts in the same tick as the statement that opened it.
 */
export interface TransactionSteps {
  /** What the work is handed. */
  context: TransactionContext;
  /** Opens it: BEGIN, or SAVEPOINT. */
  begin(): void | Promise<void>;
  /** Ends it: COMMIT, or RELEASE. */
  commit(): void | Promise<void>;
  /** Undoes it: ROLLBACK, or ROLLBACK TO. Its failure is ignored. */
  rollback(): void | Promise<void>;
}

/** The steps of an outermost transaction, with the connection it runs on. */
export interface OutermostSteps extends TransactionSteps {
  connection: unknown;
}

/** Where a new frame sits: in a frame it joins, or as an outermost transaction. */
interface FramePlace {
  parent?: TransactionFrame;
  enclosing?: TransactionFrame;
  connection?: unknown;
  options?: TransactionOptions;
  openedAt?: string;
}

/**
 * Open the frame of a part joined to `place.parent`, or of an outermost
 * transaction when there is none, and record it among the connection's open
 * frames.
 */
export function openFrame(place: FramePlace): TransactionFrame {
  const { parent } = place;
  const frame: TransactionFrame = {
    depth: parent ? parent.depth + 1 : 0,
    parent,
    enclosing: parent ? undefined : place.enclosing,
    active: true,
    rolledBack: false,
    finished: false,
    writesAfterClosing: 0,
    held: [],
    queue: Promise.resolve(),
    open: parent ? parent.open : [],
    connected: false,
    connection: place.connection,
    options: place.options,
    openedAt: place.openedAt,
  };
  frame.open.push(frame);
  return frame;
}

/** The outermost transaction `frame` runs inside; itself for that one. */
export function outermost(frame: TransactionFrame): TransactionFrame {
  let at = frame;
  while (at.parent) at = at.parent;
  return at;
}

/**
 * The frame a `transaction()` call made from `own` joins, or none when it
 * opens a transaction of its own.
 *
 * A call made later from inside a part that has since released runs inside
 * the innermost frame open on the connection. Queued on an enclosing frame,
 * it would wait behind the part running there, which may be the one awaiting
 * it. Savepoints on one connection form a stack, so whatever opens now is
 * inside that innermost frame anyway.
 *
 * The innermost open frame need not be related to the call. When it is a
 * sibling part that later rolls back, the call's write rolls back with it,
 * although the call itself already resolved. Waiting for an unrelated frame
 * instead could wait on the very frame that awaits the call.
 */
export function joinable(
  own: TransactionFrame | undefined
): TransactionFrame | undefined {
  return own?.active ? own : own?.open.at(-1);
}

/**
 * Whether an effect registered from `frame` describes a write that was
 * undone: `frame`, or a frame it runs inside, rolled back, and no
 * transaction had run from its context since it closed when the effect was
 * registered (`writesBefore`). An effect registered before such a write
 * still describes the undone one.
 */
export function undone(frame: TransactionFrame, writesBefore: number): boolean {
  if (writesBefore > 0) return false;
  for (let at: TransactionFrame | undefined = frame; at; at = at.parent) {
    if (at.rolledBack) return true;
  }
  return false;
}

/** Chain `run` onto a frame's queue, keeping the queue itself unrejected. */
export function enqueueIn<T>(
  frame: TransactionFrame,
  run: () => Promise<T>
): Promise<T> {
  const next = frame.queue.then(run, run);
  frame.queue = next.catch(() => undefined);
  return next;
}

/**
 * Close a frame to new joined calls and wait for those already queued. A call
 * arriving after this joins the innermost frame still open on the connection,
 * or, when none is, opens a transaction of its own.
 */
export async function settleNested(frame: TransactionFrame): Promise<void> {
  closeFrame(frame);
  await frame.queue;
}

/** Close a frame to new joined calls, and take it off the connection's open frames. */
export function closeFrame(frame: TransactionFrame): void {
  frame.active = false;
  // A failed RELEASE or COMMIT settles the same frame a second time.
  const index = frame.open.indexOf(frame);
  if (index !== -1) frame.open.splice(index, 1);
}
