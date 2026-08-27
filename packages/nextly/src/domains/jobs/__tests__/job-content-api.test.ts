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
    // `user` must be ABSENT, not present-and-undefined: a predicate testing
    // presence reads the latter as "has a user, and it is nothing".
    const passed = find.mock.lastCall?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(passed).toBeDefined();
    expect("user" in (passed ?? {})).toBe(false);
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
