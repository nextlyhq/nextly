/**
 * The per-request memo keeps one decision per actor, action and target, and
 * never hands one actor's decision to another.
 */
import { describe, expect, it, vi } from "vitest";

import { userActor } from "./actor";
import type { AccessTarget, Decision } from "./decide";
import { DecisionMemo } from "./memo";

const posts: AccessTarget = { kind: "collection", slug: "posts" };
const editor = () =>
  userActor({
    userId: "u1",
    roles: ["editor"],
    permissions: [{ slug: "read-posts", action: "read", resource: "posts" }],
  });
const ALLOW: Decision = { allowed: true };

describe("DecisionMemo", () => {
  it("decides once for the same actor, action and target", async () => {
    const memo = new DecisionMemo();
    const actor = editor();
    const decide = vi.fn(async () => ALLOW);
    await memo.remember(actor, "read", posts, decide);
    await memo.remember(actor, "read", posts, decide);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("decides again for another action or another target", async () => {
    const memo = new DecisionMemo();
    const actor = editor();
    const decide = vi.fn(async () => ALLOW);
    await memo.remember(actor, "read", posts, decide);
    await memo.remember(actor, "update", posts, decide);
    await memo.remember(
      actor,
      "read",
      { kind: "single", slug: "posts" },
      decide
    );
    // Same kind and action, another slug: a key without the slug would reuse
    // one collection's answer for another.
    await memo.remember(
      actor,
      "read",
      { kind: "collection", slug: "pages" },
      decide
    );
    expect(decide).toHaveBeenCalledTimes(4);
  });

  it("never reuses a decision for another actor, even one equal in every field", async () => {
    // A narrower caller in the same request is a different actor object; a
    // memo keyed by what an actor contains would hand it the broader answer.
    const memo = new DecisionMemo();
    const decide = vi.fn(async () => ALLOW);
    await memo.remember(editor(), "read", posts, decide);
    await memo.remember(editor(), "read", posts, decide);
    expect(decide).toHaveBeenCalledTimes(2);
  });

  it("shares one pending decision between two asks at once", async () => {
    const memo = new DecisionMemo();
    const actor = editor();
    const decide = vi.fn(async () => ALLOW);
    await Promise.all([
      memo.remember(actor, "read", posts, decide),
      memo.remember(actor, "read", posts, decide),
    ]);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("keeps a refusal as it was made, and serves it again", async () => {
    const memo = new DecisionMemo();
    const actor = editor();
    const refusal: Decision = { allowed: false, reason: "no-permission" };
    const decide = vi.fn(async () => refusal);
    expect(await memo.remember(actor, "update", posts, decide)).toBe(refusal);
    expect(await memo.remember(actor, "update", posts, decide)).toBe(refusal);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("refuses a decision that asks for itself rather than recurse or wait", async () => {
    const memo = new DecisionMemo();
    const actor = editor();
    let inner: Promise<Decision> | undefined;
    const decide = vi.fn((): Promise<Decision> => {
      // As a rule calling a service that asks the same thing again.
      inner = memo.remember(actor, "read", posts, decide);
      return inner.catch(() => ALLOW);
    });
    await memo.remember(actor, "read", posts, decide);
    await expect(inner).rejects.toThrow();
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("does not keep a decision that failed", async () => {
    const memo = new DecisionMemo();
    const actor = editor();
    const failing = vi.fn(async (): Promise<Decision> => {
      throw new Error("lookup failed");
    });
    await expect(memo.remember(actor, "read", posts, failing)).rejects.toThrow(
      "lookup failed"
    );
    const decide = vi.fn(async () => ALLOW);
    await expect(memo.remember(actor, "read", posts, decide)).resolves.toBe(
      ALLOW
    );
    expect(decide).toHaveBeenCalledTimes(1);
  });
});
