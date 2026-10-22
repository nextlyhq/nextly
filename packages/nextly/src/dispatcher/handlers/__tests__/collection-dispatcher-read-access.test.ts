// The read handlers must hand the caller's identity to the query service, or the
// collection's read gate cannot be evaluated for them: the service falls back to
// the permission-less default and returns every row over HTTP.
//
// These assert the forwarding contract rather than the enforcement itself
// (enforcement lives in the query/access services and is covered there), because
// the defect these guard against was a missing argument, not a wrong rule.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The read handlers go through the legacy `services.collections` fallback and
// never touch DI; stubbing these keeps that path unchanged.
vi.mock("../../helpers/di", () => ({
  getAdapterFromDI: vi.fn(),
  getCollectionRegistryFromDI: vi.fn(),
  getCollectionsHandlerFromDI: vi.fn(),
  getMigrationJournalFromDI: vi.fn(),
}));

import type { ServiceContainer } from "../../../services";
import {
  asCaller,
  keyCaller,
  sessionCaller,
} from "../../__tests__/request-caller";
import { dispatchCollections } from "../collection-dispatcher";

function makeContainer(
  collections: Record<string, ReturnType<typeof vi.fn>>
): ServiceContainer {
  return { collections } as unknown as ServiceContainer;
}

const listResult = {
  success: true,
  statusCode: 200,
  message: "ok",
  data: {
    docs: [],
    totalDocs: 0,
    limit: 10,
    page: 1,
    totalPages: 0,
    pagingCounter: 1,
    hasPrevPage: false,
    hasNextPage: false,
    prevPage: null,
    nextPage: null,
  },
};

const docResult = {
  success: true,
  statusCode: 200,
  message: "ok",
  data: { id: "e1" },
};

const countResult = {
  success: true,
  statusCode: 200,
  message: "ok",
  data: { totalDocs: 0 },
};

/** The caller the route handler sets once it has authenticated. */
const authed = sessionCaller({
  userId: "u1",
  name: "Ada",
  email: "ada@example.com",
  roles: ["editor", "author"],
});

/**
 * The same caller arriving through a scoped API key. The key's own grants are
 * pinned as its scope, apart from the owner's roles, which is the whole point:
 * the key is authoritative on its scope, never on the account that issued it.
 */
const apiKey = keyCaller("key-1", {
  userId: "u1",
  name: "Ada",
  email: "ada@example.com",
  roles: ["editor", "author"],
});
const apiKeyScope = {
  actorType: "apiKey" as const,
  permissions: ["collections:read"],
};

