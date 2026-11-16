/**
 * Two options sharing one value are refused on the dispatcher's direct create and update roads,
 * which persist and run DDL without the Builder's preview and apply: a collection's create and
 * update, a Single's create and a field group's create. Refused with `DUPLICATE` before anything
 * is stored; options each with a value of their own are not refused for it.
 *
 * The services are stubbed. What happens past the check is not judged here: with no database
 * registered a road may stop further on, so the accepted case asserts only that the refusal it got,
 * if any, is not this one.
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

import type { ServiceContainer } from "../../../services";
import {
  getCollectionsHandlerFromDI,
  getComponentRegistryFromDI,
  getSingleEntryServiceFromDI,
  getSingleMetadataServiceFromDI,
  getSingleRegistryFromDI,
} from "../../helpers/di";
import { dispatchCollections } from "../collection-dispatcher";
import { dispatchComponents } from "../component-dispatcher";
import { dispatchSingles } from "../single-dispatcher";

const choice = (second: string) => [
  {
    name: "kind",
    type: "select",
    options: [
      { label: "News", value: "news" },
      { label: "Review", value: second },
    ],
  },
];
const REPEATED = choice("news");
const DISTINCT = choice("review");

const collections = {
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
};

beforeEach(() => {
  collections.createCollection
    .mockReset()
    .mockResolvedValue({ success: true, data: {} });
  collections.updateCollection
    .mockReset()
    .mockResolvedValue({ success: true, data: {} });
  vi.mocked(getCollectionsHandlerFromDI).mockReturnValue(
    collections as unknown as ReturnType<typeof getCollectionsHandlerFromDI>
  );
  // A Single's and a field group's roads look their services up before reading the request.
  vi.mocked(getSingleRegistryFromDI).mockReturnValue(
    {} as unknown as ReturnType<typeof getSingleRegistryFromDI>
  );
  vi.mocked(getSingleEntryServiceFromDI).mockReturnValue(
    {} as unknown as ReturnType<typeof getSingleEntryServiceFromDI>
  );
  vi.mocked(getSingleMetadataServiceFromDI).mockReturnValue(
    {} as unknown as ReturnType<typeof getSingleMetadataServiceFromDI>
  );
  vi.mocked(getComponentRegistryFromDI).mockReturnValue(
    {} as unknown as ReturnType<typeof getComponentRegistryFromDI>
  );
});

/** Each road, run with `fields` as its payload, and the service call it would persist through. */
const ROADS: Array<
  [string, (fields: unknown[]) => Promise<unknown>, (() => unknown) | null]
> = [
  [
    "collection create",
    fields =>
      dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: "articles",
          fields,
        }
      ),
    () => collections.createCollection,
  ],
  [
    "collection update",
    fields =>
      dispatchCollections(
        {} as ServiceContainer,
        "updateCollection",
        { collectionName: "articles" },
        { fields }
      ),
    () => collections.updateCollection,
  ],
  [
    "Single create",
    fields =>
      dispatchSingles(
        "createSingle",
        {},
        { slug: "homepage", label: "Homepage", fields }
      ),
    null,
  ],
  [
    "field group create",
    fields =>
      dispatchComponents(
        "createComponent",
        {},
        { slug: "card", label: "Card", fields }
      ),
    null,
  ],
];

/** Whether `outcome` is the refusal of a repeated option value. */
function refusedForRepeat(outcome: unknown): boolean {
  const errors = (
    outcome as { publicData?: { errors?: Array<{ code?: string }> } }
  )?.publicData?.errors;
  return (errors ?? []).some(error => error.code === "DUPLICATE");
}

const outcomeOf = (run: Promise<unknown>) =>
  run.then(
    () => undefined,
    (error: unknown) => error
  );

describe("repeated option values on the dispatcher's direct roads", () => {
  it.each(ROADS)(
    "%s refuses two options with one value, storing nothing",
    async (_road, run, persists) => {
      expect(refusedForRepeat(await outcomeOf(run(REPEATED)))).toBe(true);
      if (persists) expect(persists()).not.toHaveBeenCalled();
    }
  );

  it.each(ROADS)(
    "%s does not refuse options each with a value of their own",
    async (_road, run) => {
      expect(refusedForRepeat(await outcomeOf(run(DISTINCT)))).toBe(false);
    }
  );
});
