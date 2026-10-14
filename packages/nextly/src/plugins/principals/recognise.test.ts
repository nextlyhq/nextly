/**
 * Recognising a person of a plugin's kind: the answer core checks, the once
 * per request it asks, and the cross-site write that gets nobody.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { beginSessionConsultation } from "../../auth/plugin-auth-api";
import { setNextlyLogger } from "../../observability/logger";
import type { PluginDefinition } from "../plugin-context";

import { createNextlyPrincipals, createPluginPrincipals } from "./api";
import { isCorePrincipal } from "./principal";
import {
  lookupPrincipal,
  principalFromRequest,
  recognisePrincipal,
  runWithPrincipalAnswers,
} from "./recognise";
import { collectPrincipalKinds, publishPrincipalKinds } from "./registry";
import type { PrincipalKindDefinition } from "./types";

const KIND = "accounts:account";
const SESSION = "acc_session=secret-session-token-123";

const warn = vi.fn();

let answer: unknown;
const resolve = vi.fn(async (_request: Request): Promise<unknown> => answer);

let lookupAnswer: unknown;
const lookup = vi.fn(async (_id: string): Promise<unknown> => lookupAnswer);

const accounts = {
  name: "accounts",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    principals: [
      {
        name: "account",
        attributes: { verified: "boolean", plan: "string", visits: "number" },
        resolve,
        lookup,
      },
      {
        name: "guest",
        attributes: {},
        resolve: async () => ({ id: "g1", attributes: {} }),
      },
    ] as unknown as PrincipalKindDefinition[],
  },
} as PluginDefinition;

const person = {
  id: "acc_1",
  attributes: { verified: true, plan: "pro", visits: 3 },
};

function request(
  init: {
    method?: string;
    origin?: string;
    headers?: Record<string, string>;
  } = {}
): Request {
  return new Request("http://localhost:3000/shop/cart", {
    method: init.method ?? "GET",
    headers: {
      cookie: SESSION,
      ...(init.origin ? { origin: init.origin } : {}),
      ...init.headers,
    },
    ...(init.method && init.method !== "GET" ? { body: "{}" } : {}),
  });
}

beforeEach(() => {
  answer = person;
  // Reset rather than cleared: a one-shot answer a test left unused must not
  // become the next test's answer.
  resolve.mockReset();
  resolve.mockImplementation(async () => answer);
  warn.mockReset();
  setNextlyLogger({ warn, error() {}, info() {}, debug() {} });
  publishPrincipalKinds(collectPrincipalKinds([accounts]));
});

afterEach(() => {
  setNextlyLogger(undefined);
  publishPrincipalKinds(new Map());
});

describe("the answer a resolver gives", () => {
  it("becomes a person core made, named by kind and id", async () => {
    const principal = await recognisePrincipal(request(), KIND);
    expect(principal).toEqual({
      type: "principal",
      kind: KIND,
      id: "acc_1",
      attributes: { verified: true, plan: "pro", visits: 3 },
    });
    expect(isCorePrincipal(principal)).toBe(true);
    expect(Object.isFrozen(principal)).toBe(true);
    expect(Object.isFrozen(principal?.attributes)).toBe(true);
  });

  it("is not a person core made when built by hand", async () => {
    // The control for the brand: a copy of a real one, field for field.
    const principal = await recognisePrincipal(request(), KIND);
    expect(isCorePrincipal({ ...principal })).toBe(false);
  });

  it("drops an attribute the kind did not declare", async () => {
    answer = {
      id: "acc_1",
      attributes: { ...person.attributes, role: "admin" },
    };
    const principal = await recognisePrincipal(request(), KIND);
    expect(principal?.attributes).not.toHaveProperty("role");
    expect(principal?.attributes).toHaveProperty("verified", true);
  });

  it("keeps a declared attribute that is null, as not known", async () => {
    answer = { id: "acc_1", attributes: { ...person.attributes, plan: null } };
    const principal = await recognisePrincipal(request(), KIND);
    expect(principal?.attributes.plan).toBeNull();
  });

  it("accepts an id of 128 characters", async () => {
    answer = { ...person, id: "a".repeat(128) };
    expect((await recognisePrincipal(request(), KIND))?.id).toHaveLength(128);
  });

  it.each([
    ["an empty id", { ...person, id: "" }],
    ["an id of 129 characters", { ...person, id: "a".repeat(129) }],
    ["an id that is a number", { ...person, id: 7 }],
    ["no attributes", { id: "acc_1" }],
    [
      "a missing declared attribute",
      { id: "acc_1", attributes: { verified: true, plan: "pro" } },
    ],
    [
      "an attribute of the wrong type",
      { id: "acc_1", attributes: { ...person.attributes, verified: "yes" } },
    ],
    [
      "a number that is not finite",
      { id: "acc_1", attributes: { ...person.attributes, visits: NaN } },
    ],
    ["an answer that is not an object", "acc_1"],
  ])("takes %s for nobody, and says why", async (_label, given) => {
    answer = given;
    expect(await recognisePrincipal(request(), KIND)).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "principal-answer-invalid",
        principalKind: KIND,
        problem: expect.any(String),
      })
    );
  });

  it("takes an answer that throws while it is read for nobody", async () => {
    answer = {
      id: "acc_1",
      get attributes(): never {
        throw new RangeError("secret-session-token-123");
      },
    };
    expect(await recognisePrincipal(request(), KIND)).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "principal-answer-invalid",
        problem: "reading the answer threw RangeError",
      })
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "secret-session-token-123"
    );
  });

  it("takes null for nobody, without a warning", async () => {
    answer = null;
    expect(await recognisePrincipal(request(), KIND)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("takes a throw for nobody, and logs it without the credentials", async () => {
    resolve.mockImplementationOnce(async (req: Request) => {
      throw new TypeError(`bad session ${req.headers.get("cookie")}`);
    });
    expect(await recognisePrincipal(request(), KIND)).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "principal-resolver-failed",
        principalKind: KIND,
        errorName: "TypeError",
      })
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "secret-session-token-123"
    );
  });

  it("refuses a kind nobody registered rather than answer nobody", () => {
    expect(() => recognisePrincipal(request(), "accounts:member")).toThrow(
      /No kind of signed-in person named "accounts:member"/
    );
  });
});

describe("asking more than once", () => {
  it("calls the resolver once for one request, however often it is asked", async () => {
    const req = request();
    const first = await recognisePrincipal(req, KIND);
    const second = await recognisePrincipal(req, KIND);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("calls it again for another request", async () => {
    // The control for the case above: a resolver called once ever would pass
    // it too.
    await recognisePrincipal(request(), KIND);
    await recognisePrincipal(request(), KIND);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("shares the answer with a copy of the request inside a route invocation", async () => {
    const req = request();
    await runWithPrincipalAnswers(req, async () => {
      await recognisePrincipal(req, KIND);
      await recognisePrincipal(req.clone(), KIND);
      await recognisePrincipal(new Request(req), KIND);
    });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("asks about a different request inside a route invocation on its own", async () => {
    // Another person's session on a request the handler builds must not be
    // answered with the routed request's person.
    resolve
      .mockImplementationOnce(async () => person)
      .mockImplementationOnce(async () => ({ ...person, id: "acc_2" }));
    const req = request();
    const other = new Request("http://localhost:3000/shop/cart", {
      headers: { cookie: "acc_session=someone-else" },
    });
    const answers = await runWithPrincipalAnswers(req, async () => [
      await recognisePrincipal(req, KIND),
      await recognisePrincipal(other, KIND),
    ]);
    expect(answers.map(found => found?.id)).toEqual(["acc_1", "acc_2"]);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve.mock.calls[1]?.[0].headers.get("cookie")).toBe(
      "acc_session=someone-else"
    );
  });

  it("hands the resolver the request without its body", async () => {
    let seen: string | undefined;
    resolve.mockImplementationOnce(async (req: Request) => {
      seen = await req.text();
      return person;
    });
    const req = request({ method: "POST", origin: "http://localhost:3000" });
    await recognisePrincipal(req, KIND);
    expect(seen).toBe("");
    // The handler still has the body the resolver could not take.
    expect(await req.text()).toBe("{}");
  });

  it("hands the resolver the request's cookies", async () => {
    await recognisePrincipal(request(), KIND);
    expect(resolve.mock.calls[0]?.[0].headers.get("cookie")).toBe(SESSION);
  });
});

describe("server code asking for a person", () => {
  it("gets the person on a read from anywhere", async () => {
    const got = await principalFromRequest(
      request({ origin: "https://evil.example" }),
      KIND
    );
    expect(got?.id).toBe("acc_1");
  });

  it("gets the person on a same-origin write", async () => {
    const got = await principalFromRequest(
      request({ method: "POST", origin: "http://localhost:3000" }),
      KIND
    );
    expect(got?.id).toBe("acc_1");
  });

  it("gets nobody on a cross-site write, and the attempt is recorded", async () => {
    const session = beginSessionConsultation();
    const got = await session.run(() =>
      principalFromRequest(
        request({ method: "POST", origin: "https://evil.example" }),
        KIND
      )
    );
    expect(got).toBeNull();
    expect(session.crossSiteRefused()).toBe(true);
    expect(session.consulted()).toBe(true);
  });

  it("records no attempt when nobody was signed in to forge", async () => {
    answer = null;
    const session = beginSessionConsultation();
    await session.run(() =>
      principalFromRequest(
        request({ method: "POST", origin: "https://evil.example" }),
        KIND
      )
    );
    expect(session.crossSiteRefused()).toBe(false);
  });

  it("gets the person on a cross-site write that carries a Bearer token", async () => {
    const got = await principalFromRequest(
      request({
        method: "POST",
        origin: "https://evil.example",
        headers: { authorization: "Bearer abc" },
      }),
      KIND
    );
    expect(got?.id).toBe("acc_1");
  });

  it("does not take an empty Bearer header for a token", async () => {
    const got = await principalFromRequest(
      request({
        method: "POST",
        origin: "https://evil.example",
        headers: { authorization: "Bearer " },
      }),
      KIND
    );
    expect(got).toBeNull();
  });

  it("asks through nextly.principals by the full kind", async () => {
    const got = await createNextlyPrincipals().fromRequest(request(), KIND);
    expect(got?.kind).toBe(KIND);
  });

  it("asks through ctx.principals by the plugin's own name for the kind", async () => {
    const got = await createPluginPrincipals(accounts)?.fromRequest(
      request(),
      "account"
    );
    expect(got?.kind).toBe(KIND);
  });

  it("gives a plugin that registers no kind no ctx.principals", () => {
    const none = {
      ...accounts,
      contributes: { principals: [] },
    } as PluginDefinition;
    expect(createPluginPrincipals(none)).toBeUndefined();
    // The control: the same plugin with its kinds has one.
    expect(createPluginPrincipals(accounts)).toBeDefined();
  });

  it("reaches only the plugin's own kinds through ctx.principals", async () => {
    // Another plugin's context, asking by the accounts plugin's kind name:
    // joined to its own slug, the name is a kind nobody registered.
    const other = { ...accounts, name: "forum" } as PluginDefinition;
    await expect(
      createPluginPrincipals(other)?.fromRequest(request(), "account")
    ).rejects.toThrow(/"forum:account"/);
  });
});

describe("looking a person up by id", () => {
  beforeEach(() => {
    lookupAnswer = person;
    lookup.mockReset();
    lookup.mockImplementation(async () => lookupAnswer);
  });

  it("finds the person through the kind's lookup, without a request", async () => {
    const found = await lookupPrincipal(KIND, "acc_1");
    expect(found).toMatchObject({ kind: KIND, id: "acc_1" });
    expect(isCorePrincipal(found)).toBe(true);
    expect(lookup).toHaveBeenCalledWith("acc_1");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("answers nobody for an id the plugin does not return", async () => {
    lookupAnswer = null;
    expect(await lookupPrincipal(KIND, "acc_9")).toBeNull();
  });

  it("checks the lookup's answer as a resolver's is checked", async () => {
    lookupAnswer = {
      id: "acc_1",
      attributes: { ...person.attributes, verified: "yes", role: "admin" },
    };
    expect(await lookupPrincipal(KIND, "acc_1")).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "principal-answer-invalid",
        source: "lookup",
      })
    );
  });

  it("drops an attribute the kind did not declare", async () => {
    lookupAnswer = {
      id: "acc_1",
      attributes: { ...person.attributes, role: "admin" },
    };
    const found = await lookupPrincipal(KIND, "acc_1");
    expect(found?.attributes).not.toHaveProperty("role");
  });

  it("answers nobody when the lookup names someone else", async () => {
    lookupAnswer = { ...person, id: "acc_2" };
    expect(await lookupPrincipal(KIND, "acc_1")).toBeNull();
  });

  it.each([
    ["an empty id", ""],
    ["an id of 129 characters", "a".repeat(129)],
  ])("answers nobody for %s without asking the plugin", async (_l, id) => {
    expect(await lookupPrincipal(KIND, id)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("takes a throw for nobody, and logs it without its message", async () => {
    lookup.mockImplementationOnce(async () => {
      throw new TypeError("secret-session-token-123");
    });
    expect(await lookupPrincipal(KIND, "acc_1")).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "principal-lookup-failed",
        errorName: "TypeError",
      })
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "secret-session-token-123"
    );
  });

  it("refuses a kind with no lookup rather than answer nobody", async () => {
    await expect(lookupPrincipal("accounts:guest", "g1")).rejects.toThrow(
      /has no lookup/
    );
  });

  it("is reached through nextly.principals and ctx.principals", async () => {
    expect((await createNextlyPrincipals().byId(KIND, "acc_1"))?.id).toBe(
      "acc_1"
    );
    expect(
      (await createPluginPrincipals(accounts)?.byId("account", "acc_1"))?.id
    ).toBe("acc_1");
  });
});
