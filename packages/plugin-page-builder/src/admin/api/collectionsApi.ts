"use client";

/**
 * Client-side discovery of collections, their field schema, and sample entries — used by
 * the Query Loop authoring UI (spec §5). The editor runs in the admin, so these hit the
 * admin REST surface (`/admin/api`, same-origin cookies). No public admin hook exposes the
 * schema/entries, so we call the endpoints directly. The response NORMALIZERS are pure and
 * unit-tested; the fetch wrappers stay thin.
 */

const BASE = "/admin/api";

export interface CollectionSummary {
  slug: string;
  label: string;
}

export interface CollectionField {
  name: string;
  type: string;
  label: string;
}

type Rec = Record<string, unknown>;
const asArray = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : []);
const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;

/** `GET /admin/api/collections` → summaries, dropping admin-hidden + slugless entries. */
export function normalizeCollections(body: unknown): CollectionSummary[] {
  const items = asArray((body as Rec | null)?.items);
  const out: CollectionSummary[] = [];
  for (const c of items) {
    const admin = c.admin as Rec | undefined;
    if (admin?.hidden === true) continue;
    const slug = str(c.name) || str(c.slug);
    if (!slug) continue;
    const labels = c.labels as Rec | undefined;
    const label = str(c.label) || str(labels?.plural) || slug;
    out.push({ slug, label });
  }
  return out;
}

/** `GET /admin/api/collections/schema/{slug}` → simple field descriptors. */
export function normalizeFields(body: unknown): CollectionField[] {
  const fields = asArray((body as Rec | null)?.fields);
  const out: CollectionField[] = [];
  for (const f of fields) {
    const name = str(f.name);
    if (!name) continue;
    out.push({ name, type: str(f.type, "text"), label: str(f.label) || name });
  }
  return out;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export async function listCollections(): Promise<CollectionSummary[]> {
  return normalizeCollections(await getJson(`${BASE}/collections`));
}

export async function getCollectionFields(
  slug: string
): Promise<CollectionField[]> {
  if (!slug) return [];
  return normalizeFields(
    await getJson(`${BASE}/collections/schema/${encodeURIComponent(slug)}`)
  );
}

export async function getSampleEntries(
  slug: string,
  opts: { limit?: number; sort?: string; where?: unknown } = {}
): Promise<Record<string, unknown>[]> {
  if (!slug) return [];
  const params = new URLSearchParams();
  params.set("limit", String(opts.limit ?? 5));
  params.set("depth", "1");
  if (opts.sort) params.set("sort", opts.sort);
  if (opts.where !== undefined && opts.where !== null) {
    params.set("where", JSON.stringify(opts.where));
  }
  const body = (await getJson(
    `${BASE}/collections/${encodeURIComponent(slug)}/entries?${params.toString()}`
  )) as Record<string, unknown> | null;
  return asArray(body?.items);
}
