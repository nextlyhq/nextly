/**
 * Sample content for the whole site: whether anyone loaded or declined it, and
 * the one load that may run at a time, whichever tab, session or person starts
 * it (`dashboard-layout` R-18 and R-19).
 *
 * Kept in `nextly_meta`, the site-wide store every server instance reads, so
 * nothing here needs a table of its own:
 *
 * - `seed.completedAt`: the content loaded and that was recorded. Written last,
 *   on its own, so "loaded but not recorded" is a state the site can be in and
 *   recover from without loading again.
 * - `seed.skippedAt`: somebody declined.
 * - `seed.run.<n>`: the n-th answer anyone started, from 1: a load, or a
 *   decline. Each is CLAIMED by inserting its key only where no row holds it
 *   (`insertIfAbsent`) and reading the row back to see whose it is, so two
 *   starts at the same moment, on any dialect, give the key to exactly one:
 *   the database's primary key decides, not a read made before the write. The
 *   claim is never released and never expires. A load that reported neither
 *   success nor failure stays "unfinished" however long ago it started, as it
 *   may still be running; only a failed load lets the next key be claimed, and
 *   only once a person confirms it.
 *
 * Only the run that claimed a key writes its outcome. A store that cannot be
 * read is said so to the caller, never read as "nobody answered".
 *
 * The project's own route runs the load: it alone knows its content
 * (`templates/blog/src/app/admin/api/seed/route.ts`). It decides who may load
 * and hands the load here, which claims, loads and records.
 *
 * @module database/seeders/sample-content
 */

import { z } from "zod";

import type { SampleRun } from "../../domains/widgets/setup-steps";
import { NEXTLY_ERROR_STATUS } from "../../errors/error-codes";

/** The key recording that the content loaded. */
export const SAMPLE_LOADED_KEY = "seed.completedAt";
/** The key recording that somebody declined. */
export const SAMPLE_DECLINED_KEY = "seed.skippedAt";
/** The prefix of each answer's claim: `seed.run.1`, `seed.run.2`, … */
const RUN_PREFIX = "seed.run.";

/** What a failure's message is cut to: enough to say what failed. */
const MAX_FAILURE_LENGTH = 500;

/** The slice of `MetaService` the site's answer is read and written through. */
export interface SampleContentStore {
  getEntry<T = unknown>(
    key: string
  ): Promise<{ present: true; value: T | null } | { present: false }>;
  insertIfAbsent(key: string, value: unknown): Promise<void>;
  set(key: string, value: unknown): Promise<void>;
}

/** One claim, as `seed.run.<n>` holds it. */
interface RunRecord {
  /** Who claimed it: a random token only the claiming request knows. */
  token: string;
  kind: "load" | "decline";
  /** When it was claimed, as an ISO 8601 instant. */
  startedAt: string;
  /** The id of the person who started it. */
  startedBy: string;
  /** A load's outcome; absent until it reports one. */
  outcome?: "loaded" | "failed";
  failure?: string;
  finishedAt?: string;
}

/** The latest claim and which one it is. */
interface LatestRun {
  generation: number;
  record: RunRecord;
}

/** The site's answer to sample content, as every reader of it sees it. */
export interface SampleContentState {
  /** Loaded and recorded, or declined: the offer is closed for everyone. */
  answer?: "loaded" | "declined";
  /** While nobody has answered: a load started and not seen through. */
  run?: SampleRun;
}

/** What starting a load came to. */
export type SampleStart<Result> =
  | { outcome: "loaded"; result: Result }
  /** Loaded, but recording that failed: `run` records it on its own. */
  | {
      outcome: "unrecorded";
      result: Result;
      run: string;
      startedAt: string;
      failure: string;
    }
  | { outcome: "failed"; failure: string; startedAt: string }
  | SampleRefusal;

/** Why a start, a decline or a record was refused, with the site's answer now. */
export type SampleRefusal = {
  outcome: "refused";
  reason:
    | "answered"
    | "in-progress"
    | "unrecorded"
    | "confirm"
    | "not-this-run";
  state: SampleContentState;
};

/** What recording a load on its own came to. */
export type SampleRecord =
  | { outcome: "loaded" }
  | { outcome: "unrecorded"; run: string; startedAt: string; failure: string }
  | SampleRefusal;

/** What declining came to. */
export type SampleDecline = { outcome: "declined" } | SampleRefusal;

