/**
 * A code-field sync that loses a race on a duplicate runs once more.
 *
 * Processes starting at once each insert a code field another process wrote
 * first; the loser's transaction rolls back, and every other change in it with
 * it, a changed `maxLength` say. Running the sync again from the rows now
 * stored writes those changes. Anything other than a duplicate is not retried,
 * and a second duplicate, such as a name an admin's own field holds, is
 * reported.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it, vi } from "vitest";

import type { Logger } from "../../../../services/shared";
import { UserFieldDefinitionService } from "../user-field-definition-service";

const FIELDS = [
  { name: "bio", type: "text", maxLength: 50 },
  { name: "company", type: "text" },
];

/** A duplicate key as the SQLite driver raises it. */
function duplicateKey(): Error {
  return Object.assign(new Error("UNIQUE constraint failed: name"), {
    code: "SQLITE_CONSTRAINT_UNIQUE",
  });
}

/** One sync attempt, as the service makes it. */
interface WritesCodeFields {
  writeCodeFields(fields: typeof FIELDS): Promise<void>;
}

function setUp(...attempts: Array<Error | undefined>) {
  const adapter = {
    getCapabilities: () => ({ dialect: "sqlite" }),
  } as unknown as DrizzleAdapter;
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
  const service = new UserFieldDefinitionService(adapter, logger);
  const write = vi.spyOn(
    service as unknown as WritesCodeFields,
    "writeCodeFields"
  );
  for (const attempt of attempts) {
    if (attempt) write.mockRejectedValueOnce(attempt);
    else write.mockResolvedValueOnce(undefined);
  }
  return { service, write, logger };
}

describe("syncCodeFields after a lost race", () => {
  it("syncs once more from the stored rows when the first attempt hit a duplicate", async () => {
    const { service, write, logger } = setUp(duplicateKey(), undefined);

    await expect(service.syncCodeFields(FIELDS)).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenNthCalledWith(2, FIELDS);
    expect(logger.debug).toHaveBeenCalled();
  });

  it("does not retry any other failure", async () => {
    const failure = new Error("disk I/O error");
    const { service, write } = setUp(failure);

    await expect(service.syncCodeFields(FIELDS)).rejects.toBe(failure);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("reports a duplicate that survives the retry, without a third attempt", async () => {
    const second = duplicateKey();
    const { service, write } = setUp(duplicateKey(), second);

    await expect(service.syncCodeFields(FIELDS)).rejects.toBe(second);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
