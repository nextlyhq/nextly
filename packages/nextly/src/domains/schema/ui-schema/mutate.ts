/**
 * In-memory `ui-schema.json` mutations for the dev write API (spec §4.12.3).
 *
 * `mutateManifest` applies one upsert/delete by slug and re-validates the whole
 * manifest through the shared Zod schema (validation Layer 4) — throwing
 * NEXTLY_UI_SCHEMA_INVALID before the caller writes anything. Pure: no HTTP, no
 * filesystem. The HTTP handler (route-handler/dev-schema-handler.ts) loads the
 * current manifest, calls this, then serializes + writes the result.
 *
 * @module domains/schema/ui-schema/mutate
 * @since v0.0.3-alpha (Plan D3)
 */
import { NextlyError } from "../../../errors";
import {
  parseUiSchema,
  type UiSchemaManifest,
} from "../../../schemas/_zod/ui-schema";
import { assertPluginFieldDeclarations } from "../../../shared/lib/assert-plugin-field-declarations";

import { restorePluginFieldOptions } from "./preserve-plugin-options";

export type ManifestKind = "collections" | "singles" | "components";

export type ManifestMutation =
  | { type: "upsert"; kind: ManifestKind; entity: unknown }
  | { type: "delete"; kind: ManifestKind; slug: string };

function slugOf(entity: unknown): string | undefined {
  const s = (entity as { slug?: unknown }).slug;
  return typeof s === "string" ? s : undefined;
}

/**
 * Apply a mutation to a validated manifest and re-validate the result.
 * Throws NEXTLY_UI_SCHEMA_INVALID (400) when the change would make the file
 * invalid — the caller then leaves the file untouched.
 */
export function mutateManifest(
  current: UiSchemaManifest,
  mutation: ManifestMutation
): UiSchemaManifest {
  const draft: Record<string, unknown> = {
    $schema: current.$schema,
    version: current.version,
    collections: [...current.collections],
    singles: [...current.singles],
    components: [...current.components],
  };

  const list = [...(draft[mutation.kind] as unknown[])];
  if (mutation.type === "upsert") {
    const slug = slugOf(mutation.entity);
    const idx =
      slug === undefined ? -1 : list.findIndex(e => slugOf(e) === slug);
    // Full-replace by slug is intentional: callers (the admin builder via
    // settings-to-manifest.ts) send a COMPLETE entity, so replacing lets a
    // user unset an optional flag (e.g. turn Draft/Published off). We do not
    // merge with the stored entity — a shallow merge would make unsetting
    // impossible (an omitted key would silently retain the old value).
    // Structurally-partial entities (missing slug/fields) are already
    // rejected by the Zod re-validation below (NEXTLY_UI_SCHEMA_INVALID).
    if (idx >= 0) list[idx] = mutation.entity;
    else list.push(mutation.entity);
  } else {
    const filtered = list.filter(e => slugOf(e) !== mutation.slug);
    list.length = 0;
    list.push(...filtered);
  }
  draft[mutation.kind] = list;

  const result = parseUiSchema(draft);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new NextlyError({
      code: "NEXTLY_UI_SCHEMA_INVALID",
      publicMessage: `ui-schema change rejected: ${issues}`,
    });
  }
  // The parse strips every key the manifest schema does not declare, and a
  // plugin field type's own options are exactly those. The database keeps them
  // (the field-payload writer persists what it was given), so returning the
  // parsed copy verbatim would commit a manifest describing a different field
  // from the one stored — and a deployment sourced from it would rebuild the
  // field without its options.
  const next = restorePluginFieldOptions(result.data, draft);

  // The upserted entity's own field types get to judge their declarations
  // before this reaches the file. `dev-schema-handler` writes whatever comes
  // back, so without this a declaration its plugin rejects lands in
  // `ui-schema.json` and is refused later — by HMR, or by the next boot, at a
  // point that no longer names the request that wrote it.
  //
  // Only the upserted entity: a manifest may already hold an entity some
  // plugin now rejects, and blocking an unrelated edit until that is cleaned
  // up would make one bad entity freeze the whole Builder.
  if (mutation.type === "upsert") {
    const upserted = next[mutation.kind].find(
      e => slugOf(e) === slugOf(mutation.entity)
    );
    if (upserted) {
      const kind = mutation.kind;
      assertPluginFieldDeclarations({
        collections: kind === "collections" ? [upserted] : [],
        singles: kind === "singles" ? [upserted] : [],
        fieldGroups: kind === "components" ? [upserted] : [],
      });
    }
  }

  return next;
}
