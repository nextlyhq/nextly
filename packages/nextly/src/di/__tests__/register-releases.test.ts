/**
 * That the releases service is actually REGISTERED, and what its checks answer.
 *
 * A service that exists and is registered nowhere is the exact shape the whole
 * R-6 product layer was in: complete, tested, and reachable by nothing. The
 * namespace resolves this from the container by name, so a missing registration
 * is a runtime 500 on the first call and nothing earlier catches it.
 *
 * @module di/__tests__/register-releases.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

describe("registerReleaseServices", () => {
  afterEach(() => {
    vi.doUnmock("../container");
    vi.resetModules();
  });

  it("registers releasesService, so the namespace can resolve it", async () => {
    const singletons = new Map<string, unknown>();
    vi.resetModules();
    vi.doMock("../container", () => ({
      container: {
        registerSingleton: (name: string, factory: () => unknown) => {
          singletons.set(name, factory());
        },
        has: () => false,
        get: () => ({}),
      },
    }));

    const { registerReleaseServices } = await import(
      "../registrations/register-releases"
    );
    const { ReleasesService } = await import(
      "../../domains/releases/services/releases-service"
    );

    registerReleaseServices({ adapter: { select: async () => [] } } as never);

    // Imported INSIDE the reset module graph, so `instanceof` compares one class
    // against itself rather than across two copies.
    expect(singletons.get("releasesService")).toBeInstanceOf(ReleasesService);
  });

  it("refuses a document action when no permission store is registered", async () => {
    // A minimal boot without RBAC can still construct the service. It must not
    // be able to authorize anyone INTO a release: no permission store is no
    // basis for saying yes, and defaulting the other way would make a stripped
    // deployment the most permissive one.
    //
    // `hasPermission` is stubbed TRUE so the release-authority check cannot be
    // what refuses. Without that this case passes while never reaching the
    // document check at all — the earlier gate would refuse first and the test
    // would be green about a mechanism it never ran.
    const singletons = new Map<string, unknown>();
    vi.resetModules();
    vi.doMock("../../services/lib/permissions", () => ({
      hasPermission: async () => true,
    }));
    vi.doMock("../container", () => ({
      container: {
        registerSingleton: (name: string, factory: () => unknown) => {
          singletons.set(name, factory());
        },
        has: (name: string) => name !== "rbacAccessControlService",
        get: () => ({}),
      },
    }));

    const { registerReleaseServices } = await import(
      "../registrations/register-releases"
    );
    registerReleaseServices({ adapter: { select: async () => [] } } as never);

    const svc = singletons.get("releasesService") as {
      addMember: (r: string, m: unknown, a: unknown) => Promise<unknown>;
      find: (q: unknown, a: unknown) => Promise<unknown>;
    };
    const checked = { userId: "u1", overrideAccess: false };

    // THE CONTROL. With `hasPermission` true, a release-authority operation
    // succeeds — which proves the stub took effect and that what refuses below
    // is the document check and nothing upstream of it.
    await expect(svc.find({}, checked)).resolves.toBeDefined();

    // Asserted on the CODE, not on "it threw". With the check disabled this
    // call still throws — it reaches a fixture adapter that has no `insert` —
    // so `toThrow()` alone is satisfied by an incidental crash and stays green
    // against the exact defect this case exists to catch. Measured: it did.
    await expect(
      svc.addMember(
        "r1",
        {
          scopeKind: "collection",
          scopeSlug: "posts",
          entryId: "e1",
          locale: null,
          action: "publish",
        },
        checked
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    vi.doUnmock("../../services/lib/permissions");
  });
});
