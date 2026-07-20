/**
 * Relationship and upload fields persist bare ids, so a stored snapshot renders
 * as identifiers unless those ids are resolved to something human-readable.
 *
 * Resolution deliberately does NOT reuse the framework's relationship
 * expansion. That path performs no access check on the target row and returns
 * every one of its columns, and it re-reads many-to-many links live from the
 * junction table — which would show a document's CURRENT links while presenting
 * them as history. Here each reference is instead read through the same
 * access-checked path a normal read uses, and only an id and a label are kept.
 *
 * @module domains/versions/snapshot-references
 */

import type { FieldConfig } from "../../collections/fields/types";
import { getService } from "../../di";
import type { UserContext } from "../singles/types";

/**
 * Upper bound on how many references one snapshot may resolve.
 *
 * Each resolution is an access-checked read, so an unusually wide document
 * would otherwise fan out into unbounded queries on every preview. Past the
 * cap, remaining references stay as bare ids rather than blocking the read.
 */
const MAX_REFERENCES = 50;

/** Field value shape after a relationship id has been resolved. */
interface ResolvedReference {
  id: string;
  label: string | null;
}

/** Field value shape after an upload id has been resolved. */
interface ResolvedUpload {
  id: string;
  filename: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  mimeType: string | null;
}

/**
 * Candidate label columns, in the order the framework already prefers them
 * elsewhere. A relationship target has no declared display column, so the first
 * populated one wins.
 *
 * `email` is deliberately not a candidate. A collection of contacts or
 * subscribers may carry no title or name, and falling back to an address would
 * route a personal identifier into version history — the same disclosure the
 * author projection already refuses to make.
 */
const LABEL_FIELDS = ["title", "name", "label", "slug"] as const;

type ReferenceKind = "relationship" | "upload";

interface Reference {
  kind: ReferenceKind;
  /** Target collection; unused for uploads, which always resolve to media. */
  collection: string;
  id: string;
}

function refKey(ref: Reference): string {
  return `${ref.kind}:${ref.collection}:${ref.id}`;
}

