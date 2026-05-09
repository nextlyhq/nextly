/**
 * Email provider + template dispatch handlers.
 *
 * Groups the two email service maps into one handler file because both
 * share the same DI-resolution pattern and neither has enough logic to
 * warrant its own module. Routes 7 provider ops and 8 template ops.
 *
 * Every handler returns a Response built via the respondX helpers in
 * `../../api/response-shapes.ts`. The dispatcher passes the Response
 * through unchanged. See spec §5.1 for the canonical shape contract.
 *
 * Email services are non-paginated (they return plain arrays), so list
 * methods use respondData with a named field rather than respondList
 * plus synthetic pagination meta.
 */

import {
  respondAction,
  respondData,
  respondDoc,
  respondMutation,
} from "../../api/response-shapes";
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
    // The provider service returns a plain array (no pagination meta),
    // so we wrap it in a named field rather than manufacturing synthetic
    // pagination meta for respondList.
    execute: async svc => {
      const providers = await svc.providerService.listProviders();
      return respondData({ providers });
    },
  },
  createProvider: {
    execute: async (svc, _p, body) => {
      const provider = await svc.providerService.createProvider(
        body as Parameters<typeof svc.providerService.createProvider>[0]
      );
      return respondMutation("Email provider created.", provider, {
        status: 201,
      });
    },
  },
  getProvider: {
    // Service throws NextlyError NOT_FOUND when the provider doesn't
    // exist.
    execute: async (svc, p) => {
      const provider = await svc.providerService.getProvider(p.providerId);
      return respondDoc(provider);
    },
  },
  updateProvider: {
    execute: async (svc, p, body) => {
      const provider = await svc.providerService.updateProvider(
        p.providerId,
        body as Parameters<typeof svc.providerService.updateProvider>[1]
      );
      return respondMutation("Email provider updated.", provider);
    },
  },
  deleteProvider: {
    // Spec divergence: spec §5.1 / §7.4 strictly maps delete to
    // respondMutation, but providerService.deleteProvider returns void
    // (no deleted record to surface). We use respondAction here so the
    // wire shape is `{ message, providerId }` rather than the awkward
    // `{ message, item: undefined }` that respondMutation would emit.
    // If providerService.deleteProvider is later refactored to return
    // the deleted record, switch this back to respondMutation.
    execute: async (svc, p) => {
      await svc.providerService.deleteProvider(p.providerId);
      return respondAction("Email provider deleted.", {
        providerId: p.providerId,
      });
    },
  },
  setDefault: {
    // setDefault is a non-CRUD mutation: no new record is created and
    // the "updated" record is the same provider promoted to default.
    // Surface the updated provider as a sibling field so the admin can
    // refresh its local cache.
    execute: async (svc, p) => {
      const provider = await svc.providerService.setDefault(p.providerId);
      return respondAction("Default email provider updated.", { provider });
    },
  },
  testProvider: {
    // testProvider is a side-effecting action (sends an email); the
    // result carries `success`/`error` flags from the underlying
    // transport.
    execute: async (svc, p, body) => {
      const { email } = body as { email: string };
      const result = await svc.providerService.testProvider(
        p.providerId,
        email
      );
      return respondAction("Test email dispatched.", { result });
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
    // Plain array, no pagination; same rationale as listProviders.
    execute: async svc => {
      const templates = await svc.templateService.listTemplates();
      return respondData({ templates });
    },
  },
  createTemplate: {
    execute: async (svc, _p, body) => {
      const template = await svc.templateService.createTemplate(
        body as Parameters<typeof svc.templateService.createTemplate>[0]
      );
      return respondMutation("Email template created.", template, {
        status: 201,
      });
    },
  },
  getTemplate: {
    execute: async (svc, p) => {
      const template = await svc.templateService.getTemplate(p.templateId);
      return respondDoc(template);
    },
  },
  updateTemplate: {
    execute: async (svc, p, body) => {
      const template = await svc.templateService.updateTemplate(
        p.templateId,
        body as Parameters<typeof svc.templateService.updateTemplate>[1]
      );
      return respondMutation("Email template updated.", template);
    },
  },
  deleteTemplate: {
    // Spec divergence: spec §5.1 / §7.4 strictly maps delete to
    // respondMutation, but templateService.deleteTemplate returns void
    // (no deleted record to surface). We use respondAction here so the
    // wire shape is `{ message, templateId }` rather than the awkward
    // `{ message, item: undefined }` that respondMutation would emit.
    // If templateService.deleteTemplate is later refactored to return
    // the deleted record, switch this back to respondMutation.
    execute: async (svc, p) => {
      await svc.templateService.deleteTemplate(p.templateId);
      return respondAction("Email template deleted.", {
        templateId: p.templateId,
      });
    },
  },
  getLayout: {
    // The layout is a `{header, footer}` pair, not a single document,
    // so the bare data shape fits better than respondDoc here.
    execute: async svc => {
      const layout = await svc.templateService.getLayout();
      return respondData(layout);
    },
  },
  updateLayout: {
    // Service returns void; the action result is a confirmation toast.
    execute: async (svc, _p, body) => {
      await svc.templateService.updateLayout(
        body as Parameters<typeof svc.templateService.updateLayout>[0]
      );
      return respondAction("Email layout updated.");
    },
  },
  previewTemplate: {
    // previewTemplate is a non-CRUD read returning a `{subject, html}`
    // pair (no document identity, no mutation, no pagination), which
    // matches respondData's contract exactly.
    execute: async (svc, p, body) => {
      const { data: sampleData } = body as {
        data: Record<string, unknown>;
      };
      const preview = await svc.templateService.previewTemplate(
        p.templateId,
        sampleData || {}
      );
      return respondData(preview);
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
