/**
 * The admin's schema routes refuse a collection, Single or component defined
 * in code as the registries do: 403 FORBIDDEN, saying it is defined in code.
 *
 * Each route checks the lock itself before it reaches its registry, so a
 * refusal there is the one the caller gets. Thrown as a bare error, it was
 * answered as an internal error (500).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../helpers/di", () => ({
  getSingleRegistryFromDI: vi.fn(),
  getSingleEntryServiceFromDI: vi.fn(),
  getSingleMetadataServiceFromDI: vi.fn(),
  getComponentRegistryFromDI: vi.fn(),
  getCollectionRegistryFromDI: vi.fn(),
  getCollectionsHandlerFromDI: vi.fn(),
  getFieldGroupMetadataServiceFromDI: vi.fn(),
  getAdapterFromDI: vi.fn(),
  getLoggerFromDI: vi.fn(),
  getConfigFromDI: vi.fn(() => undefined),
  getSchemaRegistryFromDI: vi.fn(() => undefined),
}));

vi.mock("../../../di/container", () => ({
  container: { has: vi.fn(() => false), get: vi.fn(() => undefined) },
}));

// The exclusion is not what is judged here: it runs the guarded work at once.
vi.mock(
  "../../../domains/schema/services/schema-change-exclusion",
  async importOriginal => ({
    ...(await importOriginal<object>()),
    withSchemaChangeExcluded: (_opts: unknown, work: () => unknown) => work(),
  })
);

import type { ServiceContainer } from "../../../services";
import {
  getCollectionRegistryFromDI,
  getComponentRegistryFromDI,
  getSingleEntryServiceFromDI,
  getSingleMetadataServiceFromDI,
  getSingleRegistryFromDI,
} from "../../helpers/di";
import { dispatchCollections } from "../collection-dispatcher";
import { dispatchComponents } from "../component-dispatcher";
import { dispatchSingles } from "../single-dispatcher";

const lockedSingle = {
  slug: "site-settings",
  tableName: "single_site_settings",
  locked: true,
};
const lockedCollection = { slug: "posts", locked: true };
const lockedComponent = { slug: "seo", locked: true };

beforeEach(() => {
  vi.mocked(getSingleRegistryFromDI).mockReturnValue({
    getSingleBySlug: vi.fn().mockResolvedValue(lockedSingle),
  } as unknown as ReturnType<typeof getSingleRegistryFromDI>);
  vi.mocked(getSingleEntryServiceFromDI).mockReturnValue(
    {} as unknown as ReturnType<typeof getSingleEntryServiceFromDI>
  );
  vi.mocked(getSingleMetadataServiceFromDI).mockReturnValue(
    {} as unknown as ReturnType<typeof getSingleMetadataServiceFromDI>
  );
  vi.mocked(getCollectionRegistryFromDI).mockReturnValue({
    getCollectionBySlug: vi.fn().mockResolvedValue(lockedCollection),
  } as unknown as ReturnType<typeof getCollectionRegistryFromDI>);
  vi.mocked(getComponentRegistryFromDI).mockReturnValue({
    getComponent: vi.fn().mockResolvedValue(lockedComponent),
  } as unknown as ReturnType<typeof getComponentRegistryFromDI>);
});

const changed = (thing: string) => ({
  code: "FORBIDDEN",
  statusCode: 403,
  publicMessage: `This ${thing} is defined in code, so it can't be changed here.`,
});

describe("a schema route asked to change something defined in code", () => {
  it.each([
    "updateSingleSchema",
    "previewSingleSchemaChanges",
    "applySingleSchemaChanges",
  ])("refuses a Single's %s as defined in code", async method => {
    await expect(
      dispatchSingles(method, { slug: "site-settings" }, { fields: [] })
    ).rejects.toMatchObject(changed("Single"));
  });

  it("refuses a Single's delete as defined in code", async () => {
    await expect(
      dispatchSingles("deleteSingle", { slug: "site-settings" }, {})
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
      publicMessage:
        "This Single is defined in code, so it can't be deleted here.",
    });
  });

  it.each(["previewSchemaChanges", "applySchemaChanges"])(
    "refuses a collection's %s as defined in code",
    async method => {
      await expect(
        dispatchCollections(
          {} as ServiceContainer,
          method,
          { collectionName: "posts" },
          { fields: [] }
        )
      ).rejects.toMatchObject(changed("collection"));
    }
  );

  it.each(["previewComponentSchemaChanges", "applyComponentSchemaChanges"])(
    "refuses a component's %s as defined in code",
    async method => {
      await expect(
        dispatchComponents(
          method,
          { slug: "seo" },
          // Confirmed, so the apply gets past what its body alone decides.
          { fields: [], confirmed: true }
        )
      ).rejects.toMatchObject(changed("component"));
    }
  );
});
