"use client";

/**
 * The builder's start-up read, on the editor's side: the reads the builder
 * opens on, asked in one request as it opens, and handed to each read's own
 * hook or reader as it first asks.
 *
 * Every read keeps its own hook, its own cache and its own refresh. Only what
 * it asks AS THE BUILDER OPENS takes the start-up answer instead of sending a
 * request; a refresh, a retry, a mount once the builder is open, or a return
 * to the tab reads its route as it always has.
 *
 * ## When a read takes the start-up answer
 *
 * - the read was named in the start-up request under the same path its own
 *   route would be asked at: a read asked differently (in another language,
 *   say) asks its route;
 * - the start-up read is still on its way, or answered at most
 *   {@link STARTED_READ_HANDOFF_MS} ago: the answer was read for the builder
 *   opening, not for a panel opened later;
 * - its route answered it there: a read the start-up request could not answer
 *   (refused, failed, or the whole request failed) asks its route, so a
 *   refusal reaches the screen as the route words it;
 * - for the person it was read for. The start-up answer is one person's: it
 *   is dropped when the signed-in person changes or signs out and when the
 *   builder closes (the editor's `BuilderStartup` says so), and no hook or
 *   reader that knows who is asking is handed anything read for someone
 *   else.
 *
 * A reader (`readStarted`) takes an answer once, as a cache's first read,
 * unless that read is given up (a mount undone at once), when the next takes
 * it. A
 * hook (`useStartedAnswer`) shows it on every mount made while it is handed
 * out, as one cache entry would be, until that mount asks again.
 *
 * @module admin/startup-reads
 */
import { readPluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { useRef, useState, useSyncExternalStore } from "react";

import {
  builderStartupPath,
  type BuilderStartupAnswer,
  type BuilderStartupResponse,
} from "../builder-startup-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

/**
 * How long after the start-up read answered a first ask may still take it,
 * as the admin hands a page's started reads to the parts that mount with it.
 */
export const STARTED_READ_HANDOFF_MS = 2_000;

/** The start-up answers, by the path each read's own route answers at. */
type Answers = Readonly<Record<string, BuilderStartupAnswer>>;

/** Ask the start-up route for `reads`, each by its own route's path. */
export type AskStartup = (reads: readonly string[]) => Promise<Answers>;

async function askRoute(reads: readonly string[]): Promise<Answers> {
  const body = await readPluginRoute<BuilderStartupResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: builderStartupPath(reads),
  });
  return body?.reads ?? {};
}

/** One start-up request, for one person. */
interface Started {
  /**
   * Whom it was read for; `null` for one sent as the admin loaded, before
   * anyone asked, until the editor that opens first claims it.
   */
  userId: string | null;
  /** The reads it names, sorted, as one string. */
  readonly readsKey: string;
  readonly reads: ReadonlySet<string>;
  readonly answers: Promise<Answers | undefined>;
  readonly taken: Set<string>;
  /** What it answered, once it has; `null` when the request failed. */
  settled?: Answers | null;
  settledAt?: number;
}

let started: Started | undefined;
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Whether `entry` may still hand an answer to a first ask, at `now`. */
function handsOff(entry: Started, now: number): boolean {
  return (
    entry.settledAt === undefined ||
    now - entry.settledAt <= STARTED_READ_HANDOFF_MS
  );
}

/** Whether a start-up answer is its route's answer, with a body to take. */
function answered(answer: BuilderStartupAnswer | undefined): boolean {
  return answer !== undefined && answer.status >= 200 && answer.status < 300;
}

/**
 * Start the builder's start-up read for `reads`, as `userId`.
 *
 * Asked again with the same reads while one is still handing its answers
 * out, it starts nothing: the builder renders more than once as it opens. A
 * person no one knows starts nothing, and drops what was read for anyone.
 */
export function startBuilderReads(
  userId: string | null,
  reads: readonly string[],
  ask: AskStartup = askRoute,
  now: () => number = Date.now
): void {
  if (userId === null || reads.length === 0) {
    forgetStartedReads();
    return;
  }
  const readsKey = JSON.stringify([...reads].sort());
  if (started?.readsKey === readsKey && handsOff(started, now())) {
    // Sent as the admin loaded, for whoever opens the builder first: this
    // editor, whose person is the session's that sent it.
    if (started.userId === null) {
      started.userId = userId;
      changed();
    }
    if (started.userId === userId) return;
  }
  started = startedFor(userId, reads, readsKey, ask, now);
  changed();
}

