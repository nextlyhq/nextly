/**
 * Each limit of a CLI sign-in and an agent pass, on a fake clock: the
 * 15-minute access token, the refresh token replaced on every use, the
 * 30 days unused, the 90 days in all, and the 4-hour pass that never
 * outlives its sign-in. A replaced refresh token presented again revokes
 * the sign-in and everything issued from it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLI_CREDENTIAL_LIFETIMES } from "../purposes";
import {
  hashRefreshToken,
  mintRefreshToken,
  parseRefreshToken,
} from "../refresh-token";
import { createCliCredentialService } from "../service";

import { credentialOf, memoryCliCredentialStore } from "./memory-store";

// A fixture signing key: long enough for HS256, plainly not a real one.
const SECRET = "fixture-".repeat(6);
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const START = new Date("2026-11-27T09:00:00.000Z");

function setup() {
  const store = memoryCliCredentialStore();
  const service = createCliCredentialService({ store, secret: SECRET });
  return { store, service };
}

/** Move the fake clock to `ms` after the start. */
function at(ms: number) {
  vi.setSystemTime(START.getTime() + ms);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a CLI sign-in's access token", () => {
  it("lasts 15 minutes", async () => {
    const { service } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: "laptop" });

    expect(signIn.accessTokenExpiresAt.getTime()).toBe(
      START.getTime() + 15 * MINUTE
    );
    at(15 * MINUTE - 1000);
    expect((await service.verify(signIn.accessToken, "command")).ok).toBe(true);
    at(15 * MINUTE);
    expect(await service.verify(signIn.accessToken, "command")).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("is never valid past the sign-in's 90-day end", async () => {
    const { service } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });
    let refresh = signIn.refreshToken;
    // Used every 20 days, so the idle end never comes first.
    for (const day of [20, 40, 60, 80]) {
      at(day * DAY);
      const renewed = await service.renew(refresh);
      if (!renewed.ok) throw new Error(`renewal on day ${day} refused`);
      refresh = renewed.refreshToken;
    }
    at(90 * DAY - 5 * MINUTE);
    const last = await service.renew(refresh);
    if (!last.ok) throw new Error("renewal before the end refused");

    expect(last.accessTokenExpiresAt.getTime()).toBe(
      START.getTime() + 90 * DAY
    );
    expect(last.signInEndsAt.getTime()).toBe(START.getTime() + 90 * DAY);
  });
});

