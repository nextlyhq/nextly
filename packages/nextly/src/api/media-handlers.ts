/**
 * Dynamic Media Route Handler
 *
 * Creates HTTP method handlers for Next.js media API routes using a catch-all pattern.
 * This provides a single handler that routes all media operations (files, folders).
 *
 * Uses a single catch-all route to handle all media-related endpoints,
 * simplifying the consumer's route structure.
 *
 * **IMPORTANT:** For storage plugins (S3, Vercel Blob, etc.) to work, you must
 * initialize Nextly with your config before these routes are called. The recommended
 * approach is to use Next.js instrumentation:
 *
 * ```typescript
 * // src/instrumentation.ts
 * export async function register() {
 *   if (process.env.NEXT_RUNTIME === "nodejs") {
 *     const { getNextly } = await import("nextly");
 *     const nextlyConfig = (await import("./nextly.config")).default;
 *     await getNextly({ config: nextlyConfig });
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/media/[[...path]]/route.ts
 * import { createMediaHandlers } from 'nextly/api/media-handlers';
 *
 * const handlers = createMediaHandlers();
 * export const GET = handlers.GET;
 * export const POST = handlers.POST;
 * export const PATCH = handlers.PATCH;
 * export const DELETE = handlers.DELETE;
 * ```
 *
 * Supported Routes:
 * - GET    /api/media                        - List media with pagination
 * - POST   /api/media                        - Upload new media file
 * - GET    /api/media/:id                    - Get media by ID
 * - PATCH  /api/media/:id                    - Update media metadata
 * - DELETE /api/media/:id                    - Delete media file
 * - PATCH  /api/media/:id/move               - Move media to folder
 * - GET    /api/media/folders                - List folders
 * - POST   /api/media/folders                - Create folder
 * - GET    /api/media/folders/:id            - Get folder by ID
 * - PATCH  /api/media/folders/:id            - Update folder
 * - DELETE /api/media/folders/:id            - Delete folder
 * - GET    /api/media/folders/:id/contents   - Get folder contents
 * - GET    /api/media/folders/root/contents  - Get root folder contents
 * - GET    /api/media/counts                 - Every folder's and view's item count
 * - GET    /api/media/:id/usage              - The documents using a media item
 * - POST   /api/media/:id/replace            - Replace an item's file, keeping the item
 * - POST   /api/media/deletions              - Delete items, undoable for 10 s
 * - POST   /api/media/deletions/undo         - Bring back items inside the window
 *
 * @module api/media-handlers
 */

import { z } from "zod";

import { LIST_READ_GATES, requireListRead } from "../auth/list-read-gates";
import {
  createJsonErrorResponse,
  isErrorResponse,
  isVisitorRefusal,
  requirePermission,
  type AuthContext,
} from "../auth/middleware";
import { actorFromAuthContext, type RequestActor } from "../auth/request-actor";
import { visitorReadsSystemResource } from "../auth/resource-readable";
import type { SanitizedNextlyConfig } from "../collections/config/define-config";
import { getService } from "../di";
import { SYSTEM_READ_POLICY } from "../domains/auth/system-write-policy";
import type { PendingMediaDeletes } from "../domains/media/pending-delete";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly, getNextly, type GetNextlyOptions } from "../init";
import { withTimezoneFormatting } from "../lib/date-formatting";
import { getNextlyLogger } from "../observability/logger";
import type {
  MediaService,
  ListMediaOptions,
} from "../services/media/media-service";
import type { RequestContext } from "../services/shared";
import { resolveClaimedMimeType } from "../services/upload-validation/mime";
import {
  mediaPageQuerySchema,
  mediaViewSchema,
  UploadMediaInputSchema,
  UpdateMediaInputSchema,
  type MediaPageQuery,
} from "../types/media";

import { executeBulkDelete } from "./media-bulk";
import { handleServeMediaBytes } from "./media-raw";
import { readJsonBody } from "./read-json-body";
import {
  respondAction,
  respondData,
  respondDoc,
  respondList,
  respondMutation,
} from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

// ============================================================
// Types
// ============================================================

/**
 * Route context for Next.js App Router dynamic routes.
 */
export interface RouteContext {
  params: Promise<{ path?: string[] }>;
}

/**
 * Options for creating media handlers.
 */
