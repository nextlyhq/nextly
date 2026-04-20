/**
 * Direct API Email Namespaces
 *
 * Factories for the email-related Direct API sub-namespaces:
 * - `nextly.email.*`             — raw send + template send
 * - `nextly.emailProviders.*`    — provider CRUD
 * - `nextly.emailTemplates.*`    — template CRUD + preview + layout
 * - `nextly.userFields.*`        — user field definitions CRUD
 *
 * Each of these shares the same plumbing (error conversion, optional
 * pagination), so they live in one file.
 *
 * @packageDocumentation
 */

import type { EmailProviderRecord } from "../../schemas/email-providers/types";
import type { EmailTemplateRecord } from "../../schemas/email-templates/types";
import type { UserFieldDefinitionRecord } from "../../schemas/user-field-definitions/types";
import type { UpdateEmailTemplateInput } from "../../services/email/email-template-service";
import type { PaginatedResponse } from "../../types/pagination";
import { NotFoundError, NextlyError } from "../errors";
import type {
  CreateEmailProviderArgs,
  CreateEmailTemplateArgs,
  CreateUserFieldArgs,
  DeleteEmailProviderArgs,
  DeleteEmailTemplateArgs,
  DeleteResult,
  DeleteUserFieldArgs,
  FindEmailProviderByIDArgs,
  FindEmailProvidersArgs,
  FindEmailTemplateByIDArgs,
  FindEmailTemplateBySlugArgs,
  FindEmailTemplatesArgs,
  FindUserFieldByIDArgs,
  FindUserFieldsArgs,
  GetEmailLayoutArgs,
  PreviewEmailTemplateArgs,
  ReorderUserFieldsArgs,
  SendEmailArgs,
  SendEmailResult,
  SendTemplateEmailArgs,
  SetDefaultProviderArgs,
  TestEmailProviderArgs,
  UpdateEmailLayoutArgs,
  UpdateEmailProviderArgs,
  UpdateEmailTemplateArgs,
  UpdateUserFieldArgs,
} from "../types/index";

import type { NextlyContext } from "./context";
import {
  convertServiceError,
  isNotFoundError,
  mergeConfig,
  slicePaginatedResponse,
} from "./helpers";

/**
 * `nextly.email.*` namespace — send raw or template-based emails.
 */
export interface EmailNamespace {
  send(args: SendEmailArgs): Promise<SendEmailResult>;
  sendWithTemplate(args: SendTemplateEmailArgs): Promise<SendEmailResult>;
}

/**
 * Build the `email` namespace for a `Nextly` instance.
 */
