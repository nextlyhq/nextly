/**
 * seedApi — thin client for the setup card's sample-content step, over the
 * project's own route:
 * - HEAD /admin/api/seed — the probe: may THIS person load sample content?
 * - POST /admin/api/seed — start the site's one load, `{ confirm: true }` to
 *   load again after a failed one; answered in the mutation envelope, and
 *   refused with 409 in the error envelope when another load or an answer got
 *   there first.
 *
 * Whether the site has answered, and a load nobody has seen through, come
 * with the setup card's own data; declining and recording a load on its own
 * are core's (`PUT /api/dashboard/setup`), so neither reaches a route that
 * loads.
 *
 * The probe is a HEAD with no body, so it is asked with `fetch` itself; the
 * start goes through the admin's own client.
 */

import { isApiError } from "@admin/lib/api/parseApiError";
import { protectedApi } from "@admin/lib/api/protectedApi";
import { refreshAccessToken } from "@admin/lib/api/refreshInterceptor";
import type { MutationResponse } from "@admin/lib/api/response-types";
import { debugLog } from "@admin/lib/debug";

/**
 * The probe's answer. `available: false` alone is a definitive no: the route
 * refuses this person (401, 403), or the project has no such route (404, and
 * the answers below that say the same). With `unknown`, the route could not
 * say (a 5xx while it starts, any other 4xx, a network failure): nothing is
 * offered, but setup is not judged on it, and the probe is asked again.
 */
export type SeedProbeResult =
  | { available: false; unknown?: true }
  | { available: true; template: { slug: string; label: string } };

/** The answers that say no for good: no session, refused, or no sample content at all. */
const DEFINITIVE_NO = new Set([401, 403, 404]);

/**
 * Answers outside the route's contract that still say the project has no
 * route here: not served at this method (405), gone (410), not implemented
 * (501), and 400, which Nextly's admin API catch-all answered for a path it
 * does not serve before it answered 404 at this one. A HEAD carries no body
 * to tell that 400 from another, so every 400 is read as it. Any other 4xx
 * (408, 409, 425, 429, ...) may not hold on the next ask, so it stays "not
 * known" and is asked again.
 */
const NO_ROUTE = new Set([400, 405, 410, 501]);

/**
 * What starting a load came to, as this person is told it. Never a throw: a
 * load that could not be asked for is `failed` with why, so the card says so
 * and starts nothing on its own.
 */
export type SampleStartAnswer =
  /** Loaded and recorded. */
  | { outcome: "loaded" }
  /** Loaded, but recording that failed: `run` records it on its own. */
  | { outcome: "unrecorded"; run: string; startedAt: string }
  /** Claimed, but what came of it could not be confirmed: held as not finished. */
  | { outcome: "unfinished"; startedAt: string }
  | { outcome: "failed"; failure: string; startedAt?: string }
  /** Refused with nothing loaded: another load or an answer got there first. */
  | {
      outcome: "refused";
      reason: "answered" | "in-progress" | "unrecorded" | "confirm" | "other";
      message: string;
    };

/** The probe's full path, and the start's path under the admin's API. */
const PROBE_PATH = "/admin/api/seed";
const SEED_PATH = "/seed";

/**
 * A failed probe's answer. Read as "not known", a project with no route here
 * that answers one of `NO_ROUTE` held the step open as unreadable and asked
 * the probe again on every read of the card. Not the route's contract, so it
 * is said at debug level, once per load: unlike "not known", a no is not
 * asked again.
 */
function failedProbe(status: number): SeedProbeResult {
  if (DEFINITIVE_NO.has(status)) return { available: false };
  if (NO_ROUTE.has(status)) {
    debugLog(
      "seedApi",
      `HEAD ${PROBE_PATH} answered ${status}: read as no sample content.`
    );
    return { available: false };
  }
  return { available: false, unknown: true };
}

/**
 * The probe itself: a HEAD, which carries no body to say why it was refused.
 * Never answered from a cache: an answer kept from before the project added
 * its route, or before this person was allowed to load, would hide the offer.
 */
