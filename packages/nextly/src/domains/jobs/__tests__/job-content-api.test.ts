/**
 * The identity a job resolved must reach the calls it makes.
 *
 * `resolveRunAs` establishes WHO a job runs as, and fails closed when it
 * cannot. None of that matters if the handler then reaches for an API that
 * ignores it — and the Direct API does exactly that by default:
 * `packages/nextly/AGENTS.md` states that `overrideAccess` defaults to `true`,
 * a trusted server context, and that enforcing access needs `overrideAccess:
 * false` PLUS a user.
 *
 * So a handler doing the obvious thing would run every scheduled operation
 * with trusted-system authority while the identity sat unused in its context.
 *
 * @module domains/jobs/__tests__/job-content-api.test
 */
import { describe, expect, it, vi } from "vitest";

import { createJobContentApi } from "../job-content-api";

const user = { id: "u1", roles: ["editor"] };

describe("createJobContentApi", () => {
  it("binds the resolved user to every call, without the handler asking", () => {
    const find = vi.fn(async (_args: Record<string, unknown>) => ({
      items: [],
      meta: {},
    }));
    const api = createJobContentApi(user, { find } as never);

    void api.find({ collection: "posts" } as never);

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        overrideAccess: false,
        user,
      })
    );
  });

  it("REFUSES a handler's attempt to re-enable the bypass", () => {
    // The whole point. If a handler could pass `overrideAccess: true`, the
    // binding would be a default rather than a guarantee, and the one call that
    // forgot — or a helper that spread its own options last — would silently run
    // with system authority.
    const create = vi.fn(async (_args: Record<string, unknown>) => ({
      item: {},
    }));
    const api = createJobContentApi(user, { create } as never);

    void api.create({
      collection: "posts",
      data: {},
      overrideAccess: true,
    } as never);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ overrideAccess: false, user })
    );
  });

  it("runs as ANONYMOUS when the job carries no identity, never as the system", () => {
    // A job queued without an identity acts as nobody. Nobody is not the
    // system: leaving `overrideAccess` at its `true` default here would make
    // the least-privileged case the most-privileged one.
    const find = vi.fn(async (_args: Record<string, unknown>) => ({
      items: [],
      meta: {},
    }));
    const api = createJobContentApi(null, { find } as never);

    void api.find({ collection: "posts" } as never);

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ overrideAccess: false })
    );
    // `user` must be present and UNDEFINED, not absent. Every operation begins
    // with `mergeConfig(ctx.defaultConfig, args)` — `{ ...defaultConfig,
    // ...args }` — so an absent key lets a configured default user merge back
    // in, and the least-privileged job would run as whoever that names.
    //
    // Nothing downstream reads these by presence: `directApiActor` and
    // `callerAccess` reach them as `config.user?.id` and
    // `config.actor?.actorType`, so present-and-undefined is indistinguishable
    // from absent to every consumer, and distinguishable only to the merge.
    const passed = find.mock.lastCall?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(passed).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(passed, "user")).toBe(true);
    expect(passed?.user).toBeUndefined();
  });

  it("passes the caller's own arguments through untouched", () => {
    // The control: a wrapper that replaced the arguments would satisfy the
    // cases above while making every call useless.
    const find = vi.fn(async (_args: Record<string, unknown>) => ({
      items: [],
      meta: {},
    }));
    const api = createJobContentApi(user, { find } as never);

    void api.find({
      collection: "posts",
      limit: 7,
      sort: "-createdAt",
    } as never);

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 7, sort: "-createdAt" })
    );
  });
});

describe("how the source is called", () => {
  it("calls the operation ON the source, so a method keeping `this` works", async () => {
    // The Direct API has two shapes and this client's type admits both: the
    // module-level facade is arrow functions and survives being extracted,
    // while a real `Nextly` INSTANCE reaches its context through `this`.
    // Extracting the method breaks the second — the call then fails deep inside
    // `mergeConfig`, reading `defaultConfig` of undefined, which reads as a
    // broken content API rather than a broken wrapper.
    //
    // Every other case here passes a plain object literal, which cannot tell
    // the two apart. This one deliberately does.
    class ApiWithContext {
      private readonly ctx = { defaultConfig: { locale: "en" } };
      seen: Record<string, unknown> | undefined;
      async find(args: Record<string, unknown>): Promise<{ items: never[] }> {
        // Throws exactly as the real API does when `this` is lost.
        this.seen = { ...this.ctx.defaultConfig, ...args };
        return { items: [] };
      }
    }
    const source = new ApiWithContext();
    const client = createJobContentApi({ id: "u1", roles: ["editor"] }, {
      find: source.find,
    } as never);

    // Bound from a detached reference, which is the worst case a caller can
    // hand this: it must still reach the instance.
    const detached = createJobContentApi(
      { id: "u1", roles: ["editor"] },
      source as never
    );
    await (detached.find as (args: unknown) => Promise<unknown>)({
      collection: "posts",
    });

    expect(source.seen).toMatchObject({ collection: "posts" });
    expect(source.seen?.overrideAccess).toBe(false);
    void client;
  });
});

