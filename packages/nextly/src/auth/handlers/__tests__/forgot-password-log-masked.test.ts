/**
 * A rejected forgot-password `redirectPath` is logged with no full email address outside
 * development and test.
 *
 * The warning quotes the value it rejected, so an operator can see the misconfiguration, and
 * that value is the caller's own input: a reset link built for a person often carries their
 * address in its query. Driven through the handler, so what is checked is what reaches the
 * console.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { handleForgotPassword } from "../forgot-password";

const ADDRESS = "jane@example.com";
const ORIGIN = "http://localhost:3000";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A forgot-password request whose CSRF double-submit passes, asking for `redirectPath`. */
function request(redirectPath: string): Request {
  return new Request(`${ORIGIN}/admin/api/auth/forgot-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      cookie: "nextly_csrf=csrf-test-token",
    },
    body: JSON.stringify({
      email: ADDRESS,
      redirectPath,
      csrfToken: "csrf-test-token",
    }),
  });
}

/** Everything the handler warned, for a redirect outside `/admin` under `nodeEnv`. */
async function rejectionWarnings(nodeEnv: string): Promise<string> {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("NODE_ENV", nodeEnv);
  const res = await handleForgotPassword(request(`/welcome?for=${ADDRESS}`), {
    allowedOrigins: [ORIGIN],
    loginStallTimeMs: 0,
    generatePasswordResetToken: vi.fn().mockResolvedValue({}),
  });
  expect(res.status).toBe(200);
  return JSON.stringify(warn.mock.calls);
}

describe("a rejected forgot-password redirect, logged", () => {
  it("masks the address it quotes in production", async () => {
    const written = await rejectionWarnings("production");
    // The control: the rejection was logged, quoting the value, masked. The
    // path before the address is made of characters an address may hold, so
    // it is masked with it rather than left as a prefix of the address.
    expect(written).toContain(
      "Rejected forgot-password redirectPath outside /admin"
    );
    expect(written).not.toContain(ADDRESS);
    expect(written).toContain("***@example.com");
  });

  it("quotes it whole in development", async () => {
    expect(await rejectionWarnings("development")).toContain(ADDRESS);
  });
});
