/**
 * Email provider + template dispatch handlers.
 *
 * Groups the two email service maps into one handler file because both
 * share the same DI-resolution pattern and neither has enough logic to
 * warrant its own module. Routes 7 provider ops and the template ops.
 *
 * Every handler returns a Response built via the respondX helpers in
 * `../../api/response-shapes.ts`. The dispatcher passes the Response
 * through unchanged. See spec §5.1 for the canonical shape contract.
 *
 * Email services are non-paginated (they return plain arrays), so list
 * methods use respondData with a named field rather than respondList
 * plus synthetic pagination meta.
 */

import { z } from "zod";

import {
  SKIP_DATE_FORMATTING_HEADER,
  respondAction,
  respondData,
  respondDoc,
  respondMutation,
} from "../../api/response-shapes";
import { nextlyValidationFromZod } from "../../api/zod-to-nextly-error";
import { container } from "../../di/container";
import { brandSettingsUpdateSchema } from "../../domains/email/brand-settings";
import { draftPreviewSchema } from "../../domains/email/draft-preview-request";
import { toDescriptor } from "../../domains/email/provider-definition";
import { sendOutcomeMessage } from "../../domains/email/send-outcome";
import { getEmailProviderRegistry } from "../../domains/email/services/email-provider-registry";
import {
  applyOwnerUpdateSchema,
  overrideTemplateSchema,
  undoOwnerUpdateSchema,
} from "../../domains/email/template-ownership-requests";
import type { UserService } from "../../domains/users/services/user-service";
import { NextlyError } from "../../errors/nextly-error";
import type { EmailProviderService } from "../../services/email/email-provider-service";
import type { EmailService } from "../../services/email/email-service";
import type { EmailTemplateService } from "../../services/email/email-template-service";
import { readAuthenticatedActor } from "../helpers/authenticated-actor";
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

/**
 * The editor's fields, saved or not, for a test of what is on screen. Each is
 * optional: an absent field is the stored one.
 */
const testDraftSchema = z.object({
  subject: z.string().optional(),
  preheader: z.string().nullable().optional(),
  htmlContent: z.string().optional(),
  plainTextContent: z.string().nullable().optional(),
  useLayout: z.boolean().optional(),
  layoutId: z.string().nullable().optional(),
  fromOverride: z.string().nullable().optional(),
  replyTo: z.string().nullable().optional(),
  providerId: z.string().nullable().optional(),
  // The attachments on screen, added or removed: null sends none.
  attachments: z
    .array(z.object({ mediaId: z.string(), filename: z.string().optional() }))
    .nullable()
    .optional(),
});

/**
 * A test send's body: the sample data and, for a test of unsaved edits, the
 * editor's draft. Anything else, a `to` included, is ignored.
 */
const sendTestSchema = z.object({
  variables: z.record(z.string(), z.unknown()).optional(),
  draft: testDraftSchema.optional(),
});

/** A service from the container, or undefined before it is set up. */
function fromContainer<T>(name: string): T | undefined {
  try {
    return container.has(name) ? container.get<T>(name) : undefined;
  } catch {
    // DI not initialized
    return undefined;
  }
}

/** The email service, or the generic internal error when it isn't wired. */
function emailServiceOrFail(): EmailService {
  const emailService = fromContainer<EmailService>("emailService");
  // Unwired services are a server fault: the caller gets the generic
  // internal error and the log gets what to call first.
  if (!emailService) {
    throw NextlyError.internal({
      logContext: {
        reason: "email-service-unavailable",
        hint: "Ensure registerServices() or getNextly() has been called before API requests.",
      },
    });
  }
  return emailService;
}

/**
 * The signed-in staff user's own address, which a test send always goes to.
 * An API key or any other caller has no address of its own, and is refused.
 */
