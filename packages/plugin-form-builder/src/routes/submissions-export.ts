/**
 * The submissions export, at
 * `/api/plugins/@nextlyhq/plugin-form-builder/submissions/export`: what a
 * submissions list shows, as a CSV headed by one form's labels or as JSON.
 *
 * It exports either every submission a list's scope matches (its form, status
 * tab and dates, read from the address with the list's own functions, so the
 * file holds what the list shows), or, given `ids`, exactly those submissions:
 * the rows ticked in the list, and none beside them.
 *
 * Secure by default: gated by the custom `export-submissions` permission, and
 * read as the signed-in person through the secure-by-default service path, so
 * their read rules apply to every row. It resolves its own collections through
 * `ctx.self`, so a renamed install exports from the right tables. The
 * canonical `contributes.routes` example third-party authors copy.
 *
 * @module routes/submissions-export
 */

import type { PluginRoute, PluginRouteContext } from "nextly";
import { z } from "zod";

import {
  listWhere,
  scopeFromSearch,
  type SubmissionListScope,
} from "../admin/components/submissions/submission-list-scope";
import { asFormDocument, asSubmissionDocuments } from "../document-shapes";
import type { ResolvedFormBuilderConfig } from "../types";
import { exportToCSV, generateExportFilename } from "../utils/export-formats";

import { installedSlugs } from "./public-forms";

/**
 * The most rows one export holds. Past it the export is cut short and says
 * so in a header, never silently: an unbounded read of a busy form's table
 * would hold all of it in memory.
 */
const MAX_EXPORT_ROWS = 50_000;

/** How many rows each read of the export asks for. */
const READ_PAGE_SIZE = 200;

/** The most submissions one export may name: a list's page shows far fewer. */
const MAX_IDS = 500;

/** The ticked rows an export names, as the list sends them. */
const IDS = z.array(z.string().trim().min(1).max(128)).min(1).max(MAX_IDS);

/** What one export asks for. */
interface ExportRequest {
  format: "csv" | "json";
  scope: SubmissionListScope;
  /** Exactly these submissions, when rows were ticked. */
  ids?: string[];
}

/** The request read from its address, or why it cannot be answered. */
function readRequest(url: URL): ExportRequest | string {
  const params = url.searchParams;
  const named = params.get("ids");
  const ids = named === null ? undefined : IDS.safeParse(named.split(","));
  if (ids !== undefined && !ids.success) {
    return `"ids" names 1 to ${MAX_IDS} submissions, separated by commas.`;
  }
  return {
    format: params.get("format") === "csv" ? "csv" : "json",
    scope: scopeFromSearch(url.search),
    ...(ids === undefined ? {} : { ids: ids.data }),
  };
}

/**
 * Which submissions the export reads. Ticked rows are exported as ticked,
 * whatever their status is by now, but only from the form named, so a CSV
 * headed by one form's labels never holds another form's row.
 */
function exportWhere(request: ExportRequest): Record<string, unknown> {
  if (request.ids === undefined) return listWhere(request.scope);
  return {
    id: { in: request.ids },
    ...(request.scope.form ? { form: { equals: request.scope.form } } : {}),
  };
}

/** A refused export, in the canonical error envelope. */
function refusal(status: 400 | 404, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/** How the export reads: as the signed-in person, under their read rules. */
function readerOf(ctx: PluginRouteContext) {
  return { as: "user", user: ctx.user ?? undefined } as const;
}

/** The form a CSV is headed by, read as the person; none if they cannot. */
async function readForm(
  ctx: PluginRouteContext,
  formsSlug: string,
  formId: string
): Promise<Record<string, unknown> | undefined> {
  const found = await ctx.services.collections.listEntries(
    formsSlug,
    { where: { id: { equals: formId } } },
    readerOf(ctx)
  );
  return found.data[0];
}

/**
 * Every submission `where` matches, newest first as the list orders them,
 * page by page up to MAX_EXPORT_ROWS, and whether rows were left out.
 */
async function readRows(
  ctx: PluginRouteContext,
  slug: string,
  where: Record<string, unknown>
): Promise<{ items: Record<string, unknown>[]; truncated: boolean }> {
  const items: Record<string, unknown>[] = [];
  for (let page = 1; ; page += 1) {
    const result = await ctx.services.collections.listEntries(
      slug,
      {
        where,
        sort: { field: "submittedAt", direction: "desc" },
        pagination: { limit: READ_PAGE_SIZE, page },
      },
      readerOf(ctx)
    );
    items.push(...result.data);
    const pageWasFull = result.data.length === READ_PAGE_SIZE;
    if (items.length >= MAX_EXPORT_ROWS) {
      const truncated = pageWasFull || items.length > MAX_EXPORT_ROWS;
      return { items: items.slice(0, MAX_EXPORT_ROWS), truncated };
    }
    if (!pageWasFull) return { items, truncated: false };
  }
}

/** The headers every export answers with: the file's name, and any cut. */
function fileHeaders(
  filename: string,
  truncated: boolean
): Record<string, string> {
  return {
    "Content-Disposition": `attachment; filename="${filename}"`,
    ...(truncated ? { "X-Export-Truncated": "true" } : {}),
  };
}

/** The rows as a CSV headed by `form`'s labels. */
function csvResponse(
  items: Record<string, unknown>[],
  form: Record<string, unknown>,
  truncated: boolean
): Response {
  // The service returns parsed entries; the export helpers declare the
  // document shapes, read at this boundary.
  const csv = exportToCSV(asSubmissionDocuments(items), asFormDocument(form));
  const filename = generateExportFilename(
    typeof form.slug === "string" ? form.slug : "form",
    "csv"
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      ...fileHeaders(filename, truncated),
    },
  });
}

/** The export route, reading this install's collections. */
export function submissionsExportRoute(
  config: ResolvedFormBuilderConfig
): PluginRoute {
  return {
    method: "GET",
    path: "/submissions/export",
    requiredPermission: "export-submissions",
    handler: async (req, ctx) => {
      const request = readRequest(new URL(req.url));
      if (typeof request === "string") {
        return refusal(400, "VALIDATION_ERROR", request);
      }
      const slugs = installedSlugs(config, ctx.self);

      // A CSV's columns come from one form's fields, so the form is read
      // BEFORE any submission: a request that cannot be answered fails fast
      // instead of reading the whole table first.
      let form: Record<string, unknown> | undefined;
      if (request.format === "csv") {
        if (!request.scope.form) {
          return refusal(
            400,
            "VALIDATION_ERROR",
            "CSV export requires a form parameter."
          );
        }
        form = await readForm(ctx, slugs.forms, request.scope.form);
        if (!form) return refusal(404, "NOT_FOUND", "Form not found.");
      }

      const { items, truncated } = await readRows(
        ctx,
        slugs.submissions,
        exportWhere(request)
      );
      if (form) return csvResponse(items, form, truncated);
      return Response.json(
        { items },
        { headers: fileHeaders(generateExportFilename("form", "json"), truncated) }
      );
    },
  };
}