function runKey(generation: number): string {
  return `${RUN_PREFIX}${generation}`;
}

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MAX_FAILURE_LENGTH
    ? `${message.slice(0, MAX_FAILURE_LENGTH - 1)}…`
    : message;
}

function isRunRecord(value: unknown): value is RunRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<RunRecord>;
  return (
    typeof record.token === "string" &&
    (record.kind === "load" || record.kind === "decline") &&
    typeof record.startedAt === "string"
  );
}

/** Whether a key holds a value that records something: a present, non-empty row. */
function holds(
  entry: { present: true; value: unknown } | { present: false }
): boolean {
  return entry.present && entry.value !== null && entry.value !== "";
}

/**
 * The latest claim, read from `seed.run.1` upward until a key holds none. Few
 * ever exist: one per load or decline anyone started, and a second load only
 * after a failure someone confirmed. A row that is not a claim is read as one
 * that started now and never finished, so it holds the site rather than being
 * passed over.
 */
async function latestRun(
  store: SampleContentStore
): Promise<LatestRun | undefined> {
  let latest: LatestRun | undefined;
  for (let generation = 1; ; generation += 1) {
    const entry = await store.getEntry(runKey(generation));
    if (!entry.present) return latest;
    latest = {
      generation,
      record: isRunRecord(entry.value)
        ? entry.value
        : {
            token: "",
            kind: "load",
            startedAt: new Date(0).toISOString(),
            startedBy: "",
          },
    };
  }
}

/** A load's claim as the card shows it, or none once it is answered. */
function runView(latest: LatestRun | undefined): SampleRun | undefined {
  if (latest === undefined || latest.record.kind !== "load") return undefined;
  const { record } = latest;
  if (record.outcome === "failed") {
    return {
      state: "failed",
      startedAt: record.startedAt,
      failure: record.failure ?? "The load failed.",
    };
  }
  if (record.outcome === "loaded") {
    return {
      state: "unrecorded",
      startedAt: record.startedAt,
      run: record.token,
    };
  }
  return { state: "unfinished", startedAt: record.startedAt };
}

/** The site's answer and its latest claim, read together. */
async function readAll(
  store: SampleContentStore
): Promise<{ state: SampleContentState; latest: LatestRun | undefined }> {
  const [loaded, declined, latest] = await Promise.all([
    store.getEntry(SAMPLE_LOADED_KEY),
    store.getEntry(SAMPLE_DECLINED_KEY),
    latestRun(store),
  ]);
  if (holds(loaded)) return { state: { answer: "loaded" }, latest };
  if (holds(declined) || latest?.record.kind === "decline") {
    return { state: { answer: "declined" }, latest };
  }
  const run = runView(latest);
  return { state: run === undefined ? {} : { run }, latest };
}

/**
 * The site's answer to sample content: loaded, declined, a load not seen
 * through, or nothing yet. Rejects when the store cannot be read, which every
 * caller treats as "cannot tell", never as "unanswered".
 */
export async function readSampleContent(
  store: SampleContentStore
): Promise<SampleContentState> {
  return (await readAll(store)).state;
}

/** Why a new claim may not be made over the latest one, or none when it may. */
function blocked(
  state: SampleContentState,
  confirmed: boolean
): SampleRefusal["reason"] | undefined {
  if (state.answer !== undefined) return "answered";
  const run = state.run;
  if (run === undefined) return undefined;
  if (run.state === "unfinished") return "in-progress";
  if (run.state === "unrecorded") return "unrecorded";
  return confirmed ? undefined : "confirm";
}

/**
 * Claims the key after `latest` for `record`, answering whether this request
 * holds it: inserted only where no row holds it, then read back, so of two
 * claims at once exactly one finds its own token there.
 */
async function claim(
  store: SampleContentStore,
  latest: LatestRun | undefined,
  record: RunRecord
): Promise<number | undefined> {
  const generation = (latest?.generation ?? 0) + 1;
  const key = runKey(generation);
  await store.insertIfAbsent(key, record);
  const held = await store.getEntry(key);
  return held.present &&
    isRunRecord(held.value) &&
    held.value.token === record.token
    ? generation
    : undefined;
}

async function refusal(
  store: SampleContentStore,
  reason: SampleRefusal["reason"]
): Promise<SampleRefusal> {
  return { outcome: "refused", reason, state: await readSampleContent(store) };
}

