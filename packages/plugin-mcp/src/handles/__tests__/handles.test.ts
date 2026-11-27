import type { SecretData } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { defineHandle, lifetimeInWords, type HandleCaller } from "../handles";

/**
 * A stand-in for core's one-purpose tokens, holding what each token was minted with. Enough to
 * exercise the binding and the refusals here; the real store is exercised by
 * `handles.integration.test.ts`, against an install.
 */
function fakeSecrets() {
  let clock = Date.now();
  let next = 0;
  const rows = new Map<
    string,
    {
      purpose: string;
      subject: string;
      data: SecretData | null;
      expiresAt: Date;
      spent: boolean;
    }
  >();
  const verdict = (purpose: string, token: string) => {
    const row = rows.get(token);
    if (!row || row.purpose !== purpose) return "invalid" as const;
    if (row.expiresAt.getTime() <= clock) return "expired" as const;
    if (row.spent) return "spent" as const;
    return row;
  };
  const secrets = {
    async mintToken(input: {
      purpose: string;
      subject: string;
      expiresInMs: number;
      data?: SecretData;
    }) {
      next += 1;
      const token = `token-${next}`;
      const expiresAt = new Date(clock + input.expiresInMs);
      rows.set(token, {
        purpose: input.purpose,
        subject: input.subject,
        data: input.data ?? null,
        expiresAt,
        spent: false,
      });
      return { token, expiresAt, ref: String(next) };
    },
    async peekToken(input: { purpose: string; token: string }) {
      const row = verdict(input.purpose, input.token);
      if (typeof row === "string") return { ok: false as const, reason: row };
      return {
        ok: true as const,
        subject: row.subject,
        data: row.data,
        expiresAt: row.expiresAt,
      };
    },
    async consumeToken(input: { purpose: string; token: string }) {
      const row = verdict(input.purpose, input.token);
      if (typeof row === "string") return { ok: false as const, reason: row };
      row.spent = true;
      return { ok: true as const, subject: row.subject, data: row.data };
    },
  };
  return {
    secrets: secrets as unknown as HandleCaller["security"]["secrets"],
    rows,
    advance(ms: number) {
      clock += ms;
    },
  };
}

/** A caller as core builds one: a person, arriving on a key or on a session. */
function callerOf(
  store: ReturnType<typeof fakeSecrets>,
  userId: string,
  credential: { apiKeyId: string } | "session"
): HandleCaller {
  return {
    user: { id: userId } as HandleCaller["user"],
    caller: (credential === "session"
      ? { authMethod: "session" }
      : {
          authMethod: "api-key",
          apiKeyId: credential.apiKeyId,
        }) as HandleCaller["caller"],
    security: { secrets: store.secrets },
  };
}

const PLAN = defineHandle<{ step: string }>("page-plan", 30 * 60_000);

describe("defineHandle", () => {
  it("states the lifetime and the binding in one fixed sentence", () => {
    expect(PLAN.lifetimeText).toBe(
      "A handle lasts 30 minutes and works only for you, through the credential you used to get it; after that, or for anyone else, it is refused."
    );
  });

  it.each([
    ["one minute", 60_000, "1 minute"],
    ["hours", 2 * 60 * 60_000, "2 hours"],
    ["a day", 24 * 60 * 60_000, "1 day"],
    ["minutes past an hour", 90 * 60_000, "90 minutes"],
  ])("words %s as the largest exact unit", (_, ms, words) => {
    expect(lifetimeInWords(ms)).toBe(words);
  });

  it.each([
    ["an upper-case name", "Page-Plan", 60_000],
    ["a dotted name", "page.plan", 60_000],
    ["a lifetime under a minute", "plan", 59_000],
    ["a lifetime of part-minutes", "plan", 90_000],
    ["a lifetime over 30 days", "plan", 31 * 24 * 60 * 60_000],
  ])("refuses %s when it is defined", (_, kind, ms) => {
    expect(() => defineHandle(kind, ms)).toThrow(/@nextlyhq\/plugin-mcp/);
  });
});

