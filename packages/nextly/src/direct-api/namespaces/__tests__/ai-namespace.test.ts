/**
 * Who a `nextly.ai` call is judged as. Unlike the rest of the Direct API, an
 * instance made trusted (`overrideAccess: true`, as a test harness or a
 * script may be) does not make its AI calls trusted: only a call's own
 * `overrideAccess: true` does.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../../../auth/middleware";
import { NextlyError } from "../../../errors/nextly-error";
import type { NextlyContext } from "../context";

const seen = vi.hoisted(() => ({ callers: [] as unknown[] }));

vi.mock("../../../domains/ai/ai-wiring", () => ({
  aiService: () => ({
    status: async (caller: unknown) => {
      seen.callers.push(caller);
      return { configured: false };
    },
  }),
}));

import { createAINamespace } from "../ai";

function namespaceOn(defaultConfig: Record<string, unknown>) {
  return createAINamespace({ defaultConfig } as unknown as NextlyContext);
}

const KEY_SCOPE = {
  actorType: "apiKey" as const,
  permissions: ["read-posts"],
  roles: [],
};

beforeEach(() => {
  seen.callers.length = 0;
});

describe("who a nextly.ai call is judged as", () => {
  it("checks a call on a trusted instance, so one naming nobody is refused", async () => {
    const ai = namespaceOn({ overrideAccess: true });
    const error = await ai.status().then(
      () => undefined,
      (thrown: unknown) => thrown
    );
    expect(NextlyError.is(error) && error.code).toBe("AUTH_REQUIRED");
    expect(seen.callers).toEqual([]);
  });

  it("checks a call on a trusted instance as the person it names", async () => {
    const ai = namespaceOn({ overrideAccess: true });
    await ai.status({ user: { id: "u1" } });
    expect(seen.callers).toEqual([
      expect.objectContaining({ userId: "u1", authMethod: "session" }),
    ]);
  });

  it("trusts only a call that itself passes overrideAccess: true", async () => {
    const ai = namespaceOn({ overrideAccess: false });
    await ai.status({ overrideAccess: true });
    expect(seen.callers).toEqual([null]);
  });

  it("judges a call made through a key on the key's own grants", async () => {
    const ai = namespaceOn({});
    await ai.status({ user: { id: "owner" }, actor: KEY_SCOPE });
    const [caller] = seen.callers as AuthContext[];
    expect(caller).toMatchObject({
      userId: "owner",
      authMethod: "api-key",
      permissions: ["read-posts"],
    });
  });
});