/**
 * Records that the content loaded: the claim's outcome, then the site-wide
 * record the offer closes on. The outcome is written first and on its own, so
 * a record that fails leaves "loaded, not recorded" for anyone to record,
 * never "unfinished" or "failed".
 */
async function recordLoaded(
  store: SampleContentStore,
  generation: number,
  record: RunRecord,
  now: () => Date
): Promise<{ recorded: true } | { recorded: false; failure: string }> {
  try {
    await store.set(runKey(generation), {
      ...record,
      outcome: "loaded",
      finishedAt: now().toISOString(),
    } satisfies RunRecord);
  } catch {
    // The site-wide record below still closes the offer; without it too, the
    // claim reads as unfinished, which starts nothing else.
  }
  try {
    await store.set(SAMPLE_LOADED_KEY, now().toISOString());
    return { recorded: true };
  } catch (error) {
    return { recorded: false, failure: messageOf(error) };
  }
}

/**
 * Starts loading sample content for the site, and loads it only when this
 * request holds the site's one load.
 *
 * Refused, with nothing loaded, when someone already loaded or declined it,
 * when a load is unfinished or loaded without being recorded, and after a
 * failed load unless `confirm` says the person was told some of it may
 * already be there. Never retried here: a failure is reported, and the next
 * load is the person's call.
 */
export async function startSampleContent<Result>(
  store: SampleContentStore,
  options: {
    /** The id of the person starting it. */
    by: string;
    /** That the person confirmed loading again after a failed load. */
    confirm?: boolean;
    /** The project's own load. */
    load: () => Promise<Result>;
    now?: () => Date;
    /** The claim's token; random unless a test names it. */
    token?: string;
  }
): Promise<SampleStart<Result>> {
  const now = options.now ?? (() => new Date());
  const { state, latest } = await readAll(store);
  const reason = blocked(state, options.confirm === true);
  if (reason !== undefined) return { outcome: "refused", reason, state };

  const record: RunRecord = {
    token: options.token ?? crypto.randomUUID(),
    kind: "load",
    startedAt: now().toISOString(),
    startedBy: options.by,
  };
  const generation = await claim(store, latest, record);
  if (generation === undefined) {
    // Someone else's claim landed first: a load, or a decline.
    const after = await readSampleContent(store);
    return {
      outcome: "refused",
      reason: after.answer !== undefined ? "answered" : "in-progress",
      state: after,
    };
  }

  let result: Result;
  try {
    result = await options.load();
  } catch (error) {
    const failure = messageOf(error);
    try {
      await store.set(runKey(generation), {
        ...record,
        outcome: "failed",
        failure,
        finishedAt: now().toISOString(),
      } satisfies RunRecord);
    } catch {
      // Not written, the load reads as unfinished: it starts nothing else, as
      // nobody can tell it apart from one still running.
    }
    return { outcome: "failed", failure, startedAt: record.startedAt };
  }

  const recorded = await recordLoaded(store, generation, record, now);
  return recorded.recorded
    ? { outcome: "loaded", result }
    : {
        outcome: "unrecorded",
        result,
        run: record.token,
        startedAt: record.startedAt,
        failure: recorded.failure,
      };
}

/**
 * Records a load that loaded but could not be recorded, without loading
 * again. `run` names the load: the one the site's latest claim holds, or the
 * request that loaded it would not have been told it. Recording one already
 * recorded answers that it is.
 */
export async function recordSampleContent(
  store: SampleContentStore,
  options: { run: string; now?: () => Date }
): Promise<SampleRecord> {
  const now = options.now ?? (() => new Date());
  const { state, latest } = await readAll(store);
  if (state.answer === "loaded") return { outcome: "loaded" };
  if (state.answer !== undefined) {
    return { outcome: "refused", reason: "answered", state };
  }
  if (
    latest === undefined ||
    latest.record.kind !== "load" ||
    latest.record.token !== options.run ||
    latest.record.outcome === "failed"
  ) {
    return { outcome: "refused", reason: "not-this-run", state };
  }
  const recorded = await recordLoaded(
    store,
    latest.generation,
    latest.record,
    now
  );
  return recorded.recorded
    ? { outcome: "loaded" }
    : {
        outcome: "unrecorded",
        run: latest.record.token,
        startedAt: latest.record.startedAt,
        failure: recorded.failure,
      };
}

