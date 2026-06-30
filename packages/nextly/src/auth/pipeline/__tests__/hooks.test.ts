import { describe, it, expect } from "vitest";

import type { AuthUser, AuthUserId } from "../../../types/auth";
import { AuthHookRegistry } from "../hooks";

const user: AuthUser = { id: "u1" as AuthUserId, email: "a@b.c" };

describe("AuthHookRegistry", () => {
  it("is empty until hooks are added", () => {
    const reg = new AuthHookRegistry();
    expect(reg.isEmpty).toBe(true);
    reg.add({});
    expect(reg.isEmpty).toBe(false);
  });

  it("runs afterAuthenticate in order; a returned challenge short-circuits", async () => {
    const reg = new AuthHookRegistry();
    reg.add({ afterAuthenticate: u => ({ ...u, name: "decorated" }) });
    reg.add({
      afterAuthenticate: () => ({ challenge: { id: "totp", userId: "u1" } }),
    });
    reg.add({
      afterAuthenticate: () => {
        throw new Error("must not run after a challenge");
      },
    });
    const res = await reg.runAfterAuthenticate(user, {} as never);
    expect("challenge" in res && res.challenge.id).toBe("totp");
  });

  it("threads customizeClaims through every hook", async () => {
    const reg = new AuthHookRegistry();
    reg.add({ customizeClaims: c => ({ ...c, a: 1 }) });
    reg.add({ customizeClaims: c => ({ ...c, b: 2 }) });
    const out = await reg.runCustomizeClaims({ sub: "u1" }, user, {} as never);
    expect(out).toMatchObject({ sub: "u1", a: 1, b: 2 });
  });

  it("determineUser returns the first non-null resolution", async () => {
    const reg = new AuthHookRegistry();
    reg.add({ determineUser: () => null });
    reg.add({ determineUser: () => user });
    expect(
      await reg.runDetermineUser(new Request("http://x"), {} as never)
    ).toEqual(user);
  });

  it("threads beforeRegister data through every hook", async () => {
    const reg = new AuthHookRegistry();
    reg.add({ beforeRegister: d => ({ ...d, source: "x" }) });
    const out = await reg.runBeforeRegister({ email: "a@b.c" }, {} as never);
    expect(out).toMatchObject({ email: "a@b.c", source: "x" });
  });

  it("observe-style phases fan out without error when empty", async () => {
    const reg = new AuthHookRegistry();
    await expect(reg.runAfterLogin(user, {} as never)).resolves.toBeUndefined();
    await expect(reg.runAfterLogout({} as never)).resolves.toBeUndefined();
  });
});