export interface MediaHandlerOptions {
  /**
   * Nextly configuration object.
   * Pass this to ensure storage plugins are available even if
   * instrumentation hasn't run in this worker process.
   */
  config?: SanitizedNextlyConfig;
  /**
   * Gate every operation behind a media permission and take the acting
   * identity from the authenticated session/API key rather than the request
   * body. Use this for the admin-facing mount (`/admin/api/media`), where the
   * `Path=/admin` session cookie can reach. The public mount omits it and
   * serves reads only. Off by default so existing public mounts are unchanged
   * in shape (their write verbs stop serving — see below).
   */
  requireAuth?: boolean;
}

let handlerConfig: GetNextlyOptions | undefined;

// ============================================================
// Authorization
// ============================================================

/**
 * The media permission action each route requires. Reads gate on `read`,
 * writes on the verb they perform. `move-media` is an update (it changes the
 * file's folder), and every `*-folder` mutation gates on the same action as
 * the equivalent media mutation.
 */
const MEDIA_ACTION_BY_ROUTE: Partial<
  Record<ParsedMediaRoute["type"], "create" | "read" | "update" | "delete">
> = {
  "list-media": "read",
  "get-media": "read",
  "list-folders": "read",
  "get-folder": "read",
  "get-folder-contents": "read",
  "get-root-contents": "read",
  "media-counts": "read",
  "media-usage": "read",
  "upload-media": "create",
  "create-folder": "create",
  "update-media": "update",
  "replace-media": "update",
  "move-media": "update",
  "update-folder": "update",
  "delete-media": "delete",
  "delete-folder": "delete",
  "bulk-delete-media": "delete",
  // Both halves of a delete that can be undone ask the delete permission,
  // checked by the gate before either writes or removes a mark.
  "delete-media-later": "delete",
  "undo-delete-media": "delete",
};

/** Route types that only read — the sole surface the public mount serves. */
const READ_ROUTE_TYPES = new Set<ParsedMediaRoute["type"]>([
  "list-media",
  "get-media",
  "list-folders",
  "get-folder",
  "get-folder-contents",
  "get-root-contents",
  "media-counts",
]);

/**
 * Gate a parsed route.
 *
 * - Public mount (`requireAuth` false): reads pass; any write is not served
 *   here at all — it 404s exactly like an unknown path, so the public surface
 *   never exposes a write endpoint. Writes live only on the gated admin mount.
 * - Admin mount (`requireAuth` true): every operation is checked with
 *   `requirePermission(req, action, "media")`, which authenticates the session
 *   or API key and verifies the matching `{action}-media` permission. On
 *   success the acting user id is returned so writes attribute to the real
 *   caller, never a client-supplied `uploadedBy`/`createdBy`. A read by a
 *   visitor, a request carrying no credential, is judged by the one decision
 *   with the Public role's grants (`read-media`), as a checked Direct API read
 *   naming nobody is: allowed, it is served with no caller; refused, it keeps
 *   the sign-in answer, since signing in could grant it. A write always needs
 *   a signed-in caller.
 *
 * Returns a `Response` to short-circuit (401/403), or the acting identity.
 */
async function gateMediaRoute(
  request: Request,
  route: ParsedMediaRoute,
  path: string[] | undefined,
  method: string,
  requireAuth: boolean
): Promise<
  { authUserId?: string; actor?: RequestActor; auth?: AuthContext } | Response
> {
  if (!requireAuth) {
    if (!READ_ROUTE_TYPES.has(route.type)) {
      throwUnmatchedRoute(path, method);
    }
    return {};
  }

  const action = MEDIA_ACTION_BY_ROUTE[route.type];
  // Unknown/unsupported route type: let the verb switch produce its 404.
  if (!action) {
    return {};
  }

  // The permission check reads from the DI container, so make sure Nextly is
  // initialised on this worker before it runs.
  await ensureInitialized();
  // The list's gate is the one the dashboard's media count reads.
  const auth =
    route.type === "list-media"
      ? await requireListRead(request, LIST_READ_GATES.media)
      : await requirePermission(request, action, "media");
  if (isErrorResponse(auth)) {
    if (
      READ_ROUTE_TYPES.has(route.type) &&
      isVisitorRefusal(auth) &&
      // The resource the media read policy names, so a visitor's read is
      // asked of the same grant an authenticated reader's is.
      (await visitorReadsSystemResource(SYSTEM_READ_POLICY.media.read.resource))
    ) {
      return {};
    }
    return createJsonErrorResponse(auth, request);
  }
  // Surface both the acting user id (for uploader attribution on the DB row)
  // and the full actor (session vs API key) so media writes record the true
  // caller on their outbox events.
  // The whole auth context too, for a read that answers by what the caller
  // may read (where an item is used).
  return {
    authUserId: auth.userId,
    actor: actorFromAuthContext(auth),
    auth,
  };
}

