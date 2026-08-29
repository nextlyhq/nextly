/**
 * The shared scheduler-trigger authorizer.
 *
 * This boundary decides who may cause side effects on a schedule, and until
 * now nothing tested it: no test in the package referenced `NEXTLY_DRAIN_SECRET`
 * or `CRON_SECRET` at all, so the webhook drain's auth path was covered only by
 * tests of the drain ENGINE, which never reach it. Every case below fails if the
 * corresponding guard is removed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext, ErrorResponse } from "../../auth/middleware";

const LONG_SECRET = "s".repeat(32);
const OTHER_SECRET = "x".repeat(32);

const envMock: {
  NEXTLY_DRAIN_SECRET?: string;
  CRON_SECRET?: string;
  NEXTLY_ALLOWED_ORIGINS_PARSED: string[];
} = { NEXTLY_ALLOWED_ORIGINS_PARSED: ["https://admin.example.com"] };

let originIsValid = true;

vi.mock("../../shared/lib/env", () => ({
  get env() {
    return envMock;
  },
}));

vi.mock("../../auth/csrf/validate", () => ({
  validateOrigin: () => originIsValid,
}));

const { authorizeTrigger } = await import("../trigger-auth");

/** An authenticated caller the permission check accepts. */
function allow(authMethod: "session" | "api-key"): () => Promise<AuthContext> {
  return async () =>
    ({
      userId: "u1",
      permissions: [],
      roles: [],
      authMethod,
    }) as AuthContext;
}

/** A caller the permission check refuses. */
const deny = async (): Promise<ErrorResponse> => ({
  success: false,
  statusCode: 403,
  message: "Forbidden",
  error: "Forbidden",
  data: null,
});

function request(
  method: string,
  headers: Record<string, string> = {}
): Request {
  return new Request("https://example.com/api/jobs/run", { method, headers });
}

/** Run the authorizer and report only whether it threw. */
async function authorized(
  req: Request,
  permission: Parameters<typeof authorizeTrigger>[1]["requirePermission"]
): Promise<boolean> {
  try {
    await authorizeTrigger(req, { requirePermission: permission, reason: "t" });
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  envMock.NEXTLY_DRAIN_SECRET = LONG_SECRET;
  envMock.CRON_SECRET = undefined;
  envMock.NEXTLY_ALLOWED_ORIGINS_PARSED = ["https://admin.example.com"];
  originIsValid = true;
});

describe("authorizeTrigger — the scheduler path", () => {
  it("admits a GET bearing the drain secret", async () => {
    const ok = await authorized(
      request("GET", { authorization: `Bearer ${LONG_SECRET}` }),
      deny
    );
    expect(ok).toBe(true);
  });

  it("admits a GET bearing Vercel's CRON_SECRET", async () => {
    envMock.NEXTLY_DRAIN_SECRET = undefined;
    envMock.CRON_SECRET = LONG_SECRET;
    const ok = await authorized(
      request("GET", { authorization: `Bearer ${LONG_SECRET}` }),
      deny
    );
    expect(ok).toBe(true);
  });

  it("refuses a secret shorter than 32 characters even when it matches", async () => {
    // The whole point of the length floor: a platform-wide CRON_SECRET too
    // short to be a safe authorizer must be IGNORED rather than honoured, and
    // an exact match is the only case where honouring it is tempting.
    envMock.NEXTLY_DRAIN_SECRET = undefined;
    envMock.CRON_SECRET = "short";
    const ok = await authorized(
      request("GET", { authorization: "Bearer short" }),
      deny
    );
    expect(ok).toBe(false);
  });

  it("refuses a bearer token that is not the configured secret", async () => {
    const ok = await authorized(
      request("GET", { authorization: `Bearer ${OTHER_SECRET}` }),
      deny
    );
    expect(ok).toBe(false);
  });
});

describe("authorizeTrigger — the human path", () => {
  it("refuses a GET with no secret, even from a permitted caller", async () => {
    // A GET is reachable by a cross-site top-level navigation carrying the
    // victim's SameSite=Lax session cookie. Admitting one here would make every
    // trigger a CSRF gadget, so the permission holder is refused BECAUSE the
    // method is GET.
    const ok = await authorized(request("GET"), allow("session"));
    expect(ok).toBe(false);
  });

  it("admits a POST from a permitted session on a valid origin", async () => {
    const ok = await authorized(request("POST"), allow("session"));
    expect(ok).toBe(true);
  });

  it("refuses a POST from a caller the permission check denies", async () => {
    const ok = await authorized(request("POST"), deny);
    expect(ok).toBe(false);
  });

  it("refuses a permitted session whose origin does not match", async () => {
    originIsValid = false;
    const ok = await authorized(request("POST"), allow("session"));
    expect(ok).toBe(false);
  });

  it("admits an API key on a mismatched origin, which a cookie may not", async () => {
    // The exemption is the reason the two are distinguished at all: an API key
    // carries no ambient cookie and sends no browser Origin, so an origin check
    // would refuse every legitimate machine caller while protecting nothing.
    originIsValid = false;
    const ok = await authorized(request("POST"), allow("api-key"));
    expect(ok).toBe(true);
  });
});
