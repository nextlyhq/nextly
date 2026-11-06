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
 * - `seed.current`: the latest answer anyone started, a load or a decline, with
 *   its generation (1, 2, …) and its outcome. Every read of the site's answer
 *   is these three rows, however many loads were tried before.
 * - `seed.run.<n>`: a copy of each of the last few answers, for whoever looks
 *   into a failure; older ones are removed as new ones start. Nothing reads
 *   them to decide anything.
 *
 * A new answer is CLAIMED by one conditional write of `seed.current`: inserted
 * only where no row holds it, the first time, and afterwards moved only from
 * the failed load it was read as (`compareAndSet`). Two starts at the same
 * moment, on any dialect, cannot both make that write: the database decides,
 * not a read made before it. A claim is never released and never expires. A
 * load that reported neither success nor failure stays "unfinished" however
 * long ago it started, as it may still be running; only a failed load may be
 * claimed over, and only once a person confirms it.
 *
 * Only the run that claimed `seed.current` writes its outcome, and only over
 * its own claim. A store that cannot be read is said so to the caller, never
 * read as "nobody answered".
 *
 * The project's own route runs the load: it alone knows its content
 * (`templates/blog/src/app/admin/api/seed/route.ts`). It decides who may load
 * and hands the load here, which claims, loads and records.
 *
 * @module database/seeders/sample-content
 */

import { z } from "zod";

import { buildErrorResponse } from "../../api/error-response";
import { readBoundedBytes } from "../../api/read-json-body";
import { readOrGenerateRequestId } from "../../api/request-id";
import { respondMutation } from "../../api/response-shapes";
import type { SampleRun } from "../../domains/widgets/setup-steps";
import { NextlyError } from "../../errors/nextly-error";
import { getNextlyLogger } from "../../observability/logger";

/** The key recording that the content loaded. */
export const SAMPLE_LOADED_KEY = "seed.completedAt";
/** The key recording that somebody declined. */
const SAMPLE_DECLINED_KEY = "seed.skippedAt";
/** The key holding the latest answer anyone started: the one every read takes. */
const CURRENT_KEY = "seed.current";
/** The prefix of each answer's kept copy: `seed.run.1`, `seed.run.2`, … */
const RUN_PREFIX = "seed.run.";
/** How many answers' copies are kept, the latest among them. */
const KEPT_RUNS = 3;

/**
 * What a failed load says to the person, whatever the load threw. A loader's
 * own message can hold SQL, table names, paths or a provider's answer, so it
 * goes to the server's log alone (`sample-content-load-failed`). A load that
 * throws a `NextlyError` says its public message instead, which is safe by
 * that error's own contract.
 */
const LOAD_FAILED =
  "The sample content could not be loaded. The server log says what failed.";
/** What a record that could not be written says; the store's own error is logged. */
const RECORD_FAILED =
  "The sample content loaded, but the site could not record it.";