/**
 * Send the builder's start-up read for `reads` as the admin loads, at an
 * address that opens the builder, before any editor asks: the first editor to
 * open with the same reads, while it still hands its answers out, takes it as
 * its own (`startBuilderReads`). Nothing is handed out before that.
 */
export function startEarlyBuilderReads(
  reads: readonly string[],
  ask: AskStartup = askRoute,
  now: () => number = Date.now
): void {
  if (reads.length === 0 || started !== undefined) return;
  started = startedFor(null, reads, JSON.stringify([...reads].sort()), ask, now);
  changed();
}

/** A start-up request for `reads`, sent now. */
function startedFor(
  userId: string | null,
  reads: readonly string[],
  readsKey: string,
  ask: AskStartup,
  now: () => number
): Started {
  const entry: Started = {
    userId,
    readsKey,
    reads: new Set(reads),
    taken: new Set(),
    answers: ask(reads).then(
      answers => answers,
      () => undefined
    ),
  };
  void entry.answers.then(answers => {
    entry.settled = answers ?? null;
    entry.settledAt = now();
    if (started === entry) changed();
  });
  return entry;
}

/** Drop the start-up answers: another person signed in, or nobody is. */
export function forgetStartedReads(): void {
  if (started === undefined) return;
  started = undefined;
  changed();
}

/** The start-up request that may hand `path` out now, for `userId`. */
function handingOut(
  path: string,
  userId: string | null | undefined,
  now: number
): Started | undefined {
  const entry = started;
  if (entry === undefined || !entry.reads.has(path)) return undefined;
  // Not yet claimed by an editor: whom it was read for is not known.
  if (entry.userId === null) return undefined;
  if (userId !== undefined && userId !== entry.userId) return undefined;
  return handsOff(entry, now) ? entry : undefined;
}

/**
 * Read `path`: its start-up answer when this is its first read as the
 * builder opens, and its route through `read` otherwise. With `userId`, an
 * answer read for anyone else is never taken.
 */
export function readStarted<T>(
  path: string,
  read: () => Promise<T>,
  userId?: string | null,
  now: () => number = Date.now,
  /** The ask's own signal: an ask given up hands the answer to the next. */
  signal?: AbortSignal
): Promise<T> {
  const entry = handingOut(path, userId, now());
  if (entry === undefined || entry.taken.has(path)) return read();
  entry.taken.add(path);
  signal?.addEventListener("abort", () => entry.taken.delete(path), {
    once: true,
  });
  return entry.answers.then(answers => {
    const answer = answers?.[path];
    return answered(answer) ? (answer?.body as T) : read();
  });
}

/** Where a hook's start-up answer stands. */
export type StartedAnswer<T> =
  | { readonly kind: "none" }
  | { readonly kind: "pending" }
  | { readonly kind: "answered"; readonly body: T };

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const NONE = { kind: "none" } as const;
const PENDING = { kind: "pending" } as const;

/**
 * The start-up answer for `path`, for a hook that would otherwise read its
 * route, as `userId`: `none` when there is none to take (the hook reads its
 * route), `pending` while it is on its way, `answered` once it arrived. A
 * mount that took an answer keeps it, for that person only, until it asks
 * again through `release`, after which it reads its route.
 */
export function useStartedAnswer<T>(
  path: string,
  enabled: boolean,
  userId: string | null
): { readonly answer: StartedAnswer<T>; readonly release: () => void } {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version
  );
  const [released, setReleased] = useState(false);
  const held = useRef<{ path: string; userId: string; body: T } | undefined>(
    undefined
  );
  const release = useRef(() => setReleased(true)).current;
  if (!enabled || released || userId === null) return { answer: NONE, release };
  if (held.current?.path === path && held.current.userId === userId) {
    return { answer: { kind: "answered", body: held.current.body }, release };
  }
  const entry = handingOut(path, userId, Date.now());
  if (entry === undefined) return { answer: NONE, release };
  if (entry.settled === undefined) return { answer: PENDING, release };
  const found = entry.settled?.[path];
  if (!answered(found)) return { answer: NONE, release };
  held.current = { path, userId, body: found?.body as T };
  return { answer: { kind: "answered", body: held.current.body }, release };
}

/** How many editors that send the start-up read are open. */
let openEditors = 0;

/**
 * Count one editor open while it is mounted, and drop the start-up answers
 * once none is: closing the builder, as signing out does, leaves nothing read
 * for its person. Dropped a moment after, so a mount undone and done again at
 * once (as a development build does) keeps what it sent.
 */
export function holdStartedReads(): () => void {
  openEditors += 1;
  return () => {
    openEditors -= 1;
    setTimeout(() => {
      if (openEditors === 0) forgetStartedReads();
    }, 0);
  };
}
