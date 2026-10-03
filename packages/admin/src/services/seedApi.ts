/**
 * seedApi — thin client for the dashboard SeedDemoContentCard.
 *
 * Wraps three project-local routes:
 * - HEAD /admin/api/seed                — probe (is seeding available?)
 * - POST /admin/api/seed                — run the seed, returns SeedResult
 * - GET  /admin/api/meta/seed-status    — has it been seeded/skipped?
 * - PUT  /admin/api/meta/seed-status    — record skip
 *
 * Bypasses the central `fetcher` utility because these routes return
 * raw bodies (not the `{success, data}` envelope that fetcher expects).
 */

export interface SeedSummary {
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

export interface SeedResult {
  message: string;
  summary: SeedSummary;
  warnings: string[];
}

export type SeedProbeResult =
  | { available: false }
  | { available: true; template: { slug: string; label: string } };

export interface SeedStatus {
  completedAt: string | null;
  skippedAt: string | null;
}

const SEED_PATH = "/admin/api/seed";
const META_STATUS_PATH = "/admin/api/meta/seed-status";

async function probe(): Promise<SeedProbeResult> {
  let res: Response;
  try {
    res = await fetch(SEED_PATH, { method: "HEAD", credentials: "include" });
  } catch {
    return { available: false };
  }
  // Offered only on a 2xx, because "available" means THIS reader may run the
  // seed. The route answers the probe with the authorization its POST enforces
  // -- 401 without a session, 403 for anyone who is not a super-admin -- and 404
  // where the project ships no seed, 503 while it is still starting. Read as
  // "the endpoint exists", a refusal drew a button whose every press fails, in
  // place of an action the reader could take.
  if (!res.ok) return { available: false };
  // Template metadata from headers, so the offer names the template without
  // hardcoding it.
  const slug = res.headers.get("x-nextly-seed-template") ?? "unknown";
  const label = res.headers.get("x-nextly-seed-template-label") ?? "Template";
  return { available: true, template: { slug, label } };
}

async function runSeed(): Promise<SeedResult> {
  const res = await fetch(SEED_PATH, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      errors?: Array<{ message?: string }>;
    } | null;
    const message = body?.errors?.[0]?.message ?? `Seed failed (${res.status})`;
    throw new Error(message);
  }
  return (await res.json()) as SeedResult;
}

async function getStatus(): Promise<SeedStatus> {
  const res = await fetch(META_STATUS_PATH, {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) return { completedAt: null, skippedAt: null };
  const body = (await res
    .json()
    .catch(() => null)) as Partial<SeedStatus> | null;
  return {
    completedAt: body?.completedAt ?? null,
    skippedAt: body?.skippedAt ?? null,
  };
}

async function setSkipped(): Promise<void> {
  await fetch(META_STATUS_PATH, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skippedAt: new Date().toISOString() }),
  });
}

export const seedApi = { probe, runSeed, getStatus, setSkipped };
