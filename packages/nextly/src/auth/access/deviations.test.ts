/**
 * A deviation keeps today's answer, and is recorded only where it changed the
 * decision's answer and only while a test listens.
 */
import { describe, expect, it, vi } from "vitest";

import { aboutSubject, deviate, recordingDeviations } from "./deviations";

describe("a deviation", () => {
  it("answers today's answer, whatever the decision says", async () => {
    expect(await deviate("no-service", true, () => false)).toBe(true);
    expect(await deviate("no-service", false, () => true)).toBe(false);
  });

  it("does not ask the decision when nothing listens", async () => {
    const decided = vi.fn(() => false);
    await deviate("any-of-skips-rules", true, decided);
    expect(decided).not.toHaveBeenCalled();
  });

  it("is recorded only where it changed the answer", async () => {
    const { result, deviations } = await recordingDeviations(async () => {
      await deviate("lifecycle-judged-alone", true, () => false);
      await deviate("no-service", true, () => true);
      await deviate("any-of-skips-rules", false, async () => true);
      return "done";
    });
    expect(result).toBe("done");
    expect(deviations).toEqual([
      "lifecycle-judged-alone",
      "any-of-skips-rules",
    ]);
  });

  it("is recorded once, in the registry's order, however often it fired", async () => {
    const { deviations } = await recordingDeviations(async () => {
      await deviate("key-slug-string-match", true, () => false);
      await deviate("lifecycle-judged-alone", true, () => false);
      await deviate("key-slug-string-match", true, () => false);
    });
    expect(deviations).toEqual([
      "lifecycle-judged-alone",
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

describe("a deviation about a subject", () => {
  it("is recorded under the subject it was decided for, and for the whole work too", async () => {
    const { deviations, bySubject } = await recordingDeviations(async () => {
      // Decided side by side, as a list or a dashboard decides its items.
      await Promise.all([
        aboutSubject("posts", async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          await deviate("lifecycle-judged-alone", true, () => false);
        }),
        aboutSubject("pages", () => deviate("no-service", true, () => false)),
        aboutSubject("agreed", () => deviate("no-service", true, () => true)),
      ]);
      await deviate("claimed-super-admin", true, () => false);
    });
    expect(deviations).toEqual([
      "lifecycle-judged-alone",
      "no-service",
      "claimed-super-admin",
    ]);
    expect(bySubject.get("posts")).toEqual(["lifecycle-judged-alone"]);
    expect(bySubject.get("pages")).toEqual(["no-service"]);
    // A subject whose answer agreed recorded nothing.
    expect(bySubject.has("agreed")).toBe(false);
  });

  it("runs the work as it is when nothing listens", async () => {
    expect(await aboutSubject("posts", async () => "done")).toBe("done");
  });
});
