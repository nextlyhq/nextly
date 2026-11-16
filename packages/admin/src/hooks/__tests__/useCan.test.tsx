/**
 * What `useCan` says the signed-in user may do, decided by the real
 * `useCurrentUserPermissions` against a stubbed server.
 *
 * The property that separates it from a plausible broken one is where each
 * slug is answered: an action on a collection or Single follows the server's
 * capabilities answer, code rules included, even where the permission slugs
 * say otherwise, and a standard action on a resource that answer leaves out is
 * refused, while every other slug (a system resource, a plugin's own
 * permission with another action) still follows the slugs. A hook reading
 * only the slugs passes every case where the two agree, and one reading only
 * the capabilities refuses every slug they do not name.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CapabilitiesResponse,
  EntityCapabilitiesAnswer,
  UserPermissionsResponse,
} from "../../types/permissions";

const server = vi.hoisted(() => ({
  permissions: undefined as UserPermissionsResponse | Error | undefined,
  capabilities: undefined as CapabilitiesResponse | Error | undefined,
  /** Held until released, for every capabilities request. */
  capabilitiesGate: null as Promise<void> | null,
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: {
    get: async (path: string) => {
      if (path === "/me/permissions") {
        if (server.permissions instanceof Error) throw server.permissions;
        return server.permissions;
      }
      if (path.split("?")[0] === "/me/capabilities") {
        if (server.capabilitiesGate) await server.capabilitiesGate;
        if (server.capabilities instanceof Error) throw server.capabilities;
        return server.capabilities;
      }
      throw new Error(`unexpected request ${path}`);
    },
  },
}));

vi.mock("../useRouter", () => ({
  useRouter: () => ({ route: { routeType: "private" } }),
}));

vi.mock("../useLocaleParam", () => ({
  useLocaleParam: () => undefined,
}));

import { useCan } from "../useCan";
import { useCurrentUserPermissions } from "../useCurrentUserPermissions";

const newClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

/** A user whose role holds the given permission slugs. */
const holding = (...permissions: string[]): UserPermissionsResponse => ({
  permissions,
  isSuperAdmin: false,
  roles: ["editor"],
});

const nothing: Omit<EntityCapabilitiesAnswer, "kind"> = {
  read: false,
  create: false,
  update: false,
  delete: false,
  publish: false,
  unpublish: false,
};

/** The server's answer about each named collection. */
const answering = (
  entities: Record<string, Partial<EntityCapabilitiesAnswer>>,
  isSuperAdmin = false
): CapabilitiesResponse => ({
  isSuperAdmin,
  validUntil: null,
  entities: Object.fromEntries(
    Object.entries(entities).map(([slug, answer]) => [
      slug,
      { kind: "collection", ...nothing, ...answer },
    ])
  ),
});

/**
 * What `useCan` says about each slug, once both answers have settled, with
 * the hook's own state beside it so a case can wait on it.
 */
async function canEach(
  slugs: readonly string[],
  settled: (
    access: ReturnType<typeof useCurrentUserPermissions>
  ) => boolean = access => access.hasAnswer && access.content.hasAnswer
): Promise<Record<string, boolean>> {
  // One client for every slug, so they share the answers as the admin's
  // components do.
  const client = newClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const rendered = slugs.map(slug => {
    const { result } = renderHook(
      () => ({ access: useCurrentUserPermissions(), can: useCan(slug) }),
      { wrapper }
    );
    return [slug, result] as const;
  });
  await waitFor(() => {
    for (const [, result] of rendered) {
      expect(settled(result.current.access)).toBe(true);
    }
  });
  return Object.fromEntries(
    rendered.map(([slug, result]) => [slug, result.current.can])
  );
}

beforeEach(() => {
  server.permissions = holding();
  server.capabilities = answering({});
  server.capabilitiesGate = null;
});

