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

    registerReleaseServices({
      adapter: { select: async () => [], count: async () => 0 },
    } as never);

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
    // Only `hasPermission` is stubbed; the rest of the module stays real,
    // because the registration also wires the release run and the target checks, whose
    // identity and content reads reach this module too.
    vi.doMock("../../services/lib/permissions", async importOriginal => ({
      ...(await importOriginal<
        typeof import("../../services/lib/permissions")
      >()),
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
    registerReleaseServices({
      adapter: { select: async () => [], count: async () => 0 },
    } as never);

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
    // Only `hasPermission` is stubbed; the rest of the module stays real,
    // because the registration also wires the release run and the target checks, whose
    // identity and content reads reach this module too.
    vi.doMock("../../services/lib/permissions", async importOriginal => ({
      ...(await importOriginal<
        typeof import("../../services/lib/permissions")
      >()),
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
          getRegisteredTarget: () => undefined,
        }),
      },
    }));
    const { registerReleaseServices } = await import(
      "../registrations/register-releases"
    );
    registerReleaseServices({
      adapter: { select: async () => [], count: async () => 0 },
    } as never);
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
    // Only `hasPermission` is stubbed; the rest of the module stays real,
    // because the registration also wires the release run and the target checks, whose
    // identity and content reads reach this module too.
    vi.doMock("../../services/lib/permissions", async importOriginal => ({
      ...(await importOriginal<
        typeof import("../../services/lib/permissions")
      >()),
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
          getRegisteredTarget: () => undefined,
        }),
      },
    }));
    const { registerReleaseServices } = await import(
      "../registrations/register-releases"
    );
    registerReleaseServices({
      adapter: { select: async () => [], count: async () => 0 },
    } as never);
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

  /** How an add ended: added, or the code it was refused with. */
  const outcomeOf = (added: Promise<unknown>) =>
    added.then(
      () => "added",
      (error: { code?: string }) => error.code
    );

  it("admits a key holding the lifecycle verb without update, as the run's write needs", async () => {
    // A release writes the status alone, a publish judged by `publish-posts`
    // and not `update-posts`, so the key that write admits is the one the
    // release admits. The add may still fail later, on the document: not on
    // the caller's authority.
    const { svc, actor } = await build({
      scopePermissions: ["create-content-releases", "publish-posts"],
    });
    expect(await outcomeOf(svc.addMember("r1", MEMBER, actor))).not.toBe(
      "FORBIDDEN"
    );
  });

  it("refuses a key holding update but not the lifecycle verb", async () => {
    const { svc, actor } = await build({
      scopePermissions: ["create-content-releases", "update-posts"],
    });
    expect(await outcomeOf(svc.addMember("r1", MEMBER, actor))).toBe(
      "FORBIDDEN"
    );
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

  it("admits a session caller who may publish and not update", async () => {
    // Not a key-only rule: an ordinary user scheduling a publish is judged by
    // the publish, as the run's status write is.
    const { svc, actor } = await build({
      ownerAllows: operation => operation !== "update",
    });
    expect(await outcomeOf(svc.addMember("r1", MEMBER, actor))).not.toBe(
      "FORBIDDEN"
    );
  });

  it("refuses a session caller who may update and not publish", async () => {
    const { svc, actor } = await build({
      ownerAllows: operation => operation !== "publish",
    });
    expect(await outcomeOf(svc.addMember("r1", MEMBER, actor))).toBe(
      "FORBIDDEN"
    );
  });
});

describe("registerReleaseServices binds Publish now to its own registration", () => {
  afterEach(() => {
    vi.doUnmock("../container");
    vi.doUnmock("../../domains/jobs/jobs-runner");
    vi.resetModules();
  });

  it("runs the drain with the job registry of the registration that built it", async () => {
    // Services can be cleared and registered again while a Publish now from
    // the earlier registration is still in flight. Its drain must run with
    // that registration's registry, not whichever one the container holds by
    // then, whose drain closes over a different adapter.
    const singletons = new Map<string, unknown>();
    const ownRegistry = { name: "own registration" };
    const laterRegistry = { name: "later registration" };
    let registered: unknown = ownRegistry;
    const runSweepNow = vi.fn(async () => ({
      claimed: 0,
      done: 0,
      failed: 0,
      retried: 0,
      unrecorded: 0,
    }));
    vi.resetModules();
    vi.doMock("../../domains/jobs/jobs-runner", async importOriginal => ({
      ...(await importOriginal<
        typeof import("../../domains/jobs/jobs-runner")
      >()),
      runSweepNow,
    }));
    vi.doMock("../container", () => ({
      container: {
        registerSingleton: (name: string, factory: () => unknown) => {
          singletons.set(name, factory());
        },
        has: () => true,
        get: (name: string) => (name === "jobRegistry" ? registered : {}),
      },
    }));

    const { registerReleaseServices } = await import(
      "../registrations/register-releases"
    );
    registerReleaseServices({
      adapter: { select: async () => [], count: async () => 0 },
    } as never);
    // The container moves on to a later registration's registry.
    registered = laterRegistry;

    // The dependency the service runs Publish now's drain through, read from
    // the service the registration built.
    const svc = singletons.get("releasesService") as {
      deps: { runDrainNow: (o: { maxDurationMs: number }) => Promise<unknown> };
    };
    await svc.deps.runDrainNow({ maxDurationMs: 1_000 });

    expect(runSweepNow).toHaveBeenCalledTimes(1);
    expect(runSweepNow).toHaveBeenCalledWith(
      expect.anything(),
      ownRegistry,
      "releases:drain",
      { maxDurationMs: 1_000 }
    );
  });
});
