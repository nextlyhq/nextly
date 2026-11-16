/**
 * The lists of collections, Singles and field groups, asked for the site's own
 * entities or for the plugins'.
 *
 * The owner reaches the registry as slug lists on the QUERY, so the count and
 * the page describe the same rows: the site's list denies the plugins' slugs,
 * the plugins' list narrows the reader's allowlist to them. Observed at the
 * registry call, because only there can a list become a condition both reads
 * share.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../helpers/di", () => ({
  getSingleRegistryFromDI: vi.fn(),
  getSingleEntryServiceFromDI: vi.fn(),
  getSingleMetadataServiceFromDI: vi.fn(),
  getComponentRegistryFromDI: vi.fn(),
  getFieldGroupMetadataServiceFromDI: vi.fn(),
  getAdapterFromDI: vi.fn().mockReturnValue(undefined),
  getLoggerFromDI: vi.fn(),
  getCollectionsHandlerFromDI: vi.fn(),
}));

vi.mock("../../../di/container", () => ({
  container: { has: vi.fn().mockReturnValue(false), get: vi.fn() },
}));

// The plugins the dispatchers read the owned slugs from: one plugin whose
// collection and Single a host renamed. Only `getHandlerConfig`, the one
// export the list dispatchers read, so the test does not load the module
// itself, which reaches the auth routes and every plugin's context.
vi.mock("../../../route-handler/auth-handler", () => ({
  getHandlerConfig: () => ({
    plugins: [
      {
        name: "@acme/plugin-forms",
        version: "1.0.0",
        contributes: {
          collections: [{ slug: "forms" }],
          singles: [{ slug: "settings" }],
          fieldGroups: [{ slug: "address" }],
        },
        renameMap: { forms: "contact-forms", settings: "form-settings" },
      },
    ],
  }),
}));

vi.mock("../../../services/lib/readable-slug-allowlist", () => ({
  readableSlugAllowlist: vi.fn(),
}));

// The removed-from-code mark reads the database; these lists hand rows back
// as they came.
vi.mock("../../helpers/removed-from-code-marks", () => ({
  withRemovedFromCodeMarks: async (_kind: string, items: unknown[]) => items,
}));

import type { ServiceContainer } from "../../../services";
import { readableSlugAllowlist } from "../../../services/lib/readable-slug-allowlist";
import {
  getComponentRegistryFromDI,
  getFieldGroupMetadataServiceFromDI,
  getSingleEntryServiceFromDI,
  getSingleMetadataServiceFromDI,
  getSingleRegistryFromDI,
} from "../../helpers/di";
import { asCaller, sessionCaller } from "../../__tests__/request-caller";
import { dispatchCollections } from "../collection-dispatcher";
import { dispatchComponents } from "../component-dispatcher";
import { dispatchSingles } from "../single-dispatcher";

const allowlistFor = vi.mocked(readableSlugAllowlist);

beforeEach(() => {
  vi.clearAllMocks();
});

async function listCollectionsWith(
  owner: string,
  allowlist: string[] | undefined
): Promise<{
  call: Record<string, unknown>;
  body: { meta: { total: number } };
}> {
  allowlistFor.mockResolvedValue(allowlist);
  const listCollections = vi.fn().mockResolvedValue({
    success: true,
    statusCode: 200,
    message: "ok",
    data: [{ slug: "posts", name: "posts" }],
    meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
  });
  const response = (await asCaller(sessionCaller({ userId: "u1" }), () =>
    dispatchCollections(
      { collections: { listCollections } } as unknown as ServiceContainer,
      "listCollections",
      { page: "1", limit: "10", owner },
      undefined
    )
  )) as Response;
  return {
    call: listCollections.mock.calls[0][0] as Record<string, unknown>,
    body: (await response.json()) as { meta: { total: number } },
  };
}

describe("listCollections by owner", () => {
  it("the site's list denies the plugins' registered slugs and keeps the allowlist", async () => {
    const { call, body } = await listCollectionsWith("site", ["posts"]);

    expect(call.slugAllowlist).toEqual(["posts"]);
    expect(call.slugDenylist).toEqual(["contact-forms"]);
    // The total is the service's, counted under the same lists as the page.
    expect(body.meta.total).toBe(1);
  });

  it("the plugins' list narrows the allowlist to the plugins' slugs", async () => {
    const { call } = await listCollectionsWith("plugins", [
      "posts",
      "contact-forms",
    ]);

    expect(call.slugAllowlist).toEqual(["contact-forms"]);
    expect(call.slugDenylist).toBeUndefined();
  });

  it("the plugins' list gives a reader allowed no plugin collection nothing", async () => {
    const { call } = await listCollectionsWith("plugins", ["posts"]);

    expect(call.slugAllowlist).toEqual([]);
  });

  it("refuses an owner it does not know, before the registry is asked", async () => {
    allowlistFor.mockResolvedValue(undefined);
    const listCollections = vi.fn();

    const response = (await asCaller(sessionCaller({ userId: "u1" }), () =>
      dispatchCollections(
        { collections: { listCollections } } as unknown as ServiceContainer,
        "listCollections",
        { owner: "everyone" },
        undefined
      ).catch((error: unknown) => error)
    )) as unknown;

    expect(listCollections).not.toHaveBeenCalled();
    expect(response).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("listSingles by owner", () => {
  function wireSingles(listSingles: ReturnType<typeof vi.fn>) {
    vi.mocked(getSingleRegistryFromDI).mockReturnValue({
      listSingles,
    } as unknown as ReturnType<typeof getSingleRegistryFromDI>);
    vi.mocked(getSingleEntryServiceFromDI).mockReturnValue(
      {} as unknown as ReturnType<typeof getSingleEntryServiceFromDI>
    );
    vi.mocked(getSingleMetadataServiceFromDI).mockReturnValue(
      {} as unknown as ReturnType<typeof getSingleMetadataServiceFromDI>
    );
  }

  it("the site's list denies the renamed plugin Single", async () => {
    allowlistFor.mockResolvedValue(undefined);
    const listSingles = vi.fn().mockResolvedValue({ data: [], total: 0 });
    wireSingles(listSingles);

    await asCaller(sessionCaller({ userId: "u1" }), () =>
      dispatchSingles("listSingles", { limit: "10", owner: "site" }, undefined)
    );

    expect(listSingles.mock.calls[0][0]).toMatchObject({
      slugAllowlist: undefined,
      slugDenylist: ["form-settings"],
    });
  });

  it("the plugins' list keeps only the plugin Singles the reader may read", async () => {
    allowlistFor.mockResolvedValue(["about"]);
    const listSingles = vi.fn().mockResolvedValue({ data: [], total: 0 });
    wireSingles(listSingles);

    await asCaller(sessionCaller({ userId: "u1" }), () =>
      dispatchSingles(
        "listSingles",
        { limit: "10", owner: "plugins" },
        undefined
      )
    );

    expect(listSingles.mock.calls[0][0].slugAllowlist).toEqual([]);
    expect(listSingles.mock.calls[0][0].slugDenylist).toBeUndefined();
  });
});

describe("listComponents by owner", () => {
  function wireComponents(listComponents: ReturnType<typeof vi.fn>) {
    vi.mocked(getComponentRegistryFromDI).mockReturnValue({
      listComponents,
    } as unknown as ReturnType<typeof getComponentRegistryFromDI>);
    vi.mocked(getFieldGroupMetadataServiceFromDI).mockReturnValue(
      {} as unknown as ReturnType<typeof getFieldGroupMetadataServiceFromDI>
    );
  }

  it("the site's list denies the plugins' field groups", async () => {
    const listComponents = vi.fn().mockResolvedValue({ data: [], total: 0 });
    wireComponents(listComponents);

    await dispatchComponents(
      "listComponents",
      { limit: "10", owner: "site" },
      undefined
    );

    expect(listComponents.mock.calls[0][0]).toMatchObject({
      slugDenylist: ["address"],
    });
    expect(listComponents.mock.calls[0][0].slugAllowlist).toBeUndefined();
  });

  it("the plugins' list asks for the plugins' field groups alone", async () => {
    const listComponents = vi.fn().mockResolvedValue({ data: [], total: 0 });
    wireComponents(listComponents);

    await dispatchComponents(
      "listComponents",
      { limit: "10", owner: "plugins" },
      undefined
    );

    expect(listComponents.mock.calls[0][0].slugAllowlist).toEqual(["address"]);
  });
});
