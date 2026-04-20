/**
 * Email provider + template dispatch handlers.
 *
 * Groups the two email service maps into one handler file because both
 * share the same DI-resolution pattern and neither has enough logic to
 * warrant its own module. Routes 7 provider ops and 8 template ops.
 */

import type { EmailProviderService } from "../../services/email/email-provider-service";
import type { EmailTemplateService } from "../../services/email/email-template-service";
import {
  getEmailProviderServiceFromDI,
  getEmailTemplateServiceFromDI,
} from "../helpers/di";
import type { MethodHandler, Params } from "../types";

interface EmailProviderServices {
  providerService: EmailProviderService;
}

interface EmailTemplateServices {
  templateService: EmailTemplateService;
}

// ============================================================
// Email provider methods
// ============================================================

const EMAIL_PROVIDER_METHODS: Record<
  string,
  MethodHandler<EmailProviderServices>
> = {
  listProviders: {
    execute: async svc => {
      const data = await svc.providerService.listProviders();
      return { success: true, statusCode: 200, data };
    },
  },
  createProvider: {
    execute: async (svc, _p, body) => {
      const data = await svc.providerService.createProvider(
        body as Parameters<typeof svc.providerService.createProvider>[0]
      );
      return { success: true, statusCode: 201, data };
    },
  },
  getProvider: {
    execute: async (svc, p) => {
      const data = await svc.providerService.getProvider(p.providerId);
      return { success: true, statusCode: 200, data };
    },
  },
  updateProvider: {
    execute: async (svc, p, body) => {
      const data = await svc.providerService.updateProvider(
        p.providerId,
        body as Parameters<typeof svc.providerService.updateProvider>[1]
      );
      return { success: true, statusCode: 200, data };
    },
  },
  deleteProvider: {
    execute: async (svc, p) => {
      await svc.providerService.deleteProvider(p.providerId);
      return { success: true, statusCode: 204, data: null };
    },
  },
  setDefault: {
    execute: async (svc, p) => {
      const data = await svc.providerService.setDefault(p.providerId);
      return { success: true, statusCode: 200, data };
    },
  },
  testProvider: {
    execute: async (svc, p, body) => {
      const { email } = body as { email: string };
      const data = await svc.providerService.testProvider(p.providerId, email);
      return { success: true, statusCode: 200, data };
    },
  },
};

// ============================================================
// Email template methods
// ============================================================

const EMAIL_TEMPLATE_METHODS: Record<
  string,
  MethodHandler<EmailTemplateServices>
> = {
  listTemplates: {
    execute: async svc => {
      const data = await svc.templateService.listTemplates();
      return { success: true, statusCode: 200, data };
    },
  },
  createTemplate: {
    execute: async (svc, _p, body) => {
      const data = await svc.templateService.createTemplate(
        body as Parameters<typeof svc.templateService.createTemplate>[0]
      );
      return { success: true, statusCode: 201, data };
    },
  },
  getTemplate: {
    execute: async (svc, p) => {
      const data = await svc.templateService.getTemplate(p.templateId);
      return { success: true, statusCode: 200, data };
    },
  },
  updateTemplate: {
    execute: async (svc, p, body) => {
      const data = await svc.templateService.updateTemplate(
        p.templateId,
        body as Parameters<typeof svc.templateService.updateTemplate>[1]
      );
      return { success: true, statusCode: 200, data };
    },
  },
  deleteTemplate: {
    execute: async (svc, p) => {
      await svc.templateService.deleteTemplate(p.templateId);
      return { success: true, statusCode: 204, data: null };
    },
  },
  getLayout: {
    execute: async svc => {
      const data = await svc.templateService.getLayout();
      return { success: true, statusCode: 200, data };
    },
  },
  updateLayout: {
    execute: async (svc, _p, body) => {
      await svc.templateService.updateLayout(
        body as Parameters<typeof svc.templateService.updateLayout>[0]
      );
      return { success: true, statusCode: 200, data: { updated: true } };
    },
  },
  previewTemplate: {
    execute: async (svc, p, body) => {
      const { data: sampleData } = body as {
        data: Record<string, unknown>;
      };
      const data = await svc.templateService.previewTemplate(
        p.templateId,
        sampleData || {}
      );
      return { success: true, statusCode: 200, data };
    },
  },
};

// ============================================================
// Dispatch entrypoints
// ============================================================

export function dispatchEmailProviders(
  method: string,
  params: Params,
  body: unknown
): Promise<unknown> {
  const providerService = getEmailProviderServiceFromDI();
  if (!providerService) {
    throw new Error(
      "Email provider service not available. " +
        "Ensure registerServices() or getNextly() has been called before API requests."
    );
  }

  const handler = EMAIL_PROVIDER_METHODS[method];
  if (!handler) throw new Error(`Unknown method: ${method}`);
  return handler.execute({ providerService }, params, body);
}

export function dispatchEmailTemplates(
  method: string,
  params: Params,
  body: unknown
): Promise<unknown> {
  const templateService = getEmailTemplateServiceFromDI();
  if (!templateService) {
    throw new Error(
      "Email template service not available. " +
        "Ensure registerServices() or getNextly() has been called before API requests."
    );
  }

  const handler = EMAIL_TEMPLATE_METHODS[method];
  if (!handler) throw new Error(`Unknown method: ${method}`);
  return handler.execute({ templateService }, params, body);
}
