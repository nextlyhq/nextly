/**
 * The write seam tells BOTH kinds of hook what it knows about the request.
 *
 * `beforeChange` is the phase a request-scoped rule attaches to, because every
 * door into a collection passes through it: the form route, the generic
 * collection create, and the Direct API. It runs two kinds of handler, code
 * hooks through the registry and stored hooks through their own executor, and
 * they are given contexts built by two different functions. A rule installed as
 * one kind and tested as the other is the gap this pins shut.
 */
import { describe, expect, it, vi } from "vitest";

import { CollectionHookService } from "./collection-hook-service";

const facts = {
  headers: { "user-agent": "probe/1.0" },
  http: { ip: "203.0.113.7", method: "POST" },
} as const;

function serviceWithRegistrySpy(): {
  service: CollectionHookService;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn().mockResolvedValue(undefined);
  return {
    service: new CollectionHookService({ execute } as never),
    execute,
  };
}

async function runPhase(
  service: CollectionHookService,
  req: { headers?: Record<string, string>; http?: unknown }
): Promise<void> {
  await service.runBeforeChange({
    collection: "form-submissions",
    operation: "create",
    data: { message: "hello" },
    storedHooks: [{ id: "h1", type: "beforeChange", enabled: true }] as never,
    queryDatabase: async () => false,
    req: req as never,
  });
}

describe("runBeforeChange carries the request facts", () => {
  it("hands them to a code hook", async () => {
    const { service, execute } = serviceWithRegistrySpy();
    await runPhase(service, facts);
    const context = execute.mock.calls[0]![1] as {
      req?: { http?: unknown; headers?: unknown };
    };
    expect(context.req?.http).toEqual(facts.http);
    expect(context.req?.headers).toEqual(facts.headers);
  });

  it("hands them to a stored hook", async () => {
    const { service } = serviceWithRegistrySpy();
    const executeStored = vi
      .spyOn(service.storedHookExecutor, "execute")
      .mockResolvedValue({
        data: undefined,
        executedCount: 0,
        skippedHookIds: [],
        failures: [],
      });
    await runPhase(service, facts);
    const context = executeStored.mock.calls[0]![2] as {
      req?: { http?: unknown };
    };
    // The builder for this context took no request at all before, so a stored
    // rule could not have seen one however carefully the caller passed it.
    expect(context.req?.http).toEqual(facts.http);
  });

  it("says nothing about a request when there was none", async () => {
    const { service, execute } = serviceWithRegistrySpy();
    await runPhase(service, {});
    const context = execute.mock.calls[0]![1] as { req?: { http?: unknown } };
    // The control. A seam that invented facts would satisfy both cases above
    // while telling a rate limiter that a seed script was a visitor.
    expect(context.req?.http).toBeUndefined();
  });
});
