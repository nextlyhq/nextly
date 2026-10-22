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

import { asCaller, sessionCaller } from "../../__tests__/request-caller";
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

const PARAMS = { templateId: "t1" };

/**
 * The request caller the dispatcher reads an actor out of, set the way the
 * route handler sets it. A fixture carrying a `user` object or identity params
 * instead resolves to no actor, which would make this suite pass against a
 * handler that forwards nothing.
 */
const CALLER = sessionCaller({ userId: "user-1" });

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
    await asCaller(CALLER, () =>
      dispatchEmailTemplates("createTemplate", PARAMS, {
        name: TEMPLATE.name,
        slug: TEMPLATE.slug,
        subject: TEMPLATE.subject,
        htmlContent: TEMPLATE.htmlContent,
      })
    );

    expect(service.createTemplate).toHaveBeenCalledTimes(1);
    // The SECOND argument is the actor. Asserted as defined rather than as a
    // particular shape: what the dispatcher resolves out of the caller is that
    // helper's business, and pinning it here would duplicate its rules.
    expect(service.createTemplate.mock.calls[0]?.[1]).toBeDefined();
  });

  it("passes an actor to updateTemplate", async () => {
    await asCaller(CALLER, () =>
      dispatchEmailTemplates("updateTemplate", PARAMS, {
        subject: "Changed",
      })
    );

    expect(service.updateTemplate).toHaveBeenCalledTimes(1);
    expect(service.updateTemplate.mock.calls[0]?.[2]).toBeDefined();
  });

  it("passes an actor to deleteTemplate", async () => {
    await asCaller(CALLER, () =>
      dispatchEmailTemplates("deleteTemplate", PARAMS, undefined)
    );

    expect(service.deleteTemplate).toHaveBeenCalledTimes(1);
    expect(service.deleteTemplate.mock.calls[0]?.[1]).toBeDefined();
  });
});