function headProbe(): Promise<Response> {
  return fetch(PROBE_PATH, {
    method: "HEAD",
    credentials: "include",
    cache: "no-store",
  });
}

/**
 * The probe's answer, after the admin's own session refresh where it was
 * refused for want of a session. A HEAD's 401 has no body, so the client's
 * interceptor cannot tell an expired access token from no session: the probe
 * asks for a refresh itself (the one in flight, if any), and asks again once
 * it lands. Only a 401 after that is a refusal; a refresh that could not be
 * made is not known.
 */
async function answeredProbe(): Promise<Response | "unknown"> {
  const first = await headProbe();
  if (first.status !== 401) return first;
  const refreshed = await refreshAccessToken();
  if (refreshed === "transient") return "unknown";
  return refreshed === "ok" ? headProbe() : first;
}

async function probe(): Promise<SeedProbeResult> {
  let res: Response | "unknown";
  try {
    res = await answeredProbe();
  } catch {
    return { available: false, unknown: true };
  }
  if (res === "unknown") return { available: false, unknown: true };
  // Offered only on a 2xx, because "available" means THIS person may load
  // sample content. The route answers the probe with the authorization its
  // POST enforces -- 401 without a session, 403 for anyone it refuses -- and
  // 404 where the project ships no sample content, 503 while it is still
  // starting. Read as "the endpoint exists", a refusal drew a button whose
  // every press fails, in place of an action the person could take. Every
  // other failure fails closed too: no answer is never a yes. But it is not a
  // no either: only a refusal or a missing route is (`failedProbe`).
  if (!res.ok) return failedProbe(res.status);
  // Template metadata from headers, so the offer names the template without
  // hardcoding it.
  const slug = res.headers.get("x-nextly-seed-template") ?? "unknown";
  const label = res.headers.get("x-nextly-seed-template-label") ?? "Template";
  return { available: true, template: { slug, label } };
}

const REFUSALS = ["answered", "in-progress", "unrecorded", "confirm"] as const;

/** What a load's item says: loaded, or loaded with its record still to make. */
type StartItem = {
  outcome?: unknown;
  run?: unknown;
  startedAt?: unknown;
};

/** A start that was not a success, from the error envelope: refused (409) with why, or failed with what failed. */
function notStarted(error: unknown): SampleStartAnswer {
  if (!isApiError(error)) {
    return { outcome: "failed", failure: "The server could not be reached." };
  }
  const data = (error.data ?? {}) as {
    reason?: unknown;
    failure?: unknown;
    startedAt?: unknown;
  };
  if (error.status === 409) {
    return {
      outcome: "refused",
      reason: REFUSALS.find(known => known === data.reason) ?? "other",
      message: error.message,
    };
  }
  return {
    outcome: "failed",
    failure: typeof data.failure === "string" ? data.failure : error.message,
    ...(typeof data.startedAt === "string"
      ? { startedAt: data.startedAt }
      : {}),
  };
}

/** A start that loaded, from the mutation's item: recorded, or not with the run that records it. */
function started(item: StartItem | undefined): SampleStartAnswer {
  if (
    item?.outcome === "unrecorded" &&
    typeof item.run === "string" &&
    typeof item.startedAt === "string"
  ) {
    return { outcome: "unrecorded", run: item.run, startedAt: item.startedAt };
  }
  if (item?.outcome === "unfinished" && typeof item.startedAt === "string") {
    return { outcome: "unfinished", startedAt: item.startedAt };
  }
  return { outcome: "loaded" };
}

/**
 * Starts the site's one load, through the admin's own client: the answer is
 * the mutation envelope, and a refusal or failure the error envelope. Asked
 * once: nothing here retries, as a second request could start a second load.
 */
async function start(confirm: boolean): Promise<SampleStartAnswer> {
  try {
    const answer = await protectedApi.post<MutationResponse<StartItem>>(
      SEED_PATH,
      confirm ? { confirm: true } : {}
    );
    return started(answer?.item);
  } catch (error) {
    return notStarted(error);
  }
}

/** The type of {@link seedApi}. */
type SeedApiType = {
  probe: typeof probe;
  start: typeof start;
};

export const seedApi: SeedApiType = { probe, start };
