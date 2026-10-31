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
import type { MutationResponse } from "@admin/lib/api/response-types";

export type SeedProbeResult =
  | { available: false }
  | { available: true; template: { slug: string; label: string } };

/**
 * What starting a load came to, as this person is told it. Never a throw: a
 * load that could not be asked for is `failed` with why, so the card says so
 * and starts nothing on its own.
 */
type SampleStartAnswer =
  /** Loaded and recorded. */
  | { outcome: "loaded" }
  /** Loaded, but recording that failed: `run` records it on its own. */
  | { outcome: "unrecorded"; run: string; startedAt: string }
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

async function probe(): Promise<SeedProbeResult> {
  let res: Response;
  try {
    res = await fetch(PROBE_PATH, { method: "HEAD", credentials: "include" });
  } catch {
    return { available: false };
  }
  // Offered only on a 2xx, because "available" means THIS person may load
  // sample content. The route answers the probe with the authorization its
  // POST enforces -- 401 without a session, 403 for anyone it refuses -- and
  // 404 where the project ships no sample content, 503 while it is still
  // starting. Read as "the endpoint exists", a refusal drew a button whose
  // every press fails, in place of an action the person could take. Every
  // other failure fails closed too: no answer is never a yes.
  if (!res.ok) return { available: false };
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
