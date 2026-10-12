import type { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// Hoisted so the mock factory, which vitest lifts above the imports, can read
// it without touching a module-level binding that does not exist yet.
const SECRET = vi.hoisted(() => "test-secret-at-least-32-chars-long-cccc");

vi.mock("../../lib/env", () => ({
  env: { NEXTLY_SECRET: SECRET },
}));

import { COOKIE_NAMES } from "../../auth/cookies/cookie-config";
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