async function ownAddressOfCaller(): Promise<string> {
  const actor = readAuthenticatedActor();
  const users = fromContainer<UserService>("userService");
  if (actor?.type !== "user" || !actor.id || !users) {
    throw NextlyError.forbidden({
      logContext: { reason: "test-send-needs-a-signed-in-user" },
    });
  }
  const user = await users.findById(actor.id, {});
  if (!user.email) {
    throw NextlyError.forbidden({
      logContext: { reason: "test-send-user-has-no-address" },
    });
  }
  return user.email;
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
  listProviderTypes: {
    // The catalog of provider types this install can configure, as descriptors.
    // Served through the dispatcher because that is the router a default
    // install actually mounts -- a standalone route handler the template never
    // re-exports is reachable only by an app that opts into it by hand.
    // Not async: the registry is in memory and this reads it synchronously.
    // The dispatcher awaits the returned value either way.
    execute: () => {
      const types = getEmailProviderRegistry().list().map(toDescriptor);
      // Marked to skip global date formatting. These are provider DEFINITIONS,
      // not records: a contributed text or select field whose default happens
      // to look like a timestamp would otherwise be rewritten by value, so the
      // descriptor would stop matching the registered definition and would vary
      // with the installation's timezone.
      const response = respondData({ types });
      response.headers.set(SKIP_DATE_FORMATTING_HEADER, "1");
      return Promise.resolve(response);
    },
  },
  createProvider: {
    // The acting identity is already on the params -- the route handler stamps
    // it for every dispatched request -- and this domain simply never read it,
    // which is why credential changes left no trail.
    execute: async (svc, p, body) => {
      const provider = await svc.providerService.createProvider(
        body as Parameters<typeof svc.providerService.createProvider>[0],
        readAuthenticatedActor()
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
        body as Parameters<typeof svc.providerService.updateProvider>[1],
        readAuthenticatedActor()
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
      await svc.providerService.deleteProvider(
        p.providerId,
        readAuthenticatedActor()
      );
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
      const provider = await svc.providerService.setDefault(
        p.providerId,
        readAuthenticatedActor()
      );
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
    // Plain array, no pagination; same rationale as listProviders. Each row
    // says whether it is kept on the previous engine, so the admin's list can
    // name those emails without asking once per row; the service answers for
    // the whole list in one pass.
    execute: async svc => {
      const records = await svc.templateService.listTemplates();
      const kept = await svc.templateService.keptOnOldEngineIds(records);
      const templates = records.map(record => ({
        ...record,
        keptOnOldEngine: kept.has(record.id),
      }));
      return respondData({ templates });
    },
  },
  createTemplate: {
    execute: async (svc, p, body) => {
      const template = await svc.templateService.createTemplate(
        body as Parameters<typeof svc.templateService.createTemplate>[0],
        readAuthenticatedActor()
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
        body as Parameters<typeof svc.templateService.updateTemplate>[1],
        readAuthenticatedActor()
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
      await svc.templateService.deleteTemplate(
        p.templateId,
        readAuthenticatedActor()
      );
      return respondAction("Email template deleted.", {
        templateId: p.templateId,
      });
    },
  },
  previewDraft: {
    /*
     * Renders fields that may never have been saved, for the editor's live
     * preview. Validated against the SAME schema the standalone route module
     * uses: two transports reach this behaviour, and a body accepted by one
     * and refused by the other is a difference nobody can see from the client.
     *
     * Returns `{ subject, html, text }` — the whole artifact, including the
     * text part, which is the field the browser-side preview used to guess at.
     */
    execute: async (svc, _p, body) => {
      let validated: z.infer<typeof draftPreviewSchema>;
      try {
        validated = draftPreviewSchema.parse(body);
      } catch (err) {
        if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
        throw err;
      }
      const preview = await svc.templateService.previewDraft(
        validated.template,
        validated.data,
        validated.brand
      );
      // A render, not stored data: preview text or a subject that reads as a
      // date must reach the editor as the email shows it, not rewritten to the
      // installation's timezone.
      const response = respondData(preview);
      response.headers.set(SKIP_DATE_FORMATTING_HEADER, "1");
      return response;
    },
  },
  overrideTemplate: {
    execute: async (svc, p, body) => {
      const { version } = parseBody(overrideTemplateSchema, body ?? {});
      const template = await svc.templateService.overrideTemplate(
        p.templateId,
        { version },
        readAuthenticatedActor()
      );
      return respondMutation("Email template overridden.", template);
    },
  },
  resetTemplate: {
    execute: async (svc, p) => {
      const template = await svc.templateService.resetTemplate(
        p.templateId,
        readAuthenticatedActor()
      );
      return respondMutation(
        "Email template reset to its owner's version.",
        template
      );
    },
  },
  compareTemplate: {
    // A non-CRUD read: the three versions and the offered changes.
    execute: async (svc, p) => {
      const comparison = await svc.templateService.compareTemplate(
        p.templateId
      );
      return respondData(comparison);
    },
  },
  applyOwnerUpdate: {
    execute: async (svc, p, body) => {
      const { choices, review } = parseBody(applyOwnerUpdateSchema, body);
      const { template, undo } = await svc.templateService.applyOwnerUpdate(
        p.templateId,
        choices,
        review,
        readAuthenticatedActor()
      );
      // A non-CRUD write with a result beside the item: Undo needs it.
      return respondAction("Owner's update applied.", {
        item: template,
        undo,
      });
    },
  },
  undoOwnerUpdate: {
    execute: async (svc, p, body) => {
      const { undo } = parseBody(undoOwnerUpdateSchema, body);
      const template = await svc.templateService.undoOwnerUpdate(
        p.templateId,
        undo,
        readAuthenticatedActor()
      );
      return respondMutation("Owner's update undone.", template);
    },
  },
  getBrand: {
    // A non-CRUD read: the brand settings, what each starts from, the fonts
    // they can use and which emails they reach.
    execute: async svc => respondData(await svc.templateService.getBrand()),
  },
  updateBrand: {
    execute: async (svc, _p, body) => {
      const change = parseBody(brandSettingsUpdateSchema, body ?? {});
      const settings = await svc.templateService.updateBrand(change);
      return respondMutation("Email brand settings saved.", settings);
    },
  },
  sendTestTemplate: {
    // Sends the SAVED template, with the editor's sample data, to the
    // signed-in user's own address and to nobody else: never to one the
    // caller names (a route that let any signed-in caller choose the
    // recipient would let anyone with an account send as the site), and never
    // to the template's own Cc and Bcc, who would get a sample-data email.
    //
    // PATCH, not POST, on purpose: the email-templates gate takes its
    // permission from the method, and PATCH is what makes this require
    // `update-email-templates`, as the ownership steps do. A POST would
    // need only `create-email-templates`.
    //
    // With a draft, the test is of what is on screen: the editor's unsaved
    // fields over the stored template, through the same render path as a real
    // send. The response says which provider the send went through, and
    // whether that provider delivers anything (the log provider doesn't).
    execute: async (svc, p, body) => {
      const { variables, draft } = parseBody(sendTestSchema, body ?? {});
      const to = await ownAddressOfCaller();
      const template = await svc.templateService.getTemplate(p.templateId);
      const result = await emailServiceOrFail().sendTemplateTest(
        template.slug,
        to,
        variables ?? {},
        draft
      );
      return respondAction(sendOutcomeMessage(result.success), { ...result });
    },
  },
  testSendTarget: {
    // Where a test of this template would go, and which provider would
    // deliver it, before anything is sent: the caller's own address, refused
    // to anyone without one, as the send is.
    //
    // `?providerId=` names the provider the editor's draft chose, as the send
    // will use it: an id, or empty for the default. Without it, the
    // template's own.
    execute: async (svc, p) => {
      const to = await ownAddressOfCaller();
      const template = await svc.templateService.getTemplate(p.templateId);
      const asked = p.providerId;
      const delivery = await emailServiceOrFail().testDelivery(
        asked === undefined ? template.providerId : asked || null
      );
      return respondData({ to, delivery });
    },
  },
  templateEngine: {
    // Whether the template is kept on the engine it was written for, and the
    // fields and reasons that keep it there.
    execute: async (svc, p) =>
      respondData({
        ...(await svc.templateService.oldEngineStatus(p.templateId)),
      }),
  },
  readAsLiquid: {
    // Reads a kept template as Liquid from now on. The service refuses while
    // the text that kept it is unchanged, or when it doesn't parse.
    execute: async (svc, p) => {
      const template = await svc.templateService.confirmLiquid(
        p.templateId,
        readAuthenticatedActor()
      );
      return respondMutation("This email is now read as Liquid.", template);
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

/** Parse a request body, turning a schema refusal into the validation envelope. */
function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown
): z.infer<S> {
  try {
    return schema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
    throw err;
  }
}

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
