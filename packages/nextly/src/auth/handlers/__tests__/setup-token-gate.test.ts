/**
 * Setup in production: until the install has an administrator, creating one
 * needs the setup token. Driven through the real token module over an
 * in-memory `nextly_meta` row, so what is judged is the token rules the server
 * uses, and the handler's order: the token before the rate limit, then one
 * setup at a time.
 */
import { describe, expect, it, vi } from "vitest";

import { claimFirstSetup } from "../../setup-token/setup-gate";
import {
  SETUP_TOKEN_ENV,
  SETUP_TOKEN_META_KEY,
  spendSetupToken,
  ensureSetupTokenAtBoot,
  generateSetupToken,
  readSetupTokenRecord,
  replaceSetupToken,
  verifySetupToken,
  type SetupTokenMeta,
} from "../../setup-token/setup-token";
import {
  SETUP_BODY_DEADLINE_MS,
  SETUP_READS_AT_ONCE,
  handleSetup,
  handleSetupStatus,
  type SetupHandlerDeps,
} from "../setup";

const ORIGIN = "http://localhost:3000";
const SECRET = "test-secret-that-is-at-least-32-characters-long!";

function memoryMeta(): SetupTokenMeta & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    async getEntry<T>(key: string) {
      const raw = rows.get(key);
      return raw === undefined
        ? { present: false as const }
        : { present: true as const, value: JSON.parse(raw) as T };
    },
    async insertIfAbsent(key, value) {
      if (!rows.has(key)) rows.set(key, JSON.stringify(value));
    },
    async compareAndSet(key, expected, next) {
      if (rows.get(key) !== JSON.stringify(expected)) return false;
      rows.set(key, JSON.stringify(next));
      return true;
    },
    async delete(key) {
      rows.delete(key);
    },
  };
}

/** A production install with no administrator, and the token its start printed. */
async function productionInstall(env: Record<string, string | undefined> = {}) {
  const meta = memoryMeta();
  let administrator = false;
  const boot = await ensureSetupTokenAtBoot({
    meta,
    hasAdministrator: async () => administrator,
    env,
  });
  const token =
    boot.kind === "printed" ? (/TOKEN (\S+) /.exec(boot.line)?.[1] ?? "") : "";
  const createSuperAdmin = vi.fn(
    async (data: { email: string; name: string }) => {
      // Another setup's request can be in flight while this one creates.
      await new Promise(resolve => setTimeout(resolve, 5));
      administrator = true;
      return { id: "u1", email: data.email, name: data.name };
    }
  );
  const limitWithoutValidToken = vi.fn(async () => null as Response | null);
  const deps: SetupHandlerDeps = {
    secret: SECRET,
    isProduction: true,
    accessTokenTTL: 900,
    refreshTokenTTL: 604800,
    allowedOrigins: [ORIGIN],
    trustProxy: false,
    trustedProxyIps: [],
    hasAdministrator: async () => administrator,
    setupToken: {
      required: true,
      verify: presented =>
        verifySetupToken({
          presented,
          readRecord: () => readSetupTokenRecord(meta),
          env,
        }),
      confirm: presented =>
        verifySetupToken({
          presented,
          readRecord: () => readSetupTokenRecord(meta),
          env,
        }),
      spend: () => spendSetupToken(meta),
      claim: () => claimFirstSetup(meta),
    },
    createSuperAdmin,
    fetchSessionRoles: vi
      .fn()
      .mockResolvedValue({ roleIds: ["super-admin"], validUntil: undefined }),
    seedPermissions: vi.fn().mockResolvedValue(undefined),
    storeRefreshToken: vi.fn().mockResolvedValue(undefined),
    auditLog: { write: vi.fn().mockResolvedValue(undefined) },
  };
  return { meta, token, deps, createSuperAdmin, limitWithoutValidToken };
}

