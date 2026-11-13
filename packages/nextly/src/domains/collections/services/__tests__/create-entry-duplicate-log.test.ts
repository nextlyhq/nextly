/**
 * What a failed entry create logs. A duplicate (409) is thrown to the caller,
 * which receives it and decides, as a plugin recording one row from several
 * build workers at once does: logging it as a warning too says something
 * went wrong when nothing did. It is logged at debug. Every other failure is
 * still a warning.
 */
import { describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../../errors/nextly-error";
import type { Logger } from "../../../../services/shared";
import type { CollectionEntryService } from "../../../../services/collections/collection-entry-service";
import type { CollectionMetadataService } from "../collection-metadata-service";
import { CollectionService } from "../collection-service";

function serviceAnswering(answer: { statusCode: number; message: string }) {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const entries = {
    createEntry: vi.fn(async () => ({ success: false, ...answer })),
  };
  const service = new CollectionService(
    {} as DrizzleAdapter,
    logger as unknown as Logger,
    {} as CollectionMetadataService,
    entries as unknown as CollectionEntryService
  );
  return { service, logger };
}

describe("a failed entry create", () => {
  it("logs a duplicate at debug, not as a warning, and still throws it", async () => {
    const { service, logger } = serviceAnswering({
      statusCode: 409,
      code: "DUPLICATE",
      message: "Resource already exists.",
    });
    const failure = await service
      .createEntry("nx_seo_code_pages", { path: "/pricing" }, {})
      .catch((error: unknown) => error);

    expect(NextlyError.isCode(failure, "DUPLICATE")).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      "Entry creation failed",
      expect.objectContaining({ statusCode: 409 })
    );
  });

  it("still warns of any other failure", async () => {
    const { service, logger } = serviceAnswering({
      statusCode: 500,
      message: "The database is unreachable.",
    });
    await expect(
      service.createEntry("posts", { title: "Hello" }, {})
    ).rejects.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      "Entry creation failed",
      expect.objectContaining({ statusCode: 500 })
    );
  });
});
