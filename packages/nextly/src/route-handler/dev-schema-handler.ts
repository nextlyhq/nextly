/**
 * Dev-only write API for `ui-schema.json` (spec §4.12.3).
 *
 * Endpoints (mounted only when NODE_ENV === "development"; see routeHandler):
 *   POST   /admin/api/_dev/schema/collection         upsert a collection
 *   DELETE /admin/api/_dev/schema/collection/:slug    remove a collection
 *   POST   /admin/api/_dev/schema/single             upsert a single
 *   DELETE /admin/api/_dev/schema/single/:slug        remove a single
 *   POST   /admin/api/_dev/schema/component          upsert a component
 *   DELETE /admin/api/_dev/schema/component/:slug     remove a component
 *
 * Each write loads the current manifest, applies the change, re-validates the
 * whole manifest (Layer 4 — `mutateManifest` throws NEXTLY_UI_SCHEMA_INVALID on
 * failure), then serializes via the deterministic writer and writes the file.
 *
 * @module route-handler/dev-schema-handler
 * @since v0.0.3-alpha (Plan D3)
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { respondAction } from "../api/response-shapes";
import { withErrorHandler } from "../api/with-error-handler";
import { serializeUiSchema } from "../cli/utils/ui-schema-writer";
import { loadUiSchema } from "../domains/schema/ui-schema/loader";
import {
  mutateManifest,
  type ManifestKind,
} from "../domains/schema/ui-schema/mutate";
import { NextlyError } from "../errors";

import { getHandlerConfig } from "./auth-handler";

const KIND_BY_SEGMENT: Record<string, ManifestKind> = {
  collection: "collections",
  single: "singles",
  component: "components",
};

function notFound(): Response {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Handle `/admin/api/_dev/schema/*`. `params` is the route-handler segment
 * array, e.g. `["_dev", "schema", "collection", "events"]`.
 */
export const handleDevSchemaRequest = withErrorHandler(
  async (
    req: Request,
    params: string[],
    method: "POST" | "DELETE"
  ): Promise<Response> => {
    // Defense in depth — the routeHandler branch already gates on NODE_ENV.
    if (process.env.NODE_ENV !== "development") return notFound();
    if (params[1] !== "schema") return notFound();

    const kind = KIND_BY_SEGMENT[params[2] ?? ""];
    if (!kind) return notFound();

    const config = getHandlerConfig();
    if (!config) {
      throw new NextlyError({
        code: "INTERNAL_ERROR",
        publicMessage: "Nextly config not initialized.",
      });
    }
    const projectRoot = process.cwd();
    const uiSchemaFile = config.db.uiSchemaFile;
    const current = await loadUiSchema({ projectRoot, uiSchemaFile });

    let next;
    if (method === "POST" && params[3] === undefined) {
      let body: unknown;
      try {
        const text = await req.text();
        body = text ? JSON.parse(text) : {};
      } catch {
        throw new NextlyError({
          code: "VALIDATION_ERROR",
          publicMessage: "Invalid JSON in request body.",
        });
      }
      next = mutateManifest(current, { type: "upsert", kind, entity: body });
    } else if (method === "DELETE" && params[3] !== undefined) {
      next = mutateManifest(current, {
        type: "delete",
        kind,
        slug: params[3],
      });
    } else {
      return notFound();
    }

    await writeFile(
      resolve(projectRoot, uiSchemaFile),
      serializeUiSchema(next),
      "utf-8"
    );
    return respondAction("ui-schema updated", { kind });
  }
);
