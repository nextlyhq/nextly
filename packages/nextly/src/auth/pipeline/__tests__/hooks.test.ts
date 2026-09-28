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

  it.each([
    ["another account", () => ({ ...user, id: "u2" as AuthUserId })],
    [
      "a challenge for another account",
      () => ({
        challenge: { id: "totp", userId: "u2" },
      }),
    ],
    ["no user", () => undefined as never],
  ])("fails the login when afterAuthenticate returns %s", async (_l, hook) => {
    // What the hook returns is what the session or pending token is issued
    // for, so a different id would sign in an account that never
    // authenticated.
    const reg = new AuthHookRegistry();
    reg.add({ afterAuthenticate: hook });
    await expect(
      reg.runAfterAuthenticate(user, {} as never)
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("lets afterAuthenticate change the user's details", async () => {
    // The control: only the identity is fixed.
    const reg = new AuthHookRegistry();
    reg.add({ afterAuthenticate: u => ({ ...u, name: "Renamed" }) });
    expect(await reg.runAfterAuthenticate(user, {} as never)).toEqual({
      ...user,
      name: "Renamed",
    });
  });

  it("restores the identity and token claims a hook replaced", async () => {
    // A hook spreading provider claims over the core ones would otherwise
    // sign a session for another account, or with other roles.
    const reg = new AuthHookRegistry();
    reg.add({
      customizeClaims: c => ({
        ...c,
        sub: "attacker",
        roleIds: ["super-admin"],
        email: "x@evil.test",
        typ: "pending-auth",
        tenant: "acme",
      }),
    });
    const out = await reg.runCustomizeClaims(
      { sub: "u1", email: "a@b.c", roleIds: ["editor"] },
      user,
      {} as never
    );
    expect(out).toEqual({
      sub: "u1",
      email: "a@b.c",
      roleIds: ["editor"],
      tenant: "acme",
    });
  });

  it("restores claims a hook changed in place or deleted", async () => {
    const reg = new AuthHookRegistry();
    reg.add({
      customizeClaims: c => {
        (c.roleIds as string[]).push("super-admin");
        delete c.sub;
        return c;
      },
    });
    const out = await reg.runCustomizeClaims(
      { sub: "u1", roleIds: ["editor"] },
      user,
      {} as never
    );
    expect(out).toEqual({ sub: "u1", roleIds: ["editor"] });
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
