/**
 * The deprecated `nextly/auth` exports still answer as they always have, and
 * each warns once per process, under its own name, naming what replaces it.
 *
 * Each case loads `nextly/auth` afresh, so it sees a process in which nothing
 * has warned yet.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const warn = vi.hoisted(() => vi.fn());

vi.mock("../shared/types", async importOriginal => {
  const real = await importOriginal<typeof import("../shared/types")>();
  return { ...real, consoleLogger: { ...real.consoleLogger, warn } };
});

type Auth = typeof import("./index");

async function freshAuth(): Promise<Auth> {
  vi.resetModules();
  return import("./index");
}

const user = {
  id: "user-1",
  email: "a@example.com",
  name: "A",
  image: null,
  roleIds: ["role-1"],
};

const context = {
  userId: "user-1",
  userName: "A",
  userEmail: "a@example.com",
  permissions: new Map<string, boolean>(),
  roles: [],
  authMethod: "session" as const,
};

const allowed = { checkUserPermission: async () => true };

/** Each export, called as an app calls it, with the answer it gives. */
const CASES: ReadonlyArray<{
  name: string;
  instead: string;
  call: (auth: Auth) => Promise<unknown>;
  answers: unknown;
}> = [
  {
    name: "hasRole",
    instead: "nextly.access.check",
    call: async auth => auth.hasRole(user, "role-1"),
    answers: true,
  },
  {
    name: "hasAnyRole",
    instead: "nextly.access.check",
    call: async auth => auth.hasAnyRole(user, ["other", "role-1"]),
    answers: true,
  },
  {
    name: "hasAllRoles",
    instead: "nextly.access.check",
    call: async auth => auth.hasAllRoles(user, ["role-1", "other"]),
    answers: false,
  },
  {
    name: "requireRole",
    instead: "nextly.access.check",
    call: async auth => auth.requireRole(user, "role-1"),
    answers: undefined,
  },
  {
    name: "requireAnyRole",
    instead: "nextly.access.check",
    call: async auth => auth.requireAnyRole(user, ["role-1"]),
    answers: undefined,
  },
  {
    name: "requireAllRoles",
    instead: "nextly.access.check",
    call: async auth => auth.requireAllRoles(user, ["role-1"]),
    answers: undefined,
  },
  {
    name: "checkPermission",
    instead: "nextly.access.check",
    call: auth => auth.checkPermission(context, "read", "posts", allowed),
    answers: true,
  },
  {
    name: "checkCollectionAccess",
    instead: "nextly.access.check",
    call: auth => auth.checkCollectionAccess(context, "posts", "read", allowed),
    answers: true,
  },
  {
    name: "authenticateApiKey",
    instead: "nextly.access.checkApiKey",
    call: auth =>
      auth.authenticateApiKey(new Request("http://localhost/api/posts"), {
        validateApiKey: async () => ({ valid: false }),
      }),
    answers: null,
  },
];

describe("a deprecated nextly/auth export", () => {
  beforeEach(() => {
    warn.mockClear();
  });

  for (const { name, instead, call, answers } of CASES) {
    it(`${name} answers as before and warns once, naming what replaces it`, async () => {
      const auth = await freshAuth();
      expect(await call(auth)).toEqual(answers);
      await call(auth);
      // Once, however often it is called, and only under its own name: a
      // deprecated export built on another warns for itself alone.
      expect(warn).toHaveBeenCalledTimes(1);
      const [message] = warn.mock.calls[0] as [string];
      expect(message).toContain(`\`${name}\``);
      expect(message).toContain("deprecated");
      expect(message).toContain(instead);
    });
  }

  it("authenticateApiKey still authenticates a Bearer key through the validator it is given", async () => {
    const auth = await freshAuth();
    const validateApiKey = vi.fn(async (rawKey: string) =>
      rawKey === "good-key"
        ? {
            valid: true,
            userId: "user-1",
            permissions: new Map([["read-posts", true]]),
            roles: ["editor"],
          }
        : { valid: false, error: "Invalid API key" }
    );
    const bearer = (key: string) =>
      new Request("http://localhost/api/posts", {
        headers: { authorization: `Bearer ${key}` },
      });

    const accepted = await auth.authenticateApiKey(bearer("good-key"), {
      validateApiKey,
    });
    expect(validateApiKey).toHaveBeenCalledWith("good-key");
    expect(accepted).toMatchObject({
      userId: "user-1",
      authMethod: "api-key",
      roles: ["editor"],
    });
    expect(
      accepted && "permissions" in accepted
        ? accepted.permissions.get("read-posts")
        : undefined
    ).toBe(true);

    const refused = await auth.authenticateApiKey(bearer("bad-key"), {
      validateApiKey,
    });
    expect(validateApiKey).toHaveBeenCalledWith("bad-key");
    expect(refused).toMatchObject({ statusCode: 401 });
  });

  it("is not warned about by the exports that stay", async () => {
    const auth = await freshAuth();
    // POPULATION CONTROL: the same module, an export that is not deprecated.
    auth.hashRefreshToken("a-token");
    expect(warn).not.toHaveBeenCalled();
  });
});
