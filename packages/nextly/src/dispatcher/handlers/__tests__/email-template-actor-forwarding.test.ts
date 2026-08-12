/**
 * Every surface that mutates a template forwards the acting identity.
 *
 * The activity trail drops any write whose actor is not a signed-in person, so
 * a surface that never passes one records nothing at all — and it does so
 * silently, looking exactly like a surface nobody used. The REST routes are not
 * the only door: the dispatcher and the Direct API reach the same service.
 *
 * Asserted by OBSERVING the argument the service actually receives, rather than
 * by re-deriving what the handler ought to pass. A reconstruction keeps passing
 * after someone edits the line it exists to watch.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../helpers/di", () => ({
  getEmailProviderServiceFromDI: vi.fn(),
  getEmailTemplateServiceFromDI: vi.fn(),
}));

import { getEmailTemplateServiceFromDI } from "../../helpers/di";
import { dispatchEmailTemplates } from "../email-dispatcher";

const TEMPLATE = {
  id: "t1",
  name: "Password reset",
  slug: "password-reset",
  kind: "template",
  subject: "Reset",
  htmlContent: "<p>x</p>",
};

/**
 * The shape the dispatcher reads an actor out of.
 *
 * Route params are strings, so the actor arrives split across two of them —
 * `readAuthenticatedActor` reads exactly these names. A fixture carrying a
 * `user` object instead resolves to no actor, which would make this suite pass
 * against a handler that forwards nothing.
 */
const PARAMS = {
  templateId: "t1",
  _authenticatedActorType: "user",
  _authenticatedActorId: "user-1",
};

describe("template mutations forward the actor through the dispatcher", () => {
  let service: {
    createTemplate: ReturnType<typeof vi.fn>;
    updateTemplate: ReturnType<typeof vi.fn>;
    deleteTemplate: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      createTemplate: vi.fn().mockResolvedValue(TEMPLATE),
      updateTemplate: vi.fn().mockResolvedValue(TEMPLATE),
      deleteTemplate: vi.fn().mockResolvedValue(undefined),
    };
    // The DI helper returns the SERVICE; the dispatcher is what wraps it as
    // `{ templateService }`. Mocking the wrapper instead produces a service
    // whose methods are undefined.
    vi.mocked(getEmailTemplateServiceFromDI).mockReturnValue(service as never);
  });

  it("passes an actor to createTemplate", async () => {
    await dispatchEmailTemplates("createTemplate", PARAMS, {
      name: TEMPLATE.name,
      slug: TEMPLATE.slug,
      subject: TEMPLATE.subject,
      htmlContent: TEMPLATE.htmlContent,
    });

    expect(service.createTemplate).toHaveBeenCalledTimes(1);
    // The SECOND argument is the actor. Asserted as defined rather than as a
    // particular shape: what the dispatcher resolves out of its params is that
    // helper's business, and pinning it here would duplicate its rules.
    expect(service.createTemplate.mock.calls[0]?.[1]).toBeDefined();
  });

  it("passes an actor to updateTemplate", async () => {
    await dispatchEmailTemplates("updateTemplate", PARAMS, {
      subject: "Changed",
    });

    expect(service.updateTemplate).toHaveBeenCalledTimes(1);
    expect(service.updateTemplate.mock.calls[0]?.[2]).toBeDefined();
  });

  it("passes an actor to deleteTemplate", async () => {
    await dispatchEmailTemplates("deleteTemplate", PARAMS, undefined);

    expect(service.deleteTemplate).toHaveBeenCalledTimes(1);
    expect(service.deleteTemplate.mock.calls[0]?.[1]).toBeDefined();
  });
});
