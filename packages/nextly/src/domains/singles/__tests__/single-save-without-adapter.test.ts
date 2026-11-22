/**
 * A Single's settings save with no database adapter, a configuration the service supports: its
 * statements are generated and never run. A save that sends no fields is asked nothing of a
 * translation move, whether it keeps translation as it was or toggles it, since nothing it could
 * move would run.
 */
import { describe, expect, it, vi } from "vitest";

import { SingleMetadataService } from "../services/single-metadata-service";

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

/** The service with no adapter, its translation preflight reached directly. */
const service = new SingleMetadataService(
  {} as never,
  logger as never
) as unknown as {
  assertFieldsMayLeaveTranslation(input: unknown): Promise<void>;
};

const save = (wasLocalized: boolean, isLocalized: boolean) => ({
  slug: "hero",
  fields: undefined,
  wasLocalized,
  isLocalized,
  existing: {
    tableName: "single_hero",
    fields: [{ name: "heading", type: "text" }],
  },
});

describe("a Single save with no database adapter that sends no fields", () => {
  it("asks nothing when it keeps a translated Single translated", async () => {
    await expect(
      service.assertFieldsMayLeaveTranslation(save(true, true))
    ).resolves.toBeUndefined();
  });

  it("asks nothing when it turns translation on, as it never could without an adapter", async () => {
    await expect(
      service.assertFieldsMayLeaveTranslation(save(false, true))
    ).resolves.toBeUndefined();
  });
});
