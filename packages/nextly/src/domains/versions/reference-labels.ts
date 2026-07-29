/**
 * Relationship and upload fields persist bare ids, so a stored snapshot or a
 * computed diff renders as identifiers unless those ids are resolved to
 * something human-readable.
 *
 * This resolver returns a LABEL MAP rather than rewriting the value it
 * describes. The id is the durable, machine-facing datum and must survive
 * intact for every consumer of the read/diff APIs, so a label is attached
 * alongside it (sideloaded next to a snapshot, an additive field on a diff
 * node) and never in place of it.
 *
 * Resolution deliberately does NOT reuse the framework's relationship
 * expansion. That path performs no access check on the target row, returns
 * every column, and re-reads many-to-many links live from the junction table,
 * which would present a document's CURRENT links as history. Each reference is
 * instead read through the same access-checked path a normal read uses, at
 * depth 0 (no further relationship fan-out), and only an id and a label are
 * kept.
 *
 * @module domains/versions/reference-labels
 */

import { getService } from "../../di";
import type { UserContext } from "../singles/types";

/** Media detail a history view renders for a resolved upload reference. */
export interface ResolvedMedia {
  originalFilename: string | null;
  filename: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  mimeType: string | null;
}

/**
 * A relationship or upload reference resolved to display data. `label` is a
 * relationship's display string (null when the target is unreadable or
 * unlabelled); `media` carries an upload's file detail. The id is always kept,
 * so the value a caller renders never loses its identity.
 */
export interface ResolvedReference {
  id: string;
  label: string | null;
  media?: ResolvedMedia;
}

/**
 * Upper bound on how many distinct references one payload resolves.
 *
 * Each resolution is an access-checked read, so an unusually wide document
 * would otherwise fan out into unbounded queries on every preview or diff.
 * Past the cap, remaining references keep their bare id rather than blocking
 * the read.
 */
const MAX_REFERENCES = 50;

/**
 * Candidate label columns, in the order the framework already prefers them
 * elsewhere. A relationship target declares no display column, so the first
 * populated one wins.
 *
 * `email` is deliberately excluded. A collection of contacts or subscribers may
 * carry no title or name, and falling back to an address would route a personal
 * identifier into version history, the same disclosure the author projection
 * already refuses to make.
 */
const LABEL_FIELDS = ["title", "name", "label", "slug"] as const;

/** Whether a reference points at a relationship target or an uploaded file. */
export type ReferenceKind = "relationship" | "upload";

/** One reference to resolve: its kind, target collection, and stored id. */
export interface ReferenceRequest {
  kind: ReferenceKind;
  /** Target collection; always `"media"` for an upload. */
  collection: string;
  id: string;
}

