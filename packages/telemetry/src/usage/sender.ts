import { TELEMETRY_ENDPOINT } from "../constants.js";

import { TRANSPORT_PROPERTIES } from "./catalog.js";

// One small sender in place of an analytics SDK: a single HTTPS POST of
// PostHog's batch format to Nextly's ingest address. It carries no project
// token: the ingest address holds the tokens and picks the project from the
// `project` mark ("production" or "test"), so a project can change without a
// release and nothing in the bundle can write to it directly.
//
// It never slows or breaks a run. All of one sender's flushes together wait
// at most `timeoutMs` (2 seconds unless a caller passes less), however often
// a run flushes and however the network behaves: each flush may only use what
// earlier flushes left, and once that is spent a flush neither waits nor
// sends, since the address has already failed to answer in time. A flush
// never rejects and writes nothing to standard output or standard error. A
// sender is only ever created once a guard has said usage data is on, so a
// run that is off never reaches `fetch` at all.

/** One event as PostHog's batch endpoint reads it. */
export interface WireEvent {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

/** Which PostHog project the ingest address forwards to. */
export type UsageProject = "production" | "test";

/** The longest all of a run's flushes may wait together, in milliseconds. */
const SEND_BUDGET_MS = 2000;

export interface SenderOptions {
  project: UsageProject;
  /** Defaults to Nextly's ingest address. */
  endpoint?: string;
  /** Capped at `SEND_BUDGET_MS`. */
  timeoutMs?: number;
  /** For tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export interface Sender {
  /** Queues an event already checked against the catalog. */
  enqueue(event: WireEvent): void;
  /** Sends what is queued in one request. Never rejects. */
  flush(): Promise<void>;
}

/**
 * The request body for a batch: the events, with the transport flags. The
 * event's id is given both beside the event, as PostHog's SDKs send it, and
 * inside its properties, as PostHog's batch endpoint documents it, so the
 * batch reads the same way to either.
 */
function batchBody(project: UsageProject, events: WireEvent[]): string {
  return JSON.stringify({
    project,
    batch: events.map(e => ({
      ...e,
      properties: {
        ...e.properties,
        distinct_id: e.distinct_id,
        ...TRANSPORT_PROPERTIES,
      },
    })),
  });
}

export function createSender(opts: SenderOptions): Sender {
  const endpoint = opts.endpoint ?? TELEMETRY_ENDPOINT;
  const doFetch = opts.fetch ?? globalThis.fetch;
  let queue: WireEvent[] = [];
  // What is left of the run's waiting time, spent by each flush in turn.
  let remaining = Math.min(opts.timeoutMs ?? SEND_BUDGET_MS, SEND_BUDGET_MS);

  async function flush(): Promise<void> {
    if (queue.length === 0) return;
    const events = queue;
    queue = [];
    if (remaining <= 0) return;

    const started = performance.now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outOfTime = new Promise<void>(resolve => {
      timer = setTimeout(() => {
        controller.abort();
        resolve();
      }, remaining);
      // A pending send must never keep the process alive on its own.
      timer.unref?.();
    });

    let request: Promise<void>;
    try {
      request = doFetch(new URL("batch/", endpoint), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: batchBody(opts.project, events),
        signal: controller.signal,
      }).then(
        // The answer is not needed; release its body so the socket frees.
        response => response.body?.cancel().catch(() => undefined),
        () => undefined
      );
    } catch {
      // A fetch that throws before it returns (no network stack, bad URL).
      request = Promise.resolve();
    }

    try {
      await Promise.race([request, outOfTime]);
    } finally {
      clearTimeout(timer);
      remaining -= performance.now() - started;
    }
  }

  return {
    enqueue(event) {
      queue.push(event);
    },
    flush,
  };
}
