/**
 * Two options sharing one value are refused on the dispatcher's direct collection create and
 * update, which persist and run DDL without the Builder's preview and apply. Refused with
 * `DUPLICATE` before the collection service is called; options each with a value of their own
 * are not refused for it.
 *
 * A field group's and a Single's writes are judged where every road to them meets, their metadata
 * services (`repeated-option-values-every-writer.integration.test.ts`); a collection's meet in
 * `CollectionMetadataService`, which does not judge this yet, so the dispatcher's routes do.
 *
 * The collection service is stubbed: what happens past the check is not judged here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../helpers/di", () => ({
  getCollectionRegistryFromDI: vi.fn(),
  getCollectionsHandlerFromDI: vi.fn(),
  getAdapterFromDI: vi.fn(),
  getLoggerFromDI: vi.fn(),
  getConfigFromDI: vi.fn(() => undefined),
  getSchemaRegistryFromDI: vi.fn(() => undefined),
}));

vi.mock("../../../di/container", () => ({
  container: { has: vi.fn(() => false), get: vi.fn(() => undefined) },
}));

import type { ServiceContainer } from "../../../services";
import { getCollectionsHandlerFromDI } from "../../helpers/di";
import { dispatchCollections } from "../collection-dispatcher";

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
});

/** Each route, run with `fields` as its payload, and the service call it persists through. */
const ROADS: Array<
  [string, (fields: unknown[]) => Promise<unknown>, () => unknown]
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

describe("repeated option values on the dispatcher's direct collection routes", () => {
  it.each(ROADS)(
    "%s refuses two options with one value, calling no service",
    async (_road, run, persists) => {
      expect(refusedForRepeat(await outcomeOf(run(REPEATED)))).toBe(true);
      expect(persists()).not.toHaveBeenCalled();
    }
  );

  it.each(ROADS)(
    "%s passes options each with a value of their own to the service",
    async (_road, run, persists) => {
      expect(refusedForRepeat(await outcomeOf(run(DISTINCT)))).toBe(false);
      expect(persists()).toHaveBeenCalledTimes(1);
    }
  );
});
