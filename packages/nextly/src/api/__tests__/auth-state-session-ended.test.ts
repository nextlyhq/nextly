import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the mock factories, which vitest lifts above the imports, can
// read them without touching a module-level binding that does not exist yet.
const SECRET = vi.hoisted(() => "test-secret-at-least-32-chars-long-dddd");

vi.mock("../../lib/env", () => ({
  env: { NEXTLY_SECRET: SECRET, DB_DIALECT: "sqlite" },
}));

// The session check's answer, set per test. The check itself, its cache and
// its read of the account row are covered by `session-standing.test.ts` and,
// on each dialect, `session-cutoff.integration.test.ts`; what this file asks
// is whether this route asks it, and before its own account read.
const sessionTokenIsCurrent = vi.hoisted(() =>
  vi.fn<(claims: Record<string, unknown>) => Promise<boolean>>()
);
vi.mock("../../auth/session/session-standing", () => ({
  sessionTokenIsCurrent,
}));

/** The select chain the route's account read walks, answered from memory. */
interface AccountSelect {
  select(): AccountSelect;
  from(): AccountSelect;
  where(): AccountSelect;
  limit(): Promise<unknown[]>;
}

// An active account, so a token that gets past the check reports a signed-in
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
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { GET } from "../auth-state";

async function withSession(): Promise<NextRequest> {
  const token = await signAccessToken(
    buildClaims({
      userId: "u1",
      email: "a@b.c",
      name: "A",
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    SECRET,
    900
  );
  return new Request("http://x/api/auth/state", {
    headers: { cookie: `${COOKIE_NAMES.accessToken}=${token}` },
  }) as unknown as NextRequest;
}

describe("GET /api/auth/state and an account's ended sessions", () => {
  beforeEach(() => {
    sessionTokenIsCurrent.mockReset();
    getCachedNextly.mockClear();
  });

  it("answers 'not authenticated' for a token its account can no longer use", async () => {
    // This route verifies the cookie itself rather than through getSession,
    // so it has to ask the account check itself, or a deactivated account's
    // token would go on reporting a signed-in state here.
    sessionTokenIsCurrent.mockResolvedValue(false);

    const res = await GET(await withSession());

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("AUTH_REQUIRED");
    // Judged on its epoch, not on whether the account is active: this route
    // is where an inactive account's token reports `disabled: true`.
    expect(sessionTokenIsCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "u1", nx_sev: 0 }),
      { activeOnly: false }
    );
    // Refused before the route's own account read.
    expect(getCachedNextly).not.toHaveBeenCalled();
  });

  it("reports the signed-in state for a token the check admits", async () => {
    // The control: the same token, admitted, is answered as a session, so
    // the refusal above is the check's.
    sessionTokenIsCurrent.mockResolvedValue(true);

    const res = await GET(await withSession());

    expect(res.status).toBe(200);
  });
});