// ============================================================
// Helper Functions
// ============================================================

async function ensureInitialized(): Promise<void> {
  // Two paths: if the host called createMediaHandlers({ config }) we have a
  // config to bootstrap with — use getNextly to initialise the storage plugins
  // on this worker. Otherwise we rely on whoever set up instrumentation.ts and
  // just resolve the cached instance via getCachedNextly().
  if (handlerConfig?.config) {
    await getNextly(handlerConfig);
  } else {
    await getCachedNextly();
  }
}

async function getMediaService(): Promise<MediaService> {
  await ensureInitialized();
  return getService("mediaService");
}

function createRequestContext(): RequestContext {
  return {};
}

function createAuthenticatedContext(userId: string): RequestContext {
  return {
    user: {
      id: userId,
      email: `${userId}@api.local`,
      role: "user",
      permissions: [],
    },
  };
}

// ============================================================
// Route Parsing
// ============================================================

interface ParsedMediaRoute {
  type:
    | "list-media"
    | "upload-media"
    | "get-media"
    | "update-media"
    | "delete-media"
    | "move-media"
    | "serve-media-bytes"
    | "bulk-delete-media"
    | "list-folders"
    | "create-folder"
    | "get-folder"
    | "update-folder"
    | "delete-folder"
    | "get-folder-contents"
    | "get-root-contents"
    | "media-counts"
    | "media-usage"
    | "replace-media"
    | "delete-media-later"
    | "undo-delete-media"
    | "not-found";
  mediaId?: string;
  folderId?: string;
}

function parseMediaRoute(
  path: string[] | undefined,
  method: string
): ParsedMediaRoute {
  const segments = path || [];

  if (segments.length === 0) {
    if (method === "GET") return { type: "list-media" };
    if (method === "POST") return { type: "upload-media" };
    return { type: "not-found" };
  }

  // "counts" and "bulk" must be matched before the generic
  // segments.length === 1 block so neither is mistaken for a media ID.
  if (segments[0] === "counts" && segments.length === 1) {
    if (method === "GET") return { type: "media-counts" };
    return { type: "not-found" };
  }

  // "deletions" is matched before the generic one- and two-segment blocks
  // so it is never read as a media id.
  if (segments[0] === "deletions") {
    if (segments.length === 1 && method === "POST") {
      return { type: "delete-media-later" };
    }
    if (segments.length === 2 && segments[1] === "undo" && method === "POST") {
      return { type: "undo-delete-media" };
    }
    return { type: "not-found" };
  }

  if (segments[0] === "bulk" && segments.length === 1) {
    if (method === "DELETE") return { type: "bulk-delete-media" };
    return { type: "not-found" };
  }

  if (segments[0] === "folders") {
    if (segments.length === 1) {
      if (method === "GET") return { type: "list-folders" };
      if (method === "POST") return { type: "create-folder" };
      return { type: "not-found" };
    }

    if (segments[1] === "root" && segments[2] === "contents") {
      if (method === "GET") return { type: "get-root-contents" };
      return { type: "not-found" };
    }

    if (segments.length === 3 && segments[2] === "contents") {
      if (method === "GET")
        return { type: "get-folder-contents", folderId: segments[1] };
      return { type: "not-found" };
    }

    if (segments.length === 2) {
      if (method === "GET")
        return { type: "get-folder", folderId: segments[1] };
      if (method === "PATCH")
        return { type: "update-folder", folderId: segments[1] };
      if (method === "DELETE")
        return { type: "delete-folder", folderId: segments[1] };
      return { type: "not-found" };
    }

    return { type: "not-found" };
  }

  if (segments.length === 2 && segments[1] === "raw") {
    if (method === "GET")
      return { type: "serve-media-bytes", mediaId: segments[0] };
    return { type: "not-found" };
  }

  if (segments.length === 2 && segments[1] === "usage") {
    if (method === "GET") return { type: "media-usage", mediaId: segments[0] };
    return { type: "not-found" };
  }

  if (segments.length === 2 && segments[1] === "replace") {
    if (method === "POST")
      return { type: "replace-media", mediaId: segments[0] };
    return { type: "not-found" };
  }

  if (segments.length === 2 && segments[1] === "move") {
    if (method === "PATCH") return { type: "move-media", mediaId: segments[0] };
    return { type: "not-found" };
  }

  if (segments.length === 1) {
    if (method === "GET") return { type: "get-media", mediaId: segments[0] };
    if (method === "PATCH")
      return { type: "update-media", mediaId: segments[0] };
    if (method === "DELETE")
      return { type: "delete-media", mediaId: segments[0] };
    return { type: "not-found" };
  }

  return { type: "not-found" };
}

