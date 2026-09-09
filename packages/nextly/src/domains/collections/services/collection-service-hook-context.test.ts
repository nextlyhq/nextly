/**
 * The collection facade forwards `RequestContext.context` and
 * `RequestContext.request` to the entry service on every ENTRY operation.
 *
 * `context` is advertised on the shared `RequestContext`, which every method on
 * this service takes, so a method that quietly drops it is worse than one that
 * never offered it: a caller reads the type, passes a flag, and watches a hook
 * ignore it with nothing to say why. The first version of this threading
 * reached five methods and left the batch, count and transactional paths
 * behind, which is exactly that trap.
 *
 * `request` is the HTTP request that produced the operation, and it travels the
 * same road for the same reason: a hook that applies a request-scoped rule has
 * to be able to tell a visitor from a server-side import, and a method that
 * drops it silently answers that question wrongly rather than not at all.
 *
 * Sibling of the `overrideAccess` threading test, and for the same reason: the
 * live create path cannot exercise this, so the threading is asserted directly.
 */
import { describe, expect, it, vi } from "vitest";

import { CollectionService } from "./collection-service";

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function make(entry: Record<string, unknown>): CollectionService {
  return new CollectionService(
    {} as never,
    noopLogger as never,
    {} as never,
    entry as never
  );
}

const ok = { success: true, data: { id: "1" }, statusCode: 200 };
const okList = { success: true, data: [], statusCode: 200 };
const okCount = { success: true, data: { totalDocs: 0 }, statusCode: 200 };
const hookContext = { formBuilder: { schemaOnlyRead: true } };
const request = new Request("https://example.test/api/vault", {
  method: "POST",
  headers: { "x-forwarded-for": "203.0.113.7" },
});
const ctx = { overrideAccess: true, context: hookContext, request };
const tx = {} as never;

/**
 * Every entry operation, the entry-service method it delegates to, and how to
 * call it. Listed so a NEW operation that forgets to forward is a failing case
 * rather than a silent gap.
 */
const OPERATIONS: Array<
  [string, string, (s: CollectionService) => Promise<unknown>]
> = [
  ["createEntry", "createEntry", s => s.createEntry("vault", { a: 1 }, ctx)],
  ["listEntries", "listEntries", s => s.listEntries("vault", {}, ctx)],
  ["findEntryById", "getEntry", s => s.findEntryById("vault", "1", ctx)],
  [
    "updateEntry",
    "updateEntry",
    s => s.updateEntry("vault", "1", { a: 1 }, ctx),
  ],
  ["deleteEntry", "deleteEntry", s => s.deleteEntry("vault", "1", ctx)],
  ["count", "countEntries", s => s.count("vault", {}, ctx)],
  ["createMany", "createEntries", s => s.createMany("vault", [{ a: 1 }], ctx)],
  [
    "createEntryInTransaction",
    "createEntryInTransaction",
    s => s.createEntryInTransaction(tx, "vault", { a: 1 }, ctx),
  ],
  [
    "updateEntryInTransaction",
    "updateEntryInTransaction",
    s => s.updateEntryInTransaction(tx, "vault", "1", { a: 1 }, ctx),
  ],
  [
    "deleteEntryInTransaction",
    "deleteEntryInTransaction",
    s => s.deleteEntryInTransaction(tx, "vault", "1", ctx),
  ],
];

/** The canned entry-service result each delegate has to return to get past its caller. */
function resultFor(delegate: string): unknown {
  if (delegate === "countEntries") return okCount;
  if (delegate === "listEntries") return okList;
  return ok;
}

describe("CollectionService threads RequestContext.context", () => {
  it.each(OPERATIONS)(
    "%s forwards the hook context to %s",
    async (_name, delegate, call) => {
      const spy = vi.fn().mockResolvedValue(resultFor(delegate));
      const service = make({ [delegate]: spy });
      await call(service).catch(() => undefined);
      expect(spy).toHaveBeenCalled();
      const passed = spy.mock.calls[0]!.find(
        (arg): arg is { context?: unknown } =>
          typeof arg === "object" && arg !== null && "context" in arg
      );
      expect(passed?.context).toEqual(hookContext);
    }
  );

  it("covers every entry operation the facade exposes", () => {
    // The control. A table that lost entries would delete its own cases and
    // leave a suite whose every remaining case passes, which reads exactly like
    // a passing one.
    expect(OPERATIONS).toHaveLength(10);
  });

  it("passes nothing when the caller passed nothing", () => {
    // The other control: a facade that invented a context would satisfy every
    // case above without carrying what the caller actually said.
    const spy = vi.fn().mockResolvedValue(ok);
    return make({ getEntry: spy })
      .findEntryById("vault", "1", { overrideAccess: true })
      .then(() => {
        expect(spy.mock.calls[0]![0]).toMatchObject({ context: undefined });
      });
  });
});

describe("CollectionService threads RequestContext.request", () => {
  it.each(OPERATIONS)(
    "%s forwards the request to %s",
    async (_name, delegate, call) => {
      const spy = vi.fn().mockResolvedValue(resultFor(delegate));
      const service = make({ [delegate]: spy });
      await call(service).catch(() => undefined);
      expect(spy).toHaveBeenCalled();
      const passed = spy.mock.calls[0]!.find(
        (arg): arg is { request?: unknown } =>
          typeof arg === "object" && arg !== null && "request" in arg
      );
      expect(passed?.request).toBe(request);
    }
  );

  it("passes nothing when the caller passed nothing", () => {
    // A facade that reached for an ambient request would satisfy every case
    // above while telling a hook that a server-side import came from a visitor,
    // which is the one answer that must never be invented.
    const spy = vi.fn().mockResolvedValue(ok);
    return make({ getEntry: spy })
      .findEntryById("vault", "1", { overrideAccess: true })
      .then(() => {
        expect(spy.mock.calls[0]![0]).toMatchObject({ request: undefined });
      });
  });
});
