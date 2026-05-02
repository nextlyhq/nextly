/**
 * Forms dispatch handlers (public Form Builder API).
 *
 * Routes 3 operations — listForms, getFormBySlug, submitForm — against
 * the DI-registered `CollectionsHandler`. Forms and submissions are
 * stored as entries in the `forms` and `form-submissions` collections,
 * so all handlers are thin wrappers over `listEntries` / `createEntry`.
 *
 * `submitForm` additionally validates required fields and captures the
 * client IP / user-agent from the incoming `Request` for audit.
 *
 * Phase 4 Task 9: every handler returns a Response built via the
 * respondX helpers in `../../api/response-shapes.ts`. The dispatcher
 * passes the Response through unchanged. See spec §5.1 for the
 * canonical shape contract.
 */

import {
  respondAction,
  respondDoc,
  respondList,
} from "../../api/response-shapes";
import { NextlyError } from "../../errors";
import type { ServiceContainer } from "../../services";
import type { CollectionsHandler } from "../../services/collections-handler";
import { getCollectionsHandlerFromDI } from "../helpers/di";
// Phase 4.9: shared dispatcher helpers. Previously this file kept local
// copies of paginatedResponseToMeta + unwrapServiceResult. The local
// unwrap also lacked the Bug 6 fix (status 400 to NextlyError.validation);
// the shared version has it, so consolidating here brings form-dispatcher
// into spec compliance without per-call-site changes.
import {
  paginatedResponseToMeta,
  unwrapServiceResult,
} from "../helpers/service-envelope";
import { requireParam, toNumber } from "../helpers/validation";
import type { MethodHandler, Params } from "../types";

interface FormsServices {
  collectionsHandler: CollectionsHandler;
}

interface FormRecord {
  id: string;
  name: string;
  slug: string;
  fields: Array<{
    name: string;
    label: string;
    type: string;
    required?: boolean;
  }>;
  settings?: { successMessage?: string };
}

