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

import { NextlyError } from "../../errors/nextly-error";
import type { EmailProviderRecord } from "../../schemas/email-providers/types";
import type { EmailTemplateRecord } from "../../schemas/email-templates/types";
import type { UserFieldDefinitionRecord } from "../../schemas/user-field-definitions/types";
import type { UpdateEmailTemplateInput } from "../../services/email/email-template-service";
import type {
  CreateEmailProviderArgs,
  CreateEmailTemplateArgs,
  CreateUserFieldArgs,
  DeleteEmailProviderArgs,
  DeleteEmailTemplateArgs,
  DeleteUserFieldArgs,
  FindEmailProviderByIDArgs,
  FindEmailProvidersArgs,
  FindEmailTemplateByIDArgs,
  FindEmailTemplateBySlugArgs,
  FindEmailTemplatesArgs,
  FindUserFieldByIDArgs,
  FindUserFieldsArgs,
  GetEmailLayoutArgs,
  ListResult,
  MutationResult,
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
  isNotFoundError,
  mergeConfig,
  sliceListResult,
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
    },

    async sendWithTemplate(
      args: SendTemplateEmailArgs
    ): Promise<SendEmailResult> {
      const to = Array.isArray(args.to) ? args.to[0] : args.to;

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
    },
  };
}

/**
 * `nextly.emailProviders.*` namespace — CRUD on provider configurations.
 *
 * Phase 4 (Task 13): list/mutation surfaces use canonical envelopes.
 * `setDefault` keeps returning the bare provider record because it's a
 * non-CRUD action whose primary value is the resulting record itself.
 */
export interface EmailProvidersNamespace {
  find(
    args?: FindEmailProvidersArgs
  ): Promise<ListResult<EmailProviderRecord>>;
  findByID(
    args: FindEmailProviderByIDArgs
  ): Promise<EmailProviderRecord | null>;
  create(
    args: CreateEmailProviderArgs
  ): Promise<MutationResult<EmailProviderRecord>>;
  update(
    args: UpdateEmailProviderArgs
  ): Promise<MutationResult<EmailProviderRecord>>;
  delete(
    args: DeleteEmailProviderArgs
  ): Promise<MutationResult<{ id: string }>>;
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
    ): Promise<ListResult<EmailProviderRecord>> {
      const providers = await ctx.emailProviderService.listProviders();
      return sliceListResult(providers, args.limit, args.page);
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
        throw error;
      }
    },

    async create(
      args: CreateEmailProviderArgs
    ): Promise<MutationResult<EmailProviderRecord>> {
      const item = await ctx.emailProviderService.createProvider({
        name: args.data.name,
        type: args.data.type,
        fromEmail: args.data.fromEmail,
        fromName: args.data.fromName,
        configuration: args.data.configuration,
        isDefault: args.data.isDefault,
      });
      // Phase 4 (Task 13): canonical mutation envelope.
      return { message: "Email provider created.", item };
    },

    async update(
      args: UpdateEmailProviderArgs
    ): Promise<MutationResult<EmailProviderRecord>> {
      const item = await ctx.emailProviderService.updateProvider(
        args.id,
        args.data
      );
      return { message: "Email provider updated.", item };
    },

    async delete(
      args: DeleteEmailProviderArgs
    ): Promise<MutationResult<{ id: string }>> {
      await ctx.emailProviderService.deleteProvider(args.id);
      return {
        message: "Email provider deleted.",
        item: { id: args.id },
      };
    },

    async setDefault(
      args: SetDefaultProviderArgs
    ): Promise<EmailProviderRecord> {
      return await ctx.emailProviderService.setDefault(args.id);
    },

    async test(
      args: TestEmailProviderArgs
    ): Promise<{ success: boolean; error?: string }> {
      return await ctx.emailProviderService.testProvider(args.id, args.to);
    },
  };
}

/**
 * `nextly.emailTemplates.*` namespace — CRUD + preview + shared layout.
 *
 * Phase 4 (Task 13): list/mutation surfaces use canonical envelopes.
 * `preview`, `getLayout`, `updateLayout` keep their bespoke shapes
 * because they're non-CRUD actions with domain-specific return types.
 */