describe("a CLI sign-in's refresh token", () => {
  it("is replaced on every use, and the replacement is the one that works", async () => {
    const { service, store } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });

    at(16 * MINUTE);
    const renewed = await service.renew(signIn.refreshToken);
    if (!renewed.ok) throw new Error("renewal refused");

    expect(renewed.refreshToken).not.toBe(signIn.refreshToken);
    expect(renewed.credentialId).toBe(signIn.credentialId);
    const row = store.rows.get(signIn.credentialId);
    expect(row?.refreshTokenHash).toBe(hashRefreshToken(renewed.refreshToken));
    expect(row?.refreshGeneration).toBe(1);
    expect(row?.lastUsedAt).toBe(START.getTime() + 16 * MINUTE);
    expect((await service.verify(renewed.accessToken, "command")).ok).toBe(
      true
    );

    at(17 * MINUTE);
    expect((await service.renew(renewed.refreshToken)).ok).toBe(true);
  });

  it("ends 30 days after it was last used", async () => {
    const { service, store } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });
    at(10 * DAY);
    const renewed = await service.renew(signIn.refreshToken);
    if (!renewed.ok) throw new Error("renewal refused");

    // 30 days counted from the renewal, not from the sign-in: past the
    // sign-in's own 30th day, and refused from the renewal's.
    expect(store.rows.get(signIn.credentialId)?.idleEndsAt).toBe(
      START.getTime() + 40 * DAY
    );
    at(40 * DAY);
    expect(await service.renew(renewed.refreshToken)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("still renews just before 30 days unused", async () => {
    const { service } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });
    at(30 * DAY - 1000);
    expect((await service.renew(signIn.refreshToken)).ok).toBe(true);
  });

  it("ends 90 days after sign-in, however recently it was used", async () => {
    const { service } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });
    let refresh = signIn.refreshToken;
    for (const day of [25, 50, 75, 89]) {
      at(day * DAY);
      const renewed = await service.renew(refresh);
      if (!renewed.ok) throw new Error(`renewal on day ${day} refused`);
      refresh = renewed.refreshToken;
    }
    at(90 * DAY);
    expect(await service.renew(refresh)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("ends 90 days after sign-in even when its stored idle end says later", async () => {
    const { service, store } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });
    // Renewals cap the idle end at the 90-day end; a row whose idle end
    // was written past it still ends at 90 days.
    const row = store.rows.get(signIn.credentialId);
    if (!row) throw new Error("no sign-in row");
    row.idleEndsAt = START.getTime() + 120 * DAY;
    // Accepted while its token was good, as a route would hold it.
    const from = await credentialOf(service, signIn.accessToken);

    at(90 * DAY);
    expect(await service.renew(signIn.refreshToken)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(
      await service.issueAgentPass({
        from,
        agentName: null,
        machine: null,
      })
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("used again after it was replaced, revokes the sign-in and every credential from it", async () => {
    const { service, store } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });
    const pass = await service.issueAgentPass({
      from: await credentialOf(service, signIn.accessToken),
      agentName: "Claude Code",
      machine: null,
    });
    if (!pass.ok) throw new Error("pass refused");
    at(MINUTE);
    const renewed = await service.renew(signIn.refreshToken);
    if (!renewed.ok) throw new Error("renewal refused");

    expect(await service.renew(signIn.refreshToken)).toEqual({
      ok: false,
      reason: "reused",
    });

    for (const row of store.rows.values()) {
      expect(row.revokedAt).toBe(START.getTime() + MINUTE);
      expect(row.revokedReason).toBe("refresh-reused");
    }
    expect(await service.renew(renewed.refreshToken)).toEqual({
      ok: false,
      reason: "revoked",
    });
    expect(await service.verify(renewed.accessToken, "command")).toEqual({
      ok: false,
      reason: "revoked",
    });
    expect(await service.verify(pass.accessToken, "command")).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("presented twice at once, is renewed once and revokes the sign-in", async () => {
    const { service, store } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });
    at(MINUTE);

    const results = await Promise.all([
      service.renew(signIn.refreshToken),
      service.renew(signIn.refreshToken),
    ]);

    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok)).toEqual([
      { ok: false, reason: "reused" },
    ]);
    expect(store.rows.get(signIn.credentialId)?.revokedReason).toBe(
      "refresh-reused"
    );
  });

  it("renewed while its sign-in is being revoked, is refused as revoked and not replaced", async () => {
    const store = memoryCliCredentialStore();
    // The sign-out lands between the renewal's read and its write.
    const racing = {
      ...store,
      rotate: async (change: Parameters<typeof store.rotate>[0]) => {
        await store.revoke({ familyId: change.id }, Date.now(), "revoked");
        return store.rotate(change);
      },
    };
    const service = createCliCredentialService({
      store: racing,
      secret: SECRET,
    });
    const signIn = await service.signIn({ userId: "u1", machine: null });

    expect(await service.renew(signIn.refreshToken)).toEqual({
      ok: false,
      reason: "revoked",
    });
    const row = store.rows.get(signIn.credentialId);
    expect(row?.refreshGeneration).toBe(0);
    expect(row?.refreshTokenHash).toBe(hashRefreshToken(signIn.refreshToken));
    expect(row?.revokedReason).toBe("revoked");
  });

  it("made up with a known id and an earlier generation, is refused and revokes nothing", async () => {
    const { service, store } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });
    at(MINUTE);
    const renewed = await service.renew(signIn.refreshToken);
    if (!renewed.ok) throw new Error("renewal refused");
    // The right shape, id and an earlier generation, under another secret:
    // what someone who learned the id could make.
    const forged = mintRefreshToken(
      "another-secret-entirely-of-plenty-characters",
      signIn.credentialId,
      0
    );
    expect(parseRefreshToken(forged)?.credentialId).toBe(signIn.credentialId);

    expect(await service.renew(forged)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(store.rows.get(signIn.credentialId)?.revokedAt).toBeNull();
    expect((await service.renew(renewed.refreshToken)).ok).toBe(true);
  });

  it("is refused when it is not a refresh token at all", async () => {
    const { service } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });
    for (const token of [
      "",
      "nxcli_",
      signIn.accessToken,
      `${signIn.refreshToken}x`,
    ]) {
      expect(await service.renew(token)).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
  });

  it("no longer renews once its sign-in is revoked", async () => {
    const { service } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });
    expect(
      await service.revoke(
        { credentialId: signIn.credentialId, userId: "u1" },
        "revoked"
      )
    ).toBe(true);

    expect(await service.renew(signIn.refreshToken)).toEqual({
      ok: false,
      reason: "revoked",
    });
    expect(await service.verify(signIn.accessToken, "command")).toEqual({
      ok: false,
      reason: "revoked",
    });
  });
});

