/**
 * The file routes of collections with `files`:
 *
 * - `POST /admin/api/files/:slug/uploads` starts an upload. Body
 *   `{ filename, mimeType, size, data? }`; answers 201
 *   `{ message, item: { id, upload: { url, method, headers, expiresAt } } }`.
 * - `POST /admin/api/files/:slug/uploads/:id/complete` confirms it. Answers
 *   200 `{ message, item: { id, fileStatus: "ready", filename, mimeType,
 *   size } }`, or 400 `FILE_REJECTED` / `FILE_NOT_UPLOADED`.
 *
 * A collection without `files`, an upload that does not exist and one that
 * is not the caller's are all answered with the same 404. A cookie-carried
 * write from another site is refused before anyone is recognised. Every
 * answer is marked private to its caller and never stored.
 *
 * @module api/file-routes
 * @experimental
 */
import { z } from "zod";

import { refuseCrossSiteWrite } from "../domains/files/file-caller";
import {
  completeUpload,
  startUpload,
  startUploadBody,
  type StartUploadBody,
} from "../domains/files/file-uploads";
import { NextlyError } from "../errors/nextly-error";
import { ensureServicesInitialized } from "../route-handler";

import { PRIVATE_NO_STORE_HEADERS } from "./authenticated-read";
import { respondMutation } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

/** The body of a start request, parsed at the boundary. */
async function startBody(request: Request): Promise<StartUploadBody> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw NextlyError.validation({
      errors: [
        {
          path: "",
          code: "invalid_json",
          message: "Request body is not valid JSON.",
        },
      ],
      logContext: { reason: "file-upload-invalid-json" },
    });
  }
  try {
    return startUploadBody.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) throw nextlyValidationFromZod(error);
    throw error;
  }
}

/**
 * Serve one file route, named by `method` as the route parser names it, for
 * the collection and upload in `routeParams`.
 */
export const handleFileRoute: (
  request: Request,
  method: string,
  routeParams: Record<string, string>
) => Promise<Response> = withErrorHandler(
  async (
    request: Request,
    method: string,
    routeParams: Record<string, string>
  ): Promise<Response> => {
    // Before the body is read or anyone recognised.
    refuseCrossSiteWrite(request);
    // A signed-in person's request carries no staff credential, which is
    // what boots the app for other routes, so this one boots it itself, from
    // the handler's own configuration, as the router would.
    await ensureServicesInitialized();
    const slug = routeParams.slug ?? "";
    switch (method) {
      case "startFileUpload": {
        const started = await startUpload(
          request,
          slug,
          await startBody(request)
        );
        return respondMutation("Upload started.", started, {
          status: 201,
          headers: PRIVATE_NO_STORE_HEADERS,
        });
      }
      case "completeFileUpload": {
        const done = await completeUpload(
          request,
          slug,
          routeParams.uploadId ?? ""
        );
        return respondMutation("Upload confirmed.", done, {
          headers: PRIVATE_NO_STORE_HEADERS,
        });
      }
      default:
        // Only a parser and switch that disagree reach this.
        throw NextlyError.notFound({
          logContext: { service: "files", method },
        });
    }
  }
);