describe("a handle", () => {
  it("is read back, as often as needed, by the caller it was issued to", async () => {
    const store = fakeSecrets();
    const alice = callerOf(store, "alice", { apiKeyId: "k1" });
    const { handle } = await PLAN.issue(alice, { step: "hero" });

    expect((await PLAN.read(alice, handle)).data).toEqual({ step: "hero" });
    expect((await PLAN.read(alice, handle)).data).toEqual({ step: "hero" });
  });

  it("is refused for another person, saying it is not theirs", async () => {
    const store = fakeSecrets();
    const alice = callerOf(store, "alice", { apiKeyId: "k1" });
    const bob = callerOf(store, "bob", { apiKeyId: "k2" });
    const { handle } = await PLAN.issue(alice);

    await expect(PLAN.read(bob, handle)).rejects.toMatchObject({
      code: "MCP_HANDLE_NOT_YOURS",
      statusCode: 403,
    });
  });

  it("is refused for the same person on another credential", async () => {
    const store = fakeSecrets();
    const { handle } = await PLAN.issue(
      callerOf(store, "alice", { apiKeyId: "k1" })
    );

    for (const other of [
      callerOf(store, "alice", { apiKeyId: "k2" }),
      callerOf(store, "alice", "session"),
    ]) {
      await expect(PLAN.read(other, handle)).rejects.toMatchObject({
        code: "MCP_HANDLE_NOT_YOURS",
      });
    }
  });

  it("is refused after its lifetime, saying how long it lasts", async () => {
    const store = fakeSecrets();
    const alice = callerOf(store, "alice", "session");
    const { handle } = await PLAN.issue(alice);
    store.advance(30 * 60_000);

    await expect(PLAN.read(alice, handle)).rejects.toMatchObject({
      code: "MCP_HANDLE_EXPIRED",
      publicMessage: expect.stringContaining("it lasts 30 minutes"),
    });
  });

  it("is refused when this server never issued it", async () => {
    const store = fakeSecrets();
    const alice = callerOf(store, "alice", "session");

    await expect(PLAN.read(alice, "made-up")).rejects.toMatchObject({
      code: "MCP_HANDLE_UNKNOWN",
    });
  });

  it("is refused when it is another kind's handle", async () => {
    const store = fakeSecrets();
    const alice = callerOf(store, "alice", "session");
    const other = defineHandle("upload-link", 15 * 60_000);
    const { handle } = await other.issue(alice);

    await expect(PLAN.read(alice, handle)).rejects.toMatchObject({
      code: "MCP_HANDLE_UNKNOWN",
    });
  });

  it("is spent once: a second spend is refused as used", async () => {
    const store = fakeSecrets();
    const alice = callerOf(store, "alice", "session");
    const { handle } = await PLAN.issue(alice, { step: "hero" });

    expect((await PLAN.spend(alice, handle)).data).toEqual({ step: "hero" });
    await expect(PLAN.spend(alice, handle)).rejects.toMatchObject({
      code: "MCP_HANDLE_USED",
    });
  });

  it("cannot be spent by someone else, and stays usable by its holder", async () => {
    const store = fakeSecrets();
    const alice = callerOf(store, "alice", "session");
    const bob = callerOf(store, "bob", "session");
    const { handle } = await PLAN.issue(alice);

    await expect(PLAN.spend(bob, handle)).rejects.toMatchObject({
      code: "MCP_HANDLE_NOT_YOURS",
    });
    // The refusal burned nothing: the holder still spends it.
    await expect(PLAN.spend(alice, handle)).resolves.toEqual({ data: null });
  });

  it("is refused to a request with no caller, before anything is minted", async () => {
    const store = fakeSecrets();
    const nobody: HandleCaller = {
      user: null,
      caller: null,
      security: { secrets: store.secrets },
    };

    await expect(PLAN.issue(nobody)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(store.rows.size).toBe(0);
  });

  it("is refused to a key caller whose key is not named, so two keys never share a binding", async () => {
    const store = fakeSecrets();
    const unnamedKey = (): HandleCaller => ({
      user: { id: "alice" } as HandleCaller["user"],
      caller: { authMethod: "api-key" } as HandleCaller["caller"],
      security: { secrets: store.secrets },
    });
    // The control: a named key of the same person is served.
    const { handle } = await PLAN.issue(
      callerOf(store, "alice", { apiKeyId: "k1" })
    );

    await expect(PLAN.issue(unnamedKey())).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    await expect(PLAN.read(unnamedKey(), handle)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(store.rows.size).toBe(1);
  });
});