describe("revoking a credential", () => {
  it("is refused for a credential another person holds, and changes nothing", async () => {
    const { service, store } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });

    expect(
      await service.revoke(
        { credentialId: signIn.credentialId, userId: "u2" },
        "revoked"
      )
    ).toBe(false);
    expect(store.rows.get(signIn.credentialId)?.revokedAt).toBeNull();
    expect((await service.renew(signIn.refreshToken)).ok).toBe(true);
  });
});

describe("a person's list of credentials", () => {
  it("lists what still stands, newest first, and nothing ended, revoked or another person's", async () => {
    const { service, store } = setup();
    const laptop = await service.signIn({ userId: "u1", machine: "laptop" });
    const pass = await service.issueAgentPass({
      from: await credentialOf(service, laptop.accessToken),
      agentName: "Claude Code",
      machine: "laptop",
    });
    if (!pass.ok) throw new Error("pass refused");
    at(MINUTE);
    const desktop = await service.signIn({ userId: "u1", machine: "desktop" });
    const signedOut = await service.signIn({ userId: "u1", machine: "old" });
    await service.revoke(
      { credentialId: signedOut.credentialId, userId: "u1" },
      "revoked"
    );
    await service.signIn({ userId: "u2", machine: "theirs" });

    const listed = await service.listFor("u1");
    expect(listed.map(held => held.credentialId)).toEqual([
      desktop.credentialId,
      laptop.credentialId,
      pass.credentialId,
    ]);
    expect(listed[2]).toEqual({
      credentialId: pass.credentialId,
      purpose: "agent-pass",
      parentId: laptop.credentialId,
      agentName: "Claude Code",
      machine: "laptop",
      createdAt: START,
      lastUsedAt: null,
      endsAt: new Date(START.getTime() + 4 * 60 * MINUTE),
    });

    // Past the pass's 4 hours: the pass is no longer listed.
    at(4 * 60 * MINUTE);
    expect((await service.listFor("u1")).map(held => held.machine)).toEqual([
      "desktop",
      "laptop",
    ]);

    // Its sign-in revoked while the pass's own row was missed: neither
    // is listed.
    at(MINUTE);
    const row = store.rows.get(laptop.credentialId);
    if (!row) throw new Error("no sign-in row");
    row.revokedAt = Date.now();
    expect((await service.listFor("u1")).map(held => held.machine)).toEqual([
      "desktop",
    ]);

    // Unused for 30 days: the sign-in is no longer listed.
    at(MINUTE + 30 * DAY);
    expect(await service.listFor("u1")).toEqual([]);
  });
});

