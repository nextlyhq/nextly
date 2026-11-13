/**
 * Single API Service
 *
 * API client for Single operations. Follows the same pattern as collectionApi.ts.
 *
 * This module provides two types of operations:
 * 1. **Schema/Metadata operations** - CRUD operations on Single definitions (fields, labels, etc.)
 * 2. **Document operations** - Read/update operations on Single document data (the actual content)
 *
 * @module services/singleApi
 */

import type { ListResponse, TableParams } from "@nextlyhq/ui";

import type { ApiSingle, UpdateSinglePayload } from "@admin/types/entities";

import { buildQuery as buildQueryUtil } from "../lib/api/buildQuery";
import { fetcher } from "../lib/api/fetcher";
import { keepaliveOptions } from "../lib/api/keepalive";
import { protectedApi } from "../lib/api/protectedApi";
import type {
  ActionResponse,
  MutationResponse,
} from "../lib/api/response-types";
import {
  everyLanguageBody,
  type EveryLanguageVersion,
} from "../lib/document-version";

import { withListOwner, type ListOwner } from "./list-owner";
import type {
  PublishAllLanguageOutcome,
  PublishAllPreview,
} from "./publishAllPreview";
import type {
  FieldResolution,
  SchemaApplyResponse,
  SchemaPreviewResponse,
  SchemaRenameResolution,
} from "./schemaApi";

/**
 * Build query string for pagination and search using shared utility
 */
const buildQuery = (params: TableParams): string => {
  return buildQueryUtil(params, {
    fieldMapping: {
      slug: "slug",
      label: "label",
      source: "source",
      createdAt: "createdAt",
    },
    validSortFields: ["slug", "label", "source", "createdAt"],
  });
};

/**
 * The path a list of singles is read from, for `params`: the one place it is
 * spelled, shared by the list's own read and the admin's startup request,
 * which must name exactly the path the read will ask for.
 */
export function singlesListPath(
  params: TableParams,
  owner?: ListOwner
): string {
  const query = withListOwner(buildQuery(params), owner);
  return `/singles${query ? `?${query}` : ""}`;
}

/**
 * Fetch Singles with pagination and filters.
 */
export const fetchSingles = async (
  params: TableParams,
  // The site's Singles or the plugins'; none lists both.
  owner?: ListOwner
): Promise<ListResponse<ApiSingle>> => {
  const url = singlesListPath(params, owner);
  return fetcher<ListResponse<ApiSingle>>(url, {}, true);
};

/**
 * Delete a Single by slug. Caller expects void; we discard the body.
 */
export const deleteSingle = async (slug: string): Promise<void> => {
  // Use MutationResponse<unknown> as a generic shape. The dispatcher
  // emits either respondMutation (item) or respondAction ({ slug }),
  // and we drop the body in either case.
  await fetcher<MutationResponse<unknown>>(
    `/singles/${slug}`,
    {
      method: "DELETE",
    },
    true
  );
};

/** The type of {@link singleApi}. */
type SingleApiType = {
  readonly fetchSingles: typeof fetchSingles;
  readonly deleteSingle: typeof deleteSingle;
  readonly list: () => Promise<ApiSingle[]>;
  readonly get: (slug: string) => Promise<ApiSingle>;
  readonly getSchema: (slug: string) => Promise<ApiSingle>;
  readonly create: (
    payload: UpdateSinglePayload
  ) => Promise<{ message: string; data: ApiSingle }>;
  readonly update: (
    slug: string,
    payload: UpdateSinglePayload
  ) => Promise<{ message: string }>;
  readonly previewSchemaChanges: (
    slug: string,
    fields: unknown[],
    localized?: boolean
  ) => Promise<SchemaPreviewResponse>;
  readonly applySchemaChanges: (
    slug: string,
    fields: unknown[],
    schemaVersion: number,
    resolutions?: Record<string, FieldResolution>,
    renameResolutions?: SchemaRenameResolution[],
    localized?: boolean
  ) => Promise<SchemaApplyResponse>;
  readonly remove: (slug: string) => Promise<{ message: string }>;
  readonly getDocument: (
    slug: string,
    options?: {
      depth?: number;
      // i18n: read the document in this content language. `fallbackLocale: "none"` returns
      // untranslated fields empty (admin editor); `translationStatus` attaches the per-locale
      // `_translations` map for the language pills. Omitted params no-op for non-localized singles.
      locale?: string;
      fallbackLocale?: string;
      translationStatus?: boolean;
      /**
       * Opt into the working-draft overlay, so an editor sees this Single's
       * pending change rather than the published document. Gated server-side on
       * an update-capability probe, so passing it never widens what a
       * read-only caller can see.
       */
      draft?: boolean;
    }
  ) => Promise<SingleDocument>;
  readonly updateDocument: (
    slug: string,
    data: Record<string, unknown>,
    options?: { locale?: string; keepalive?: boolean }
  ) => Promise<SingleDocument>;
  readonly publishAllLocales: (
    slug: string,
    version?: EveryLanguageVersion
  ) => Promise<{
    id: string;
    status?: string;
    languages?: PublishAllLanguageOutcome[];
  }>;
  readonly previewPublishAllLocales: (
    slug: string
  ) => Promise<PublishAllPreview>;
};

