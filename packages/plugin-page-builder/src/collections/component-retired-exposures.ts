/**
 * Where each component's retired field and slot ids are kept.
 *
 * Removing an exposed field from a component, and publishing that, RETIRES its
 * id: it is never minted again, and no placement value under it may survive a
 * write. The list is bookkeeping about the component rather than part of its
 * design, so it lives here, keyed by component id, and not in the component's
 * envelope: the published block document format stays as it is, and a
 * component restored from an older version cannot bring a retired id back by
 * carrying its own list.
 *
 * One row per retired id. `identity` spells all of it in one unique column,
 * because a collection's composite indexes never reach the schema pipeline,
 * which builds a table's indexes from its fields; a unique key is what makes
 * recording the same retirement twice a no-op rather than a second row.
 *
 * @module collections/component-retired-exposures
 */
import {
  defineCollection,
  text,
  textarea,
  type CollectionConfig,
} from "nextly/config";

/** The slug the retired ids are stored under. */
export const COMPONENT_RETIRED_SLUG = "nx_pb_component_retired";

/** Which namespace a retired id belongs to. */
export type RetiredKind = "property" | "slot";

/** One stored row. */
export interface ComponentRetiredRow {
  /** `componentId`, `kind` and `exposureId`, joined by {@link retiredKey}. */
  identity: string;
  componentId: string;
  kind: RetiredKind;
  exposureId: string;
}

/**
 * The unique key of one retired id: a SHA-256 of the triple as a JSON array,
 * in hex.
 *
 * JSON quotes and escapes each part, so no two triples share a spelling, as a
 * plain separator an id could contain would let them. Hashed because an
 * exposure id has no length bound, while a unique column does: a short text
 * column is `varchar(255)` on MySQL, and a key past it would fail the record
 * there alone. The digest is always 64 characters, and holds no NUL, which
 * PostgreSQL refuses in text. Web Crypto, because this module is reachable
 * from a browser bundle, where `node:crypto` does not resolve.
 */
export async function retiredKey(
  componentId: string,
  // Any kind the table files, so a duplicate's origin row is keyed the same
  // way as a retired id.
  kind: string,
  exposureId: string
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify([componentId, kind, exposureId])
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/** The retired-ids collection. */
export function componentRetiredCollection(): CollectionConfig {
  return defineCollection({
    slug: COMPONENT_RETIRED_SLUG,
    labels: {
      singular: "Retired component field",
      plural: "Retired component fields",
    },
    // Bookkeeping the plugin writes when a component is published, never
    // authored. `internal` keeps it out of the admin's navigation; the access
    // rules below keep it out of everything else.
    internal: true,
    fields: [
      // Not `key`, which is a reserved word in SQL and refused as a field name.
      text({ name: "identity", required: true, unique: true }),
      // Indexed because every read asks for the ids of the components one
      // document places.
      text({ name: "componentId", required: true, index: true }),
      text({ name: "kind", required: true }),
      // Long text: an exposure id has no length bound, and a short text column
      // is `varchar(255)` on MySQL.
      textarea({ name: "exposureId", required: true }),
    ],
    access: {
      // Written by the plugin through the Direct API, which overrides access.
      // A row authored by hand could retire a field nobody removed, and every
      // later write would strip its values, so the wire API is closed to all
      // four. Functions rather than `false`, because access rules are
      // validated as callables.
      create: () => false,
      update: () => false,
      delete: () => false,
      read: () => false,
    },
    // An omitted option records, so a site subscribed to `entry.*` would
    // receive every retirement; these rows are not content.
    webhooks: false,
    admin: {
      description:
        "Fields removed from components. Maintained automatically when a component is published.",
    },
    timestamps: false,
  });
}