describe("an agent pass", () => {
  it("lasts 4 hours", async () => {
    const { service, store } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });
    const pass = await service.issueAgentPass({
      from: await credentialOf(service, signIn.accessToken),
      agentName: "Claude Code",
      machine: "laptop",
    });
    if (!pass.ok) throw new Error("pass refused");

    expect(CLI_CREDENTIAL_LIFETIMES.agentPassMs).toBe(4 * 60 * MINUTE);
    const row = store.rows.get(pass.credentialId);
    expect(row).toMatchObject({
      purpose: "agent-pass",
      userId: "u1",
      familyId: signIn.credentialId,
      parentId: signIn.credentialId,
      agentName: "Claude Code",
      door: "command",
      refreshTokenHash: null,
      endsAt: START.getTime() + 4 * 60 * MINUTE,
    });
    // The access token itself carries the end, whatever 15 minutes says.
    expect(pass.expiresAt.getTime()).toBe(START.getTime() + 4 * 60 * MINUTE);
    at(4 * 60 * MINUTE - 1000);
    expect((await service.verify(pass.accessToken, "command")).ok).toBe(true);
    at(4 * 60 * MINUTE);
    expect((await service.verify(pass.accessToken, "command")).ok).toBe(false);
  });

  it("never lasts past the sign-in it came from", async () => {
    const { service } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });
    let refresh = signIn.refreshToken;
    for (const day of [25, 50, 75]) {
      at(day * DAY);
      const renewed = await service.renew(refresh);
      if (!renewed.ok) throw new Error(`renewal on day ${day} refused`);
      refresh = renewed.refreshToken;
    }
    // An hour before the 90-day end, renewed so its idle end is later.
    at(90 * DAY - 60 * MINUTE);
    const last = await service.renew(refresh);
    if (!last.ok) throw new Error("last renewal refused");
    const pass = await service.issueAgentPass({
      from: await credentialOf(service, last.accessToken),
      agentName: null,
      machine: null,
    });
    if (!pass.ok) throw new Error("pass refused");

    expect(pass.expiresAt.getTime()).toBe(START.getTime() + 90 * DAY);
  });

  it("is not made from a sign-in revoked or left unused for 30 days since its token was accepted", async () => {
    const { service } = setup();
    const revoked = await service.signIn({ userId: "u1", machine: null });
    const revokedFrom = await credentialOf(service, revoked.accessToken);
    await service.revoke(
      { credentialId: revoked.credentialId, userId: "u1" },
      "revoked"
    );
    expect(
      await service.issueAgentPass({
        from: revokedFrom,
        agentName: null,
        machine: null,
      })
    ).toEqual({ ok: false, reason: "revoked" });

    const idle = await service.signIn({ userId: "u1", machine: null });
    const idleFrom = await credentialOf(service, idle.accessToken);
    at(30 * DAY);
    expect(
      await service.issueAgentPass({
        from: idleFrom,
        agentName: null,
        machine: null,
      })
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("never lasts past the moment its sign-in would end unused", async () => {
    const { service } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });
    const from = await credentialOf(service, signIn.accessToken);
    // An hour before the sign-in's 30 days unused run out.
    at(30 * DAY - 60 * MINUTE);
    const pass = await service.issueAgentPass({
      from,
      agentName: null,
      machine: null,
    });
    if (!pass.ok) throw new Error("pass refused");

    expect(pass.expiresAt.getTime()).toBe(START.getTime() + 30 * DAY);
  });

  it("is not made from a credential naming another person than its sign-in", async () => {
    const { service } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });
    const from = await credentialOf(service, signIn.accessToken);

    expect(
      await service.issueAgentPass({
        from: { ...from, userId: "u2" },
        agentName: null,
        machine: null,
      })
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("is not made from another pass", async () => {
    const { service } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });
    const pass = await service.issueAgentPass({
      from: await credentialOf(service, signIn.accessToken),
      agentName: null,
      machine: null,
    });
    if (!pass.ok) throw new Error("pass refused");

    expect(
      await service.issueAgentPass({
        from: await credentialOf(service, pass.accessToken),
        agentName: null,
        machine: null,
      })
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("is refused once its sign-in is revoked, even when its own row was not", async () => {
    const { service, store } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });
    const pass = await service.issueAgentPass({
      from: await credentialOf(service, signIn.accessToken),
      agentName: null,
      machine: null,
    });
    if (!pass.ok) throw new Error("pass refused");
    // The sign-in alone revoked: a pass made while its family was being
    // revoked, which that revocation's write did not reach.
    const signInRow = store.rows.get(signIn.credentialId);
    if (!signInRow) throw new Error("no sign-in row");
    signInRow.revokedAt = Date.now();
    signInRow.revokedReason = "revoked";

    expect(store.rows.get(pass.credentialId)?.revokedAt).toBeNull();
    expect(await service.verify(pass.accessToken, "command")).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("revoked alone, leaves its sign-in standing", async () => {
    const { service } = setup();
    const signIn = await service.signIn({ userId: "u1", machine: null });
    const pass = await service.issueAgentPass({
      from: await credentialOf(service, signIn.accessToken),
      agentName: null,
      machine: null,
    });
    if (!pass.ok) throw new Error("pass refused");

    await service.revoke(
      { credentialId: pass.credentialId, userId: "u1" },
      "revoked"
    );

    expect(await service.verify(pass.accessToken, "command")).toEqual({
      ok: false,
      reason: "revoked",
    });
    expect((await service.verify(signIn.accessToken, "command")).ok).toBe(true);
  });
});
