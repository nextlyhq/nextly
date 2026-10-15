import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// These tests read a session with no database behind it. Whether the account
// may still use its token is the session check's own question, covered by
// `auth/session/__tests__/session-standing.test.ts` and, on each dialect,
// `session-cutoff.integration.test.ts`; here every account may.
vi.mock("../../auth/session/session-standing", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../auth/session/session-standing")
  >()),
  sessionTokenIsCurrent: async () => true,
}));

// Hoisted so the mock factory, which vitest lifts above the imports, can read
// it without touching a module-level binding that does not exist yet.
const SECRET = vi.hoisted(() => "test-secret-at-least-32-chars-long-cccc");

// The dialect only picks which table definitions the account read names; the
// read itself is answered by the stub below.
vi.mock("../../lib/env", () => ({
  env: { NEXTLY_SECRET: SECRET, DB_DIALECT: "sqlite" },
}));

/** The select chain the route's account read walks, answered from memory. */
interface AccountSelect {
  select(): AccountSelect;
  from(): AccountSelect;
  where(): AccountSelect;
  limit(): Promise<unknown[]>;
}

// The route's first step after a token verifies is reading the account, so a
// call here is how a test sees that a token got past verification. It answers
// with one active account, so a token that does get past reports a signed-in
// state rather than failing for want of a database.
const getCachedNextly = vi.hoisted(() =>
  vi.fn(async () => {
    const account = {
      id: "u1",
      email: "a@b.c",
      name: "A",
      emailVerified: null,
      isActive: true,
      lockedUntil: null,
    };
    const chain: AccountSelect = {
      select: () => chain,
      from: () => chain,
      where: () => chain,
      limit: async () => [account],
    };
    return { adapter: { getDrizzle: () => chain } };
  })
);

vi.mock("../../init", () => ({ getCachedNextly }));

import { COOKIE_NAMES } from "../../auth/cookies/cookie-config";
import {
  signUnmarkedPendingToken,
  signUnmarkedPendingTokenWithoutMarker,
} from "../../auth/jwt/__tests__/unmarked-tokens";
import { mintPendingToken } from "../../auth/pipeline/pending-token";
import { GET } from "../auth-state";

function withAccessCookie(token: string): NextRequest {
  return new Request("http://x/api/auth/state", {
    headers: { cookie: `${COOKIE_NAMES.accessToken}=${token}` },
  }) as unknown as NextRequest;
}

describe("GET /api/auth/state rejects pending-auth tokens", () => {
  it("answers 'not authenticated' for a pending token in the session cookie", async () => {
    // This endpoint verifies the cookie itself rather than going through
    // getSession, so the typed-token rules have to hold here independently.
    // It refuses before any database work, which is why no Nextly instance is
    // needed to reach the assertion.
    const pending = await mintPendingToken(
      { userId: "u1", challengeId: "totp", attempts: 0 },
      SECRET,
      300
    );

    const res = await GET(withAccessCookie(pending));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("AUTH_REQUIRED");
  });
});

describe("GET /api/auth/state and pending tokens minted before tokens named their purpose", () => {
  beforeEach(() => {
    getCachedNextly.mockClear();
  });

  it("answers 'not authenticated' for one, before reading any account", async () => {
    // Such a token has no header `typ`, which the verifier still lets through
    // for tokens already in circulation, so its `typ` claim is the only thing
    // that keeps it from reporting a signed-in state here.
    const pending = await signUnmarkedPendingToken("u1", SECRET);

    const res = await GET(withAccessCookie(pending));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("AUTH_REQUIRED");
    expect(getCachedNextly).not.toHaveBeenCalled();
  });

  it("reports a signed-in state for the same unmarked shape without the pending claim", async () => {
    // The control that makes the refusal above mean something: the same
    // token, missing only the pending claim, is answered as a session, so the
    // refusal comes from that claim rather than from the cookie, the
    // signature or the absent header. It holds only while unmarked tokens are
    // accepted, and goes when that allowance ends.
    const unmarked = await signUnmarkedPendingTokenWithoutMarker("u1", SECRET);

    const res = await GET(withAccessCookie(unmarked));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      authenticated: true,
      user: { id: "u1" },
    });
    expect(getCachedNextly).toHaveBeenCalledTimes(1);
  });
});
