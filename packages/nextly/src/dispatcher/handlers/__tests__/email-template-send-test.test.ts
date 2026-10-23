/**
 * A template's test send goes to the signed-in user's own address, and only
 * there.
 *
 * The admin's "Send test" is the one way to send email over the admin API. A
 * caller who could name the recipient could send as the site to anyone, so
 * the address comes from the caller's own user record and any `to` in the
 * body is ignored. A caller with no address of its own, an API key above all,
 * is refused before anything is sent.
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

const TEMPLATE = { id: "t1", slug: "welcome" };
const PARAMS = { templateId: "t1" };

let sendWithTemplate: ReturnType<typeof vi.fn>;
let findById: ReturnType<typeof vi.fn>;

beforeEach(() => {
  services.clear();
  sendWithTemplate = vi
    .fn()
    .mockResolvedValue({ success: true, messageId: "m-1" });
  findById = vi.fn(async (id: string) => ({
    id,
    email: `${id}@example.com`,
  }));
  services.set("emailService", { sendWithTemplate });
  services.set("userService", { findById });
  vi.mocked(getEmailTemplateServiceFromDI).mockReturnValue({
    getTemplate: vi.fn().mockResolvedValue(TEMPLATE),
  } as never);
});

describe("a template's test send", () => {
  it("sends the saved template to the signed-in user's own address", async () => {
    const result = await asCaller(sessionCaller({ userId: "ana" }), () =>
      dispatchEmailTemplates("sendTestTemplate", PARAMS, {
        variables: { name: "Ana" },
      })
    );

    expect(findById).toHaveBeenCalledWith("ana", {});
    expect(sendWithTemplate).toHaveBeenCalledWith(
      "welcome",
      "ana@example.com",
      { name: "Ana" }
    );
    const response = result as Response;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      messageId: "m-1",
    });
  });

  it("ignores a `to` in the body", async () => {
    await asCaller(sessionCaller({ userId: "ana" }), () =>
      dispatchEmailTemplates("sendTestTemplate", PARAMS, {
        to: "someone-else@example.com",
        variables: {},
      })
    );

    expect(sendWithTemplate).toHaveBeenCalledTimes(1);
    expect(sendWithTemplate.mock.calls[0]?.[1]).toBe("ana@example.com");
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
    expect(sendWithTemplate).not.toHaveBeenCalled();
  });

  it("refuses a user with no address, and sends nothing", async () => {
    findById.mockResolvedValue({ id: "ana", email: "" });

    await expect(
      asCaller(sessionCaller({ userId: "ana" }), () =>
        dispatchEmailTemplates("sendTestTemplate", PARAMS, {})
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(sendWithTemplate).not.toHaveBeenCalled();
  });
});