/**
 * Declines sample content for the whole site. A decline is a claim like a
 * load, on the same keys, so a decline and a load started at the same moment
 * cannot both be taken: whichever claims first is the site's answer. Refused
 * once it is loaded, while a load is unfinished or unrecorded, and when
 * another claim lands first; declining again answers that it is.
 */
export async function declineSampleContent(
  store: SampleContentStore,
  options: { by: string; now?: () => Date; token?: string }
): Promise<SampleDecline> {
  const now = options.now ?? (() => new Date());
  const { state, latest } = await readAll(store);
  if (state.answer === "declined") return { outcome: "declined" };
  // A failed load may be declined: nobody has to be told "load again" first.
  const reason = blocked(state, true);
  if (reason !== undefined) return { outcome: "refused", reason, state };

  const at = now().toISOString();
  const generation = await claim(store, latest, {
    token: options.token ?? crypto.randomUUID(),
    kind: "decline",
    startedAt: at,
    startedBy: options.by,
  });
  if (generation === undefined) {
    const after = await readSampleContent(store);
    if (after.answer === "declined") return { outcome: "declined" };
    return refusal(store, after.answer ? "answered" : "in-progress");
  }
  try {
    // The claim already answers for the site; this keeps the key older readers know.
    await store.set(SAMPLE_DECLINED_KEY, at);
  } catch {
    // The claim holds the decline: every reader here reads it.
  }
  return { outcome: "declined" };
}

/** What each refusal says, for the person who asked. */
export const SAMPLE_REFUSAL_MESSAGE: Record<SampleRefusal["reason"], string> = {
  answered: "Someone has already loaded or declined sample content.",
  "in-progress": "A sample-content load is already in progress.",
  unrecorded:
    "Sample content already loaded, but recording that failed. Record it instead of loading again.",
  confirm:
    "The last load failed, and some sample content may already be there. Confirm to load again.",
  "not-this-run": "That load is not the one waiting to be recorded.",
};

/**
 * A start's outcome as the project's route answers it: 200 when it loaded
 * (recorded or not, as the body says), 500 when it failed, 409 when it was
 * refused. A body that is not a success carries `errors`, as every route
 * here answers a failure.
 */
export function sampleStartResponse<Result>(
  start: SampleStart<Result>
): Response {
  switch (start.outcome) {
    case "loaded":
    case "unrecorded":
      return Response.json(start);
    case "failed":
      return Response.json(
        { ...start, errors: [{ message: start.failure }] },
        { status: NEXTLY_ERROR_STATUS.INTERNAL_ERROR }
      );
    case "refused":
      // A conflict: the site's answer has moved on from what the person saw.
      return Response.json(
        {
          ...start,
          errors: [{ message: SAMPLE_REFUSAL_MESSAGE[start.reason] }],
        },
        { status: NEXTLY_ERROR_STATUS.CONFLICT }
      );
  }
}

/** The largest start body read: `{ "confirm": true }` and little else. */
const MAX_START_BODY_BYTES = 512;

/** What a POST to the project's route may ask: whether to load again after a failure. */
const startBody = z.object({ confirm: z.boolean().optional() }).strict();

/**
 * Whether a POST to the project's route confirms loading again after a
 * failed load, or `undefined` when its body is not one it takes. No body, or
 * an empty one, is a first start, as older admins send.
 */
async function confirmedIn(request: Request): Promise<boolean | undefined> {
  const text = await request.text().catch(() => "");
  if (text.trim() === "") return false;
  if (text.length > MAX_START_BODY_BYTES) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = startBody.safeParse(body);
  return parsed.success ? parsed.data.confirm === true : undefined;
}

/**
 * The whole POST of a project's sample-content route, once the route has
 * decided the person may load: reads whether they confirmed loading again,
 * starts the load, and answers. Recording a load on its own and declining are
 * core's (`PUT /api/dashboard/setup`), so they never reach a route that loads.
 */
export async function sampleContentPost<Result>(
  request: Request,
  options: {
    store: SampleContentStore;
    by: string;
    load: () => Promise<Result>;
  }
): Promise<Response> {
  const confirm = await confirmedIn(request);
  if (confirm === undefined) {
    return Response.json(
      {
        errors: [
          { message: 'The body must be empty or `{ "confirm": true }`.' },
        ],
      },
      { status: NEXTLY_ERROR_STATUS.INVALID_INPUT }
    );
  }
  return sampleStartResponse(
    await startSampleContent(options.store, {
      by: options.by,
      confirm,
      load: options.load,
    })
  );
}
