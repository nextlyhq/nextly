/**
 * Publishing every language judges what goes live BEFORE it writes anything.
 *
 * The judgement is the publish's precondition. Run after the status write, a
 * refusal would undo a write that already happened, which only a rollback
 * makes look the same; the order is what this pins.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it, vi } from "vitest";

import type { Logger } from "../../../shared/types";

import { SinglePublishAllService } from "./single-publish-all";
import type { SingleQueryService } from "./single-query-service";
import type { SingleRegistryService } from "./single-registry-service";

/** The transaction body, which every attempt of the publish runs. */
interface CommitsPublish {
  commitPublish(
    tx: TransactionContext,
    plan: Record<string, unknown>,
    options: Record<string, unknown>,
    refused: { denied?: unknown }
  ): Promise<unknown>;
}

describe("publishing every language of a Single", () => {
  it("writes no status when the judgement of what goes live refuses", async () => {
    // A required field the stored row does not hold: judged whole as it goes
    // live, the document is refused.
    const fields = [{ name: "title", type: "text", required: true }];
    const update = vi.fn(async () => []);
    const tx = {
      // The locked main row: a draft, so the publish moves it.
      selectOne: vi.fn(async () => ({ id: "s1", status: "draft" })),
      update,
      // The executor the gate's stored reads would run on; none run here.
      getDrizzle: () => ({}),
    } as unknown as TransactionContext;
    const service = new SinglePublishAllService(
      {} as DrizzleAdapter,
      {} as Logger,
      {} as SingleRegistryService,
      undefined,
      undefined,
      undefined,
      {
        deserializeJsonFields: (doc: unknown) => doc,
      } as unknown as SingleQueryService
    ) as unknown as CommitsPublish;
    const plan = {
      slug: "landing",
      singleMeta: { tableName: "single_landing", fields },
      existingDoc: { id: "s1" },
      hasMainStatus: true,
      companion: null,
      companionPublishable: false,
      fieldConfigs: fields,
      recordingEnabled: false,
      actor: null,
    };

    // A trusted call, so the publish permission (asked first, inside the same
    // transaction) admits it and the judgement of what goes live is reached.
    await expect(
      service.commitPublish(tx, plan, { overrideAccess: true }, {})
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    // Refused before any write.
    expect(update).not.toHaveBeenCalled();
  });
});
