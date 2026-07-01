import { describe, it, expect } from "vitest";

import type { AuthUser, AuthUserId } from "../../../types/auth";
import { createPasswordStrategy } from "../password-strategy";

const user: AuthUser = {
  id: "u1" as AuthUserId,
  email: "a@b.c",
  name: "A",
  image: null,
};

describe("password strategy", () => {
  it("returns pass when no email/password present", async () => {
    const s = createPasswordStrategy({
      verify: async () => {
        throw new Error("unused");
      },
    });
    const out = await s.authenticate(
      { request: new Request("http://x"), body: {}, strategyName: "password" },
      {} as never
    );
    expect(out.type).toBe("pass");
  });

  it("returns authenticated on valid credentials", async () => {
    const s = createPasswordStrategy({ verify: async () => user });
    const out = await s.authenticate(
      {
        request: new Request("http://x"),
        body: { email: "a@b.c", password: "p" },
        strategyName: "password",
      },
      {} as never
    );
    expect(out).toEqual({ type: "authenticated", user });
  });

  it("re-throws the verifier's error (failure legs preserved)", async () => {
    const s = createPasswordStrategy({
      verify: async () => {
        throw new Error("AUTH_INVALID_CREDENTIALS");
      },
    });
    await expect(
      s.authenticate(
        {
          request: new Request("http://x"),
          body: { email: "a@b.c", password: "bad" },
          strategyName: "password",
        },
        {} as never
      )
    ).rejects.toThrow("AUTH_INVALID_CREDENTIALS");
  });
});