/**
 * Throw a canonical 404 for paths/methods this dispatcher doesn't serve.
 * The unmatched path/method goes to `logContext` for operator debugging
 * while the public surface stays the canonical "Not found." sentence.
 */
function throwUnmatchedRoute(
  path: string[] | undefined,
  method: string
): never {
  throw NextlyError.notFound({
    logContext: {
      path: path ?? [],
      method,
      reason: "unmatched-media-route",
    },
  });
}

// ============================================================
// Media Operations
// ============================================================

async function handleListMedia(request: Request): Promise<Response> {
  const mediaService = await getMediaService();
  const { searchParams } = new URL(request.url);
  const context = createRequestContext();

  const folderIdParam = searchParams.get("folderId");
  const options: ListMediaOptions = {
    page: searchParams.get("page") ? Number(searchParams.get("page")) : 1,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : 24,
    search: searchParams.get("search") || undefined,
    type: (searchParams.get("type") as ListMediaOptions["type"]) || undefined,
    folderId: folderIdParam === "root" ? "root" : folderIdParam || undefined,
    view: parseAtBoundary(
      mediaViewSchema.optional(),
      searchParams.get("view") ?? undefined
    ),
    sortBy:
      (searchParams.get("sortBy") as ListMediaOptions["sortBy"]) ||
      "uploadedAt",
    sortOrder:
      (searchParams.get("sortOrder") as ListMediaOptions["sortOrder"]) ||
      "desc",
  };

  const result = await mediaService.listMedia(options, context);

  const page = options.page ?? 1;
  const limit = Math.max(1, options.limit ?? 24);
  const total = result.pagination.total;
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return respondList(result.data, {
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  });
}

/** The file a request sends as `file`, checked against the upload schema. */
async function uploadedFile(
  formData: FormData,
  uploadedBy: string
): Promise<{
  buffer: Buffer;
  filename: string;
  mimeType: string;
  size: number;
}> {
  const file = formData.get("file") as File | null;
  if (!file) {
    throw NextlyError.validation({
      errors: [
        { path: "file", code: "REQUIRED", message: "file is required." },
      ],
    });
  }

  // `file` is narrowed to File past the guard above.
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const input = {
    file: buffer,
    filename: file.name,
    mimeType: resolveClaimedMimeType(file.name, file.type, buffer),
    size: file.size,
    uploadedBy,
  };

  try {
    UploadMediaInputSchema.parse(input);
  } catch (err) {
    if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
    throw err;
  }
  // The type the schema ACCEPTED, not a second resolution of the same
  // question: validating one value and storing another means the record can
  // carry a type nothing checked.
  return {
    buffer,
    filename: file.name,
    mimeType: input.mimeType,
    size: file.size,
  };
}

async function handleUploadMedia(
  request: Request,
  authUserId: string,
  actor?: RequestActor
): Promise<Response> {
  const mediaService = await getMediaService();
  const formData = await request.formData();
  const folderId = formData.get("folderId") as string | null;

  // The uploader is the authenticated caller, resolved from the session/API
  // key — never a client-supplied `uploadedBy`, which could name anyone.
  const file = await uploadedFile(formData, authUserId);
  const context = createAuthenticatedContext(authUserId);

  const mediaFile = await mediaService.upload(
    { ...file, folderId: folderId || undefined },
    context,
    actor
  );

  return respondMutation("Media uploaded.", mediaFile, { status: 201 });
}