/** Stable map key for a reference, distinguishing kind and target collection. */
export function referenceLabelKey(ref: {
  kind: ReferenceKind;
  collection: string;
  id: string;
}): string {
  return `${ref.kind}:${ref.collection}:${ref.id}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One reference carried by a stored relationship or upload value. */
export interface StoredRef {
  id: string;
  /** Present only for a polymorphic value, which names its own target collection. */
  relationTo?: string;
}

/**
 * References carried by a stored relationship or upload value, in any of its
 * forms: a bare id, an array of them, a polymorphic `{ relationTo, value }` pair
 * (the only form that names its own target collection, so it must travel with
 * the id), or an already-populated `{ id }`.
 */
export function storedRefsOf(value: unknown): StoredRef[] {
  if (typeof value === "string" && value.length > 0) return [{ id: value }];
  if (Array.isArray(value)) return value.flatMap(storedRefsOf);
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
    return typeof value.id === "string" && value.id.length > 0
      ? [{ id: value.id }]
      : [];
  }
  return [];
}

/**
 * A resolvable request for one stored reference. The target collection is the
 * value's own when polymorphic, otherwise the field's first declared target;
 * an upload always resolves against media. Null when no collection is known.
 */
export function toReferenceRequest(
  kind: ReferenceKind,
  stored: StoredRef,
  collections: string[]
): ReferenceRequest | null {
  const collection =
    kind === "upload" ? "media" : (stored.relationTo ?? collections[0]);
  if (!collection || !stored.id) return null;
  return { kind, collection, id: stored.id };
}

/** First populated candidate column, or null when none carries a string. */
function labelFor(row: Record<string, unknown>): string | null {
  for (const key of LABEL_FIELDS) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/**
 * Read one relationship target through the access-checked read path.
 *
 * `overrideAccess: false` with `routeAuthorized: false` runs the RBAC check
 * against THIS target: the caller was authorized for the parent document, never
 * for what it links to. `status: "all"` resolves a historical link that now
 * points at an unpublished row. A denied or missing target yields a null label
 * rather than throwing, because dropping the reference would misrepresent the
 * historical value as empty and surfacing the error would confirm the target
 * exists.
 */
async function resolveRelationship(
  ref: ReferenceRequest,
  user: UserContext
): Promise<ResolvedReference> {
  try {
    const collections = getService("collectionsHandler");
    const result = await collections.getEntry({
      collectionName: ref.collection,
      entryId: ref.id,
      user,
      depth: 0,
      overrideAccess: false,
      routeAuthorized: false,
      status: "all",
    });
    if (!result.success || !isPlainObject(result.data)) {
      return { id: ref.id, label: null };
    }
    return { id: ref.id, label: labelFor(result.data) };
  } catch {
    return { id: ref.id, label: null };
  }
}

/**
 * Read one upload, projecting only what a history view renders.
 *
 * `MediaService.findById` ignores its context argument and performs no
 * authorization of its own, so the caller's permission to read media is checked
 * here first: without it, resolving a stored id would hand a filename and a URL
 * to someone with no access to the library.
 */
async function resolveUpload(
  ref: ReferenceRequest,
  user: UserContext
): Promise<ResolvedReference> {
  const unresolved: ResolvedReference = {
    id: ref.id,
    label: null,
    media: {
      originalFilename: null,
      filename: null,
      url: null,
      thumbnailUrl: null,
      mimeType: null,
    },
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
      // The user-facing name, falling back to the internal filename, matching
      // what every other admin surface shows for an upload.
      label: file.originalFilename ?? file.filename ?? null,
      media: {
        originalFilename: file.originalFilename ?? null,
        filename: file.filename ?? null,
        url: file.url ?? null,
        thumbnailUrl: file.thumbnailUrl ?? null,
        mimeType: file.mimeType ?? null,
      },
    };
  } catch {
    return unresolved;
  }
}

/**
 * Resolve a batch of references to display labels, access-checked and deduped.
 *
 * The result is keyed by {@link referenceLabelKey}; a caller looks up each id it
 * renders and falls back to the bare id when the key is absent (past the cap, or
 * an empty/invalid request). References are resolved once each and in parallel.
 */
export async function resolveReferenceLabels(
  refs: ReferenceRequest[],
  user: UserContext
): Promise<Map<string, ResolvedReference>> {
  const distinct = new Map<string, ReferenceRequest>();
  for (const ref of refs) {
    if (!ref.collection || !ref.id) continue;
    const key = referenceLabelKey(ref);
    if (!distinct.has(key) && distinct.size < MAX_REFERENCES) {
      distinct.set(key, ref);
    }
  }

  const resolved = new Map<string, ResolvedReference>();
  await Promise.all(
    [...distinct].map(async ([key, ref]) => {
      resolved.set(
        key,
        ref.kind === "upload"
          ? await resolveUpload(ref, user)
          : await resolveRelationship(ref, user)
      );
    })
  );
  return resolved;
}

/**
 * The value form a resolved reference takes in the read-only value kit, which
 * already renders `{ id, label }` relationships and `{ id, filename,
 * thumbnailUrl, ... }` uploads. Resolving into that shape in place lets the
 * preview and the diff reuse the one kit rather than a second renderer.
 *
 * A polymorphic relationship keeps its `{ relationTo, value }` wrapper (with the
 * label inlined) so the kit still reads it as polymorphic. When the reference
 * was not resolved (past the cap), the original stored form is returned so the
 * id is never lost.
 */
export function referenceDisplayValue(
  stored: StoredRef,
  resolved: ResolvedReference | undefined
): unknown {
  if (!resolved) {
    return stored.relationTo !== undefined
      ? { relationTo: stored.relationTo, value: stored.id }
      : stored.id;
  }
  if (resolved.media) {
    return { id: resolved.id, ...resolved.media };
  }
  if (stored.relationTo !== undefined) {
    return {
      relationTo: stored.relationTo,
      value: resolved.id,
      label: resolved.label,
    };
  }
  return { id: resolved.id, label: resolved.label };
}
