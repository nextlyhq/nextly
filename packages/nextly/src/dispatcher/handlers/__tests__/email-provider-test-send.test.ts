/**
 * A provider's test send goes to the signed-in user's own address, and only
 * there.
 *
 * Sending a test is open to whoever may add providers, so they can test the
 * one they just made. A caller who could also name the recipient could send
 * through any saved provider's credentials to anyone, so the address comes
 * from the caller's own user record and any `email` in the body is ignored.
 * A caller with no address of its own, an API key above all, is refused
 * before anything is sent.
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
import { getEmailProviderServiceFromDI } from "../../helpers/di";
import { dispatchEmailProviders } from "../email-dispatcher";

const PARAMS = { providerId: "p1" };

let testProvider: ReturnType<typeof vi.fn>;
let findById: ReturnType<typeof vi.fn>;

beforeEach(() => {
  services.clear();
  testProvider = vi.fn().mockResolvedValue({ success: true });
  findById = vi.fn(async (id: string) => ({
    id,
    email: `${id}@example.com`,
  }));
  services.set("userService", { findById });
  vi.mocked(getEmailProviderServiceFromDI).mockReturnValue({
    testProvider,
  } as never);
});

describe("a provider's test send", () => {
  it("goes to the signed-in user's own address", async () => {
    const result = await asCaller(sessionCaller({ userId: "ana" }), () =>
      dispatchEmailProviders("testProvider", PARAMS, {})
    );

    expect(findById).toHaveBeenCalledWith("ana", {});
    expect(testProvider).toHaveBeenCalledWith("p1", "ana@example.com");
    const response = result as Response;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "Test email dispatched.",
      result: { success: true },
    });
  });

  it("ignores an address in the body", async () => {
    await asCaller(sessionCaller({ userId: "ana" }), () =>
      dispatchEmailProviders("testProvider", PARAMS, {
        email: "someone-else@example.com",
      })
    );

    expect(testProvider).toHaveBeenCalledTimes(1);
    expect(testProvider.mock.calls[0]?.[1]).toBe("ana@example.com");
  });

  it("refuses an API key, which has no address of its own, before sending", async () => {
    await expect(
      asCaller(keyCaller("k1"), () =>
        dispatchEmailProviders("testProvider", PARAMS, {
          email: "someone-else@example.com",
        })
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(testProvider).not.toHaveBeenCalled();
  });
});
