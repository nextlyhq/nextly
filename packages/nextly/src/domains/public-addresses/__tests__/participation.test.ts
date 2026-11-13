/**
 * Keeping which plugins take part never fails a start: what it keeps only
 * makes participants check their records again, so a database refusing it
 * is logged, and the start goes on with the count it read.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MetaService } from "../../meta/services/meta-service";
import {
  addParticipant,
  removeParticipant,
  type ParticipantRunner,
} from "../participants";
import { participationCount, recordStartParticipation } from "../participation";

const runner = {} as ParticipantRunner;

afterEach(() => {
  removeParticipant(runner);
});

describe("keeping the participation at a start", () => {
  it("logs a refusal and goes on with the count the start read", async () => {
    addParticipant(runner, "plugin:@test/refused");
    const refusal = new Error("duplicate key value violates unique constraint");
    const meta = {
      insertIfAbsent: vi.fn(() => Promise.reject(refusal)),
    } as unknown as MetaService;
    const adapter = {
      transaction: vi.fn(),
    } as unknown as DrizzleAdapter;
    const warn = vi.fn();

    await expect(
      recordStartParticipation(
        adapter,
        meta,
        { owners: ["plugin:@test/earlier"], count: 4 },
        { warn }
      )
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not be recorded at start")
    );
    expect(participationCount()).toBe(4);
  });
});