/** The slice of `MetaService` the site's answer is read and written through. */
export interface SampleContentStore {
  getEntry<T = unknown>(
    key: string
  ): Promise<{ present: true; value: T | null } | { present: false }>;
  insertIfAbsent(key: string, value: unknown): Promise<void>;
  compareAndSet(
    key: string,
    expected: unknown,
    next: unknown
  ): Promise<boolean>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** One answer, as `seed.current` holds it. */
interface RunRecord {
  /** Which answer this is, from 1. */
  generation: number;
  /** Who claimed it: a random token only the claiming request knows. */
  token: string;
  kind: "load" | "decline";
  /** When it was claimed, as an ISO 8601 instant. */
  startedAt: string;
  /** The id of the person who started it. */
  startedBy: string;
  /** A load's outcome; absent until it reports one. */
  outcome?: "loaded" | "failed";
  /** A failed load's stable code: what the server log names it by. */
  failureCode?: "load-failed";
  /** A failed load's words for the person: never the loader's own message. */
  failure?: string;
  finishedAt?: string;
}

/**
 * The latest answer: the record as read, and the value exactly as stored, which
 * a claim over it names so the write lands only on what was read.
 */
interface LatestRun {
  record: RunRecord;
  stored: unknown;
}

/** The site's answer to sample content, as every reader of it sees it. */
export interface SampleContentState {
  /** Loaded and recorded, or declined: the offer is closed for everyone. */
  answer?: "loaded" | "declined";
  /** When it was answered, as recorded, while `answer` is set. */
  answeredAt?: string;
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
  /**
   * Claimed, but what came of it could not be written or confirmed: the site
   * holds it as a load that has not finished, and so does this answer. Never
   * taken as ended, as every unfinished load is not.
   */
  | { outcome: "unfinished"; startedAt: string }
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

/** A thrown value's own message, for the server's log alone. */
function rawMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What a failed load says to the person: a `NextlyError`'s public message,
 * which is safe by contract, else the fixed words. The raw error is logged on
 * the server under `kind`, and never returned or stored.
 */
function publicFailure(error: unknown, kind: string, fallback: string): string {
  getNextlyLogger().error({ kind, reason: rawMessage(error) });
  return NextlyError.is(error) ? error.publicMessage : fallback;
}

function isRunRecord(value: unknown): value is RunRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<RunRecord>;
  return (
    typeof record.generation === "number" &&
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
 * The latest answer, from `seed.current`. A row that is not one is read as a
 * load that started at the epoch and never finished, so it holds the site
 * rather than being passed over.
 */
function latestOf(
  entry: { present: true; value: unknown } | { present: false }
): LatestRun | undefined {
  if (!entry.present) return undefined;
  const record: RunRecord = isRunRecord(entry.value)
    ? entry.value
    : {
        generation: 0,
        token: "",
        kind: "load",
        startedAt: new Date(0).toISOString(),
        startedBy: "",
      };
  return { record, stored: entry.value };
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

/** An answer, with when it was recorded where the row holds an instant. */
function answered(
  answer: "loaded" | "declined",
  entry: { present: true; value: unknown } | { present: false }
): SampleContentState {
  const at = entry.present ? entry.value : undefined;
  return typeof at === "string" ? { answer, answeredAt: at } : { answer };
}

/** The site's answer and its latest claim: three rows, read together. */
async function readAll(
  store: SampleContentStore
): Promise<{ state: SampleContentState; latest: LatestRun | undefined }> {
  const [loaded, declined, current] = await Promise.all([
    store.getEntry(SAMPLE_LOADED_KEY),
    store.getEntry(SAMPLE_DECLINED_KEY),
    store.getEntry(CURRENT_KEY),
  ]);
  const latest = latestOf(current);
  if (holds(loaded)) {
    return { state: answered("loaded", loaded), latest };
  }
  if (holds(declined)) {
    return { state: answered("declined", declined), latest };
  }
  if (latest?.record.kind === "decline") {
    return {
      state: { answer: "declined", answeredAt: latest.record.startedAt },
      latest,
    };
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
 * Keeps a copy of a claimed answer and removes the copy that falls out of the
 * last {@link KEPT_RUNS}. Best effort: the copies decide nothing, so a write
 * that fails here never fails the answer.
 */
async function keepCopy(
  store: SampleContentStore,
  record: RunRecord
): Promise<void> {
  try {
    await store.set(runKey(record.generation), record);
    const dropped = record.generation - KEPT_RUNS;
    if (dropped >= 1) await store.delete(runKey(dropped));
  } catch {
    // Only the copy is lost: `seed.current` holds the answer.
  }
}

/**
 * Claims the next answer over `latest` with ONE conditional write of
 * `seed.current`, answering the claimed record when this request holds it. The
 * first is inserted only where no row holds the key, and read back to see
 * whose it is; each later one replaces the record only while it still holds
 * the value read, so of two claims at once exactly one lands.
 */
async function claim(
  store: SampleContentStore,
  latest: LatestRun | undefined,
  start: Omit<RunRecord, "generation">
): Promise<
  { claimed: RunRecord } | { lost: true } | { unverified: RunRecord }
> {
  const record: RunRecord = {
    generation: (latest?.record.generation ?? 0) + 1,
    ...start,
  };
  let won: boolean;
  if (latest === undefined) {
    await store.insertIfAbsent(CURRENT_KEY, record);
    let held: Awaited<ReturnType<SampleContentStore["getEntry"]>>;
    try {
      held = await again(() => store.getEntry(CURRENT_KEY));
    } catch {
      // Inserted, perhaps, and not confirmed: what the site holds may be this
      // claim, which nobody would ever finish. Nothing is loaded on it, and it
      // is answered as the site would read it then, a load not finished.
      return { unverified: record };
    }
    // The whole record, not a field of it: the row this request inserted, and
    // no other, holds every one of its values.
    won = held.present && JSON.stringify(held.value) === JSON.stringify(record);
  } else {
    won = await store.compareAndSet(CURRENT_KEY, latest.stored, record);
  }
  if (!won) return { lost: true };
  await keepCopy(store, record);
  return { claimed: record };
}

/** `work`, asked once more if it throws: a read or write that may fail for a moment. */
async function again<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    return work();
  }
}

/**
 * Writes a claimed load's outcome over its own claim, and its copy. Moved only
 * from the record this run claimed, so it can never land on a later answer.
 * Answers whether it was written.
 */
async function writeOutcome(
  store: SampleContentStore,
  claimed: RunRecord,
  finished: RunRecord
): Promise<boolean> {
  try {
    const written = await again(() =>
      store.compareAndSet(CURRENT_KEY, claimed, finished)
    );
    if (written) await keepCopy(store, finished);
    return written;
  } catch {
    return false;
  }
}

/**
 * Records that the content loaded: the claim's outcome, then the site-wide
 * record the offer closes on. The outcome is written first and on its own, so
 * a record that fails leaves "loaded, not recorded" for anyone to record,
 * never "unfinished" or "failed".
 */
async function recordLoaded(
  store: SampleContentStore,
  claimed: RunRecord,
  now: () => Date
): Promise<{ recorded: true } | { recorded: false; failure: string }> {
  if (claimed.outcome === undefined) {
    // Not written, the claim reads as unfinished, which starts nothing else;
    // the site-wide record below still closes the offer.
    await writeOutcome(store, claimed, {
      ...claimed,
      outcome: "loaded",
      finishedAt: now().toISOString(),
    });
  }
  // Stamped only where no row holds it, then read back: two records of the
  // same load at once both find it recorded, whichever wrote it, and a write
  // that failed on the other's row is no failure.
  let failed: unknown;
  try {
    await store.insertIfAbsent(SAMPLE_LOADED_KEY, now().toISOString());
  } catch (error) {
    failed = error;
  }
  const stamped = await store
    .getEntry(SAMPLE_LOADED_KEY)
    .catch((): { present: false } => ({ present: false }));
  if (holds(stamped)) return { recorded: true };
  return {
    recorded: false,
    failure: publicFailure(
      failed ?? "seed.completedAt was not written",
      "sample-content-unrecorded",
      RECORD_FAILED
    ),
  };
}

/**
 * A start refused after this request's claim lost to someone else's, saying
 * why from the winner's answer as it reads now, through the same decision a
 * start is refused by: still loading, failed (confirm to load again), loaded
 * but not recorded (record it), or answered. A winner that left nothing to
 * refuse on is still the reason this one did not start: a load in progress.
 */
async function lostClaim(store: SampleContentStore): Promise<SampleRefusal> {
  const state = await readSampleContent(store);
  return {
    outcome: "refused",
    reason: blocked(state, false) ?? "in-progress",
    state,
  };
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
  }
): Promise<SampleStart<Result>> {
  const now = options.now ?? (() => new Date());
  const { state, latest } = await readAll(store);
  const reason = blocked(state, options.confirm === true);
  if (reason !== undefined) return { outcome: "refused", reason, state };

  const claiming = await claim(store, latest, {
    // Minted here for each start, never named by a caller: two starts can
    // never claim with the same one.
    token: crypto.randomUUID(),
    kind: "load",
    startedAt: now().toISOString(),
    startedBy: options.by,
  });
  if ("lost" in claiming) return lostClaim(store);
  if ("unverified" in claiming) {
    return { outcome: "unfinished", startedAt: claiming.unverified.startedAt };
  }
  const claimed = claiming.claimed;

  let result: Result;
  try {
    result = await options.load();
  } catch (error) {
    const failure = publicFailure(
      error,
      "sample-content-load-failed",
      LOAD_FAILED
    );
    const written = await writeOutcome(store, claimed, {
      ...claimed,
      outcome: "failed",
      failureCode: "load-failed",
      failure,
      finishedAt: now().toISOString(),
    });
    // Not written, the site holds the load as unfinished, and starts nothing
    // else, as nobody can tell it apart from one still running: answered as it
    // is held, so the card offers nothing the server would refuse.
    return written
      ? { outcome: "failed", failure, startedAt: claimed.startedAt }
      : { outcome: "unfinished", startedAt: claimed.startedAt };
  }

  const recorded = await recordLoaded(store, claimed, now);
  return recorded.recorded
    ? { outcome: "loaded", result }
    : {
        outcome: "unrecorded",
        result,
        run: claimed.token,
        startedAt: claimed.startedAt,
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
  const recorded = await recordLoaded(store, latest.record, now);
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
 * load, on the same row, so a decline and a load started at the same moment
 * cannot both be taken: whichever claims first is the site's answer. Refused
 * once it is loaded, while a load is unfinished or unrecorded, and when
 * another claim lands first; declining again answers that it is.
 */
export async function declineSampleContent(
  store: SampleContentStore,
  options: { by: string; now?: () => Date }
): Promise<SampleDecline> {
  const now = options.now ?? (() => new Date());
  const { state, latest } = await readAll(store);
  if (state.answer === "declined") return { outcome: "declined" };
  // A failed load may be declined: nobody has to be told "load again" first.
  const reason = blocked(state, true);
  if (reason !== undefined) return { outcome: "refused", reason, state };

  const at = now().toISOString();
  const claimed = await claim(store, latest, {
    token: crypto.randomUUID(),
    kind: "decline",
    startedAt: at,
    startedBy: options.by,
  });
  if (!("claimed" in claimed)) {
    // Lost, or not confirmed: answered from the site's answer as it reads now.
    const lost = await lostClaim(store);
    return lost.state.answer === "declined" ? { outcome: "declined" } : lost;
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
 * A refusal as the error every route answers with: a conflict, as the site's
 * answer has moved on from what the person saw, saying why in `data.reason`.
 */
export function sampleRefusalError(refusal: SampleRefusal): NextlyError {
  return new NextlyError({
    code: "CONFLICT",
    publicMessage: SAMPLE_REFUSAL_MESSAGE[refusal.reason],
    publicData: {
      reason: refusal.reason,
      ...(refusal.state.run === undefined
        ? {}
        : { startedAt: refusal.state.run.startedAt }),
    },
    logContext: { reason: "sample-content-refused", sample: refusal.reason },
  });
}

/**
 * A start's outcome as the project's route answers it: the mutation envelope,
 * `{ message, item }`, with the outcome as the item when it loaded (recorded
 * or not, as the item says); the error envelope otherwise, a conflict for a
 * refusal and an internal error carrying what failed for a failed load, which
 * the person who started it is told.
 */
function startAnswer<Result>(start: SampleStart<Result>): Response {
  switch (start.outcome) {
    case "loaded":
      return respondMutation("Sample content loaded.", start);
    case "unrecorded":
      return respondMutation(
        "Sample content loaded, but recording that failed.",
        start
      );
    case "unfinished":
      return respondMutation(
        "A sample-content load started and has not finished.",
        start
      );
    case "failed":
      throw new NextlyError({
        code: "INTERNAL_ERROR",
        publicMessage: "Loading sample content failed.",
        publicData: {
          reason: "failed",
          failure: start.failure,
          startedAt: start.startedAt,
        },
        logContext: {
          reason: "sample-content-failed",
          failure: start.failure,
        },
      });
    case "refused":
      throw sampleRefusalError(start);
  }
}

/** The largest start body read, in bytes: `{ "confirm": true }` and little else. */
const MAX_START_BODY_BYTES = 512;

/** What a POST to the project's route may ask: whether to load again after a failure. */
const startBody = z.object({ confirm: z.boolean().optional() }).strict();

function invalidStartBody(): NextlyError {
  return NextlyError.invalidInput({
    message: 'The body must be empty, `{}` or `{ "confirm": true }`.',
  });
}

/**
 * Whether a POST to the project's route confirms loading again after a
 * failed load. Read through the bounded reader, so a body past the cap is
 * refused at the cap, counted in bytes, without being buffered whole. No
 * body, or an empty one, is a first start, as older admins send.
 */
async function confirmedIn(request: Request): Promise<boolean> {
  const bytes = await readBoundedBytes(request, MAX_START_BODY_BYTES, {
    route: "sample-content",
  });
  const text = bytes === undefined ? "" : new TextDecoder().decode(bytes);
  if (text.trim() === "") return false;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw invalidStartBody();
  }
  const parsed = startBody.safeParse(body);
  if (!parsed.success) throw invalidStartBody();
  return parsed.data.confirm === true;
}

/**
 * The whole POST of a project's sample-content route, once the route has
 * decided the person may load: reads whether they confirmed loading again,
 * starts the load, and answers in the canonical envelopes. Recording a load
 * on its own and declining are core's (`PUT /api/dashboard/setup`), so they
 * never reach a route that loads.
 */
export async function sampleContentPost<Result>(
  request: Request,
  options: {
    store: SampleContentStore;
    by: string;
    load: () => Promise<Result>;
  }
): Promise<Response> {
  try {
    const confirm = await confirmedIn(request);
    return startAnswer(
      await startSampleContent(options.store, {
        by: options.by,
        confirm,
        load: options.load,
      })
    );
  } catch (error) {
    if (!NextlyError.is(error)) throw error;
    return buildErrorResponse(error, {
      requestId: readOrGenerateRequestId(request),
    });
  }
}

/**
 * The project's sample-content route, as a path under the admin's API
 * (`/admin/api/seed`): the admin's setup card asks it with a HEAD whether
 * this person may load sample content, and POSTs to it to start the load.
 */
const SAMPLE_CONTENT_SEGMENT = "seed";

/** Whether a path under the admin's API is the project's sample-content route. */
export function isSampleContentPath(params: readonly string[]): boolean {
  return params.length === 1 && params[0] === SAMPLE_CONTENT_SEGMENT;
}

/**
 * Core's answer at the sample-content route where the project ships none:
 * its own route file (the blog template's) is matched before the admin API's
 * catch-all, so a request reaching the catch-all there names a route the
 * project does not have. 404, which the setup card reads as "no sample
 * content here" and does not ask again. Answered as the built-in router's
 * invalid-route 400 before, which the card could read only as "not known":
 * the step stayed open as unreadable and the probe was asked again on every
 * read of the card. A HEAD, the card's probe, is answered with no body.
 *
 * Never stored: a 404 is cacheable by default, and a kept one would hide the
 * route a project adds at this address later, from the browser and from any
 * shared cache between it and the site.
 */
export function sampleContentNotShipped(request: Request): Response {
  const answer = buildErrorResponse(
    NextlyError.notFound({
      message: "This project ships no sample content.",
      logContext: { reason: "no-sample-content-route" },
    }),
    { requestId: readOrGenerateRequestId(request) }
  );
  answer.headers.set("Cache-Control", "no-store");
  // The envelope's status and headers, without its body.
  return request.method === "HEAD"
    ? new Response(null, { status: answer.status, headers: answer.headers })
    : answer;
}
