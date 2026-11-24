/**
 * The tries of one entry write (`WriteTries`): made again only where the comparison under its hold
 * found the definition changed, each step of its hooks run once and handed on as it was left, and
 * each access question answered as it was first answered until the write has its hold.
 *
 * What separates the right tries from a plausible wrong one: a write made whole a second time stores
 * the same values and runs its hooks twice; one that keeps a reference rather than a copy hands the
 * later try what the first did to it in place; one that serves a kept answer within a try hides what
 * a hook changed; one that serves it after the hold answers the questions of another write.
 */
import { describe, expect, it, vi } from "vitest";

import {
  askOnce,
  replayingWrite,
  savesHoldEntriesHere,
  WRITE_TRIES,
  WriteTries,
} from "../write-tries";

const reloads = () => vi.fn(async () => true);

describe("the tries of an entry write", () => {
  it("makes a write once where its definition stands", async () => {
    const tries = new WriteTries();
    const reload = reloads();
    const write = vi.fn(async () => {
      tries.compared(false);
      return "written";
    });

    expect(await tries.make(write, reload)).toBe("written");
    expect(write).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("makes it again, read afresh first, where the definition changed under it", async () => {
    const tries = new WriteTries();
    const order: string[] = [];
    const write = async () => {
      order.push("write");
      const changed = order.filter(step => step === "write").length === 1;
      tries.compared(changed);
      if (changed) throw new Error("made from an earlier definition");
      return "written";
    };
    const reload = async () => {
      order.push("reload");
      return true;
    };

    expect(await tries.make(write, reload)).toBe("written");
    expect(order).toEqual(["write", "reload", "write"]);
  });

  it("makes it again where the refusal came back as a result rather than thrown", async () => {
    const tries = new WriteTries();
    let made = 0;
    const answer = await tries.make(async () => {
      made += 1;
      tries.compared(made === 1);
      return { success: made > 1 };
    }, reloads());

    expect(answer).toEqual({ success: true });
    expect(made).toBe(2);
  });

  it("never makes again a write refused for anything else, nor one whose last comparison passed", async () => {
    const refused = new WriteTries();
    const refusal = new Error("not valid");
    const write = vi.fn(async () => {
      throw refusal;
    });
    await expect(refused.make(write, reloads())).rejects.toBe(refusal);
    expect(write).toHaveBeenCalledTimes(1);

    // A transaction the database retried: compared as changed, then as standing, in one try.
    const passed = new WriteTries();
    const retried = vi.fn(async () => {
      passed.compared(true);
      passed.compared(false);
      throw refusal;
    });
    await expect(passed.make(retried, reloads())).rejects.toBe(refusal);
    expect(retried).toHaveBeenCalledTimes(1);
  });

  it("leaves the last refusal standing after its last try, or where nothing could be read afresh", async () => {
    const changing = new WriteTries();
    const refusals: Error[] = [];
    const write = vi.fn(async () => {
      changing.compared(true);
      refusals.push(new Error(`refused ${String(refusals.length + 1)}`));
      throw refusals.at(-1);
    });
    await expect(changing.make(write, reloads())).rejects.toThrow(
      `refused ${String(WRITE_TRIES)}`
    );
    expect(write).toHaveBeenCalledTimes(WRITE_TRIES);

    const inside = new WriteTries();
    const once = vi.fn(async () => {
      inside.compared(true);
      throw new Error("refused");
    });
    await expect(inside.make(once, async () => false)).rejects.toThrow(
      "refused"
    );
    expect(once).toHaveBeenCalledTimes(1);
  });

  it("runs a step once, and hands a later try a copy of what it left", async () => {
    const tries = new WriteTries();
    const hook = vi.fn(() => ({ password: "plain", tags: ["a"] }));
    const seen: unknown[] = [];
    await tries.make(async () => {
      const data = await tries.kept("hooks", hook);
      seen.push(structuredClone(data));
      // As a write shapes its data in place.
      data.password = `hash of ${data.password}`;
      data.tags.push("shaped");
      tries.compared(seen.length < 3);
      return undefined;
    }, reloads());

    expect(hook).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([
      { password: "plain", tags: ["a"] },
      { password: "plain", tags: ["a"] },
      { password: "plain", tags: ["a"] },
    ]);
  });

  it("keeps nothing, and is made once, where no save can hold entries", async () => {
    const tries = new WriteTries(false);
    const left = { data: { title: "t" } };
    const run = vi.fn(() => left);
    const write = vi.fn(async () => {
      // The thing itself, each time it is asked for: no copy is made for a try that cannot come.
      expect(await tries.kept("hooks", run)).toBe(left);
      expect(await tries.kept("hooks", run)).toBe(left);
      tries.compared(true);
      throw new Error("made from an earlier definition");
    });
    const reload = reloads();

    await expect(tries.make(write, reload)).rejects.toThrow(
      "made from an earlier definition"
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it("is made again outside production alone", () => {
    const before = process.env.NODE_ENV;
    try {
      vi.stubEnv("NODE_ENV", "production");
      expect(savesHoldEntriesHere()).toBe(false);
      vi.stubEnv("NODE_ENV", "development");
      expect(savesHoldEntriesHere()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(process.env.NODE_ENV).toBe(before);
  });

  it("waits one time over all its tries, counted from its first hold", async () => {
    vi.useFakeTimers();
    try {
      const tries = new WriteTries();
      // A slow hook, before the write seeks its hold: no part of its wait.
      vi.advanceTimersByTime(40_000);
      expect(tries.waitLeft(30_000)).toBe(30_000);
      // The first try waited for a save, and the second seeks its hold.
      vi.advanceTimersByTime(21_000);
      expect(tries.waitLeft(30_000)).toBe(9_000);
      vi.advanceTimersByTime(60_000);
      expect(tries.waitLeft(30_000)).toBe(0);
      // Another write has a wait of its own.
      expect(new WriteTries().waitLeft(30_000)).toBe(30_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands on the thing itself where a step's answer is not data", async () => {
    const tries = new WriteTries();
    const contexts: Record<string, unknown>[] = [];
    await tries.make(async () => {
      contexts.push(await tries.once("context", () => ({ by: "hook" })));
      tries.compared(contexts.length === 1);
      return undefined;
    }, reloads());

    expect(contexts).toHaveLength(2);
    expect(contexts[1]).toBe(contexts[0]);
  });

  it("asks a rule once over a write's tries, and as often as ever within one", async () => {
    const tries = new WriteTries();
    let answer = "allowed at first";
    const rule = vi.fn(async () => answer);
    const ask = () => askOnce("update", rule, { onTransaction: false });
    const heard: string[] = [];
    let made = 0;
    await tries.make(async () => {
      made += 1;
      heard.push(await ask());
      // A hook of the first try changes what the rule says, before it is asked again.
      if (made === 1) answer = "allowed after a hook";
      heard.push(await ask());
      tries.compared(made === 1);
      return undefined;
    }, reloads());

    expect(rule).toHaveBeenCalledTimes(2);
    expect(heard).toEqual([
      "allowed at first",
      "allowed after a hook",
      "allowed after a hook",
      "allowed after a hook",
    ]);
  });

  it("asks afresh from its hold on, on a transaction, and for another question", async () => {
    const tries = new WriteTries();
    const rule = vi.fn(async (asked: string) => asked);
    const ask = (question: string, onTransaction = false) =>
      askOnce(question, () => rule(question), { onTransaction });
    let made = 0;
    await tries.make(async () => {
      made += 1;
      await ask("update");
      if (made === 1) {
        tries.compared(true);
        return undefined;
      }
      await ask("publish");
      await ask("update", true);
      tries.compared(false);
      await ask("update");
      return undefined;
    }, reloads());

    expect(rule.mock.calls.map(([asked]) => asked)).toEqual([
      "update",
      "publish",
      "update",
      "update",
    ]);
  });

  it("asks a rule that failed again", async () => {
    const tries = new WriteTries();
    let made = 0;
    const rule = vi.fn(async () => {
      if (made === 1) throw new Error("unreadable");
      return "allowed";
    });
    const heard: unknown[] = [];
    await tries.make(async () => {
      made += 1;
      heard.push(
        await askOnce("update", rule, { onTransaction: false }).catch(
          () => "failed"
        )
      );
      tries.compared(made === 1);
      return undefined;
    }, reloads());

    expect(heard).toEqual(["failed", "allowed"]);
  });

  it("is replaying only in a later try before its hold, and never in a write of its own inside one", async () => {
    const tries = new WriteTries();
    const seen: boolean[] = [];
    let made = 0;
    await tries.make(async () => {
      made += 1;
      seen.push(replayingWrite());
      if (made === 1) {
        tries.compared(true);
        return undefined;
      }
      const inner = new WriteTries();
      await inner.make(async () => {
        seen.push(replayingWrite());
        return undefined;
      }, reloads());
      tries.compared(false);
      seen.push(replayingWrite());
      return undefined;
    }, reloads());

    expect(seen).toEqual([false, true, false, false]);
    expect(replayingWrite()).toBe(false);
  });
});