export interface EmailTemplatesNamespace {
  find(
    args?: FindEmailTemplatesArgs
  ): Promise<ListResult<EmailTemplateRecord>>;
  findByID(
    args: FindEmailTemplateByIDArgs
  ): Promise<EmailTemplateRecord | null>;
  findBySlug(
    args: FindEmailTemplateBySlugArgs
  ): Promise<EmailTemplateRecord | null>;
  create(
    args: CreateEmailTemplateArgs
  ): Promise<MutationResult<EmailTemplateRecord>>;
  update(
    args: UpdateEmailTemplateArgs
  ): Promise<MutationResult<EmailTemplateRecord>>;
  delete(
    args: DeleteEmailTemplateArgs
  ): Promise<MutationResult<{ id: string }>>;
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
    ): Promise<ListResult<EmailTemplateRecord>> {
      const templates = await ctx.emailTemplateService.listTemplates();
      return sliceListResult(templates, args.limit, args.page);
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
        throw error;
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
          throw NextlyError.notFound({
            logContext: { slug: args.slug, entity: "emailTemplate" },
          });
        }
        return template;
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

    async create(
      args: CreateEmailTemplateArgs
    ): Promise<MutationResult<EmailTemplateRecord>> {
      const item = await ctx.emailTemplateService.createTemplate({
        name: args.data.name,
        slug: args.data.slug,
        subject: args.data.subject,
        htmlContent: args.data.htmlContent,
        plainTextContent: args.data.textContent,
        variables: args.data.variables,
        attachments: args.data.attachments,
      });
      // Phase 4 (Task 13): canonical mutation envelope.
      return { message: "Email template created.", item };
    },

    async update(
      args: UpdateEmailTemplateArgs
    ): Promise<MutationResult<EmailTemplateRecord>> {
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
      const item = await ctx.emailTemplateService.updateTemplate(
        args.id,
        updateData
      );
      return { message: "Email template updated.", item };
    },

    async delete(
      args: DeleteEmailTemplateArgs
    ): Promise<MutationResult<{ id: string }>> {
      await ctx.emailTemplateService.deleteTemplate(args.id);
      return {
        message: "Email template deleted.",
        item: { id: args.id },
      };
    },

    async preview(
      args: PreviewEmailTemplateArgs
    ): Promise<{ subject: string; html: string }> {
      return await ctx.emailTemplateService.previewTemplate(
        args.id,
        args.data ?? {}
      );
    },

    async getLayout(
      _args: GetEmailLayoutArgs = {}
    ): Promise<{ header: string; footer: string }> {
      return await ctx.emailTemplateService.getLayout();
    },

    async updateLayout(args: UpdateEmailLayoutArgs): Promise<void> {
      await ctx.emailTemplateService.updateLayout(args.data);
    },
  };
}

/**
 * `nextly.userFields.*` namespace — CRUD on user field definitions.
 *
 * Phase 4 (Task 13): list/mutation surfaces use canonical envelopes.
 * `reorder` keeps its array return type because the wire-side equivalent
 * also returns the reordered list as a non-CRUD action.
 */
export interface UserFieldsNamespace {
  find(
    args?: FindUserFieldsArgs
  ): Promise<ListResult<UserFieldDefinitionRecord>>;
  findByID(
    args: FindUserFieldByIDArgs
  ): Promise<UserFieldDefinitionRecord | null>;
  create(
    args: CreateUserFieldArgs
  ): Promise<MutationResult<UserFieldDefinitionRecord>>;
  update(
    args: UpdateUserFieldArgs
  ): Promise<MutationResult<UserFieldDefinitionRecord>>;
  delete(args: DeleteUserFieldArgs): Promise<MutationResult<{ id: string }>>;
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
    ): Promise<ListResult<UserFieldDefinitionRecord>> {
      const allFields = args.includeInactive
        ? await ctx.userFieldDefinitionService.listFields()
        : await ctx.userFieldDefinitionService.getMergedFields();
      return sliceListResult(allFields, args.limit, args.page);
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
        throw error;
      }
    },

    async create(
      args: CreateUserFieldArgs
    ): Promise<MutationResult<UserFieldDefinitionRecord>> {
      const item = await ctx.userFieldDefinitionService.createField({
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
      // Phase 4 (Task 13): canonical mutation envelope.
      return { message: "User field created.", item };
    },

    async update(
      args: UpdateUserFieldArgs
    ): Promise<MutationResult<UserFieldDefinitionRecord>> {
      const item = await ctx.userFieldDefinitionService.updateField(
        args.id,
        args.data
      );
      return { message: "User field updated.", item };
    },

    async delete(
      args: DeleteUserFieldArgs
    ): Promise<MutationResult<{ id: string }>> {
      await ctx.userFieldDefinitionService.deleteField(args.id);
      return {
        message: "User field deleted.",
        item: { id: args.id },
      };
    },

    async reorder(
      args: ReorderUserFieldsArgs
    ): Promise<UserFieldDefinitionRecord[]> {
      return await ctx.userFieldDefinitionService.reorderFields(
        args.orderedIds
      );
    },
  };
}
