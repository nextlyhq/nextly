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

import type { AnyRelations } from "drizzle-orm";

import type { DrizzleTransactor } from "./pinned-transaction";
import type {
  AdapterLogger,
  TransactionContext,
  TransactionOptions,
} from "./types";

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
  /**
   * How many parts joined to this outermost transaction have rolled back to
   * their savepoint. Only the outermost transaction's count is used: what
   * any call inside the transaction read before one of them may describe a
   * write that is gone (`TransactionInFlow.undone`).
   */
  rollbacks: number;
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
   * Effects held with `afterRollback` from any frame of the outermost
   * transaction, in registration order, run once it has rolled back for
   * good. Only the outermost transaction's list is used.
   */
  rollbackHeld: HeldEffect[];
  /**
   * Set once a part joined to this outermost transaction failed in a way the
   * transaction cannot commit past (`TransactionSteps.dooms`): its COMMIT is
   * then refused, it rolls back and rejects with this error, and every later
   * joined call fails with it at once.
   */
  doomed: { error: unknown } | undefined;
  /**
   * True once the outermost transaction holds a connection of its own. From
   * then on anything the flow takes from the pool runs outside it.
   */
  connected: boolean;
  /**
   * How a call made inside the transaction joins it, on its connection. The
   * dialect built it over that connection when it opened the transaction.
   * Undefined for a frame that only tracks a transaction a dialect runs
   * itself (`runInFlowTransaction`): nothing joins that one.
   */
  join: JoinSteps | undefined;
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

/**
 * How an outermost transaction ended: committed, with the work's result and
 * the `afterCommit` effects to run, or rolled back, with the error that ended
 * it and the `afterRollback` effects to run once it is the last attempt.
 */
export type Settled<T> =
  | { committed: true; result: T; effects: HeldEffect[] }
  | { committed: false; error: unknown; effects: HeldEffect[] };

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
export interface TransactionSteps<C = TransactionContext> {
  /** What the work is handed. */
  context: C;
  /** Opens it: BEGIN, or SAVEPOINT. */
  begin(): void | Promise<void>;
  /** Ends it: COMMIT, or RELEASE. */
  commit(): void | Promise<void>;
  /** Undoes it: ROLLBACK, or ROLLBACK TO. Its failure is ignored. */
  rollback(): void | Promise<void>;
  /**
   * For a joined part: whether `error`, raised inside it, leaves the whole
   * transaction unable to commit. On a dialect whose join is flat, with no
   * savepoint to undo the part alone, every failure does; on PostgreSQL a
   * serialization failure or a deadlock does, which only a retry of the
   * outermost transaction can answer. Absent, none does.
   */
  dooms?(error: unknown): boolean;
}

/**
 * How calls made inside a transaction join it: the steps of a part joined
 * `depth` deep, on the transaction's own connection.
 */
export interface JoinSteps {
  /** For a `transaction()` call: its work is handed a transaction context. */
  adapter(depth: number): TransactionSteps;
  /**
   * For the Drizzle handle's `transaction`, or Drizzle's own `tx.transaction`:
   * its work is handed a Drizzle handle on the same connection, with
   * `relations` when the handle it was called on had them. Absent on a
   * dialect whose handle takes no async work.
   */
  drizzle?: (
    depth: number,
    relations: AnyRelations | undefined
  ) => TransactionSteps<DrizzleTransactor>;
}

/** The steps of an outermost transaction, with how calls inside it join it. */
export interface OutermostSteps<C = TransactionContext>
  extends TransactionSteps<C> {
  /**
   * How calls made inside the transaction join it. Without it, nothing
   * joins the transaction: calls made inside open transactions of their own.
   */
  join?: JoinSteps;
  /**
   * The connection the transaction runs on.
   *
   * @deprecated Unused: how calls inside join the transaction (`join`) is
   *   built over the connection instead.
   */
  connection?: unknown;
  /**
   * The stack that opened the transaction, captured by the dialect before it
   * awaited anything, while a test harness observes escapes.
   */
  openedAt?: string;
}

/** Where a new frame sits: in a frame it joins, or as an outermost transaction. */
/**
 * What a dialect hands the base to run an outermost transaction: one attempt
 * at a time, and which of the errors that end one it retries of its own
 * accord.
 */
export interface TransactionAttempts<T> {
  /**
   * Runs attempt `attempt`: takes a connection, runs the transaction on it
   * (`runOutermost`, handed `openedAt`), and gives the connection back
   * before settling, so what was held runs where it holds none.
   */
  run(attempt: number, openedAt: string | undefined): Promise<Settled<T>>;
  /** Whether the dialect retries `error` itself: a serialization failure or a deadlock. */
  retryable(error: unknown): boolean;
  /** How a retry's log line names `error`, and what it records of it. */
  describe(error: unknown): { label: string; detail: Record<string, unknown> };
  /** The adapter's logger, if it was given one. */
  logger: AdapterLogger | undefined;
}

/** A frame that calls made inside it can join. */
export type JoinableFrame = TransactionFrame & { join: JoinSteps };

interface FramePlace {
  parent?: TransactionFrame;
  enclosing?: TransactionFrame;
  join: JoinSteps | undefined;
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
    rollbacks: 0,
    finished: false,
    writesAfterClosing: 0,
    held: [],
    rollbackHeld: [],
    doomed: undefined,
    queue: Promise.resolve(),
    open: parent ? parent.open : [],
    // A frame is opened only once its transaction holds its connection.
    connected: true,
    join: place.join,
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
): JoinableFrame | undefined {
  const frame = own?.active ? own : own?.open.at(-1);
  return frame !== undefined && isJoinable(frame) ? frame : undefined;
}

/** Whether calls made inside `frame` can join it. */
function isJoinable(frame: TransactionFrame): frame is JoinableFrame {
  return frame.join !== undefined;
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
