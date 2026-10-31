/**
 * seedApi — thin client for the setup card's sample-content step, over the
 * project's own route:
 * - HEAD /admin/api/seed — the probe: may THIS person load sample content?
 * - POST /admin/api/seed — start the site's one load, `{ confirm: true }` to
 *   load again after a failed one; refused with 409 when another load or an
 *   answer got there first.
 *
 * Whether the site has answered, and a load nobody has seen through, come
 * with the setup card's own data; declining and recording a load on its own
 * are core's (`PUT /api/dashboard/setup`), so neither reaches a route that
 * loads.
 *
 * Bypasses the central `fetcher` utility because these routes return
 * raw bodies (not the `{success, data}` envelope that fetcher expects).
 */

interface SeedSummary {
  rolesCreated: number;
  usersCreated: number;
  categoriesCreated: number;
  tagsCreated: number;
  postsCreated: number;
  mediaUploaded: number;
  mediaSkipped: number;
  collectionsRegistered: number;
  singlesRegistered: number;
  permissionsSynced: number;
}

interface SeedResult {
  message: string;
  summary: SeedSummary;
  warnings: string[];
}

export type SeedProbeResult =
  | { available: false }
  | { available: true; template: { slug: string; label: string } };

/**
 * What starting a load came to, as this person is told it. Never a throw: a
 * load that could not be asked for is `failed` with why, so the card says so
 * and starts nothing on its own.
 */
type SampleStartAnswer =
  /** Loaded and recorded; `result` is absent from a project route older than the runner. */
  | { outcome: "loaded"; result?: SeedResult }
  /** Loaded, but recording that failed: `run` records it on its own. */
  | { outcome: "unrecorded"; run: string; startedAt: string }
  | { outcome: "failed"; failure: string; startedAt?: string }
  /** Refused with nothing loaded: another load or an answer got there first. */
  | {
      outcome: "refused";
      reason: "answered" | "in-progress" | "unrecorded" | "confirm" | "other";
      message: string;
    };

const SEED_PATH = "/admin/api/seed";

async function probe(): Promise<SeedProbeResult> {
  let res: Response;
  try {
    res = await fetch(SEED_PATH, { method: "HEAD", credentials: "include" });
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

/** The first error message a failed answer carries, or `fallback`. */
function messageIn(body: unknown, fallback: string): string {
  const errors = (body as { errors?: Array<{ message?: unknown }> } | null)
    ?.errors;
  const message = errors?.[0]?.message;
  return typeof message === "string" && message !== "" ? message : fallback;
}

const REFUSALS = ["answered", "in-progress", "unrecorded", "confirm"] as const;

/** A refusal's reason, as the route names it, or `other` for one it does not. */
function refusalReason(
  body: unknown
): Extract<SampleStartAnswer, { outcome: "refused" }>["reason"] {
  const reason = (body as { reason?: unknown } | null)?.reason;
  return REFUSALS.find(known => known === reason) ?? "other";
}

/** What a start's answer body may carry. */
type StartBody = {
  outcome?: unknown;
  run?: unknown;
  startedAt?: unknown;
  failure?: unknown;
  result?: SeedResult;
} | null;

/** A start that was not a success: refused (409) with why, or failed with what failed. */
function notStarted(status: number, body: StartBody): SampleStartAnswer {
  if (status === 409) {
    return {
      outcome: "refused",
      reason: refusalReason(body),
      message: messageIn(body, "Sample content could not be loaded now."),
    };
  }
  return {
    outcome: "failed",
    failure:
      typeof body?.failure === "string"
        ? body.failure
        : messageIn(body, `Loading failed (${status}).`),
    ...(typeof body?.startedAt === "string"
      ? { startedAt: body.startedAt }
      : {}),
  };
}

/** A start that loaded: recorded, or not recorded with the run that records it. */
function started(body: StartBody): SampleStartAnswer {
  if (
    body?.outcome === "unrecorded" &&
    typeof body.run === "string" &&
    typeof body.startedAt === "string"
  ) {
    return { outcome: "unrecorded", run: body.run, startedAt: body.startedAt };
  }
  // A route older than the runner answers its result alone, having recorded it itself.
  const result =
    body?.outcome === "loaded" ? body.result : (body as SeedResult | null);
  return result ? { outcome: "loaded", result } : { outcome: "loaded" };
}

/**
 * Starts the site's one load. Asked once: nothing here retries, as a second
 * request could start a second load.
 */
async function start(confirm: boolean): Promise<SampleStartAnswer> {
  let res: Response;
  try {
    res = await fetch(SEED_PATH, {
      method: "POST",
      credentials: "include",
      ...(confirm
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirm: true }),
          }
        : {}),
    });
  } catch {
    return {
      outcome: "failed",
      failure: "The server could not be reached.",
    };
  }
  const body = (await res.json().catch(() => null)) as StartBody;
  return res.ok ? started(body) : notStarted(res.status, body);
}

/** The type of {@link seedApi}. */
type SeedApiType = {
  probe: typeof probe;
  start: typeof start;
};

export const seedApi: SeedApiType = { probe, start };
