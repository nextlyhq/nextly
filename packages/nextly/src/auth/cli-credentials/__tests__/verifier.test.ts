/**
 * The verifier per purpose: each door accepts only the purposes it is for,
 * and a credential is refused for any purpose but its own. The command door
 * takes CLI sign-ins and agent passes, the chat-app door chat-app passes
 * only, and neither takes an admin session; a CLI credential is no admin
 * session either.
 */
import { describe, expect, it } from "vitest";

import { buildClaims } from "../../jwt/claims";
import { signAccessToken } from "../../jwt/sign";
import { verifyAccessToken } from "../../jwt/verify";
import { createCliCredentialService } from "../service";
import type { CliCredentialRow } from "../store";

import { memoryCliCredentialStore } from "./memory-store";

// A fixture signing key: long enough for HS256, plainly not a real one.
const SECRET = "fixture-".repeat(6);

async function setup() {
  const store = memoryCliCredentialStore();
  const service = createCliCredentialService({ store, secret: SECRET });
  const signIn = await service.signIn({ userId: "u1", machine: null });
  const pass = await service.issueAgentPass({
    signInId: signIn.credentialId,
    agentName: "Claude Code",
    machine: null,
  });
  if (!pass.ok) throw new Error("pass refused");
  // Nothing issues chat-app passes yet; a row of that purpose stands in for
  // the one the chat-app door will make.
  const chatAppRow: CliCredentialRow = {
    id: "ncc_00000000000000000000000000000c4a",
    purpose: "chat-app-pass",
    userId: "u1",
    familyId: "ncc_00000000000000000000000000000c4a",
    parentId: null,
    agentName: "a chat app",
    door: "chat-app",
    machine: null,
    refreshTokenHash: null,
    refreshGeneration: 0,
    createdAt: Date.now(),
    lastUsedAt: null,
    idleEndsAt: null,
    endsAt: Date.now() + 60 * 60 * 1000,
    revokedAt: null,
    revokedReason: null,
  };
  await store.insert(chatAppRow);
  const chatAppToken = await signAccessToken(
    { sub: "u1", cid: chatAppRow.id },
    SECRET,
    900,
    "chatAppPass"
  );
  const sessionToken = await signAccessToken(
    buildClaims({
      userId: "u1",
      email: "u1@example.com",
      name: "U1",
      image: null,
      roleIds: [],
    }),
    SECRET
  );
  return {
    store,
    service,
    signIn,
    pass,
    chatAppRow,
    chatAppToken,
    sessionToken,
  };
}

describe("the command door", () => {
  it("accepts a CLI sign-in and an agent pass, each as itself", async () => {
    const { service, signIn, pass } = await setup();

    expect(await service.verify(signIn.accessToken, "command")).toEqual({
      ok: true,
      credential: {
        credentialId: signIn.credentialId,
        purpose: "cli-sign-in",
        userId: "u1",
        familyId: signIn.credentialId,
        parentId: null,
        agentName: null,
        machine: null,
      },
    });
    expect(await service.verify(pass.accessToken, "command")).toMatchObject({
      ok: true,
      credential: {
        credentialId: pass.credentialId,
        purpose: "agent-pass",
        parentId: signIn.credentialId,
        agentName: "Claude Code",
      },
    });
  });

  it("refuses a chat-app pass", async () => {
    const { service, chatAppToken } = await setup();
    expect(await service.verify(chatAppToken, "command")).toEqual({
      ok: false,
      reason: "wrong-door",
    });
  });

  it("refuses an admin session token", async () => {
    const { service, sessionToken } = await setup();
    expect(await service.verify(sessionToken, "command")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("the chat-app door", () => {
  it("accepts a chat-app pass", async () => {
    const { service, chatAppToken, chatAppRow } = await setup();
    expect(await service.verify(chatAppToken, "chat-app")).toMatchObject({
      ok: true,
      credential: { credentialId: chatAppRow.id, purpose: "chat-app-pass" },
    });
  });

  it("refuses a CLI sign-in and an agent pass", async () => {
    const { service, signIn, pass } = await setup();
    for (const token of [signIn.accessToken, pass.accessToken]) {
      expect(await service.verify(token, "chat-app")).toEqual({
        ok: false,
        reason: "wrong-door",
      });
    }
  });

  it("refuses an admin session token", async () => {
    const { service, sessionToken } = await setup();
    expect(await service.verify(sessionToken, "chat-app")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("a credential presented for a purpose not its own", () => {
  it("is refused when its token names another purpose than its row", async () => {
    const { service, pass } = await setup();
    // An agent pass's id under the sign-in purpose: a pass passed off as the
    // person's own sign-in.
    const relabelled = await signAccessToken(
      { sub: "u1", cid: pass.credentialId },
      SECRET,
      900,
      "cliSignIn"
    );
    expect(await service.verify(relabelled, "command")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("is refused at a door its row is not for, whatever its token says", async () => {
    const { service, store, chatAppRow } = await setup();
    // A chat-app pass row signed under the agent pass purpose, which the
    // command door takes: the row's own purpose and door still refuse it.
    const asAgent = await signAccessToken(
      { sub: "u1", cid: chatAppRow.id },
      SECRET,
      900,
      "agentPass"
    );
    expect(await service.verify(asAgent, "command")).toEqual({
      ok: false,
      reason: "invalid",
    });
    store.rows.set(chatAppRow.id, { ...chatAppRow, purpose: "agent-pass" });
    expect(await service.verify(asAgent, "command")).toEqual({
      ok: false,
      reason: "wrong-door",
    });
  });

  it("is refused when its token names another person than its row", async () => {
    const { service, signIn } = await setup();
    const otherPerson = await signAccessToken(
      { sub: "u2", cid: signIn.credentialId },
      SECRET,
      900,
      "cliSignIn"
    );
    expect(await service.verify(otherPerson, "command")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("is refused when signed with another secret", async () => {
    const { service, signIn } = await setup();
    const forged = await signAccessToken(
      { sub: "u1", cid: signIn.credentialId },
      "another-secret-entirely-of-plenty-characters",
      900,
      "cliSignIn"
    );
    expect(await service.verify(forged, "command")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("is refused when its credential does not exist", async () => {
    const { service } = await setup();
    const unknown = await signAccessToken(
      { sub: "u1", cid: "ncc_ffffffffffffffffffffffffffffffff" },
      SECRET,
      900,
      "cliSignIn"
    );
    expect(await service.verify(unknown, "command")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("is refused as an admin session", async () => {
    const { signIn, pass, chatAppToken } = await setup();
    for (const token of [signIn.accessToken, pass.accessToken, chatAppToken]) {
      expect(await verifyAccessToken(token, SECRET)).toEqual({
        valid: false,
        reason: "invalid",
      });
    }
  });

  it("for another door is refused by its header, before any row is read", async () => {
    const { signIn, chatAppToken } = await setup();
    const unreadable = {
      ...memoryCliCredentialStore(),
      async find(): Promise<CliCredentialRow[]> {
        throw new Error("the store was read");
      },
    };
    const service = createCliCredentialService({
      store: unreadable,
      secret: SECRET,
    });
    expect(await service.verify(signIn.accessToken, "chat-app")).toEqual({
      ok: false,
      reason: "wrong-door",
    });
    expect(await service.verify(chatAppToken, "command")).toEqual({
      ok: false,
      reason: "wrong-door",
    });
  });

  it("is refused when it is not a token at all", async () => {
    const { service } = await setup();
    for (const token of ["", "not-a-jwt", "a.b.c"]) {
      expect(await service.verify(token, "command")).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
  });
});