/**
 * Replace an item's file, keeping the item, with the file the request
 * sends, checked as an upload's is.
 */
async function handleReplaceMedia(
  request: Request,
  mediaId: string,
  authUserId: string,
  actor?: RequestActor
): Promise<Response> {
  const mediaService = await getMediaService();
  const file = await uploadedFile(await request.formData(), authUserId);
  const mediaFile = await mediaService.replaceFile(
    mediaId,
    file,
    createAuthenticatedContext(authUserId),
    actor
  );
  return respondMutation("Media file replaced.", mediaFile);
}

async function handleGetMedia(mediaId: string): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  const mediaFile = await mediaService.findById(mediaId, context);

  return respondDoc(mediaFile);
}

async function handleUpdateMedia(
  request: Request,
  mediaId: string,
  actor?: RequestActor
): Promise<Response> {
  const mediaService = await getMediaService();
  const body = await readJsonBody<Record<string, unknown>>(request);

  let validated: z.infer<typeof UpdateMediaInputSchema>;
  try {
    validated = UpdateMediaInputSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
    throw err;
  }

  const context = createRequestContext();

  const mediaFile = await mediaService.update(
    mediaId,
    validated,
    context,
    actor
  );

  return respondMutation("Media updated.", mediaFile);
}

async function handleDeleteMedia(
  mediaId: string,
  actor?: RequestActor
): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  await mediaService.delete(mediaId, context, actor);

  // Service returns void; surface the deleted id alongside the toast so the
  // admin can update its local cache without a follow-up fetch.
  return respondAction("Media deleted.", { id: mediaId });
}

async function handleMoveMedia(
  request: Request,
  mediaId: string,
  actor?: RequestActor
): Promise<Response> {
  const mediaService = await getMediaService();
  const body = await readJsonBody<Record<string, unknown>>(request);
  const folderId = body.folderId as string | null | undefined;
  const context = createRequestContext();

  // Thread the authenticated actor so the move's media.updated event is
  // attributed to the real user/API key instead of `system`.
  await mediaService.moveToFolder(mediaId, folderId ?? null, context, actor);

  // Service returns void; echo the target ids so the admin can update the
  // moved record locally without re-fetching the affected folders.
  return respondAction("Media moved.", {
    id: mediaId,
    folderId: folderId ?? null,
  });
}

async function handleBulkDeleteMedia(
  request: Request,
  actor?: RequestActor
): Promise<Response> {
  const mediaService = await getMediaService();
  return executeBulkDelete(
    request,
    mediaService,
    createRequestContext(),
    actor
  );
}

// ============================================================
// Folder Operations
// ============================================================

async function handleListFolders(request: Request): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  const { searchParams } = new URL(request.url);
  const root = searchParams.get("root") === "true";
  const parentId = searchParams.get("parentId");

  const folders =
    root || !parentId
      ? await mediaService.listRootFolders(context)
      : await mediaService.listSubfolders(parentId, context);

  // Folder listings are not server-paginated; use respondData with a named
  // field to keep the bare-array payload addressable without a synthetic
  // pagination envelope.
  return respondData({ folders });
}

async function handleCreateFolder(
  request: Request,
  authUserId: string
): Promise<Response> {
  const mediaService = await getMediaService();
  const body = await readJsonBody<Record<string, unknown>>(request);

  // Ignore any client-supplied `createdBy`; the creator is the authenticated
  // caller.
  const { createdBy: _ignoredCreatedBy, ...folderInput } = body as {
    createdBy?: string;
    name?: string;
    [k: string]: unknown;
  };

  if (!folderInput.name) {
    throw NextlyError.validation({
      errors: [
        { path: "name", code: "REQUIRED", message: "name is required." },
      ],
    });
  }

  const context = createAuthenticatedContext(authUserId);
  const folder = await mediaService.createFolder(
    folderInput as Parameters<MediaService["createFolder"]>[0],
    context
  );

  return respondMutation("Folder created.", folder, { status: 201 });
}

async function handleGetFolder(folderId: string): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  const folder = await mediaService.findFolderById(folderId, context);

  return respondDoc(folder);
}

