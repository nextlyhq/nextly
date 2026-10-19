/**
 * A Single's default document, created on its first read, when another process
 * creates it first.
 *
 * Several processes reading a Single for the first time at once each find no
 * row and each try to create it; the table's unique slug lets one insert win.
 * A reader whose insert lost takes the document that won, with nothing logged
 * above debug. Any other failure is still the read's failure.
 */
import { describe, expect, it, vi } from "vitest";

import { SingleQueryService } from "../services/single-query-service";

import {
  createMockAdapter,
  createMockHookRegistry,
  createMockSingleRegistry,
  createSilentLogger,
  siteSettingsMeta,
} from "./single-test-helpers";

type Ctor = ConstructorParameters<typeof SingleQueryService>;
type SingleMeta = Parameters<SingleQueryService["createDefaultDocument"]>[0];

/** The read path's creation step, reached as the read reaches it. */
interface CreatesOnce {
  createDefaultDocumentOnce(meta: SingleMeta): Promise<unknown>;
}

function setUp(stored: unknown, insertError: unknown) {
  const adapter = createMockAdapter({
    selectOne: vi.fn().mockResolvedValue(stored),
  });
  const logger = createSilentLogger();
  const service = new SingleQueryService(
    adapter as unknown as Ctor[0],
    logger as unknown as Ctor[1],
    createMockSingleRegistry() as unknown as Ctor[2],
    createMockHookRegistry() as unknown as Ctor[3]
  );
  vi.spyOn(service, "createDefaultDocument").mockRejectedValue(insertError);
  const meta = siteSettingsMeta({}) as unknown as SingleMeta;
  return {
    adapter,
    logger,
    create: () =>
      (service as unknown as CreatesOnce).createDefaultDocumentOnce(meta),
  };
}

/** A duplicate key as the SQLite driver raises it. */
function duplicateKey(): Error {
  return Object.assign(new Error("UNIQUE constraint failed: single.slug"), {
    code: "SQLITE_CONSTRAINT_UNIQUE",
  });
}

describe("a Single's default document created by another process first", () => {
  it("is read back and returned, logged at debug only", async () => {
    const winner = { id: "won", slug: "site-settings" };
    const { create, logger } = setUp(winner, duplicateKey());

    await expect(create()).resolves.toBe(winner);
    expect(logger.debug).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("still fails the read on a duplicate that leaves no row behind", async () => {
    const error = duplicateKey();
    const { create } = setUp(null, error);

    await expect(create()).rejects.toBe(error);
  });

  it("still fails the read on any other error, without reading back", async () => {
    const error = new Error("connection reset");
    const { create, adapter } = setUp({ id: "won" }, error);

    await expect(create()).rejects.toBe(error);
    expect(adapter.selectOne).not.toHaveBeenCalled();
  });
});
