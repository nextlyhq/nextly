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

  it("hands the details afterAuthenticate changed to the hooks after it", async () => {
    // The control for the identity check above: only the id is fixed here.
    // The details a hook returns reach the later hooks, and no further: the
    // session is signed with the checked account's email, name and image
    // (`handlers/__tests__/issue-session-account-state.test.ts`).
    const reg = new AuthHookRegistry();
    reg.add({ afterAuthenticate: u => ({ ...u, name: "Renamed" }) });
    reg.add({ afterAuthenticate: u => ({ ...u, image: `${u.name}.png` }) });
    expect(await reg.runAfterAuthenticate(user, {} as never)).toEqual({
      ...user,
      name: "Renamed",
      image: "Renamed.png",
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
        sev: 99,
        tenant: "acme",
      }),
    });
    const out = await reg.runCustomizeClaims(
      { sub: "u1", email: "a@b.c", roleIds: ["editor"], sev: 2 },
      user,
      {} as never
    );
    // The session epoch too: a hook setting it would sign a token that
    // outlives the change that ended the account's sessions.
    expect(out).toEqual({
      sub: "u1",
      email: "a@b.c",
      roleIds: ["editor"],
      sev: 2,
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

  describe("an afterAuthenticate hook changing the account in place", () => {
    it("fails the login when the only hook rewrites user.id and returns it", async () => {
      // Compared against the object handed to the hook, the check saw the
      // new id on both sides and passed; the session was then minted for it.
      const reg = new AuthHookRegistry();
      reg.add({
        afterAuthenticate: u => {
          Object.assign(u, { id: "admin-id" });
          return u;
        },
      });
      await expect(
        reg.runAfterAuthenticate({ ...user }, {} as never)
      ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    });

    it("fails when one hook mutates and the next returns a copy", async () => {
      const reg = new AuthHookRegistry();
      reg.add({
        afterAuthenticate: u => {
          u.id = "admin-id" as AuthUserId;
          return u;
        },
      });
      reg.add({ afterAuthenticate: u => ({ ...u }) });
      await expect(
        reg.runAfterAuthenticate({ ...user }, {} as never)
      ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    });

    it("returns the authenticated id even if a hook changes its result later", async () => {
      // A hook keeping a reference to what it returned could otherwise change
      // the account between the check and the mint.
      let kept: AuthUser | undefined;
      const reg = new AuthHookRegistry();
      reg.add({
        afterAuthenticate: u => {
          kept = { ...u, name: "decorated" };
          return kept;
        },
      });
      const out = await reg.runAfterAuthenticate({ ...user }, {} as never);
      (kept as AuthUser).id = "admin-id" as AuthUserId;
      expect(out).toMatchObject({ id: "u1", name: "decorated" });
    });
  });

  describe("claims built from custom fields", () => {
    it("are restored when a hook replaces them", async () => {
      // A tenant id from `user_ext` reaches custom access rules as the
      // caller's identity; a replaced one would judge the session as
      // another tenant.
      const reg = new AuthHookRegistry();
      reg.add({ customizeClaims: c => ({ ...c, tenantId: "t2" }) });
      const out = await reg.runCustomizeClaims(
        { sub: "u1", tenantId: "t1" },
        user,
        {} as never
      );
      expect(out).toEqual({ sub: "u1", tenantId: "t1" });
    });

    it("are restored when a hook deletes them", async () => {
      const reg = new AuthHookRegistry();
      reg.add({
        customizeClaims: c => {
          delete c.tenantId;
          return c;
        },
      });
      const out = await reg.runCustomizeClaims(
        { sub: "u1", tenantId: "t1" },
        user,
        {} as never
      );
      expect(out).toEqual({ sub: "u1", tenantId: "t1" });
    });

    it("still let a hook ADD a claim of its own", async () => {
      // The control: restoring everything would satisfy the cases above
      // while also dropping what hooks exist to add.
      const reg = new AuthHookRegistry();
      reg.add({ customizeClaims: c => ({ ...c, plan: "pro" }) });
      const out = await reg.runCustomizeClaims(
        { sub: "u1", tenantId: "t1" },
        user,
        {} as never
      );
      expect(out).toEqual({ sub: "u1", tenantId: "t1", plan: "pro" });
    });
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