type PaginatedShape = {
  docs: unknown[];
  totalDocs: number;
  limit: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

const FORMS_METHODS: Record<string, MethodHandler<FormsServices>> = {
  listForms: {
    // Phase 4: respondList. listEntries returns the legacy
    // CollectionServiceResult wrapping a PaginatedResponse; we unwrap +
    // translate to canonical PaginationMeta so the wire shape matches
    // every other paginated read.
    execute: async (svc, p) => {
      const result = await svc.collectionsHandler.listEntries({
        collectionName: "forms",
        limit: toNumber(p.limit) || 100,
        page: toNumber(p.page) || 1,
        where: { status: { equals: "published" } },
      });
      const paginated = unwrapServiceResult<PaginatedShape>(result, {
        scope: "forms-list",
      });
      return respondList(paginated.docs, paginatedResponseToMeta(paginated));
    },
  },

  getFormBySlug: {
    // Phase 4: respondDoc. The "find by slug" use case uses listEntries
    // under the hood (we don't have a slug-keyed get endpoint on the
    // collections service), but the wire shape still wants a bare doc.
    // Missing-form throws NotFound so the dispatcher's error path emits
    // a canonical 404 response.
    execute: async (svc, p) => {
      const slug = requireParam(p, "slug", "Form slug");

      const result = await svc.collectionsHandler.listEntries({
        collectionName: "forms",
        limit: 1,
        where: {
          and: [
            { slug: { equals: slug } },
            { status: { equals: "published" } },
          ],
        },
      });
      const paginated = unwrapServiceResult<PaginatedShape>(result, {
        scope: "forms-get-by-slug",
        slug,
      });

      const docs = paginated.docs;
      if (!docs || docs.length === 0) {
        // §13.8: identifier (slug) belongs in logContext only.
        throw NextlyError.notFound({
          logContext: {
            entity: "form",
            slug,
            reason: "not-found-or-unpublished",
          },
        });
      }

      return respondDoc(docs[0]);
    },
  },

  submitForm: {
    // Phase 4: respondAction. submitForm is fundamentally a non-CRUD
    // mutation: the public-facing event is "submission accepted" and
    // the response surfaces a server-authored toast + the new
    // submissionId. Validation/notFound branches throw NextlyError so
    // the dispatcher's error path canonicalises the response.
    execute: async (svc, p, body, request) => {
      const slug = requireParam(p, "slug", "Form slug");
      const submissionData = body as { data?: Record<string, unknown> };

      if (!submissionData?.data || typeof submissionData.data !== "object") {
        // 400 invalid body: surface as a validation error so the wire
        // body keeps the canonical `{ error: ... }` shape.
        throw NextlyError.validation({
          errors: [
            {
              path: "data",
              code: "MISSING_FIELD",
              message: "Request body must contain a 'data' object.",
            },
          ],
          logContext: { slug },
        });
      }

      // Validate the form exists and is published.
      const formResult = await svc.collectionsHandler.listEntries({
        collectionName: "forms",
        limit: 1,
        where: {
          and: [
            { slug: { equals: slug } },
            { status: { equals: "published" } },
          ],
        },
      });
      const formPaginated = unwrapServiceResult<PaginatedShape>(formResult, {
        scope: "forms-submit-lookup",
        slug,
      });

      const forms = formPaginated.docs;
      if (!forms || forms.length === 0) {
        throw NextlyError.notFound({
          logContext: {
            entity: "form",
            slug,
            reason: "not-found-or-unpublished",
          },
        });
      }

      const form = forms[0] as FormRecord;

      // Validate required fields.
      const errors: Array<{ path: string; code: string; message: string }> =
        [];
      for (const field of form.fields || []) {
        const value = submissionData.data[field.name];
        if (
          field.required &&
          (value === undefined ||
            value === null ||
            value === "" ||
            (Array.isArray(value) && value.length === 0))
        ) {
          errors.push({
            path: field.name,
            code: "REQUIRED",
            message: `${field.label || field.name} is required`,
          });
        }
      }

      if (errors.length > 0) {
        throw NextlyError.validation({
          errors,
          logContext: { slug, formId: form.id },
        });
      }

      // Capture client metadata from request headers for audit.
      let ipAddress = "unknown";
      let userAgent = "unknown";
      if (request) {
        const headers = request.headers;
        ipAddress =
          headers.get("x-forwarded-for")?.split(",")[0] ||
          headers.get("x-real-ip") ||
          "unknown";
        userAgent = headers.get("user-agent") || "unknown";
      }

      const submissionEntry = await svc.collectionsHandler.createEntry(
        { collectionName: "form-submissions" },
        {
          form: form.id,
          data: submissionData.data,
          status: "new",
          ipAddress,
          userAgent,
          submittedAt: new Date(),
        }
      );
      // createEntry's CollectionServiceResult<unknown> isn't generic-narrowed;
      // unwrapServiceResult takes `data: unknown` and casts to T on
      // success so we name the expected shape here.
      const created = unwrapServiceResult<{ id?: string } | null>(
        submissionEntry,
        {
          scope: "forms-submit-create",
          slug,
          formId: form.id,
        }
      );

      const submissionId = created?.id;

      return respondAction(
        form.settings?.successMessage || "Thank you for your submission!",
        { submissionId },
        { status: 201 }
      );
    },
  },
};

/**
 * Dispatch a Forms method call. Prefers the DI-registered
 * `CollectionsHandler` (which has dynamic schemas wired up) and falls
 * back to the container's collections service.
 */
export function dispatchForms(
  services: ServiceContainer,
  method: string,
  params: Params,
  body: unknown,
  request?: Request
): Promise<unknown> {
  const collectionsHandler =
    getCollectionsHandlerFromDI() ?? services.collections;

  const handler = FORMS_METHODS[method];
  if (!handler) throw new Error(`Unknown method: ${method}`);
  return handler.execute({ collectionsHandler }, params, body, request);
}
