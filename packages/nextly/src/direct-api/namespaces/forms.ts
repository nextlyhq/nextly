/**
 * Direct API Forms Namespace
 *
 * Factory for the `nextly.forms.*` sub-namespace. Delegates to the generic
 * `CollectionsHandler` because forms are stored in collections provided by
 * the `@revnixhq/plugin-form-builder` plugin.
 *
 * @packageDocumentation
 */

import { NextlyError } from "../../errors/nextly-error";
import type { WhereFilter } from "../../services/collections/query-operators";
import type { PaginatedResponse } from "../../types/pagination";
import type {
  FindFormBySlugArgs,
  FindFormsArgs,
  FormSubmissionsArgs,
  ListResult,
  SubmitFormArgs,
  SubmitFormResult,
} from "../types/index";

import type { NextlyContext } from "./context";
import {
  createErrorFromResult,
  isNotFoundError,
  looksLikeId,
  mergeConfig,
} from "./helpers";

/**
 * Forms namespace API, bound to a Nextly context.
 *
 * Phase 4 (Task 13): list surfaces use the canonical `ListResult<T>`
 * envelope. `submit()` retains its own `SubmitFormResult` shape because
 * it carries `success`/`redirect` semantics that don't map cleanly onto
 * `MutationResult`.
 */
export interface FormsNamespace {
  find(args?: FindFormsArgs): Promise<ListResult<Record<string, unknown>>>;
  findBySlug(args: FindFormBySlugArgs): Promise<Record<string, unknown> | null>;
  submit(args: SubmitFormArgs): Promise<SubmitFormResult>;
  submissions(
    args: FormSubmissionsArgs
  ): Promise<ListResult<Record<string, unknown>>>;
}

/**
 * Build the `forms` namespace for a `Nextly` instance.
 */
export function createFormsNamespace(ctx: NextlyContext): FormsNamespace {
  const namespace: FormsNamespace = {
    async find(
      args: FindFormsArgs = {}
    ): Promise<ListResult<Record<string, unknown>>> {
      const limit = args.limit ?? 10;
      const page = args.page ?? 1;

      const where: WhereFilter = {};
      if (args.status) {
        where.status = { equals: args.status };
      }

      const result = await ctx.collectionsHandler.listEntries({
        collectionName: ctx.formsCollectionSlug,
        page,
        limit,
        where: Object.keys(where).length > 0 ? where : undefined,
      });

      if (!result.success) {
        throw createErrorFromResult(result);
      }

      // Phase 4 (Task 13): the underlying collectionsHandler still emits
      // the legacy Payload-style envelope (`{ docs, totalDocs, ... }`);
      // adapt to the canonical `ListResult<T>` here. Defaults guard
      // against test fixtures that omit pagination metadata.
      const legacy = result.data as PaginatedResponse<Record<string, unknown>>;
      const total = legacy.totalDocs ?? legacy.docs.length;
      const totalPages =
        legacy.totalPages ?? Math.max(1, Math.ceil(total / Math.max(limit, 1)));
      return {
        items: legacy.docs,
        meta: {
          total,
          page,
          limit,
          totalPages,
          hasNext: legacy.hasNextPage ?? page < totalPages,
          hasPrev: legacy.hasPrevPage ?? page > 1,
        },
      };
    },

    async findBySlug(
      args: FindFormBySlugArgs
    ): Promise<Record<string, unknown> | null> {
      const config = mergeConfig(ctx.defaultConfig, args);

      if (!args.slug) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'slug' is required for forms.findBySlug()",
          statusCode: 400,
        });
      }

      try {
        const result = await ctx.collectionsHandler.listEntries({
          collectionName: ctx.formsCollectionSlug,
          where: { slug: { equals: args.slug } },
          limit: 1,
        });

        if (!result.success) {
          if (config.disableErrors) {
            return null;
          }
          throw createErrorFromResult(result);
        }

        const docs = (result.data as PaginatedResponse<Record<string, unknown>>)
          .docs;

        if (!docs || docs.length === 0) {
          if (config.disableErrors) {
            return null;
          }
          throw NextlyError.notFound({
            logContext: { slug: args.slug, entity: "form" },
          });
        }

        return docs[0];
      } catch (error) {
        if (config.disableErrors && isNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    },

    async submit(args: SubmitFormArgs): Promise<SubmitFormResult> {
      if (!args.form) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'form' (slug) is required for forms.submit()",
          statusCode: 400,
        });
      }

      if (!args.data || typeof args.data !== "object") {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'data' is required for forms.submit()",
          statusCode: 400,
        });
      }

      const form = await namespace.findBySlug({
        slug: args.form,
        disableErrors: true,
      });

      if (!form) {
        return {
          success: false,
          error: "Form not found",
        };
      }

      if (form.status !== "published") {
        return {
          success: false,
          error: "This form is not currently accepting submissions",
        };
      }

      const submissionData: Record<string, unknown> = {
        form: form.id,
        data: args.data,
        status: "new",
        submittedAt: new Date(),
      };

      if (args.metadata?.ipAddress) {
        submissionData.ipAddress = args.metadata.ipAddress;
      }
      if (args.metadata?.userAgent) {
        submissionData.userAgent = args.metadata.userAgent;
      }

      const createResult = await ctx.collectionsHandler.createEntry(
        { collectionName: ctx.submissionsCollectionSlug },
        submissionData
      );

      if (!createResult.success) {
        return {
          success: false,
          error: createResult.message || "Failed to create submission",
        };
      }

      const settings = form.settings as
        | { confirmationType?: string; redirectUrl?: string }
        | undefined;
      const redirect =
        settings?.confirmationType === "redirect"
          ? settings.redirectUrl
          : undefined;

      return {
        success: true,
        submission: createResult.data as Record<string, unknown>,
        redirect,
      };
    },

    async submissions(
      args: FormSubmissionsArgs
    ): Promise<ListResult<Record<string, unknown>>> {
      if (!args.form) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'form' (slug or ID) is required for forms.submissions()",
          statusCode: 400,
        });
      }

      const limit = args.limit ?? 10;
      const page = args.page ?? 1;

      let formId = args.form;

      const isSlug = !looksLikeId(args.form);

      if (isSlug) {
        const form = await namespace.findBySlug({
          slug: args.form,
          disableErrors: true,
        });

        if (!form) {
          throw NextlyError.notFound({
            logContext: { slug: args.form, entity: "form" },
          });
        }

        formId = form.id as string;
      }

      const result = await ctx.collectionsHandler.listEntries({
        collectionName: ctx.submissionsCollectionSlug,
        page,
        limit,
        where: { form: { equals: formId } },
      });

      if (!result.success) {
        throw createErrorFromResult(result);
      }

      // Phase 4 (Task 13): adapt the legacy Payload-style envelope from
      // collectionsHandler.listEntries to the canonical `ListResult<T>`.
      const legacy = result.data as PaginatedResponse<Record<string, unknown>>;
      const total = legacy.totalDocs ?? legacy.docs.length;
      const totalPages =
        legacy.totalPages ?? Math.max(1, Math.ceil(total / Math.max(limit, 1)));
      return {
        items: legacy.docs,
        meta: {
          total,
          page,
          limit,
          totalPages,
          hasNext: legacy.hasNextPage ?? page < totalPages,
          hasPrev: legacy.hasPrevPage ?? page > 1,
        },
      };
    },
  };

  return namespace;
}
