import { describe, it, expect } from "vitest";

import { ChallengeRegistry } from "../challenge";

describe("ChallengeRegistry", () => {
  it("dispatches resolve to the matching definition", async () => {
    const reg = new ChallengeRegistry();
    reg.add({
      id: "totp",
      resolve: async ({ response }) =>
        response.code === "123456" ? { ok: true } : { ok: false },
    });
    expect(
      await reg.resolve(
        "totp",
        { userId: "u1", response: { code: "123456" } },
        {} as never
      )
    ).toEqual({ ok: true });
    expect(
      await reg.resolve(
        "totp",
        { userId: "u1", response: { code: "000" } },
        {} as never
      )
    ).toEqual({ ok: false });
  });

  it("throws for an unknown challenge id", async () => {
    const reg = new ChallengeRegistry();
    await expect(
      reg.resolve("nope", { userId: "u1", response: {} }, {} as never)
    ).rejects.toThrow(/Unknown challenge/);
  });

  it("rejects duplicate ids", () => {
    const reg = new ChallengeRegistry();
    reg.add({ id: "totp", resolve: async () => ({ ok: true }) });
    expect(() =>
      reg.add({ id: "totp", resolve: async () => ({ ok: true }) })
    ).toThrow(/Duplicate challenge id/);
  });

  it("reports membership via has()", () => {
    const reg = new ChallengeRegistry();
    reg.add({ id: "totp", resolve: async () => ({ ok: true }) });
    expect(reg.has("totp")).toBe(true);
    expect(reg.has("sms")).toBe(false);
  });
});