function setupRequest(
  setupToken?: unknown,
  extra: Record<string, unknown> = {}
): Request {
  return new Request(`${ORIGIN}/admin/api/auth/setup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      cookie: "nextly_csrf=csrf-test-token",
    },
    body: JSON.stringify({
      email: "owner@example.com",
      name: "Owner",
      password: "Str0ng-P@ssw0rd!",
      csrfToken: "csrf-test-token",
      ...(setupToken === undefined ? {} : { setupToken }),
      ...extra,
    }),
  });
}

describe("setup in production", () => {
  it.each([
    ["no token", undefined],
    ["a wrong token", "not-the-token"],
    ["a token of the wrong type", 42],
  ])("refuses %s alike, creating nothing", async (_, presented) => {
    const { deps, createSuperAdmin, limitWithoutValidToken } =
      await productionInstall();
    const res = await handleSetup(setupRequest(presented), deps, {
      limitWithoutValidToken,
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("SETUP_TOKEN_REQUIRED");
    expect(body.error.message).toMatch(/server's output|NEXTLY_SETUP_TOKEN/);
    expect(createSuperAdmin).not.toHaveBeenCalled();
    expect(limitWithoutValidToken).toHaveBeenCalledTimes(1);
  });

  it("answers a wrong token 429 once the auth limit refuses it", async () => {
    const { deps, createSuperAdmin } = await productionInstall();
    const limited = new Response(null, { status: 429 });
    const res = await handleSetup(setupRequest("wrong"), deps, {
      limitWithoutValidToken: async () => limited,
    });
    expect(res.status).toBe(429);
    expect(createSuperAdmin).not.toHaveBeenCalled();
  });

  it("creates the administrator with the valid token, without asking the limit, and spends the token", async () => {
    const { deps, token, meta, createSuperAdmin } = await productionInstall();
    const limitWithoutValidToken = vi.fn(
      async () => new Response(null, { status: 429 })
    );
    const res = await handleSetup(setupRequest(token), deps, {
      limitWithoutValidToken,
    });
    expect(res.status).toBe(201);
    expect(createSuperAdmin).toHaveBeenCalledTimes(1);
    expect(limitWithoutValidToken).not.toHaveBeenCalled();
    expect(meta.rows.has(SETUP_TOKEN_META_KEY)).toBe(false);
    // And the token never comes back in the response.
    expect(JSON.stringify(await res.json())).not.toContain(token);

    // Spent, the token is no longer valid: the next request is counted, and
    // with budget left it is told setup is complete.
    const counted = vi.fn(async () => null as Response | null);
    const again = await handleSetup(setupRequest(token), deps, {
      limitWithoutValidToken: counted,
    });
    expect(counted).toHaveBeenCalledTimes(1);
    expect(again.status).toBe(403);
    expect(
      ((await again.json()) as { error: { code: string } }).error.code
    ).toBe("SETUP_COMPLETE");
  });

  it("counts a request without a valid token before any work, even one setup would refuse as complete", async () => {
    const { deps } = await productionInstall();
    const hasAdministrator = vi.fn(async () => true);
    deps.hasAdministrator = hasAdministrator;
    const res = await handleSetup(setupRequest("not-the-token"), deps, {
      limitWithoutValidToken: async () => new Response(null, { status: 429 }),
    });
    expect(res.status).toBe(429);
    // Refused by the limit before the administrator was even looked up.
    expect(hasAdministrator).not.toHaveBeenCalled();
  });

  it("reads no more than a small body, counting a larger one unread, even with the valid token", async () => {
    const { deps, token, createSuperAdmin } = await productionInstall();
    const counted = vi.fn(async () => null as Response | null);
    const huge = setupRequest(token, { padding: "x".repeat(64 * 1024) });
    await expect(
      handleSetup(huge, deps, { limitWithoutValidToken: counted })
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    // Its token was never read, so it was counted like any other.
    expect(counted).toHaveBeenCalledTimes(1);
    expect(createSuperAdmin).not.toHaveBeenCalled();
  });

  it("reads only so many setup bodies at once, refusing the next unread, and frees a slow one at the deadline", async () => {
    const { deps } = await productionInstall();
    /** A setup whose body starts and never finishes arriving. */
    const trickle = () =>
      new Request(`${ORIGIN}/admin/api/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
          },
        }),
        duplex: "half",
      } as RequestInit);
    const hooks = { limitWithoutValidToken: async () => null };
    vi.useFakeTimers();
    try {
      const slow = Array.from({ length: SETUP_READS_AT_ONCE }, () =>
        handleSetup(trickle(), deps, hooks).catch((error: unknown) => error)
      );
      await vi.advanceTimersByTimeAsync(0);

      // Every reading place is held: the next is refused before any read.
      const refused = await handleSetup(setupRequest("x"), deps, hooks);
      expect(refused.status).toBe(429);

      // At the deadline the slow bodies are cancelled, and their places free.
      await vi.advanceTimersByTimeAsync(SETUP_BODY_DEADLINE_MS);
      const ended = await Promise.all(slow);
      expect(ended).toHaveLength(SETUP_READS_AT_ONCE);
      for (const outcome of ended) {
        expect(outcome).toMatchObject({ code: "VALIDATION_ERROR" });
      }
      const after = await handleSetup(
        setupRequest("not-the-token"),
        deps,
        hooks
      );
      expect(after.status).toBe(403);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a token replaced after it was judged, creating nothing", async () => {
    const { deps, token, meta, createSuperAdmin } = await productionInstall();
    // The operator replaces the leaked token while this request is between
    // its first judgement and its claim.
    const claim = deps.setupToken.claim;
    deps.setupToken.claim = async () => {
      await replaceSetupToken({ meta, env: {} });
      return claim();
    };
    const res = await handleSetup(setupRequest(token), deps, {
      limitWithoutValidToken: async () => null,
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "SETUP_TOKEN_REQUIRED"
    );
    expect(createSuperAdmin).not.toHaveBeenCalled();
  });

  it("creates exactly one administrator when setups with the valid token race", async () => {
    const { deps, token, createSuperAdmin } = await productionInstall();
    const responses = await Promise.all(
      [1, 2, 3].map(() => handleSetup(setupRequest(token), deps))
    );
    const statuses = responses.map(r => r.status).sort();
    expect(statuses).toEqual([201, 403, 403]);
    expect(createSuperAdmin).toHaveBeenCalledTimes(1);
    for (const res of responses.filter(r => r.status === 403)) {
      expect(
        ((await res.json()) as { error: { code: string } }).error.code
      ).toBe("SETUP_COMPLETE");
    }
  });

  it("refuses a setup that claims only after another one finished", async () => {
    // It passed the first check while no administrator existed, and claims
    // after the other setup created one and released its claim.
    const { deps, token, createSuperAdmin } = await productionInstall();
    let checks = 0;
    const late: SetupHandlerDeps = {
      ...deps,
      hasAdministrator: async () => checks++ > 0,
    };
    const res = await handleSetup(setupRequest(token), late);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "SETUP_COMPLETE"
    );
    expect(createSuperAdmin).not.toHaveBeenCalled();
  });

  it("opens with the operator's own token, and stays closed while it is weak", async () => {
    const value = generateSetupToken();
    const set = await productionInstall({ [SETUP_TOKEN_ENV]: value });
    expect((await handleSetup(setupRequest(value), set.deps)).status).toBe(201);

    const weak = await productionInstall({ [SETUP_TOKEN_ENV]: "short" });
    const res = await handleSetup(setupRequest("short"), weak.deps);
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("SETUP_TOKEN_REQUIRED");
    expect(body.error.message).toMatch(/too weak/);
    expect(body.error.message).not.toContain("short");
    expect(weak.createSuperAdmin).not.toHaveBeenCalled();
  });

  it("tells the admin's setup form that a token is needed, and nothing about it", async () => {
    const { deps, token } = await productionInstall();
    const res = await handleSetupStatus(
      new Request(`${ORIGIN}/admin/api/auth/setup-status`),
      deps
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      isSetup: false,
      requiresInitialUser: true,
      requiresSetupToken: true,
    });
    expect(JSON.stringify(body)).not.toContain(token);
  });
});

describe("setup in development", () => {
  it("asks for no token", async () => {
    const { deps, createSuperAdmin } = await productionInstall();
    const dev: SetupHandlerDeps = {
      ...deps,
      isProduction: false,
      setupToken: { ...deps.setupToken, required: false },
    };
    expect((await handleSetup(setupRequest(), dev)).status).toBe(201);
    expect(createSuperAdmin).toHaveBeenCalledTimes(1);
  });
});
