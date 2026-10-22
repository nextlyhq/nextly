/**
 * A registration whose account was created, and whose `afterRegister` hook
 * then met a busy database, is not answered with a retry hint.
 *
 * The hook runs after the account exists. Answered DATABASE_BUSY with
 * `Retry-After`, the person sends the request again, finds the email taken,
 * and the hook never runs for the account. The control is the same error from
 * creating the account, where nothing exists yet and a retry is safe.
 */
import { poolWaitTimeoutError } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { PluginContext } from "../../../plugins/plugin-context";
import { AuthHookRegistry } from "../../pipeline/hooks";
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

/** What creating the account returns. */
type CreatedUser = { id: string; email: string; name: string | null };

function deps(opts: {
  registerUser: () => Promise<CreatedUser>;
  afterRegister?: () => Promise<void>;
}) {
  const authHooks = new AuthHookRegistry();
  if (opts.afterRegister) authHooks.add({ afterRegister: opts.afterRegister });
  return {
    allowedOrigins: [ORIGIN],
    allowRegistration: true,
    revealRegistrationConflict: false,
    loginStallTimeMs: 0,
    registerUser: vi.fn(opts.registerUser),
    authHooks,
    pluginCtx: {} as PluginContext,
  };
}

const created = async (): Promise<CreatedUser> => ({
  id: "u1",
  email: "stranger@example.com",
  name: "Stranger",
});

async function errorOf(res: Response) {
  const body = (await res.json()) as {
    error?: { code?: string; message?: string };
  };
  return body.error;
}

describe("a busy database during registration", () => {
  for (const [name, thrown] of [
    ["raw", () => poolWaitTimeoutError(15000)],
    ["typed", () => NextlyError.databaseBusy()],
  ] as const) {
    it(`after the account exists (${name}), answers that it was saved, with no retry hint`, async () => {
      const d = deps({
        registerUser: created,
        afterRegister: async () => {
          throw thrown();
        },
      });

      const res = await handleRegister(registration(), d);

      expect(res.status).toBe(500);
      expect(res.headers.get("retry-after")).toBeNull();
      const error = await errorOf(res);
      expect(error?.code).toBe("INTERNAL_ERROR");
      expect(error?.message).toMatch(/change was saved/);
      expect(d.registerUser).toHaveBeenCalledTimes(1);
    });
  }

  it("before the account exists, keeps DATABASE_BUSY and its retry hint", async () => {
    const d = deps({
      registerUser: async () => {
        throw poolWaitTimeoutError(15000);
      },
      afterRegister: async () => undefined,
    });

    const res = await handleRegister(registration(), d);

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
    expect((await errorOf(res))?.code).toBe("DATABASE_BUSY");
  });

  it("keeps a hook's own refusal that asks for no retry", async () => {
    const d = deps({
      registerUser: created,
      afterRegister: async () => {
        throw NextlyError.forbidden();
      },
    });

    const res = await handleRegister(registration(), d);

    expect(res.status).toBe(403);
  });
});