describe("useCan", () => {
  it("follows the server where a code rule refuses what the role's permission allows", async () => {
    server.permissions = holding("read-posts", "update-posts");
    server.capabilities = answering({ posts: { read: true } });

    expect(await canEach(["read-posts", "update-posts"])).toEqual({
      "read-posts": true,
      "update-posts": false,
    });
  });

  it("allows an action on a collection the server allows, though no slug names it", async () => {
    server.permissions = holding("read-posts", "update-posts");
    server.capabilities = answering({
      posts: { read: true, update: true, publish: true, unpublish: true },
    });

    expect(await canEach(["publish-posts", "unpublish-posts"])).toEqual({
      "publish-posts": true,
      "unpublish-posts": true,
    });
  });

  it("reads a collection whose slug has a hyphen in it from the server", async () => {
    server.permissions = holding("update-blog-posts");
    server.capabilities = answering({ "blog-posts": { read: true } });

    expect(await canEach(["update-blog-posts"])).toEqual({
      "update-blog-posts": false,
    });
  });

  it("answers system resources and a plugin's own permissions from the slugs", async () => {
    server.permissions = holding(
      "manage-seo",
      "read-webhooks",
      "create-content-releases"
    );
    server.capabilities = answering({ posts: { read: true } });

    expect(
      await canEach([
        "manage-seo",
        "read-webhooks",
        "create-content-releases",
        "delete-webhooks",
      ])
    ).toEqual({
      "manage-seo": true,
      "read-webhooks": true,
      "create-content-releases": true,
      "delete-webhooks": false,
    });
  });

  it("refuses a standard action on a resource the server's answer leaves out, though the role holds it", async () => {
    server.permissions = holding(
      "read-secrets",
      "update-secrets",
      "read-seo-report"
    );
    server.capabilities = answering({ posts: { read: true } });

    expect(
      await canEach(["read-secrets", "update-secrets", "read-seo-report"])
    ).toEqual({
      "read-secrets": false,
      "update-secrets": false,
      "read-seo-report": false,
    });
  });

  it("gives a super-admin a standard action on a resource the server's answer leaves out", async () => {
    server.permissions = { permissions: [], isSuperAdmin: true, roles: [] };
    server.capabilities = answering({ posts: {} }, true);

    expect(await canEach(["read-seo-report"])).toEqual({
      "read-seo-report": true,
    });
  });

  it("takes that super-admin answer from the server, not from a super-admin flag in the slugs", async () => {
    server.permissions = { permissions: [], isSuperAdmin: true, roles: [] };
    server.capabilities = answering({ posts: { read: true } });

    expect(await canEach(["read-seo-report"])).toEqual({
      "read-seo-report": false,
    });
  });

  it("offers no action on a collection while the server's answer is missing, and keeps the slugs' answers", async () => {
    server.permissions = holding(
      "update-posts",
      "read-webhooks",
      "read-content-releases",
      "manage-seo"
    );
    server.capabilities = new Error("capabilities unavailable");

    expect(
      await canEach(
        [
          "update-posts",
          "read-webhooks",
          "read-content-releases",
          "manage-seo",
        ],
        access => access.hasAnswer && access.content.error !== null
      )
    ).toEqual({
      "update-posts": false,
      "read-webhooks": true,
      "read-content-releases": true,
      "manage-seo": true,
    });
  });

  it("gives a super-admin every action the server's answer gives one, and every other slug", async () => {
    server.permissions = { permissions: [], isSuperAdmin: true, roles: [] };
    server.capabilities = answering({ posts: {} }, true);

    expect(await canEach(["update-posts", "manage-seo"])).toEqual({
      "update-posts": true,
      "manage-seo": true,
    });
  });

  it("takes a collection's answer from the server, not from a super-admin flag in the slugs", async () => {
    // The two answers are separate requests: the slugs can still report a
    // super-admin after the server's answer about content stopped giving one.
    server.permissions = { permissions: [], isSuperAdmin: true, roles: [] };
    server.capabilities = answering({ posts: { read: true } });

    expect(await canEach(["update-posts"])).toEqual({
      "update-posts": false,
    });
  });

  it("offers no action on a collection while the server's answer is on its way, though the slugs have arrived", async () => {
    server.permissions = holding("update-posts", "manage-seo");
    server.capabilities = answering({ posts: { update: true } });
    let release!: () => void;
    server.capabilitiesGate = new Promise(done => {
      release = done;
    });

    expect(
      await canEach(
        ["update-posts", "manage-seo"],
        access => access.hasAnswer && access.content.isLoading
      )
    ).toEqual({ "update-posts": false, "manage-seo": true });
    release();
  });
});
