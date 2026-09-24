/**
 * `createExternalUser` has to be on the service PLUGINS actually get.
 *
 * `ctx.services.users` resolves to this `UserService`. The method existed only
 * on the legacy `UsersService`, so a plugin reaching the supported SDK surface
 * could not call it — and the nearest thing it could call, `create`, makes the
 * local invite shape: inactive, with a set-password link, unverified. Exactly
 * the opposite of what an external login needs, and silently so.
 */
import { describe, expect, it, vi } from "vitest";

import { UserService } from "../user-service";

/** Only the members the delegation touches; the rest are never reached. */
function serviceWithStubbedMutation() {
  const createExternalUser = vi.fn().mockResolvedValue({
    id: "u-1",
    email: "person@example.com",
  });
  const service = new UserService(
    {} as never,
    { createExternalUser } as never,
    {} as never,
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never
  );
  return { service, createExternalUser };
}

describe("UserService.createExternalUser", () => {
  it("EXISTS on the service plugins receive", () => {
    // The whole finding: a plugin holding `ctx.services.users` could not
    // reach this at all.
    const { service } = serviceWithStubbedMutation();
    expect(typeof service.createExternalUser).toBe("function");
  });

  it("passes the input through untouched", async () => {
    // A thin delegation on purpose: every rule this path enforces belongs to
    // the mutation service, and a second copy here would be a second thing to
    // keep right. Observed on the real call rather than reconstructed.
    const { service, createExternalUser } = serviceWithStubbedMutation();
    const input = {
      email: "person@example.com",
      name: "Person",
      roleIds: ["role-editor"],
      emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
    };

    await service.createExternalUser(input, { user: undefined } as never);

    expect(createExternalUser).toHaveBeenCalledOnce();
    expect(createExternalUser.mock.calls[0][0]).toEqual(input);
  });

  it("derives the actor from the request context's USER", async () => {
    // Same shape as the other writes on this service. Passing the context
    // itself would record the request as the actor, which is not a user.
    const { service, createExternalUser } = serviceWithStubbedMutation();

    await service.createExternalUser(
      {
        email: "person@example.com",
        name: "Person",
        roleIds: ["role-editor"],
        emailVerifiedAt: new Date(),
      },
      { user: { id: "admin-7" } } as never
    );

    expect(createExternalUser.mock.calls[0][1]).toMatchObject({
      id: "admin-7",
    });
  });
});
