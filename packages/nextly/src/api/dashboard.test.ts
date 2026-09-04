// Pins the canonical respondData wire shape for the three dashboard
// endpoints. The handlers are exercised in isolation (auth + DI mocked) so
// the assertions focus on the response envelope and not the underlying
// service queries.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  isErrorResponse: vi.fn(),
}));

vi.mock("../auth/middleware/to-nextly-error", () => ({
  toNextlyAuthError: vi.fn((errResponse: unknown) => {
    return new Error(`auth error: ${JSON.stringify(errResponse)}`);
  }),
}));

vi.mock("../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));

const { containerGet } = vi.hoisted(() => ({ containerGet: vi.fn() }));
// BOTH specifiers, because they are two module records: the handlers reach the
// container through the barrel and `registered-content-slugs` through the
// narrow module, so mocking one leaves the other reading the real container --
// which answers nothing here and takes the registry read's `catch` branch,
// reporting an empty candidate list as though the install had no collections.
vi.mock("../di", () => ({ container: { get: containerGet } }));
vi.mock("../di/container", () => ({ container: { get: containerGet } }));

vi.mock("../services/lib/permissions", () => ({
  // `readCaller` (via `authenticated-read.ts`) resolves this to build the
  // caller it hands the dashboard service. Unmocked, it falls through to a
  // real database lookup that has nothing to connect to in this suite.
  resolveRoleSlugs: vi.fn(),
}));

// The scope's DECISION is `canReadEntity`'s, and
// `__tests__/dashboard-read-scope.test.ts` drives the real one against a real
// `RBACAccessControlService`. Stubbed here so these tests can assert the
// handler's WIRING instead: which slugs it offers for a decision, under whose
// resolved identity, and that the verdict reaches the service unchanged.
const { readableEntities } = vi.hoisted(() => ({
  readableEntities: vi.fn(),
}));
// Spread from the real module rather than replaced by a literal: this module
// also publishes `readAccessCaller`, which the handlers use to derive the
// identity a decision is taken under. A closed literal supplies only what it
// names, so that conversion would arrive as `undefined` and every handler would
// answer 500 -- a failure about the mock's shape wearing the costume of a
// defect in the code under test.
vi.mock("../auth/entity-read-access", async importOriginal => ({
  ...(await importOriginal<typeof import("../auth/entity-read-access")>()),
  readableEntities,
}));

import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { container } from "../di";
import { SETTINGS_ACTIVITY_NAMESPACES } from "../domains/audit/settings-activity-namespaces";
import { resolveRoleSlugs } from "../services/lib/permissions";

import {
  getDashboardActivity,
  getDashboardRecentEntries,
  getDashboardStats,
} from "./dashboard";

function makeReq(url: string): Request {
  return new Request(url);
}

/**
 * Every name the handler offers for a read decision.
 *
 * Two collections and one single from the stubbed registries, PLUS the settings
 * activity namespaces, which are not registry-derived: `activity_log.collection`
 * is a free string and `recordSettingsActivity` files entries under names that
 * are neither a collection nor a single. Spliced from the exported list rather
 * than spelled out, so a new namespace reaches this expectation the moment its
 * writer registers one -- a literal here would leave the test agreeing with a
 * handler that had gone stale.
 */
const CANDIDATES = [
  "posts",
  "pages",
  "site-settings",
  ...SETTINGS_ACTIVITY_NAMESPACES,
];

/**
 * The dashboard service (or activity log service) this test wants back.
 *
 * `container.get` now answers for the two registries as well, because the scope
 * is resolved from the entities they list. A single `mockReturnValue` would
 * hand the same object to every lookup, so the registries would answer with a
 * service and the scope would silently come out empty -- which looks exactly
 * like a working deny.
 */
let serviceStub: unknown = {};

/** The slugs offered for a read decision, in the order they were offered. */
function offeredSlugs(): string[] {
  return [...((readableEntities.mock.calls[0]?.[0] as string[]) ?? [])].sort();
}

/** The identity the read decisions were taken under. */
function decidingCaller(): Record<string, unknown> {
  return readableEntities.mock.calls[0]?.[1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceStub = {};
  containerGet.mockImplementation((name: string) => {
    if (name === "collectionRegistryService") {
      return {
        getAllCollections: vi
          .fn()
          .mockResolvedValue([{ slug: "posts" }, { slug: "pages" }]),
      };
    }
    if (name === "singleRegistryService") {
      return {
        getAllSingles: vi.fn().mockResolvedValue([{ slug: "site-settings" }]),
      };
    }
    return serviceStub;
  });
  // Admits everything by default, so a test that cares about the scope states
  // its own verdict and the rest are unaffected by it.
  readableEntities.mockImplementation(
    async (slugs: readonly string[]) => new Set(slugs)
  );
  (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "user-1",
  });
  (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValue(false);
  (resolveRoleSlugs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe("getDashboardStats", () => {
  it("emits respondData (no `data` envelope) for the stats payload", async () => {
    const stats = {
      content: {
        totalEntries: 47,
        totalMedia: 3,
        contentTypes: 2,
        recentChanges24h: 5,
      },
      status: { draft: 1, published: 46 },
      collectionCounts: [],
      users: 1,
      roles: 2,
      permissions: 10,
      fieldGroups: 0,
      singles: 0,
      apiKeys: 0,
    };
    serviceStub = {
      getStats: vi.fn().mockResolvedValue(stats),
    };

    const res = await getDashboardStats(
      makeReq("http://x/api/dashboard/stats")
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    // Bare body, no `{ data: ... }` wrapper.
    expect(json).not.toHaveProperty("data");
    expect((json as typeof stats).content.totalEntries).toBe(47);
    expect((json as typeof stats).status).toEqual({ draft: 1, published: 46 });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Vary")).toBe("Cookie");
  });
});

describe("getDashboardRecentEntries", () => {
  it("emits respondData with the named `entries` field", async () => {
    const entries = {
      entries: [
        { id: "p1", collection: "posts", updatedAt: "2026-04-29T00:00:00Z" },
      ],
    };
    serviceStub = {
      getRecentEntries: vi.fn().mockResolvedValue(entries),
    };

    const res = await getDashboardRecentEntries(
      makeReq("http://x/api/dashboard/recent-entries?limit=5")
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty("data");
    expect(json).toEqual(entries);
  });

  it("builds the caller from readCaller's RESOLVED slugs and forwards it as the third argument", async () => {
    // Session auth carries role IDS on the auth context; `resolveRoleSlugs`
    // is what turns those into the SLUGS a role-based access rule matches.
    // The two are made deliberately different strings ("role-7" vs
    // "editor") so this assertion can actually tell "the handler forwarded
    // the resolved caller" apart from "the handler forwarded the raw auth
    // context" -- if both were "editor" the test could not distinguish them.
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "user-1",
      roles: ["role-7"],
    });
    (resolveRoleSlugs as ReturnType<typeof vi.fn>).mockResolvedValue([
      "editor",
    ]);

    const getRecentEntries = vi.fn().mockResolvedValue({ entries: [] });
    serviceStub = {
      getRecentEntries,
    };

    await getDashboardRecentEntries(
      makeReq("http://x/api/dashboard/recent-entries?limit=5")
    );

    // The seam this task's whole security property runs through: had the
    // handler built `{ user: { id: auth.userId, roles: auth.roles } }` by
    // hand instead of calling `readCaller(auth)`, this would observe
    // `roles: ["role-7"]` (the unresolved id) instead of `["editor"]`, and
    // every test in the file would otherwise stay green while a
    // role-guarded collection silently returned zero rows.
    expect(getRecentEntries).toHaveBeenCalledWith(
      5,
      { kind: "some", resources: new Set(CANDIDATES) },
      { user: { id: "user-1", roles: ["editor"], role: "editor" } }
    );
  });
});

describe("getDashboardActivity", () => {
  it("emits respondData with cursor-shaped { activities, total, hasMore }", async () => {
    const result = {
      activities: [{ id: "a1", action: "create", collection: "posts" }],
      total: 1,
      hasMore: false,
    };
    serviceStub = {
      getRecentActivity: vi.fn().mockResolvedValue(result),
    };

    const res = await getDashboardActivity(
      makeReq("http://x/api/dashboard/activity?limit=5")
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty("data");
    expect(json).toEqual(result);
  });
});

/**
 * What the handler does with the access layer's answer.
 *
 * The DECISION itself belongs to `canReadEntity` and is driven for real, with a
 * real `RBACAccessControlService` and real code-defined rules, in
 * `__tests__/dashboard-read-scope.test.ts`. Everything here is about the wiring
 * around it, which has its own ways of being wrong: offering the wrong SET of
 * candidates, offering them under the wrong IDENTITY, or widening the verdict on
 * the way to the service.
 */
describe("dashboard read scope", () => {
  it("offers every candidate for a decision -- singles and settings namespaces too", async () => {
    // A single is an entity with its own `access` rules, and
    // `getRegisteredAccess` reads both maps. Omitting the single registry here
    // would leave every single permanently invisible on the dashboard, with no
    // error to say so.
    const getStats = vi.fn().mockResolvedValue({});
    serviceStub = { getStats };

    await getDashboardStats(makeReq("http://localhost/api/dashboard/stats"));

    expect(offeredSlugs()).toEqual([...CANDIDATES].sort());
  });

  it("forwards exactly what the access layer admitted, and nothing beside it", async () => {
    readableEntities.mockResolvedValue(new Set(["posts"]));

    const getStats = vi.fn().mockResolvedValue({});
    serviceStub = { getStats };

    await getDashboardStats(makeReq("http://localhost/api/dashboard/stats"));

    // `pages` and `site-settings` were offered and refused, so they must not
    // appear: the handler carries the verdict, it does not re-decide it.
    expect(getStats).toHaveBeenCalledWith({
      scope: { kind: "some", resources: new Set(["posts"]) },
      caller: expect.anything(),
    });
  });

  it("passes an EMPTY `some` through when the access layer admits nothing", async () => {
    readableEntities.mockResolvedValue(new Set());

    const getStats = vi.fn().mockResolvedValue({});
    serviceStub = { getStats };

    await getDashboardStats(makeReq("http://localhost/api/dashboard/stats"));

    // The original defect was an empty set reaching the service as "no
    // filter", so the least-privileged caller got the most access. An empty
    // `some` admits nothing, and that is what must arrive.
    expect(getStats).toHaveBeenCalledWith({
      scope: { kind: "some", resources: new Set() },
      caller: expect.anything(),
    });
  });

  it("never resolves an unbounded `all`, even when everything is admitted", async () => {
    // The positive control for the two above: an implementation that answered
    // `all` whenever nothing was refused would satisfy both of them, and would
    // then let `recentChanges24h` count activity for collections that are no
    // longer registered at all.
    const getStats = vi.fn().mockResolvedValue({});
    serviceStub = { getStats };

    await getDashboardStats(makeReq("http://localhost/api/dashboard/stats"));

    expect(getStats).toHaveBeenCalledWith({
      scope: { kind: "some", resources: new Set(CANDIDATES) },
      caller: expect.anything(),
    });
  });

  it("hands the service the SAME resolved caller it decided the scope with", async () => {
    // The per-collection totals are read as this caller, so the scope and the
    // counts have to describe one identity. Two resolutions would let the
    // dashboard list a collection under one identity and count it under
    // another, and nothing in the response would say so.
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "user-1",
      authMethod: "session",
      permissions: [],
      roles: ["role-7"],
    });
    (resolveRoleSlugs as ReturnType<typeof vi.fn>).mockResolvedValue([
      "editor",
    ]);

    const getStats = vi.fn().mockResolvedValue({});
    serviceStub = { getStats };

    await getDashboardStats(makeReq("http://localhost/api/dashboard/stats"));

    expect(getStats).toHaveBeenCalledWith(
      expect.objectContaining({
        caller: { user: { id: "user-1", roles: ["editor"], role: "editor" } },
      })
    );
  });

  it("decides under the caller's RESOLVED identity, not the raw auth context", async () => {
    // Session auth carries role IDS; a role-based access rule matches SLUGS.
    // The two strings are deliberately different so this can tell "the handler
    // asked as the resolved caller" apart from "the handler forwarded the raw
    // context" -- the second answers no for every role-guarded entity, silently.
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "user-1",
      authMethod: "session",
      permissions: [],
      roles: ["role-7"],
    });
    (resolveRoleSlugs as ReturnType<typeof vi.fn>).mockResolvedValue([
      "editor",
    ]);

    serviceStub = { getStats: vi.fn().mockResolvedValue({}) };

    await getDashboardStats(makeReq("http://localhost/api/dashboard/stats"));

    expect(decidingCaller()).toEqual({
      userId: "user-1",
      authMethod: "session",
      // A session carries none: its grants are resolved from the database.
      permissions: [],
      roles: ["editor"],
    });
  });
});

describe("dashboard activity scope", () => {
  it("scopes the activity feed to the entities the access layer admitted", async () => {
    readableEntities.mockResolvedValue(new Set(["posts"]));

    const getRecentActivity = vi
      .fn()
      .mockResolvedValue({ activities: [], total: 0, hasMore: false });
    serviceStub = { getRecentActivity };

    await getDashboardActivity(
      makeReq("http://localhost/api/dashboard/activity")
    );

    // The defect was that no scope was passed at all, so every caller saw
    // every collection's activity -- entry titles, user names and emails.
    expect(getRecentActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "some", resources: new Set(["posts"]) },
      })
    );
  });

  it("passes an EMPTY scope through rather than omitting it", async () => {
    readableEntities.mockResolvedValue(new Set());

    const getRecentActivity = vi
      .fn()
      .mockResolvedValue({ activities: [], total: 0, hasMore: false });
    serviceStub = { getRecentActivity };

    await getDashboardActivity(
      makeReq("http://localhost/api/dashboard/activity")
    );

    // The fail-closed branch. An omitted scope would let the service's own
    // default decide, and a service default is exactly what went wrong in
    // dashboard-service. The handler states it.
    expect(getRecentActivity).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { kind: "some", resources: new Set() } })
    );
  });
});

