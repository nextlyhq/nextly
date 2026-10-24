/**
 * A template's test send goes to the signed-in user's own address, and only
 * there.
 *
 * The admin's "Send test" is the one way to send email over the admin API. A
 * caller who could name the recipient could send as the site to anyone, so
 * the address comes from the caller's own user record and any `to` in the
 * body is ignored. A caller with no address of its own, an API key above all,
 * is refused before anything is sent.
 *
 * A test can carry the editor's draft, which is what it then sends; and it
 * names the provider that delivers it, before sending (`testSendTarget`) and
 * after. The kept-template routes reach the template service as the caller.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => new Map<string, unknown>());

vi.mock("../../helpers/di", () => ({
  getEmailProviderServiceFromDI: vi.fn(),
  getEmailTemplateServiceFromDI: vi.fn(),
}));
vi.mock("../../../di/container", () => ({
  container: {
    has: (name: string) => services.has(name),
    get: (name: string) => services.get(name),
  },
}));

import {
  asCaller,
  keyCaller,
  sessionCaller,
} from "../../__tests__/request-caller";
import { getEmailTemplateServiceFromDI } from "../../helpers/di";
import { dispatchEmailTemplates } from "../email-dispatcher";

const TEMPLATE = { id: "t1", slug: "welcome", providerId: "p-template" };
const DELIVERY = { provider: "Resend", type: "resend", delivers: true };
const PARAMS = { templateId: "t1" };

let sendTemplateTest: ReturnType<typeof vi.fn>;
let testDelivery: ReturnType<typeof vi.fn>;
let findById: ReturnType<typeof vi.fn>;
let templateService: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  services.clear();
  sendTemplateTest = vi
    .fn()
    .mockResolvedValue({ success: true, messageId: "m-1" });
  findById = vi.fn(async (id: string) => ({
    id,
    email: `${id}@example.com`,
  }));
  testDelivery = vi.fn().mockResolvedValue(DELIVERY);
  services.set("emailService", { sendTemplateTest, testDelivery });
  services.set("userService", { findById });
  templateService = {
    getTemplate: vi.fn().mockResolvedValue(TEMPLATE),
    oldEngineStatus: vi.fn().mockResolvedValue({ kept: false, reasons: [] }),
    confirmLiquid: vi.fn().mockResolvedValue(TEMPLATE),
  };
  vi.mocked(getEmailTemplateServiceFromDI).mockReturnValue(
    templateService as never
  );
});

describe("a template's test send", () => {
  it("sends the saved template to the signed-in user's own address", async () => {
    const result = await asCaller(sessionCaller({ userId: "ana" }), () =>
      dispatchEmailTemplates("sendTestTemplate", PARAMS, {
        variables: { name: "Ana" },
      })
    );

    expect(findById).toHaveBeenCalledWith("ana", {});
    expect(sendTemplateTest).toHaveBeenCalledWith(
      "welcome",
      "ana@example.com",
      { name: "Ana" },
      undefined
    );
    const response = result as Response;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      messageId: "m-1",
      delivery: DELIVERY,
    });
    // The template's own provider, as its sends use.
    expect(testDelivery).toHaveBeenCalledWith("p-template");
  });

  it("sends the editor's draft, through the draft's provider when it sets one", async () => {
    const draft = { subject: "Draft subject", providerId: "p-draft" };
    await asCaller(sessionCaller({ userId: "ana" }), () =>
      dispatchEmailTemplates("sendTestTemplate", PARAMS, {
        variables: {},
        draft,
      })
    );

    expect(sendTemplateTest).toHaveBeenCalledWith(
      "welcome",
      "ana@example.com",
      {},
      draft
    );
    expect(testDelivery).toHaveBeenCalledWith("p-draft");
  });

  it("ignores a `to` in the body", async () => {
    await asCaller(sessionCaller({ userId: "ana" }), () =>
      dispatchEmailTemplates("sendTestTemplate", PARAMS, {
        to: "someone-else@example.com",
        variables: {},
      })
    );

    expect(sendTemplateTest).toHaveBeenCalledTimes(1);
    expect(sendTemplateTest.mock.calls[0]?.[1]).toBe("ana@example.com");
  });

  it.each([
    ["an API key", keyCaller("k1", { userId: "ana" })],
    ["an anonymous request", undefined],
  ])("refuses %s, and sends nothing", async (_, caller) => {
    await expect(
      asCaller(caller, () =>
        dispatchEmailTemplates("sendTestTemplate", PARAMS, { variables: {} })
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(findById).not.toHaveBeenCalled();
    expect(sendTemplateTest).not.toHaveBeenCalled();
  });

  it("refuses a draft field of the wrong kind", async () => {
    await expect(
      asCaller(sessionCaller({ userId: "ana" }), () =>
        dispatchEmailTemplates("sendTestTemplate", PARAMS, {
          draft: { subject: 42 },
        })
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(sendTemplateTest).not.toHaveBeenCalled();
  });

  it("refuses a user with no address, and sends nothing", async () => {
    findById.mockResolvedValue({ id: "ana", email: "" });

    await expect(
      asCaller(sessionCaller({ userId: "ana" }), () =>
        dispatchEmailTemplates("sendTestTemplate", PARAMS, {})
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(sendTemplateTest).not.toHaveBeenCalled();
  });
});

describe("where a test would go", () => {
  it("names the caller's own address and the provider, sending nothing", async () => {
    const response = (await asCaller(sessionCaller({ userId: "ana" }), () =>
      dispatchEmailTemplates("testSendTarget", PARAMS, undefined)
    )) as Response;

    expect(await response.json()).toEqual({
      to: "ana@example.com",
      delivery: DELIVERY,
    });
    expect(testDelivery).toHaveBeenCalledWith("p-template");
    expect(sendTemplateTest).not.toHaveBeenCalled();
  });

  it.each([
    ["an API key", keyCaller("k1", { userId: "ana" })],
    ["an anonymous request", undefined],
  ])("refuses %s", async (_, caller) => {
    await expect(
      asCaller(caller, () =>
        dispatchEmailTemplates("testSendTarget", PARAMS, undefined)
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(testDelivery).not.toHaveBeenCalled();
  });
});

describe("a template kept on its first engine", () => {
  it("reports whether it is kept, and why", async () => {
    templateService.oldEngineStatus.mockResolvedValue({
      kept: true,
      reasons: [{ field: "htmlContent", label: "HTML", reason: "a filter" }],
    });
    const response = (await asCaller(sessionCaller({ userId: "ana" }), () =>
      dispatchEmailTemplates("templateEngine", PARAMS, undefined)
    )) as Response;

    expect(templateService.oldEngineStatus).toHaveBeenCalledWith("t1");
    expect(await response.json()).toMatchObject({ kept: true });
  });

  it("is read as Liquid by the signed-in caller", async () => {
    await asCaller(sessionCaller({ userId: "ana" }), () =>
      dispatchEmailTemplates("readAsLiquid", PARAMS, undefined)
    );

    expect(templateService.confirmLiquid).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ type: "user", id: "ana" })
    );
  });
});
