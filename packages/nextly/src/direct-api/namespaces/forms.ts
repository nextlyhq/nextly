/**
 * Direct API Forms Namespace
 *
 * Factory for the `nextly.forms.*` sub-namespace. Delegates to the generic
 * `CollectionsHandler` because forms are stored in collections provided by
 * the `@revnixhq/plugin-form-builder` plugin.
 *
 * @packageDocumentation
 */

import type { WhereFilter } from "../../services/collections/query-operators";
import type { PaginatedResponse } from "../../types/pagination";
import { NextlyError, NextlyErrorCode, NotFoundError } from "../errors";
import type {
  FindFormBySlugArgs,
  FindFormsArgs,
  FormSubmissionsArgs,
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
 */
export interface FormsNamespace {
  find(
    args?: FindFormsArgs
  ): Promise<PaginatedResponse<Record<string, unknown>>>;
  findBySlug(args: FindFormBySlugArgs): Promise<Record<string, unknown> | null>;
  submit(args: SubmitFormArgs): Promise<SubmitFormResult>;
  submissions(
    args: FormSubmissionsArgs
  ): Promise<PaginatedResponse<Record<string, unknown>>>;
}

/**
 * Build the `forms` namespace for a `Nextly` instance.
 */
export function createFormsNamespace(ctx: NextlyContext): FormsNamespace {
  const namespace: FormsNamespace = {
    async find(
      args: FindFormsArgs = {}
    ): Promise<PaginatedResponse<Record<string, unknown>>> {
      const limit = args.limit ?? 10;
      const page = args.page ?? 1;

      try {
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

        return result.data as PaginatedResponse<Record<string, unknown>>;
      } catch (error) {
        if (error instanceof NextlyError) {
          throw error;
        }
        throw error;
      }
    },

    async findBySlug(
      args: FindFormBySlugArgs
    ): Promise<Record<string, unknown> | null> {
      const config = mergeConfig(ctx.defaultConfig, args);

      if (!args.slug) {
        throw new NextlyError(
          "'slug' is required for forms.findBySlug()",
          NextlyErrorCode.INVALID_INPUT,
          400
        );
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
          throw new NotFoundError(`Form with slug '${args.slug}' not found`, {
            slug: args.slug,
          });
        }

        return docs[0];
      } catch (error) {
        if (error instanceof NextlyError) {
          throw error;
        }
        if (config.disableErrors && isNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    },

    async submit(args: SubmitFormArgs): Promise<SubmitFormResult> {
      if (!args.form) {
        throw new NextlyError(
          "'form' (slug) is required for forms.submit()",
          NextlyErrorCode.INVALID_INPUT,
          400
        );
      }

      if (!args.data || typeof args.data !== "object") {
        throw new NextlyError(
          "'data' is required for forms.submit()",
          NextlyErrorCode.INVALID_INPUT,
          400
        );
      }

      try {
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
      } catch (error) {
        if (error instanceof NextlyError) {
          throw error;
        }
        throw error;
      }
    },

    async submissions(
      args: FormSubmissionsArgs
    ): Promise<PaginatedResponse<Record<string, unknown>>> {
      if (!args.form) {
        throw new NextlyError(
          "'form' (slug or ID) is required for forms.submissions()",
          NextlyErrorCode.INVALID_INPUT,
          400
        );
      }

      const limit = args.limit ?? 10;
      const page = args.page ?? 1;

      try {
        let formId = args.form;

        const isSlug = !looksLikeId(args.form);

        if (isSlug) {
          const form = await namespace.findBySlug({
            slug: args.form,
            disableErrors: true,
          });

          if (!form) {
            throw new NotFoundError(`Form with slug '${args.form}' not found`, {
              slug: args.form,
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

        return result.data as PaginatedResponse<Record<string, unknown>>;
      } catch (error) {
        if (error instanceof NextlyError) {
          throw error;
        }
        throw error;
      }
    },
  };

  return namespace;
}
