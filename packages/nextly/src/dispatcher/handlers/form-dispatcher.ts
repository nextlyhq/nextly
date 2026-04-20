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
 */

import type { ServiceContainer } from "../../services";
import type { CollectionsHandler } from "../../services/collections-handler";
import { getCollectionsHandlerFromDI } from "../helpers/di";
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

const FORMS_METHODS: Record<string, MethodHandler<FormsServices>> = {
  listForms: {
    execute: async (svc, p) => {
      // Query the forms collection for published forms.
      const result = await svc.collectionsHandler.listEntries({
        collectionName: "forms",
        limit: toNumber(p.limit) || 100,
        page: toNumber(p.page) || 1,
        where: { status: { equals: "published" } },
      });

      return {
        success: true,
        statusCode: 200,
        data: result.data,
      };
    },
  },

  getFormBySlug: {
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

      const docs = result.data?.docs || [];
      if (docs.length === 0) {
        return {
          success: false,
          statusCode: 404,
          message: "Form not found or not published",
        };
      }

      return {
        success: true,
        statusCode: 200,
        data: docs[0],
      };
    },
  },

  submitForm: {
    execute: async (svc, p, body, request) => {
      const slug = requireParam(p, "slug", "Form slug");
      const submissionData = body as { data?: Record<string, unknown> };

      if (!submissionData?.data || typeof submissionData.data !== "object") {
        return {
          success: false,
          statusCode: 400,
          message: "Request body must contain a 'data' object",
        };
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

      const forms = formResult.data?.docs || [];
      if (forms.length === 0) {
        return {
          success: false,
          statusCode: 404,
          message: "Form not found or not accepting submissions",
        };
      }

      const form = forms[0] as FormRecord;

      // Validate required fields.
      const errors: Record<string, string> = {};
      for (const field of form.fields || []) {
        const value = submissionData.data[field.name];
        if (
          field.required &&
          (value === undefined ||
            value === null ||
            value === "" ||
            (Array.isArray(value) && value.length === 0))
        ) {
          errors[field.name] = `${field.label || field.name} is required`;
        }
      }

      if (Object.keys(errors).length > 0) {
        return {
          success: false,
          statusCode: 400,
          message: "Validation failed",
          errors,
        };
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

      const submissionId =
        submissionEntry.data &&
        typeof submissionEntry.data === "object" &&
        "id" in submissionEntry.data
          ? (submissionEntry.data as { id: string }).id
          : undefined;

      return {
        success: true,
        statusCode: 201,
        message:
          form.settings?.successMessage || "Thank you for your submission!",
        data: { submissionId },
      };
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
