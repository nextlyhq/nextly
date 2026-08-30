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

describe("registerReleaseServices document authority", () => {
  afterEach(() => {
    vi.doUnmock("../container");
    vi.doUnmock("../../services/lib/permissions");
    vi.resetModules();
  });

  /**
   * Build the service with a permission store that ALLOWS the owner, so the
   * only thing that can refuse below is the key's own scope.
   */
  async function withOwnerAllowed(scopePermissions: string[]) {
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
        has: (name: string) => name === "rbacAccessControlService",
        get: () => ({
          // The OWNER is allowed on the document. If the key's own grants were
          // ignored, this is the answer that would come back.
          checkAccess: async () => true,
          getRegisteredAccess: () => undefined,
        }),
      },
    }));
    const { registerReleaseServices } = await import(
      "../registrations/register-releases"
    );
    registerReleaseServices({ adapter: { select: async () => [] } } as never);
    return {
      svc: singletons.get("releasesService") as {
        addMember: (r: string, m: unknown, a: unknown) => Promise<unknown>;
      },
      actor: {
        userId: "owner",
        overrideAccess: false,
        authenticatedScope: {
          actorType: "apiKey" as const,
          permissions: scopePermissions,
        },
      },
    };
  }

  const MEMBER = {
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: "e1",
    locale: null,
    action: "publish",
  };

  it("refuses a key without the document grant, however privileged its owner", async () => {
    // THE case the release-resource check alone does not cover: a key holding
    // create-content-releases but not publish-posts, owned by someone who CAN
    // publish posts. Resolving the document from the owner inserts the member
    // and materialises it later as that privileged person.
    const { svc, actor } = await withOwnerAllowed(["create-content-releases"]);
    await expect(svc.addMember("r1", MEMBER, actor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("admits a key that holds the document grant", async () => {
    // The control: the key path must not deny everything, which would make a
    // properly scoped key unusable and still pass the case above. It gets past
    // the document check and fails later on the fixture adapter instead.
    const { svc, actor } = await withOwnerAllowed([
      "create-content-releases",
      "publish-posts",
      // The base write grant too: an ordinary lifecycle write needs `update`
      // alongside the verb, so a key holding only `publish-posts` cannot
      // perform one.
      "update-posts",
    ]);
    await expect(svc.addMember("r1", MEMBER, actor)).rejects.not.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("registerReleaseServices lifecycle grants", () => {
  afterEach(() => {
    vi.doUnmock("../container");
    vi.doUnmock("../../services/lib/permissions");
    vi.resetModules();
  });

  async function build(opts: {
    scopePermissions?: string[];
    ownerAllows?: (operation: string) => boolean;
  }) {
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
        has: (name: string) => name === "rbacAccessControlService",
        get: () => ({
          checkAccess: async ({ operation }: { operation: string }) =>
            opts.ownerAllows ? opts.ownerAllows(operation) : true,
          getRegisteredAccess: () => undefined,
        }),
      },
    }));
    const { registerReleaseServices } = await import(
      "../registrations/register-releases"
    );
    registerReleaseServices({ adapter: { select: async () => [] } } as never);
    return {
      svc: singletons.get("releasesService") as {
        addMember: (r: string, m: unknown, a: unknown) => Promise<unknown>;
      },
      actor: {
        userId: "owner",
        overrideAccess: false,
        ...(opts.scopePermissions
          ? {
              authenticatedScope: {
                actorType: "apiKey" as const,
                permissions: opts.scopePermissions,
              },
            }
          : {}),
      },
    };
  }

  const MEMBER = {
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: "e1",
    locale: null,
    action: "publish",
  };

  it("refuses a key holding the lifecycle verb but not the base update grant", async () => {
    // An ordinary lifecycle write requires `update-posts` as well as
    // `publish-posts`. Asking only about the verb admits a key that may publish
    // but may not write the document — and the drain then executes as the
    // owner, turning a release into a way around the missing grant.
    const { svc, actor } = await build({
      scopePermissions: ["create-content-releases", "publish-posts"],
    });
    await expect(svc.addMember("r1", MEMBER, actor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses when the AUTHOR cannot perform the action, however scoped the key", async () => {
    // The author is who executes: `createJobContentApi` strips `actor`, so the
    // key's scope is gone at materialisation. A member admitted on the key's
    // authority alone is one the drain refuses forever, leaving the release
    // scheduled and the content absent.
    const { svc, actor } = await build({
      scopePermissions: [
        "create-content-releases",
        "publish-posts",
        "update-posts",
      ],
      ownerAllows: operation => operation !== "publish",
    });
    await expect(svc.addMember("r1", MEMBER, actor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses a session caller who lacks the base update grant", async () => {
    // Not a key-only rule: an ordinary user scheduling a publish must be able
    // to write the document too.
    const { svc, actor } = await build({
      ownerAllows: operation => operation !== "update",
    });
    await expect(svc.addMember("r1", MEMBER, actor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
