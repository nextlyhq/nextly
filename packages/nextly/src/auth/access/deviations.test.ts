/**
 * A deviation keeps today's answer, and is recorded only where it changed the
 * decision's answer and only while a test listens.
 */
import { describe, expect, it, vi } from "vitest";

import { deviate, recordingDeviations } from "./deviations";

describe("a deviation", () => {
  it("answers today's answer, whatever the decision says", async () => {
    expect(await deviate("no-service", true, () => false)).toBe(true);
    expect(await deviate("no-service", false, () => true)).toBe(false);
  });

  it("does not ask the decision when nothing listens", async () => {
    const decided = vi.fn(() => false);
    await deviate("rule-alone-for-people", true, decided);
    expect(decided).not.toHaveBeenCalled();
  });

  it("is recorded only where it changed the answer", async () => {
    const { result, deviations } = await recordingDeviations(async () => {
      await deviate("rule-alone-for-people", true, () => false);
      await deviate("no-service", true, () => true);
      await deviate("visitor-public-default", false, async () => true);
      return "done";
    });
    expect(result).toBe("done");
    expect(deviations).toEqual([
      "rule-alone-for-people",
      "visitor-public-default",
    ]);
  });

  it("is recorded once, in the registry's order, however often it fired", async () => {
    const { deviations } = await recordingDeviations(async () => {
      await deviate("key-slug-string-match", true, () => false);
      await deviate("rule-alone-for-people", true, () => false);
      await deviate("key-slug-string-match", true, () => false);
    });
    expect(deviations).toEqual([
      "rule-alone-for-people",
      "key-slug-string-match",
    ]);
  });

  it("is kept to the work it was recorded for", async () => {
    const first = recordingDeviations(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      await deviate("no-service", true, () => false);
    });
    const second = recordingDeviations(async () => {
      await deviate("claimed-super-admin", true, () => false);
    });
    expect((await first).deviations).toEqual(["no-service"]);
    expect((await second).deviations).toEqual(["claimed-super-admin"]);
  });
});