describe("collection read handlers forward the caller to the query service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listEntries passes the authenticated user and attests route authorization", async () => {
    const listEntries = vi.fn().mockResolvedValue(listResult);
    await asCaller(authed, () =>
      dispatchCollections(
        makeContainer({ listEntries }),
        "listEntries",
        { collectionName: "posts" },
        undefined
      )
    );

    expect(listEntries).toHaveBeenCalledTimes(1);
    const args = listEntries.mock.calls[0][0];
    expect(args.user).toEqual({
      id: "u1",
      name: "Ada",
      email: "ada@example.com",
      roles: ["editor", "author"],
      // Rules and field callbacks written against a single-role model read
      // `user.role`; without it an authorized caller would have fields stripped.
      role: "editor",
    });
    // The route ran the coarse RBAC gate already, so it is not run again.
    expect(args.routeAuthorized).toBe(true);
  });

  it("listEntries sends no user for an anonymous caller", async () => {
    const listEntries = vi.fn().mockResolvedValue(listResult);
    await asCaller(undefined, () =>
      dispatchCollections(
        makeContainer({ listEntries }),
        "listEntries",
        { collectionName: "posts" },
        undefined
      )
    );

    const args = listEntries.mock.calls[0][0];
    // An absent user must never be mistaken for a trusted one: the service
    // treats `undefined` as anonymous, and nothing attests authorization.
    expect(args.user).toBeUndefined();
    expect(args.routeAuthorized).toBe(false);
  });

  it("getEntry passes the user, route attestation, and the API-key scope", async () => {
    const getEntry = vi.fn().mockResolvedValue(docResult);
    await asCaller(authed, () =>
      dispatchCollections(
        makeContainer({ getEntry }),
        "getEntry",
        { collectionName: "posts", entryId: "e1" },
        undefined
      )
    );

    const args = getEntry.mock.calls[0][0];
    expect(args.user).toMatchObject({ id: "u1", roles: ["editor", "author"] });
    expect(args.routeAuthorized).toBe(true);
    // Present as a key on every call so a scoped key is judged on its own read
    // grant rather than on the permissions of the user that owns it.
    expect(args).toHaveProperty("authenticatedScope");
  });

  it("getEntry forwards the working-draft overlay opt-in from ?draft=true", async () => {
    // Without this the merged draft/published-split engine is unreachable over
    // HTTP: the query service honors `includeWorkingDraft`, but nothing sets it.
    const getEntry = vi.fn().mockResolvedValue(docResult);
    await asCaller(authed, () =>
      dispatchCollections(
        makeContainer({ getEntry }),
        "getEntry",
        { collectionName: "posts", entryId: "e1", draft: "true" },
        undefined
      )
    );

    expect(getEntry.mock.calls[0][0].includeWorkingDraft).toBe(true);
  });

  it("getEntry leaves the working-draft opt-in off when ?draft is absent", async () => {
    // The overlay is opt-in: a plain read must keep returning the live row, so
    // the flag is explicitly false rather than undefined-and-forgotten.
    const getEntry = vi.fn().mockResolvedValue(docResult);
    await asCaller(authed, () =>
      dispatchCollections(
        makeContainer({ getEntry }),
        "getEntry",
        { collectionName: "posts", entryId: "e1" },
        undefined
      )
    );

    expect(getEntry.mock.calls[0][0].includeWorkingDraft).toBe(false);
  });

  it("countEntries counts under the same caller context listEntries filters by", async () => {
    const listEntries = vi.fn().mockResolvedValue(listResult);
    const countEntries = vi.fn().mockResolvedValue(countResult);
    const container = makeContainer({ listEntries, countEntries });

    await asCaller(authed, () =>
      dispatchCollections(
        container,
        "listEntries",
        { collectionName: "posts" },
        undefined
      )
    );
    await asCaller(authed, () =>
      dispatchCollections(
        container,
        "countEntries",
        { collectionName: "posts" },
        undefined
      )
    );

    const listArgs = listEntries.mock.calls[0][0];
    const countArgs = countEntries.mock.calls[0][0];
    // Assert the context is actually present before comparing: two `undefined`
    // values are trivially equal, so an equality check alone would still pass if
    // both handlers forwarded nothing.
    expect(countArgs.user).toMatchObject({ id: "u1" });
    expect(countArgs.routeAuthorized).toBe(true);
    // A total computed under weaker rules than the list would report rows the
    // caller cannot see, leaking how much data exists and breaking pagination.
    expect(countArgs.user).toEqual(listArgs.user);
    expect(countArgs.routeAuthorized).toBe(listArgs.routeAuthorized);
  });

  it("forwards the API-key scope on every read, not just getEntry", async () => {
    // Without the scope the access service treats a super-admin-owned key as an
    // unscoped super-admin session and lifts the gate entirely, so the key reads
    // rows outside its own grant. getEntry alone forwarding it is
    // not enough: list and count are the paths that return rows in bulk.
    const listEntries = vi.fn().mockResolvedValue(listResult);
    const countEntries = vi.fn().mockResolvedValue(countResult);
    const getEntry = vi.fn().mockResolvedValue(docResult);
    const container = makeContainer({ listEntries, countEntries, getEntry });

    await asCaller(
      apiKey,
      () =>
        dispatchCollections(
          container,
          "listEntries",
          { collectionName: "posts" },
          undefined
        ),
      apiKeyScope
    );
    await asCaller(
      apiKey,
      () =>
        dispatchCollections(
          container,
          "countEntries",
          { collectionName: "posts" },
          undefined
        ),
      apiKeyScope
    );
    await asCaller(
      apiKey,
      () =>
        dispatchCollections(
          container,
          "getEntry",
          { collectionName: "posts", entryId: "e1" },
          undefined
        ),
      apiKeyScope
    );

    const expected = {
      actorType: "apiKey",
      permissions: ["collections:read"],
    };
    expect(listEntries.mock.calls[0][0].authenticatedScope).toEqual(expected);
    expect(countEntries.mock.calls[0][0].authenticatedScope).toEqual(expected);
    expect(getEntry.mock.calls[0][0].authenticatedScope).toEqual(expected);
  });

  it("reads an empty role set as no roles rather than an empty grant", async () => {
    // A caller resolved to no roles reaches the rules the same way as one
    // whose route resolves none: no `roles`, and no `role` to match on.
    const listEntries = vi.fn().mockResolvedValue(listResult);
    await asCaller(sessionCaller({ userId: "u1", roles: [] }), () =>
      dispatchCollections(
        makeContainer({ listEntries }),
        "listEntries",
        { collectionName: "posts" },
        undefined
      )
    );

    const args = listEntries.mock.calls[0][0];
    expect(args.user.id).toBe("u1");
    expect(args.user.roles).toBeUndefined();
    expect(args.user.role).toBeUndefined();
  });
});
