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
  // 404 = no seed route in this project. 503 = Nextly init transient
  // failure; treat as unavailable so the card doesn't render in a
  // broken state.
  if (res.status === 404 || res.status === 503) return { available: false };
  // 200/401/403 — endpoint exists. Read template metadata from headers
  // so the card can render the template label without hardcoding.
  if (res.ok || res.status === 401 || res.status === 403) {
    const slug = res.headers.get("x-nextly-seed-template") ?? "unknown";
    const label = res.headers.get("x-nextly-seed-template-label") ?? "Template";
    return { available: true, template: { slug, label } };
  }
  return { available: false };
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