/** Human-facing label for a related row. */
function labelFor(row: Record<string, unknown>): string | null {
  for (const key of LABEL_FIELDS) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/**
 * A snapshot is captured from the persisted row, so JSON-backed containers can
 * arrive already parsed or as strings depending on the dialect. Anything that
 * does not parse is left exactly as found.
 */
function parseIfJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One stored reference: its id, plus the collection it names when polymorphic. */
interface StoredRef {
  id: string;
  /** Present only for a polymorphic value, which names its own target. */
  relationTo?: string;
}

/**
 * References carried by a relationship or upload value, in any of its stored
 * forms.
 *
 * A polymorphic value stores `{ relationTo, value }` and is the only form that
 * knows its own target collection. That target must travel with the id: the
 * field declares several possible collections, and resolving against the first
 * one would miss every reference to any of the others.
 */
function refsFromValue(value: unknown): StoredRef[] {
  if (typeof value === "string" && value.length > 0) return [{ id: value }];
  if (Array.isArray(value)) return value.flatMap(refsFromValue);
  if (isPlainObject(value)) {
    if ("relationTo" in value && "value" in value) {
      const inner = value.value;
      const id =
        typeof inner === "string"
          ? inner
          : isPlainObject(inner) && typeof inner.id === "string"
            ? inner.id
            : null;
      if (id === null) return [];
      return typeof value.relationTo === "string"
        ? [{ id, relationTo: value.relationTo }]
        : [{ id }];
    }
    // Already-populated `{ id }`.
    return typeof value.id === "string" && value.id.length > 0
      ? [{ id: value.id }]
      : [];
  }
  return [];
}

function targetOf(field: FieldConfig): string {
  const relationTo = (field as { relationTo?: unknown }).relationTo;
  if (typeof relationTo === "string") return relationTo;
  if (Array.isArray(relationTo) && typeof relationTo[0] === "string") {
    return relationTo[0];
  }
  const target = (field as { options?: { target?: unknown } }).options?.target;
  return typeof target === "string" ? target : "";
}

function childFieldsOf(field: FieldConfig): FieldConfig[] {
  const nested = (field as { fields?: unknown }).fields;
  return Array.isArray(nested) ? (nested as FieldConfig[]) : [];
}

/**
 * Walk a value against its field list, invoking `visit` for every relationship
 * or upload leaf. Container types are descended into so nested references are
 * found too.
 */
function walk(
  value: unknown,
  fields: FieldConfig[],
  visit: (
    field: FieldConfig,
    name: string,
    holder: Record<string, unknown>
  ) => void
): void {
  if (!isPlainObject(value)) return;

  for (const field of fields) {
    // A field without a name addresses no value in the snapshot.
    const name = field.name;
    if (typeof name !== "string" || name.length === 0) continue;

    const raw = parseIfJsonString(value[name]);
    if (raw === undefined || raw === null) continue;

    if (field.type === "relationship" || field.type === "upload") {
      value[name] = raw;
      visit(field, name, value);
      continue;
    }

    const children = childFieldsOf(field);
    if (children.length === 0) continue;

    // Containers hold either one nested object or a list of them.
    value[name] = raw;
    if (Array.isArray(raw)) {
      for (const row of raw) walk(row, children, visit);
    } else {
      walk(raw, children, visit);
    }
  }
}

/** Read one relationship target through the access-checked read path. */
async function resolveRelationship(
  ref: Reference,
  user: UserContext
): Promise<ResolvedReference> {
  try {
    const collections = getService("collectionsHandler");
    const result = await collections.getEntry({
      collectionName: ref.collection,
      entryId: ref.id,
      user,
      overrideAccess: false,
      // The caller was authorized for the parent document, never for this
      // target, so the RBAC check must run rather than be skipped.
      routeAuthorized: false,
      status: "all",
    });
    const data = (result as { success?: boolean; data?: unknown }).data;
    if (!(result as { success?: boolean }).success || !isPlainObject(data)) {
      return { id: ref.id, label: null };
    }
    return { id: ref.id, label: labelFor(data) };
  } catch {
    // A denied or missing target yields an unlabelled reference: dropping it
    // would misrepresent the historical value as empty, and raising would
    // confirm the target exists.
    return { id: ref.id, label: null };
  }
}

/**
 * Read one upload, projecting only what a history view renders.
 *
 * `MediaService.findById` ignores its context argument, so it performs no
 * authorization of its own. The caller's permission to read media is therefore
 * checked here: without it, resolving a stored id would hand back a filename
 * and a URL to someone with no access to the library.
 */
async function resolveUpload(
  ref: Reference,
  user: UserContext
): Promise<ResolvedUpload> {
  const unresolved: ResolvedUpload = {
    id: ref.id,
    filename: null,
    url: null,
    thumbnailUrl: null,
    mimeType: null,
  };

  try {
    const rbac = getService("rbacAccessControlService");
    const allowed = await rbac.checkAccess({
      userId: String(user.id),
      operation: "read",
      resource: "media",
    });
    if (!allowed) return unresolved;

    const media = getService("mediaService");
    const file = await media.findById(ref.id, {});
    return {
      id: ref.id,
      filename: file.filename ?? null,
      url: file.url ?? null,
      thumbnailUrl: file.thumbnailUrl ?? null,
      mimeType: file.mimeType ?? null,
    };
  } catch {
    return unresolved;
  }
}

/**
 * Replace relationship and upload ids in a snapshot with display-ready values.
 * Mutates in place, matching the redaction pass that runs alongside it.
 *
 * Labels reflect the target's CURRENT value, because a snapshot stores ids
 * rather than the label as it read at capture time.
 */
export async function hydrateSnapshotReferences(
  snapshot: unknown,
  user: UserContext,
  fields: FieldConfig[]
): Promise<void> {
  if (!isPlainObject(snapshot) || fields.length === 0) return;

  // Pass 1: collect every distinct reference, bounded by the cap.
  const wanted = new Map<string, Reference>();
  walk(snapshot, fields, (field, name, holder) => {
    const kind: ReferenceKind =
      field.type === "upload" ? "upload" : "relationship";
    const collection = kind === "upload" ? "media" : targetOf(field);
    if (kind === "relationship" && !collection) return;

    for (const stored of refsFromValue(holder[name])) {
      // A polymorphic value names its own collection; only fall back to the
      // field's declaration when it does not.
      const target =
        kind === "upload" ? "media" : (stored.relationTo ?? collection);
      if (!target) continue;

      const ref: Reference = { kind, collection: target, id: stored.id };
      const key = refKey(ref);
      if (!wanted.has(key) && wanted.size < MAX_REFERENCES) {
        wanted.set(key, ref);
      }
    }
  });

  if (wanted.size === 0) return;

  // Pass 2: resolve each distinct reference once.
  const resolved = new Map<string, unknown>();
  await Promise.all(
    [...wanted.values()].map(async ref => {
      resolved.set(
        refKey(ref),
        ref.kind === "upload"
          ? await resolveUpload(ref, user)
          : await resolveRelationship(ref, user)
      );
    })
  );

  // Pass 3: substitute. A reference past the cap is absent from the map and
  // keeps its stored id.
  walk(snapshot, fields, (field, name, holder) => {
    const kind: ReferenceKind =
      field.type === "upload" ? "upload" : "relationship";
    const collection = kind === "upload" ? "media" : targetOf(field);
    if (kind === "relationship" && !collection) return;

    const current = holder[name];
    const stored = refsFromValue(current);
    if (stored.length === 0) return;

    const lookup = (entry: StoredRef): unknown => {
      const target =
        kind === "upload" ? "media" : (entry.relationTo ?? collection);
      return (
        resolved.get(refKey({ kind, collection: target, id: entry.id })) ??
        entry.id
      );
    };

    holder[name] = Array.isArray(current)
      ? stored.map(lookup)
      : stored[0]
        ? lookup(stored[0])
        : null;
  });
}
