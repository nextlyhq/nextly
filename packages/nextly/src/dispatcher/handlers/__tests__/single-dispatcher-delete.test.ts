/**
 * What a delete is allowed to call a success.
 *
 * Deleting a Single is two removals — its storage, then its registry row — and only the second may
 * be missing without that being a failure. A row another request already took is the state this
 * asks for; storage that would not go away is not, however its driver phrases the refusal.
 *
 * The distinction is easy to lose because both arrive as an exception, and a handler that reads the
 * MESSAGE cannot tell them apart: a dropped table that "does not exist" and a registry row that is
 * already gone can word themselves the same way. Answering 200 to the first leaves the row present
 * and the storage half removed, which is precisely the state the delete's ordering exists to avoid,
 * and it leaves it while telling the caller the Single is gone.
 *
 * These drive the dispatcher rather than the service because the classification is the dispatcher's:
 * it decides what reaches the caller.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../helpers/di", () => ({
  getSingleRegistryFromDI: vi.fn(),
  getSingleEntryServiceFromDI: vi.fn(),
  getSingleMetadataServiceFromDI: vi.fn(),
  getComponentRegistryFromDI: vi.fn().mockReturnValue(undefined),
  getAdapterFromDI: vi.fn(),
  getConfigFromDI: vi.fn(() => undefined),
  getSchemaRegistryFromDI: vi.fn(() => undefined),
}));

vi.mock("../../../di/container", () => ({
  container: {
    has: vi.fn(() => false),
    get: vi.fn(() => undefined),
  },
}));

import { SingleMetadataService } from "../../../domains/singles/services/single-metadata-service";
import type { SingleRegistryService } from "../../../domains/singles/services/single-registry-service";
import { NextlyError } from "../../../errors";
import type { Logger } from "../../../shared/types";
import {
  getSingleEntryServiceFromDI,
  getSingleMetadataServiceFromDI,
  getSingleRegistryFromDI,
} from "../../helpers/di";
import { dispatchSingles } from "../single-dispatcher";

const SLUG = "site_settings";

/**
 * A registry reporting one unlocked Single, so the delete gets past its own preconditions and
 * reaches the removal being tested.
 */
function wireRegistry(deleteSingle: () => Promise<void>) {
  const registry = {
    getSingleBySlug: vi.fn().mockResolvedValue({
      slug: SLUG,
      tableName: `single_${SLUG}`,
      locked: false,
    }),
    deleteSingle: vi.fn(deleteSingle),
  };
  vi.mocked(getSingleRegistryFromDI).mockReturnValue(
    registry as unknown as ReturnType<typeof getSingleRegistryFromDI>
  );
  vi.mocked(getSingleEntryServiceFromDI).mockReturnValue({
    get: vi.fn(),
    update: vi.fn(),
  } as unknown as ReturnType<typeof getSingleEntryServiceFromDI>);
  return registry;
}

function wireMetadata(deleteSingle: () => Promise<void>) {
  const metadata = { deleteSingle: vi.fn(deleteSingle) };
  vi.mocked(getSingleMetadataServiceFromDI).mockReturnValue(
    metadata as unknown as ReturnType<typeof getSingleMetadataServiceFromDI>
  );
  return metadata;
}

beforeEach(() => {
  vi.mocked(getSingleRegistryFromDI).mockReset();
  vi.mocked(getSingleEntryServiceFromDI).mockReset();
  vi.mocked(getSingleMetadataServiceFromDI).mockReset();
});

describe("deleteSingle reports what actually happened", () => {
  it("removes the storage and the row when both succeed", async () => {
    wireRegistry(async () => {});
    const metadata = wireMetadata(async () => {});

    await expect(
      dispatchSingles("deleteSingle", { slug: SLUG }, {})
    ).resolves.toBeDefined();

    expect(metadata.deleteSingle).toHaveBeenCalledWith(SLUG, `single_${SLUG}`);
  });

  it("fails when the storage will not go away, however the failure is worded", async () => {
    // Phrased the way a driver reports a missing object on purpose. The wording is the whole point:
    // a handler classifying by message reads this as "already deleted" and answers success, leaving
    // the registry row behind.
    wireRegistry(async () => {});
    wireMetadata(async () => {
      throw new Error(`relation "single_${SLUG}" not found`);
    });

    await expect(
      dispatchSingles("deleteSingle", { slug: SLUG }, {})
    ).rejects.toThrow(/not found/);
  });
});

/**
 * The other half of the same rule, one layer down.
 *
 * Driven with no table name, which is the shape of a Single that never had storage: the teardown
 * and the drop are skipped entirely, so what remains is the registry step alone and the tolerance
 * can be observed without standing up a database to reach it.
 */
describe("the metadata service tolerates one failure and no others", () => {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  function serviceOver(deleteSingle: () => Promise<void>) {
    const registry = { deleteSingle: vi.fn(deleteSingle) };
    return {
      registry,
      service: new SingleMetadataService(
        registry as unknown as SingleRegistryService,
        logger
      ),
    };
  }

  it("completes when the row was already taken", async () => {
    // `NextlyError.notFound` is what the registry raises for a row that is gone: a typed answer
    // rather than a phrase, which is the only reason it can be told apart from a storage failure
    // that happens to describe something missing.
    const { registry, service } = serviceOver(async () => {
      throw NextlyError.notFound({ logContext: { slug: SLUG } });
    });

    await expect(
      service.deleteSingle(SLUG, undefined)
    ).resolves.toBeUndefined();
    expect(registry.deleteSingle).toHaveBeenCalled();
  });

  it("fails when the registry refuses for any other reason", async () => {
    // The tolerance is for one code, not for the registry generally.
    const { service } = serviceOver(async () => {
      throw NextlyError.forbidden({ logContext: { slug: SLUG } });
    });

    await expect(service.deleteSingle(SLUG, undefined)).rejects.toThrow();
  });
});