describe("the options this client OWNS", () => {
  it("strips EVERY authorization-bearing option, not just the two it sets", async () => {
    // Every authority-bearing option is owned by this client, not just the two
    // it sets. `actor` is the sharpest: `apiKeyScopeAllows` reads its
    // `permissions` array as AUTHORITATIVE rather than consulting the bound
    // user's grants, so a caller supplying one grants itself what it names.
    // The parameter is DECLARED, not inferred. Without it `vi.fn` types
    // `mock.calls` as an empty tuple, so reading `calls[0][0]` is a type
    // error — invisible to `vitest` and to a bare `tsc --noEmit`, and
    // reported only by the second pass `check-types` runs over the tests.
    const find = vi.fn(async (_args: Record<string, unknown>) => ({
      items: [],
    }));
    const client = createJobContentApi({ id: "u1", roles: ["editor"] }, {
      find,
    } as never);

    await (client.find as (args: unknown) => Promise<unknown>)({
      collection: "posts",
      actor: { actorType: "apiKey", permissions: ["delete-posts"] },
      trusted: () => true,
      enforceFieldAccess: false,
      fieldAccessUser: { id: "somebody-else", roles: ["admin"] },
      frameworkFilter: true,
      overrideAccess: true,
      user: { id: "somebody-else", roles: ["admin"] },
    });

    const sent = find.mock.calls[0]?.[0] as Record<string, unknown>;
    for (const owned of [
      "actor",
      "trusted",
      "enforceFieldAccess",
      "fieldAccessUser",
      "frameworkFilter",
    ]) {
      // Present and undefined, which is what overrides an instance default in
      // `mergeConfig`'s spread. Asserting absence here would pass against a
      // `delete`, and a `delete` leaves the default standing.
      expect(Object.prototype.hasOwnProperty.call(sent, owned)).toBe(true);
      expect(sent[owned]).toBeUndefined();
    }
    // The two this client DOES set are set to its own values, not the caller's.
    expect(sent.overrideAccess).toBe(false);
    expect(sent.user).toEqual({ id: "u1", roles: ["editor"] });
  });

  it("CLEARS an owned option so an instance default cannot reinstate it", async () => {
    // Every operation begins with `mergeConfig(ctx.defaultConfig, args)`, which
    // is `{ ...defaultConfig, ...args }`. A DELETED key is merely absent from
    // `args`, so the instance default survives into the authorized call — an
    // instance configured with `actor` would hand the job an API-key scope
    // whose `permissions` array is read as authoritative, behind a wrapper
    // advertising a bound identity. Present-and-undefined is what wins the
    // spread.
    const find = vi.fn(async (_args: Record<string, unknown>) => ({
      items: [],
    }));
    const client = createJobContentApi({ id: "u1", roles: ["editor"] }, {
      find,
    } as never);

    await (client.find as (args: unknown) => Promise<unknown>)({
      collection: "posts",
      actor: { actorType: "apiKey", permissions: ["delete-posts"] },
    });

    const sent = find.mock.calls[0]?.[0] as Record<string, unknown>;
    // The key must be PRESENT and undefined. `not.toHaveProperty` would pass on
    // a deleted key, which is the implementation this case exists to reject.
    expect(Object.prototype.hasOwnProperty.call(sent, "actor")).toBe(true);
    expect(sent.actor).toBeUndefined();
  });

  it("clears `user` too, so an anonymous job cannot inherit a configured one", async () => {
    // A job queued by nobody acts as nobody. With `user` merely deleted, an
    // instance default would be merged back in and the least-privileged job
    // would run as whoever that default names.
    const find = vi.fn(async (_args: Record<string, unknown>) => ({
      items: [],
    }));
    const client = createJobContentApi(null, { find } as never);

    await (client.find as (args: unknown) => Promise<unknown>)({
      collection: "posts",
    });

    const sent = find.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(sent, "user")).toBe(true);
    expect(sent.user).toBeUndefined();
    expect(sent.overrideAccess).toBe(false);
  });

  it("still forwards the options that carry no authority", async () => {
    // The control. Stripping everything would satisfy the case above while
    // making the client useless: a job could not choose a locale, a depth, or
    // pass context to its hooks.
    const find = vi.fn(async (_args: Record<string, unknown>) => ({
      items: [],
    }));
    const client = createJobContentApi(null, { find } as never);

    await (client.find as (args: unknown) => Promise<unknown>)({
      collection: "posts",
      locale: "de",
      depth: 2,
      context: { from: "a job" },
    });

    expect(find.mock.calls[0]?.[0]).toMatchObject({
      locale: "de",
      depth: 2,
      context: { from: "a job" },
    });
  });
});