async function handleUpdateFolder(
  request: Request,
  folderId: string
): Promise<Response> {
  const mediaService = await getMediaService();
  const body = await readJsonBody<Record<string, unknown>>(request);
  const context = createRequestContext();

  const folder = await mediaService.updateFolder(folderId, body, context);

  return respondMutation("Folder updated.", folder);
}

async function handleDeleteFolder(
  request: Request,
  folderId: string
): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  const { searchParams } = new URL(request.url);
  const deleteContents = searchParams.get("deleteContents") === "true";

  await mediaService.deleteFolder(folderId, deleteContents, context);

  // Service returns void; echo the deleted id so the admin can prune its
  // folder tree locally without a follow-up fetch.
  return respondAction("Folder deleted.", { id: folderId });
}

/** A folder's page query, parsed from the request's search parameters. */
function folderPageQuery(request: Request): MediaPageQuery {
  const { searchParams } = new URL(request.url);
  const raw: Record<string, string> = {};
  for (const key of [
    "page",
    "limit",
    "search",
    "type",
    "sortBy",
    "sortOrder",
  ]) {
    const value = searchParams.get(key);
    if (value !== null && value !== "") raw[key] = value;
  }
  return parseAtBoundary(mediaPageQuerySchema, raw);
}

/** `value` parsed by `schema`, or the request's validation error. */
function parseAtBoundary<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw nextlyValidationFromZod(parsed.error);
  return parsed.data;
}

async function handleGetFolderContents(
  request: Request,
  folderId: string
): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  const contents = await mediaService.getFolderContents(
    folderId,
    context,
    folderPageQuery(request)
  );

  // Folder contents is a structured object (folder, subfolders, mediaFiles,
  // breadcrumbs); ship it bare via respondData for non-CRUD reads.
  return respondData(contents as unknown as Record<string, unknown>);
}

async function handleGetRootContents(request: Request): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  const contents = await mediaService.getFolderContents(
    null,
    context,
    folderPageQuery(request)
  );

  return respondData(contents as unknown as Record<string, unknown>);
}

/**
 * The sidebar's counts: every folder's items, the items in no folder, and
 * each view's, from one query.
 */
async function handleMediaCounts(): Promise<Response> {
  const mediaService = await getMediaService();
  const counts = await mediaService.countLibrary(createRequestContext());
  return respondData(counts as unknown as Record<string, unknown>);
}

/** The Used in query: every use, or only those naming the item by address. */
const usageQuerySchema = z.object({
  byAddress: z
    .enum(["true", "false"])
    .optional()
    .transform(value => value === "true"),
});

/** The ids a delete or its Undo names: one to a hundred items. */
const deletionBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

/** The library reads that finish deletes whose window has ended. */
const LIBRARY_READS = new Set<ParsedMediaRoute["type"]>([
  "list-media",
  "get-folder-contents",
  "get-root-contents",
  "media-counts",
]);

/** The marks, over the booted adapter and the ordinary media delete. */
async function pendingDeletes(): Promise<PendingMediaDeletes> {
  const mediaService = await getMediaService();
  // Loaded when a delete or a read needs it, not with the handlers.
  const { PendingMediaDeletes } = await import(
    "../domains/media/pending-delete"
  );
  return new PendingMediaDeletes({
    db: getService("adapter"),
    deleteItem: (mediaId, actor) =>
      mediaService.delete(mediaId, createRequestContext(), actor),
    // The files a Replace kept for pages naming the item's old address.
    afterDelete: async mediaId => {
      const [{ removeKeptFiles }, { getMediaStorage }] = await Promise.all([
        import("../domains/media/usage/address-uses"),
        import("../storage/storage"),
      ]);
      await removeKeptFiles(
        getService("adapter"),
        getMediaStorage(),
        getService("logger"),
        mediaId
      );
    },
    logger: getNextlyLogger(),
  });
}

/**
 * Finish the deletes whose window has ended. A read never fails for it: what
 * is left is tried again by the next.
 */
