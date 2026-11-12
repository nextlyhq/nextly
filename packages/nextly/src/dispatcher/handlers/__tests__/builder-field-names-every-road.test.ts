/**
 * The Builder's field-name rule on every schema road of the admin's
 * dispatcher: a name the entity already holds keeps working whatever its
 * case (a plugin or the API may have made it camelCase, and the admin sends
 * every field on each save), and a camelCase name it does not hold yet is
 * refused with `INVALID_FIELD_NAME`.
 *
 * The registries are stubbed to hold the entity with camelCase fields, and
 * the schema lock runs its work at once. What happens past the name check is
 * not judged here: with no database registered a road stops further on, so
 * the kept case asserts only that the refusal it got is not the name's.
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

/** The entity's fields as stored: camelCase, at the top level and in a group. */
const STORED = [
  { name: "firstName", type: "text" },
  {
    name: "seo",
    type: "group",
    fields: [{ name: "metaTitle", type: "text" }],
  },
];
const stored = (slug: string, tableName: string) => ({
  slug,
  tableName,
  fields: STORED,
  schemaVersion: 1,
});

beforeEach(() => {
  const single = stored("site-settings", "single_site_settings");
  vi.mocked(getSingleRegistryFromDI).mockReturnValue({
    getSingleBySlug: vi.fn().mockResolvedValue(single),
    getSingleForWrite: vi.fn().mockResolvedValue(single),
  } as unknown as ReturnType<typeof getSingleRegistryFromDI>);
  vi.mocked(getSingleEntryServiceFromDI).mockReturnValue(
    {} as unknown as ReturnType<typeof getSingleEntryServiceFromDI>
  );
  vi.mocked(getSingleMetadataServiceFromDI).mockReturnValue(
    {} as unknown as ReturnType<typeof getSingleMetadataServiceFromDI>
  );
  vi.mocked(getCollectionRegistryFromDI).mockReturnValue({
    getCollectionBySlug: vi
      .fn()
      .mockResolvedValue(stored("people", "dc_people")),
  } as unknown as ReturnType<typeof getCollectionRegistryFromDI>);
  const component = stored("seo", "comp_seo");
  vi.mocked(getComponentRegistryFromDI).mockReturnValue({
    getComponent: vi.fn().mockResolvedValue(component),
    getComponentForWrite: vi.fn().mockResolvedValue(component),
  } as unknown as ReturnType<typeof getComponentRegistryFromDI>);
});

/** Each road, run with `fields` as its payload. */
const ROADS: Array<[string, (fields: unknown[]) => Promise<unknown>]> = [
  [
    "collection preview",
    fields =>
      dispatchCollections(
        {} as ServiceContainer,
        "previewSchemaChanges",
        { collectionName: "people" },
        { fields }
      ),
  ],
  [
    "collection apply",
    fields =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "people" },
        { fields, confirmed: true }
      ),
  ],
  [
    "Single save",
    fields =>
      dispatchSingles(
        "updateSingleSchema",
        { slug: "site-settings" },
        { fields }
      ),
  ],
  [
    "Single preview",
    fields =>
      dispatchSingles(
        "previewSingleSchemaChanges",
        { slug: "site-settings" },
        { fields }
      ),
  ],
  [
    "Single apply",
    fields =>
      dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "site-settings" },
        { fields, confirmed: true }
      ),
  ],
  [
    "field group preview",
    fields =>
      dispatchComponents(
        "previewComponentSchemaChanges",
        { slug: "seo" },
        { fields }
      ),
  ],
  [
    "field group apply",
    fields =>
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "seo" },
        { fields, confirmed: true }
      ),
  ],
];

/** Whether `outcome` is the refusal of a field's name. */
function refusedForName(outcome: unknown): boolean {
  const errors = (
    outcome as { publicData?: { errors?: Array<{ code?: string }> } }
  )?.publicData?.errors;
  return (errors ?? []).some(error => error.code === "INVALID_FIELD_NAME");
}

const outcomeOf = (run: Promise<unknown>) =>
  run.then(
    () => undefined,
    (error: unknown) => error
  );

describe("the Builder's field names on every dispatcher road", () => {
  it.each(ROADS)(
    "%s keeps the camelCase names the entity holds",
    async (_road, run) => {
      expect(refusedForName(await outcomeOf(run(STORED)))).toBe(false);
    }
  );

  it.each(ROADS)(
    "%s refuses a camelCase name the entity does not hold",
    async (_road, run) => {
      const outcome = await outcomeOf(
        run([...STORED, { name: "lastName", type: "text" }])
      );
      expect(refusedForName(outcome)).toBe(true);
    }
  );
});
