/**
 * Whether strangers may register is the app's choice, and off unless the app
 * turns it on (`auth.allowRegistration`). While it is off, a registration is
 * refused before anything is created or sent.
 */
import { describe, expect, it, vi } from "vitest";

import { sanitizeConfig } from "../../../shared/types/config";
import { buildAuthRouterDeps } from "../deps-bridge";
import { handleRegister } from "../register";

const ORIGIN = "http://localhost:3000";

function registration(): Request {
  return new Request(`${ORIGIN}/admin/api/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      cookie: "nextly_csrf=csrf-test-token",
    },
    body: JSON.stringify({
      email: "stranger@example.com",
      password: "Pass1234!",
      name: "Stranger",
      csrfToken: "csrf-test-token",
    }),
  });
}

function deps(allowRegistration: boolean) {
  return {
    allowedOrigins: [ORIGIN],
    allowRegistration,
    revealRegistrationConflict: false,
    loginStallTimeMs: 0,
    registerUser: vi.fn().mockResolvedValue({
      id: "u1",
      email: "stranger@example.com",
      name: "Stranger",
    }),
  };
}

describe("registration while it is off", () => {
  it("is refused, and creates and sends nothing", async () => {
    const off = deps(false);
    const res = await handleRegister(registration(), off);

    expect(res.status).toBe(403);
    // registerUser creates the account and sends its verification email, so
    // never calling it is what "nothing created and nothing sent" means here.
    expect(off.registerUser).not.toHaveBeenCalled();
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toMatch(/registration is not open/i);
  });

  it("goes ahead once the app turns it on", async () => {
    const on = deps(true);
    const res = await handleRegister(registration(), on);
    expect(res.status).toBe(200);
    expect(on.registerUser).toHaveBeenCalledTimes(1);
  });
});

describe("the registration choice in the app's configuration", () => {
  const services = (config: unknown) => (name: string) =>
    name === "config"
      ? config
      : name === "adapter"
        ? { getDrizzle: () => ({}) }
        : {};

  it("is off when the app says nothing", () => {
    expect(buildAuthRouterDeps(services({ auth: {} })).allowRegistration).toBe(
      false
    );
    expect(buildAuthRouterDeps(services({})).allowRegistration).toBe(false);
  });

  it("is on only when the app turns it on", () => {
    expect(
      buildAuthRouterDeps(services({ auth: { allowRegistration: true } }))
        .allowRegistration
    ).toBe(true);
    expect(
      buildAuthRouterDeps(services({ auth: { allowRegistration: "yes" } }))
        .allowRegistration
    ).toBe(false);
  });

  it("defaults to off in the sanitised config", () => {
    expect(sanitizeConfig({} as never).auth.allowRegistration).toBe(false);
    expect(
      sanitizeConfig({ auth: { allowRegistration: true } } as never).auth
        .allowRegistration
    ).toBe(true);
  });
});