async function sweepPendingDeletes(): Promise<void> {
  try {
    const pending = await pendingDeletes();
    await pending.finalizeDue();
  } catch (error) {
    getNextlyLogger().warn({
      kind: "media-delete-sweep-failed",
      message:
        "Deleted media items could not be finished; the next read tries again.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Delete items so that the delete can be undone: each is marked, leaves the
 * library at once, and is deleted with its files once the window ends, by a
 * timer here or by the next library read.
 */
async function handleDeleteMediaLater(
  request: Request,
  actor?: RequestActor
): Promise<Response> {
  const { ids } = parseAtBoundary(
    deletionBodySchema,
    await readJsonBody(request)
  );
  const pending = await pendingDeletes();
  const marked = await pending.mark(ids, actor);
  const { PENDING_DELETE_WINDOW_MS } = await import(
    "../domains/media/pending-delete"
  );
  // A moment after the window, so the marks are due when it runs. Unref'd:
  // a waiting delete never keeps a process alive, and the sweep covers one
  // that exits first.
  setTimeout(() => {
    void sweepPendingDeletes();
  }, PENDING_DELETE_WINDOW_MS + 500).unref?.();
  return respondAction("Media deleted.", {
    ids: marked.ids,
    deleteAfter: marked.deleteAfter,
  });
}

/** Bring back items deleted inside the window; say which had already gone. */
async function handleUndoDeleteMedia(request: Request): Promise<Response> {
  const { ids } = parseAtBoundary(
    deletionBodySchema,
    await readJsonBody(request)
  );
  const pending = await pendingDeletes();
  const undone = await pending.undo(ids);
  return respondAction(
    undone.gone.length === 0
      ? "Delete undone."
      : "Some items were already deleted.",
    { restored: undone.restored, gone: undone.gone }
  );
}

/**
 * The documents using one item that the caller may read, and the rest
 * counted by collection, read from the usage record. Served only on the
 * gated mount, since it names documents: the public mount answers it as an
 * unknown path. Per caller, so it is never cached for another.
 */
async function handleMediaUsage(
  request: Request,
  mediaId: string,
  auth: AuthContext | undefined
): Promise<Response> {
  // Only a gated mount reaches here, and it always carries the caller.
  if (!auth) throw NextlyError.authRequired();
  const mediaService = await getMediaService();
  // An item that does not exist is not found, rather than used by nothing.
  await mediaService.findById(mediaId, createRequestContext());
  // Loaded when it is asked, not with the handlers.
  const [{ readCaller, PRIVATE_NO_STORE_HEADERS }, { mediaUsesOf }, source] =
    await Promise.all([
      import("./authenticated-read"),
      import("../domains/media/usage/media-uses"),
      import("../domains/media/usage/media-uses-source"),
    ]);
  // `?byAddress=true` asks only for the uses naming the item by its
  // address, which keep the old file when it is replaced.
  const { byAddress } = parseAtBoundary(
    usageQuerySchema,
    Object.fromEntries(new URL(request.url).searchParams)
  );
  const uses = await mediaUsesOf(
    mediaId,
    source.bootedMediaUsesSource(getService("adapter"), await readCaller(auth)),
    { byAddressOnly: byAddress }
  );
  return respondList(
    uses.items,
    {
      total: uses.items.length,
      page: 1,
      limit: uses.items.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
      ...(uses.hidden.length > 0 ? { hidden: uses.hidden } : {}),
    },
    { headers: PRIVATE_NO_STORE_HEADERS }
  );
}

// ============================================================
// Public API
// ============================================================

/**
 * Create dynamic HTTP method handlers for Next.js media API routes
 *
 * Use with a catch-all route pattern: app/api/media/[[...path]]/route.ts
 *
 * @param options - Optional configuration including nextly config
 * @returns Object with handlers for GET, POST, PATCH, DELETE
 */
export function createMediaHandlers(options?: MediaHandlerOptions) {
  if (options?.config) {
    handlerConfig = { config: options.config };
  }
  // Captured per-instance, not module-level: one process can mount both a
  // public (reads only) and an admin (gated) instance, so this must not leak
  // between them.
  const requireAuth = options?.requireAuth ?? false;

  return {
    GET: withErrorHandler(
      async (request: Request, ctx: RouteContext): Promise<Response> => {
        const resolvedParams = await ctx.params;
        const route = parseMediaRoute(resolvedParams.path, "GET");
        /*
         * Answered BEFORE the gate, and deliberately: a browser fetching a
         * font carries no session, so on a gated mount this route would
         * otherwise answer 401 and the page would fall back to another face.
         * What keeps that safe is that the handler serves only the publicly
         * servable mime types and 404s everything else — the whole of its
         * access control, stated in one place.
         */
        if (route.type === "serve-media-bytes") {
          await ensureInitialized();
          return await handleServeMediaBytes(route.mediaId!, request);
        }
        const gate = await gateMediaRoute(
          request,
          route,
          resolvedParams.path,
          "GET",
          requireAuth
        );
        if (gate instanceof Response) return gate;

        // The library's reads finish any delete whose window ended while no
        // timer was left to finish it.
        if (LIBRARY_READS.has(route.type)) await sweepPendingDeletes();

        let response: Response;
        switch (route.type) {
          case "list-media":
            response = await handleListMedia(request);
            break;
          case "get-media":
            response = await handleGetMedia(route.mediaId!);
            break;
          case "list-folders":
            response = await handleListFolders(request);
            break;
          case "get-folder":
            response = await handleGetFolder(route.folderId!);
            break;
          case "get-folder-contents":
            response = await handleGetFolderContents(request, route.folderId!);
            break;
          case "get-root-contents":
            response = await handleGetRootContents(request);
            break;
          case "media-counts":
            response = await handleMediaCounts();
            break;
          case "media-usage":
            response = await handleMediaUsage(
              request,
              route.mediaId!,
              gate.auth
            );
            break;
          default:
            throwUnmatchedRoute(resolvedParams.path, "GET");
        }

        return withTimezoneFormatting(response);
      }
    ),

    POST: withErrorHandler(
      async (request: Request, ctx: RouteContext): Promise<Response> => {
        const resolvedParams = await ctx.params;
        const route = parseMediaRoute(resolvedParams.path, "POST");
        const gate = await gateMediaRoute(
          request,
          route,
          resolvedParams.path,
          "POST",
          requireAuth
        );
        if (gate instanceof Response) return gate;

        let response: Response;
        switch (route.type) {
          case "upload-media":
            response = await handleUploadMedia(
              request,
              gate.authUserId!,
              gate.actor
            );
            break;
          case "create-folder":
            response = await handleCreateFolder(request, gate.authUserId!);
            break;
          case "replace-media":
            response = await handleReplaceMedia(
              request,
              route.mediaId!,
              gate.authUserId!,
              gate.actor
            );
            break;
          case "delete-media-later":
            response = await handleDeleteMediaLater(request, gate.actor);
            break;
          case "undo-delete-media":
            response = await handleUndoDeleteMedia(request);
            break;
          default:
            throwUnmatchedRoute(resolvedParams.path, "POST");
        }

        return withTimezoneFormatting(response);
      }
    ),

    PATCH: withErrorHandler(
      async (request: Request, ctx: RouteContext): Promise<Response> => {
        const resolvedParams = await ctx.params;
        const route = parseMediaRoute(resolvedParams.path, "PATCH");
        const gate = await gateMediaRoute(
          request,
          route,
          resolvedParams.path,
          "PATCH",
          requireAuth
        );
        if (gate instanceof Response) return gate;

        let response: Response;
        switch (route.type) {
          case "update-media":
            response = await handleUpdateMedia(
              request,
              route.mediaId!,
              gate.actor
            );
            break;
          case "move-media":
            response = await handleMoveMedia(
              request,
              route.mediaId!,
              gate.actor
            );
            break;
          case "update-folder":
            response = await handleUpdateFolder(request, route.folderId!);
            break;
          default:
            throwUnmatchedRoute(resolvedParams.path, "PATCH");
        }

        return withTimezoneFormatting(response);
      }
    ),

    DELETE: withErrorHandler(
      async (request: Request, ctx: RouteContext): Promise<Response> => {
        const resolvedParams = await ctx.params;
        const route = parseMediaRoute(resolvedParams.path, "DELETE");
        const gate = await gateMediaRoute(
          request,
          route,
          resolvedParams.path,
          "DELETE",
          requireAuth
        );
        if (gate instanceof Response) return gate;

        let response: Response;
        switch (route.type) {
          case "delete-media":
            response = await handleDeleteMedia(route.mediaId!, gate.actor);
            break;
          case "delete-folder":
            response = await handleDeleteFolder(request, route.folderId!);
            break;
          case "bulk-delete-media":
            response = await handleBulkDeleteMedia(request, gate.actor);
            break;
          default:
            throwUnmatchedRoute(resolvedParams.path, "DELETE");
        }

        return withTimezoneFormatting(response);
      }
    ),
  };
}