/**
 * An API-KEY caller reaches the decision as the KEY, not as its owner.
 *
 * `auth.userId` for an API-key request is the key's OWNER, so a decision taken
 * on that id alone judges the key by the owner's roles. The whole point of a
 * narrowly scoped key is that it carries LESS reach than its owner, and a
 * super-admin owner is where that gap is widest -- so the tests here make the
 * owner a super-admin, because a test with an ordinary owner passes on the
 * broken implementation too.
 *
 * `canReadEntity`'s api-key branch is what enforces it, and it reads
 * `permissions` in the KEY's vocabulary: the `permissions.slug` column, seeded
 * as `${action}-${resource}` -- `read-posts`. A session's grants are spelled
 * `${resource}:${action}` and resolved from the database instead, so handing
 * either branch the other's list answers "denied" for every check, which fails
 * closed and reads as a working deny rather than as a broken read.
 */
describe("dashboard read scope for an API-KEY caller", () => {
  /** A key whose OWNER is a super-admin, bearing the key's own narrow grant. */
  function authenticateAsApiKey(permissions: string[]): void {
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "owner-1",
      authMethod: "api-key",
      permissions,
      roles: ["viewer-of-posts"],
      apiKeyId: "key-1",
    });
    (resolveRoleSlugs as ReturnType<typeof vi.fn>).mockResolvedValue([
      "viewer-of-posts",
    ]);
  }

  it("takes the decision as the key, carrying the key's OWN stamped grant", async () => {
    authenticateAsApiKey(["read-posts", "create-pages"]);

    serviceStub = { getStats: vi.fn().mockResolvedValue({}) };

    await getDashboardStats(makeReq("http://localhost/api/dashboard/stats"));

    expect(decidingCaller()).toEqual({
      userId: "owner-1",
      authMethod: "api-key",
      // Verbatim, unparsed. The prefix stripping that used to happen here is
      // gone: `canReadEntity` tests membership of `read-{slug}` instead, so a
      // hyphenated resource name needs no special handling to stay whole.
      permissions: ["read-posts", "create-pages"],
      roles: ["viewer-of-posts"],
    });
  });

  it("offers a hyphenated slug for decision whole, never split", async () => {
    // `read-site-settings` names `site-settings`. The old parser split on "-"
    // and had to strip by LENGTH to avoid yielding `site`, which matches no
    // entity -- a silent empty dashboard that reads as a working deny.
    authenticateAsApiKey(["read-site-settings"]);
    readableEntities.mockImplementation(
      async (slugs: readonly string[], caller: { permissions: string[] }) =>
        new Set(
          slugs.filter(slug => caller.permissions.includes(`read-${slug}`))
        )
    );

    const getStats = vi.fn().mockResolvedValue({});
    serviceStub = { getStats };

    await getDashboardStats(makeReq("http://localhost/api/dashboard/stats"));

    expect(getStats).toHaveBeenCalledWith({
      scope: { kind: "some", resources: new Set(["site-settings"]) },
      caller: expect.anything(),
    });
  });

  it("scopes /activity through the same decision", async () => {
    authenticateAsApiKey(["read-posts"]);
    readableEntities.mockResolvedValue(new Set(["posts"]));

    const getRecentActivity = vi
      .fn()
      .mockResolvedValue({ activities: [], total: 0, hasMore: false });
    serviceStub = { getRecentActivity };

    await getDashboardActivity(
      makeReq("http://localhost/api/dashboard/activity")
    );

    expect(getRecentActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "some", resources: new Set(["posts"]) },
      })
    );
  });
});