export function createEmailNamespace(ctx: NextlyContext): EmailNamespace {
  return {
    async send(args: SendEmailArgs): Promise<SendEmailResult> {
      const to = Array.isArray(args.to) ? args.to[0] : args.to;

      try {
        const result = await ctx.emailSendService.send({
          to,
          subject: args.subject,
          html: args.html,
          plainText: args.text,
          providerId: args.providerId,
          attachments: args.attachments,
        });
        return {
          success: result.success,
          messageId: result.messageId,
        };
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async sendWithTemplate(
      args: SendTemplateEmailArgs
    ): Promise<SendEmailResult> {
      const to = Array.isArray(args.to) ? args.to[0] : args.to;

      try {
        const sendOptions: {
          providerId?: string;
          attachments?: typeof args.attachments;
        } = {};
        if (args.providerId) sendOptions.providerId = args.providerId;
        if (args.attachments) sendOptions.attachments = args.attachments;

        const result = await ctx.emailSendService.sendWithTemplate(
          args.template,
          to,
          args.variables ?? {},
          Object.keys(sendOptions).length > 0 ? sendOptions : undefined
        );
        return {
          success: result.success,
          messageId: result.messageId,
        };
      } catch (error) {
        throw convertServiceError(error);
      }
    },
  };
}

/**
 * `nextly.emailProviders.*` namespace — CRUD on provider configurations.
 */
export interface EmailProvidersNamespace {
  find(
    args?: FindEmailProvidersArgs
  ): Promise<PaginatedResponse<EmailProviderRecord>>;
  findByID(
    args: FindEmailProviderByIDArgs
  ): Promise<EmailProviderRecord | null>;
  create(args: CreateEmailProviderArgs): Promise<EmailProviderRecord>;
  update(args: UpdateEmailProviderArgs): Promise<EmailProviderRecord>;
  delete(args: DeleteEmailProviderArgs): Promise<DeleteResult>;
  setDefault(args: SetDefaultProviderArgs): Promise<EmailProviderRecord>;
  test(
    args: TestEmailProviderArgs
  ): Promise<{ success: boolean; error?: string }>;
}

/**
 * Build the `emailProviders` namespace for a `Nextly` instance.
 */
export function createEmailProvidersNamespace(
  ctx: NextlyContext
): EmailProvidersNamespace {
  return {
    async find(
      args: FindEmailProvidersArgs = {}
    ): Promise<PaginatedResponse<EmailProviderRecord>> {
      try {
        const providers = await ctx.emailProviderService.listProviders();
        return slicePaginatedResponse(providers, args.limit, args.page);
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async findByID(
      args: FindEmailProviderByIDArgs
    ): Promise<EmailProviderRecord | null> {
      const config = mergeConfig(ctx.defaultConfig, args);
      try {
        return await ctx.emailProviderService.getProvider(args.id);
      } catch (error) {
        if (config.disableErrors && isNotFoundError(error)) {
          return null;
        }
        throw convertServiceError(error);
      }
    },

    async create(args: CreateEmailProviderArgs): Promise<EmailProviderRecord> {
      try {
        return await ctx.emailProviderService.createProvider({
          name: args.data.name,
          type: args.data.type,
          fromEmail: args.data.fromEmail,
          fromName: args.data.fromName,
          configuration: args.data.configuration,
          isDefault: args.data.isDefault,
        });
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async update(args: UpdateEmailProviderArgs): Promise<EmailProviderRecord> {
      try {
        return await ctx.emailProviderService.updateProvider(
          args.id,
          args.data
        );
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async delete(args: DeleteEmailProviderArgs): Promise<DeleteResult> {
      try {
        await ctx.emailProviderService.deleteProvider(args.id);
        return { deleted: true, ids: [args.id] };
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async setDefault(
      args: SetDefaultProviderArgs
    ): Promise<EmailProviderRecord> {
      try {
        return await ctx.emailProviderService.setDefault(args.id);
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async test(
      args: TestEmailProviderArgs
    ): Promise<{ success: boolean; error?: string }> {
      try {
        return await ctx.emailProviderService.testProvider(args.id, args.to);
      } catch (error) {
        throw convertServiceError(error);
      }
    },
  };
}

/**
 * `nextly.emailTemplates.*` namespace — CRUD + preview + shared layout.
 */
export interface EmailTemplatesNamespace {
  find(
    args?: FindEmailTemplatesArgs
  ): Promise<PaginatedResponse<EmailTemplateRecord>>;
  findByID(
    args: FindEmailTemplateByIDArgs
  ): Promise<EmailTemplateRecord | null>;
  findBySlug(
    args: FindEmailTemplateBySlugArgs
  ): Promise<EmailTemplateRecord | null>;
  create(args: CreateEmailTemplateArgs): Promise<EmailTemplateRecord>;
  update(args: UpdateEmailTemplateArgs): Promise<EmailTemplateRecord>;
  delete(args: DeleteEmailTemplateArgs): Promise<DeleteResult>;
  preview(
    args: PreviewEmailTemplateArgs
  ): Promise<{ subject: string; html: string }>;
  getLayout(
    args?: GetEmailLayoutArgs
  ): Promise<{ header: string; footer: string }>;
  updateLayout(args: UpdateEmailLayoutArgs): Promise<void>;
}

/**
 * Build the `emailTemplates` namespace for a `Nextly` instance.
 */
export function createEmailTemplatesNamespace(
  ctx: NextlyContext
): EmailTemplatesNamespace {
  return {
    async find(
      args: FindEmailTemplatesArgs = {}
    ): Promise<PaginatedResponse<EmailTemplateRecord>> {
      try {
        const templates = await ctx.emailTemplateService.listTemplates();
        return slicePaginatedResponse(templates, args.limit, args.page);
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async findByID(
      args: FindEmailTemplateByIDArgs
    ): Promise<EmailTemplateRecord | null> {
      const config = mergeConfig(ctx.defaultConfig, args);
      try {
        return await ctx.emailTemplateService.getTemplate(args.id);
      } catch (error) {
        if (config.disableErrors && isNotFoundError(error)) {
          return null;
        }
        throw convertServiceError(error);
      }
    },

    async findBySlug(
      args: FindEmailTemplateBySlugArgs
    ): Promise<EmailTemplateRecord | null> {
      const config = mergeConfig(ctx.defaultConfig, args);
      try {
        const template = await ctx.emailTemplateService.getTemplateBySlug(
          args.slug
        );
        if (!template) {
          if (config.disableErrors) {
            return null;
          }
          throw new NotFoundError(
            `Email template with slug '${args.slug}' not found`,
            { slug: args.slug }
          );
        }
        return template;
      } catch (error) {
        if (error instanceof NextlyError) {
          throw error;
        }
        if (config.disableErrors && isNotFoundError(error)) {
          return null;
        }
        throw convertServiceError(error);
      }
    },

    async create(args: CreateEmailTemplateArgs): Promise<EmailTemplateRecord> {
      try {
        return await ctx.emailTemplateService.createTemplate({
          name: args.data.name,
          slug: args.data.slug,
          subject: args.data.subject,
          htmlContent: args.data.htmlContent,
          plainTextContent: args.data.textContent,
          variables: args.data.variables,
          attachments: args.data.attachments,
        });
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async update(args: UpdateEmailTemplateArgs): Promise<EmailTemplateRecord> {
      try {
        const { textContent, variables, attachments, ...rest } = args.data;
        const updateData: UpdateEmailTemplateInput = {
          ...rest,
        };
        if (textContent !== undefined) {
          updateData.plainTextContent = textContent;
        }
        if (variables !== undefined) {
          updateData.variables = variables;
        }
        if (attachments !== undefined) {
          updateData.attachments = attachments;
        }
        return await ctx.emailTemplateService.updateTemplate(
          args.id,
          updateData
        );
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async delete(args: DeleteEmailTemplateArgs): Promise<DeleteResult> {
      try {
        await ctx.emailTemplateService.deleteTemplate(args.id);
        return { deleted: true, ids: [args.id] };
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async preview(
      args: PreviewEmailTemplateArgs
    ): Promise<{ subject: string; html: string }> {
      try {
        return await ctx.emailTemplateService.previewTemplate(
          args.id,
          args.data ?? {}
        );
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async getLayout(
      _args: GetEmailLayoutArgs = {}
    ): Promise<{ header: string; footer: string }> {
      try {
        return await ctx.emailTemplateService.getLayout();
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async updateLayout(args: UpdateEmailLayoutArgs): Promise<void> {
      try {
        await ctx.emailTemplateService.updateLayout(args.data);
      } catch (error) {
        throw convertServiceError(error);
      }
    },
  };
}

/**
 * `nextly.userFields.*` namespace — CRUD on user field definitions.
 */
export interface UserFieldsNamespace {
  find(
    args?: FindUserFieldsArgs
  ): Promise<PaginatedResponse<UserFieldDefinitionRecord>>;
  findByID(
    args: FindUserFieldByIDArgs
  ): Promise<UserFieldDefinitionRecord | null>;
  create(args: CreateUserFieldArgs): Promise<UserFieldDefinitionRecord>;
  update(args: UpdateUserFieldArgs): Promise<UserFieldDefinitionRecord>;
  delete(args: DeleteUserFieldArgs): Promise<DeleteResult>;
  reorder(args: ReorderUserFieldsArgs): Promise<UserFieldDefinitionRecord[]>;
}

/**
 * Build the `userFields` namespace for a `Nextly` instance.
 */
export function createUserFieldsNamespace(
  ctx: NextlyContext
): UserFieldsNamespace {
  return {
    async find(
      args: FindUserFieldsArgs = {}
    ): Promise<PaginatedResponse<UserFieldDefinitionRecord>> {
      try {
        const allFields = args.includeInactive
          ? await ctx.userFieldDefinitionService.listFields()
          : await ctx.userFieldDefinitionService.getMergedFields();
        return slicePaginatedResponse(allFields, args.limit, args.page);
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async findByID(
      args: FindUserFieldByIDArgs
    ): Promise<UserFieldDefinitionRecord | null> {
      const config = mergeConfig(ctx.defaultConfig, args);
      try {
        return await ctx.userFieldDefinitionService.getField(args.id);
      } catch (error) {
        if (config.disableErrors && isNotFoundError(error)) {
          return null;
        }
        throw convertServiceError(error);
      }
    },

    async create(
      args: CreateUserFieldArgs
    ): Promise<UserFieldDefinitionRecord> {
      try {
        return await ctx.userFieldDefinitionService.createField({
          name: args.data.name,
          label: args.data.label,
          type: args.data.type,
          required: args.data.required,
          defaultValue: args.data.defaultValue,
          options: args.data.options,
          placeholder: args.data.placeholder,
          description: args.data.description,
          sortOrder: args.data.sortOrder,
          source: "ui",
        });
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async update(
      args: UpdateUserFieldArgs
    ): Promise<UserFieldDefinitionRecord> {
      try {
        return await ctx.userFieldDefinitionService.updateField(
          args.id,
          args.data
        );
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async delete(args: DeleteUserFieldArgs): Promise<DeleteResult> {
      try {
        await ctx.userFieldDefinitionService.deleteField(args.id);
        return { deleted: true, ids: [args.id] };
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async reorder(
      args: ReorderUserFieldsArgs
    ): Promise<UserFieldDefinitionRecord[]> {
      try {
        return await ctx.userFieldDefinitionService.reorderFields(
          args.orderedIds
        );
      } catch (error) {
        throw convertServiceError(error);
      }
    },
  };
}
