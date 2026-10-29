/**
 * A checked Direct API call that is refused logs why, as a refused request
 * does.
 *
 * A REST refusal is logged where it is answered; a Direct API call throws its
 * refusal straight to its caller, with no route boundary to log it, so the
 * check logs it itself before throwing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { container } from "../../../di/container";

vi.mock("../../../auth/middleware", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../auth/middleware")>()),
  authorizeCaller: async () => ({
    success: false,
    statusCode: 403,
    message: "Forbidden",
    error: "You can't create roles.",
    data: null,
    reason: "the caller does not hold create-roles",
  }),
}));

const { authorizeChecked } = await import("../helpers");

describe("a refused checked Direct API call", () => {
  const info = vi.fn();

  beforeAll(() => {
    container.register("logger", () => ({
      debug: vi.fn(),
      info,
      warn: vi.fn(),
      error: vi.fn(),
    }));
  });
  afterAll(() => {
    container.clear();
  });

  it("logs why it was refused, and throws what was refused", async () => {
    await expect(
      authorizeChecked(
        {
          userId: "user-1",
          permissions: [],
          roles: [],
          authMethod: "session",
        },
        { action: "create", resource: "roles" }
      )
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      publicMessage: "You can't create roles.",
    });
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("Refused"),
      expect.objectContaining({
        status: 403,
        reason: "the caller does not hold create-roles",
      })
    );
  });
});