/**
 * Single API client object with all operations.
 *
 * The `protectedApi.*` calls below receive the raw canonical body:
 * list endpoints emit `ListResponse<T>`, bare reads (get, getSchema,
 * getDocument) return the doc directly, and mutations return
 * `MutationResponse<T>`. We project to the legacy shapes existing
 * callers expect (bare arrays for `list`, `{ message, data }` for
 * `create`, etc.).
 */
export const singleApi: SingleApiType = {
  fetchSingles,
  deleteSingle,

  /**
   * List all Singles.
   */
  list: async (): Promise<ApiSingle[]> => {
    const result = await protectedApi.get<ListResponse<ApiSingle>>("/singles");
    return result.items;
  },

  /**
   * Get a Single by slug.
   *
   * gated by `requireSingleAccess`). Without bypassing the default
   * published-only filter, a freshly-created status-enabled Single
   * comes back 404 because the auto-create path defaults the new doc
   * to `status='draft'`. Public REST callers omit this param and
   * continue to get the safe published-only default. Mirrors the
   * collection-side fix in `entryApi.findByID`.
   */
  get: async (slug: string): Promise<ApiSingle> => {
    return protectedApi.get<ApiSingle>(`/singles/${slug}?status=all`);
  },

  /**
   * Get the schema for a Single.
   */
  getSchema: async (slug: string): Promise<ApiSingle> => {
    return protectedApi.get<ApiSingle>(`/singles/${slug}/schema`);
  },

  /**
   * Create a new Single.
   */
  create: async (
    payload: UpdateSinglePayload
  ): Promise<{ message: string; data: ApiSingle }> => {
    const result = await protectedApi.post<MutationResponse<ApiSingle>>(
      "/singles",
      payload
    );
    // Preserve the legacy `{ message, data }` projection for callers; map
    // the canonical `item` field into `data`.
    return { message: result.message, data: result.item };
  },

  /**
   * Update an existing Single's schema/metadata.
   *
   * This updates the Single's schema definition (fields, label, description, admin options).
   * For updating the Single's document data (actual content values), use `updateDocument()`.
   */
  update: async (
    slug: string,
    payload: UpdateSinglePayload
  ): Promise<{ message: string }> => {
    const result = await protectedApi.patch<MutationResponse<ApiSingle>>(
      `/singles/${slug}/schema`,
      payload
    );
    return { message: result.message };
  },

  /**
   * Preview single schema changes — dry-run diff with rename candidates.
   * Mirrors schemaApi.preview() for collections.
   */
  previewSchemaChanges: async (
    slug: string,
    fields: unknown[],
    // i18n: mirrors schemaApi.preview — the preview collects the resolutions
    // the apply runs with, so both have to diff against the same localization
    // state or the apply can need a prompt the preview never showed.
    localized?: boolean,
    // The pending Draft/Published toggle, so a field taking one of the lifecycle's own names is
    // refused when the same save turns the lifecycle on. Judged with, never applied: the settings
    // save that follows the fields sets it. Undefined leaves the stored flag alone in charge.
    status?: boolean
  ): Promise<SchemaPreviewResponse> => {
    return protectedApi.post<SchemaPreviewResponse>(
      `/singles/schema/${slug}/preview`,
      {
        fields,
        ...(localized !== undefined ? { localized } : {}),
        ...(status !== undefined ? { status } : {}),
      }
    );
  },

  /**
   * Apply confirmed single schema changes via PushSchemaPipeline.
   * Mirrors schemaApi.apply() for collections.
   */
  applySchemaChanges: async (
    slug: string,
    fields: unknown[],
    schemaVersion: number,
    resolutions?: Record<string, FieldResolution>,
    renameResolutions?: SchemaRenameResolution[],
    // i18n: the current Internationalization toggle, so an apply that flips i18n AND changes
    // fields provisions the companion in the same request instead of reading a stale registry
    // flag. Undefined leaves the persisted value untouched.
    localized?: boolean,
    // The pending Draft/Published toggle, judged with as the preview is (see above).
    status?: boolean
  ): Promise<SchemaApplyResponse> => {
    const result = await protectedApi.post<
      ActionResponse<{ newSchemaVersion: number; toastSummary?: string }>
    >(`/singles/schema/${slug}/apply`, {
      fields,
      confirmed: true,
      schemaVersion,
      resolutions,
      renameResolutions,
      ...(localized !== undefined ? { localized } : {}),
      ...(status !== undefined ? { status } : {}),
    });
    return {
      success: true,
      message: result.message,
      newSchemaVersion: result.newSchemaVersion,
      toastSummary: result.toastSummary,
    };
  },

  /**
   * Remove a Single.
   */
  remove: async (slug: string): Promise<{ message: string }> => {
    // Single delete is a respondAction (`{ message, slug }`) in the
    // dispatcher; the message field is shared between mutation and action
    // shapes, so we type the broader MutationResponse and read `message`.
    const result = await protectedApi.delete<MutationResponse<unknown>>(
      `/singles/${slug}`
    );
    return { message: result.message };
  },

  // ============================================================
  // DOCUMENT OPERATIONS
  // These operate on the actual Single document data, not the schema
  // ============================================================

  /**
   * Get a Single's document data.
   */
  getDocument: async (
    slug: string,
    options?: {
      depth?: number;
      // i18n: read the document in this content language. `fallbackLocale: "none"` returns
      // untranslated fields empty (admin editor); `translationStatus` attaches the per-locale
      // `_translations` map for the language pills. Omitted params no-op for non-localized singles.
      locale?: string;
      fallbackLocale?: string;
      translationStatus?: boolean;
      /**
       * Opt into the working-draft overlay, so an editor sees this Single's
       * pending change rather than the published document. Gated server-side on
       * an update-capability probe, so passing it never widens what a
       * read-only caller can see.
       */
      draft?: boolean;
    }
  ): Promise<SingleDocument> => {
    const params = new URLSearchParams();
    if (options?.depth !== undefined) {
      params.set("depth", String(options.depth));
    }
    if (options?.locale) params.set("locale", options.locale);
    // Server reads the hyphenated `fallback-locale` (see singles-detail route).
    if (options?.fallbackLocale) {
      params.set("fallback-locale", options.fallbackLocale);
    }
    if (options?.translationStatus) params.set("translation-status", "1");
    if (options?.draft) params.set("draft", "1");
    // context is trusted; pass status=all so a freshly-created Single
    // (auto-created with status='draft') is reachable. Without this
    // the user sees "Not found." on the page
    // they just navigated to from "+ New Single".
    params.set("status", "all");
    const query = params.toString();
    // The /singles/[slug] endpoint returns document data
    const url = `/singles/${slug}${query ? `?${query}` : ""}`;
    return protectedApi.get<SingleDocument>(url);
  },

  /**
   * Update a Single's document data.
   */
  updateDocument: async (
    slug: string,
    data: Record<string, unknown>,
    // i18n: `?locale=de` stores the translatable values for German only (the shared
    // columns are still updated). Omitted for non-localized singles.
    // `keepalive` asks for an update that outlives the page (lib/api/keepalive).
    options?: { locale?: string; keepalive?: boolean }
  ): Promise<SingleDocument> => {
    const query = new URLSearchParams();
    if (options?.locale) query.set("locale", options.locale);
    const qs = query.toString();
    const result = await protectedApi.patch<MutationResponse<SingleDocument>>(
      `/singles/${slug}${qs ? `?${qs}` : ""}`,
      data,
      keepaliveOptions(data, options?.keepalive)
    );
    return result.item;
  },

  /**
   * Publish every language of a Single at once.
   *
   * Hits `POST /api/singles/{slug}/publish-all`, which moves the main status
   * and every companion `_status` in one transaction — so the document is never
   * observable with some languages live and others not.
   */
  publishAllLocales: async (
    slug: string,
    /**
     * The version of every language, as a read of every language gives it: a
     * publish of every language is refused when any of them changed since.
     * Or the overwrite choice, from a caller refused that read.
     */
    version?: EveryLanguageVersion
  ): Promise<{
    id: string;
    status?: string;
    languages?: PublishAllLanguageOutcome[];
  }> => {
    // The route answers with the action envelope (`{ message, ...data }`)
    // rather than a document, since publishing changes status and returns no
    // content the editor did not already have. It carries each language's
    // outcome, which the result message names language by language.
    return protectedApi.post<{
      message: string;
      slug: string;
      id: string;
      status?: string;
      languages?: PublishAllLanguageOutcome[];
    }>(`/singles/${slug}/publish-all`, everyLanguageBody(version));
  },

  /**
   * What publishing every language of a Single would do, language by
   * language, without doing it: asked as the publish is, and writing nothing.
   * Hits `GET /api/singles/{slug}/publish-all`.
   */
  previewPublishAllLocales: async (slug: string): Promise<PublishAllPreview> =>
    protectedApi.get<PublishAllPreview>(`/singles/${slug}/publish-all`),
} as const;

// ============================================================
// Types
// ============================================================

/**
 * Single document data - the actual content stored in a Single.
 * This is distinct from ApiSingle which represents the schema/metadata.
 */
export interface SingleDocument {
  /** Unique document ID */
  id: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Dynamic field values based on Single schema */
  [key: string]: unknown;
}
