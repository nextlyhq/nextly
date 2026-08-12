/**
 * Relationship and upload fields persist bare ids, so a stored snapshot or a
 * computed diff renders as identifiers unless those ids are resolved to
 * something human-readable.
 *
 * This resolver returns a LABEL MAP keyed by target. Its callers — the snapshot
 * and diff walkers — look each id up and rewrite the stored value in place to
 * the read-only value kit's display shape, always keeping the id inside the
 * resolved value so nothing loses its identity.
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

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { canReadSystemResource } from "../../auth/resource-readable";
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
  /** Target collection: the value's own when polymorphic, else the field's declared target. */
  collection: string;
  id: string;
  /**
   * The field's configured display column (`targetLabelField`), preferred over
   * the default candidates when it names a populated, non-sensitive column.
   */
  labelField?: string;
}

/**
 * Stable map key for a reference. The configured `labelField` is part of the
 * identity: two fields may reference the same target id yet want different
 * display columns, so a key without it would let one field's resolved label
 * satisfy the other and show the wrong text.
 */
export function referenceLabelKey(ref: {
  kind: ReferenceKind;
  collection: string;
  id: string;
  labelField?: string;
}): string {
  return `${ref.kind}:${ref.collection}:${ref.id}:${ref.labelField ?? ""}`;
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
 * value's own when polymorphic (a relationship OR a multi-collection upload),
 * otherwise the field's first declared target. Uploads fall back to the built-in
 * `media` collection when neither is present, since that is their default store.
 * Null when no collection is known.
 */
export function toReferenceRequest(
  kind: ReferenceKind,
  stored: StoredRef,
  collections: string[],
  labelField?: string
): ReferenceRequest | null {
  const collection =
    stored.relationTo ??
    collections[0] ??
    (kind === "upload" ? "media" : undefined);
  if (!collection || !stored.id) return null;
  return {
    kind,
    collection,
    id: stored.id,
    ...(labelField ? { labelField } : {}),
  };
}

/**
 * Columns never surfaced as a label, even if a field names one as its display
 * column: an address is a personal identifier and a password/hash is a secret,
 * either of which would otherwise ride into version history via `label`.
 */
const EXCLUDED_LABEL_FIELDS = [
  "email",
  "password",
  "passwordHash",
  "password_hash",
];

/**
 * The display label for a resolved row: the field's configured label column when
 * it names a populated, non-sensitive field, otherwise the first populated
 * default candidate. A configured label field pointing at an excluded (PII or
 * secret) column is ignored rather than leaked.
 */
function labelForRow(
  row: Record<string, unknown>,
  labelField?: string
): string | null {
  if (labelField && !EXCLUDED_LABEL_FIELDS.includes(labelField)) {
    const configured = row[labelField];
    if (typeof configured === "string" && configured.length > 0) {
      return configured;
    }
  }
  for (const key of LABEL_FIELDS) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/** The `users` entity is the only system target a relationship can name. */
function isSystemUserCollection(collection: string): boolean {
  return collection.toLowerCase() === "users";
}

/** Reads a resolver's caller through the shared system-resource read gate. */
function callerMayRead(
  resource: string,
  user: UserContext,
  authenticatedScope?: AuthenticatedScope
): Promise<boolean> {
  return canReadSystemResource(resource, String(user.id), authenticatedScope);
}

/**
 * Resolve a `users` system-entity target to its display name.
 *
 * `users` is not a dynamic collection `collectionsHandler.getEntry` can load, so
 * it is read through the same name lookup the version-author projection uses.
 * Unlike that projection, this resolves an arbitrary `users` relationship field
 * rather than the change's own author, so it is gated on the caller's own
 * `read-users` grant (via {@link callerMayRead}). A caller without
 * user-read access keeps the bare id rather than learning the account's name.
 */
async function resolveSystemUser(
  ref: ReferenceRequest,
  user: UserContext,
  authenticatedScope?: AuthenticatedScope
): Promise<ResolvedReference> {
  try {
    if (!(await callerMayRead("users", user, authenticatedScope))) {
      return { id: ref.id, label: null };
    }
    const users = getService("userService");
    const [found] = await users.listUsersByIds([ref.id]);
    return { id: ref.id, label: found?.name ?? null };
  } catch {
    return { id: ref.id, label: null };
  }
}

/**
 * Read one target row through the access-checked read path, or null when it is
 * denied, missing, or not an object.
 *
 * `overrideAccess: false` with `routeAuthorized: false` runs the RBAC check
 * against THIS target: the caller was authorized for the parent document, never
 * for what it links to. A scoped API key is judged on its OWN read grant via
 * `authenticatedScope`, so a super-admin-owned but narrowly scoped key cannot
 * read a target its scope excludes. `status: "all"` resolves a historical link
 * that now points at an unpublished row, and `locale` reads the target in the
 * version's own language. A denied or missing target yields null rather than
 * throwing, because dropping the reference would misrepresent the historical
 * value as empty and surfacing the error would confirm the target exists.
 */
async function readTargetRow(
  ref: ReferenceRequest,
  user: UserContext,
  authenticatedScope?: AuthenticatedScope,
  locale?: string | null
): Promise<Record<string, unknown> | null> {
  const collections = getService("collectionsHandler");
  const result = await collections.getEntry({
    collectionName: ref.collection,
    entryId: ref.id,
    user,
    depth: 0,
    overrideAccess: false,
    routeAuthorized: false,
    status: "all",
    ...(locale ? { locale } : {}),
    ...(authenticatedScope ? { authenticatedScope } : {}),
  });
  return result.success && isPlainObject(result.data) ? result.data : null;
}

/** Read one relationship target to its display label through the access gate. */
async function resolveRelationship(
  ref: ReferenceRequest,
  user: UserContext,
  authenticatedScope?: AuthenticatedScope,
  locale?: string | null
): Promise<ResolvedReference> {
  try {
    const row = await readTargetRow(ref, user, authenticatedScope, locale);
    return {
      id: ref.id,
      label: row ? labelForRow(row, ref.labelField) : null,
    };
  } catch {
    return { id: ref.id, label: null };
  }
}

/** The nulled file detail returned when an upload cannot be resolved. */
const EMPTY_MEDIA: ResolvedMedia = {
  originalFilename: null,
  filename: null,
  url: null,
  thumbnailUrl: null,
  mimeType: null,
};

/**
 * Project an upload row (from the media service or an upload-enabled
 * collection) into the value kit's upload shape, keeping only the file detail a
 * history view renders. The label mirrors what every other admin surface shows:
 * the user-facing name, then the internal filename.
 */
function toResolvedMedia(
  id: string,
  source: Record<string, unknown>
): ResolvedReference {
  const text = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;
  const originalFilename = text(source.originalFilename);
  const filename = text(source.filename);
  return {
    id,
    label: originalFilename ?? filename,
    media: {
      originalFilename,
      filename,
      url: text(source.url),
      thumbnailUrl: text(source.thumbnailUrl),
      mimeType: text(source.mimeType),
    },
  };
}

/**
 * Read one upload stored in a content collection (a custom upload target rather
 * than the built-in `media` library) through the access-checked entry path, and
 * project the same file detail the media service would. The collection's own
 * read rules gate the row, so no extra scope check is needed here (unlike the
 * unauthenticated media service). A renderable upload shape is returned so a
 * custom upload shows a filename and thumbnail rather than a bare id.
 */
async function resolveUploadEntry(
  ref: ReferenceRequest,
  user: UserContext,
  authenticatedScope?: AuthenticatedScope,
  locale?: string | null
): Promise<ResolvedReference> {
  const unresolved: ResolvedReference = {
    id: ref.id,
    label: null,
    media: { ...EMPTY_MEDIA },
  };
  try {
    const row = await readTargetRow(ref, user, authenticatedScope, locale);
    return row ? toResolvedMedia(ref.id, row) : unresolved;
  } catch {
    return unresolved;
  }
}

/**
 * Read one upload from the built-in `media` library, projecting only what a
 * history view renders.
 *
 * `MediaService.findById` ignores its context argument and performs no
 * authorization of its own, so the caller's media-read permission is checked
 * first (via {@link callerMayRead}): without it, resolving a stored id
 * would hand a filename and a URL to someone with no access to the library.
 */
async function resolveUpload(
  ref: ReferenceRequest,
  user: UserContext,
  authenticatedScope?: AuthenticatedScope
): Promise<ResolvedReference> {
  const unresolved: ResolvedReference = {
    id: ref.id,
    label: null,
    media: { ...EMPTY_MEDIA },
  };

  try {
    if (!(await callerMayRead("media", user, authenticatedScope))) {
      return unresolved;
    }
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
  user: UserContext,
  authenticatedScope?: AuthenticatedScope,
  locale?: string | null
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
        await resolveOne(ref, user, authenticatedScope, locale)
      );
    })
  );
  return resolved;
}

/**
 * Resolve one reference by its kind and target. An upload projects a file shape:
 * from the media service for the built-in `media` library, or through the
 * access-checked entry read for a custom upload collection. A relationship
 * resolves to a label: a `users` system entity through the user reader,
 * everything else through the entry read.
 *
 * INVARIANT: every branch below is access-gated for the caller. The two
 * dynamic-collection branches (custom uploads, relationships) inherit `getEntry`'s
 * own gate via {@link readTargetRow}; the two system-table branches (`media`,
 * `users`) gate through {@link callerMayRead} because their readers do
 * no authorization of their own. A new branch here MUST keep that property.
 */
async function resolveOne(
  ref: ReferenceRequest,
  user: UserContext,
  authenticatedScope?: AuthenticatedScope,
  locale?: string | null
): Promise<ResolvedReference> {
  if (ref.kind === "upload") {
    return ref.collection === "media"
      ? resolveUpload(ref, user, authenticatedScope)
      : resolveUploadEntry(ref, user, authenticatedScope, locale);
  }
  if (isSystemUserCollection(ref.collection)) {
    return resolveSystemUser(ref, user, authenticatedScope);
  }
  return resolveRelationship(ref, user, authenticatedScope, locale);
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
