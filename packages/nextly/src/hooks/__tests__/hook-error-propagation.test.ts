/**
 * A hook's typed error survives the registry.
 *
 * `execute()` rebuilt every thrown error as a generic one, keeping only its
 * message. A hook rejecting input with `NextlyError.validation()` therefore
 * reached the mutation boundary as something `NextlyError.is()` does not
 * recognise, and the caller was answered 500 — so a hook enforcing a rule
 * reported a server fault instead of the rule, and the field issues it supplied
 * to explain itself were gone.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import { HookRegistry } from "../hook-registry";
import type { HookContext } from "../types";

function contextFor(collection: string): HookContext {
  return {
    collection,
    operation: "create",
    data: {},
  } as unknown as HookContext;
}

describe("hook error propagation", () => {
  it("preserves a validation error thrown by a hook", async () => {
    const registry = new HookRegistry();
    // A real validation error: `validation()` takes an `errors` array and
    // ignores anything else, so a fixture built from a message alone carries
    // `errors: undefined` and proves nothing about the field issues this test
    // exists to protect.
    const thrown = NextlyError.validation({
      errors: [
        { path: "title", code: "REQUIRED", message: "Title is required." },
      ],
    });
    registry.register("beforeCreate", "docs", () => {
      throw thrown;
    });

    // Identity, not just shape: the boundary reads status, code and field
    // issues off this object, and a copy carrying the message alone would
    // satisfy a looser assertion while still losing them.
    const error = await registry
      .execute("beforeCreate", contextFor("docs"))
      .catch((e: unknown) => e);

    // Identity, not just shape: the boundary reads status, code and field
    // issues off this object, and a copy carrying the message alone would
    // satisfy a looser assertion while still losing them.
    expect(error).toBe(thrown);
    // Asserted explicitly, because identity alone would still pass for an
    // error whose issues were never populated.
    expect(
      (error as { publicData?: { errors?: unknown } }).publicData?.errors
    ).toEqual([
      { path: "title", code: "REQUIRED", message: "Title is required." },
    ]);
  });

  it("keeps the error recognisable to NextlyError.is", async () => {
    const registry = new HookRegistry();
    registry.register("beforeCreate", "docs", () => {
      throw NextlyError.forbidden({});
    });

    // What the mutation boundary actually branches on. Without it the response
    // falls through to a 500 regardless of what the hook meant.
    const error = await registry
      .execute("beforeCreate", contextFor("docs"))
      .catch((e: unknown) => e);
    expect(NextlyError.is(error)).toBe(true);
  });

  it("wraps an untyped error as internal, keeping the original as cause", async () => {
    const registry = new HookRegistry();
    const original = new Error("boom");
    registry.register("beforeCreate", "docs", () => {
      throw original;
    });

    const error = await registry
      .execute("beforeCreate", contextFor("docs"))
      .catch((e: unknown) => e);

    // Genuinely unexpected, so it becomes an internal error — but the original
    // is kept rather than flattened into a message, so the stack survives.
    expect(NextlyError.is(error)).toBe(true);
    expect((error as NextlyError).code).toBe("INTERNAL_ERROR");
    expect((error as { cause?: unknown }).cause).toBe(original);
  });

  it("survives a thrown non-Error", async () => {
    // A hook may throw a string. It must not take the registry down with it,
    // and what it threw is worth recording.
    const registry = new HookRegistry();
    registry.register("beforeCreate", "docs", () => {
      throw "nope";
    });

    const error = await registry
      .execute("beforeCreate", contextFor("docs"))
      .catch((e: unknown) => e);
    expect(NextlyError.is(error)).toBe(true);
  });

  it("preserves a typed error thrown by a beforeOperation hook", async () => {
    // The same guarantee on the other execution path. `beforeOperation` has its
    // own loop with its own catch, and fixing one and not the other leaves half
    // the lifecycle rebuilding errors.
    const registry = new HookRegistry();
    const thrown = NextlyError.forbidden({});
    registry.register("beforeOperation", "docs", () => {
      throw thrown;
    });

    await expect(
      registry.executeBeforeOperation({
        collection: "docs",
        operation: "read",
        args: {},
      } as never)
    ).rejects.toBe(thrown);
  });

  it("wraps an untyped beforeOperation error as internal", async () => {
    const registry = new HookRegistry();
    const original = new Error("boom");
    registry.register("beforeOperation", "docs", () => {
      throw original;
    });

    const error = await registry
      .executeBeforeOperation({
        collection: "docs",
        operation: "read",
        args: {},
      } as never)
      .catch((e: unknown) => e);
    expect(NextlyError.is(error)).toBe(true);
    expect((error as { cause?: unknown }).cause).toBe(original);
  });

  it("survives a thrown value that cannot be stringified", async () => {
    // A null-prototype object has no `toString`, so recording it would throw
    // inside the handler meant to describe the original failure -- replacing
    // the error the caller needs with one about logging it.
    const registry = new HookRegistry();
    registry.register("beforeCreate", "docs", () => {
      throw Object.create(null) as never;
    });

    const error = await registry
      .execute("beforeCreate", contextFor("docs"))
      .catch((e: unknown) => e);
    expect(NextlyError.is(error)).toBe(true);
  });

  it("survives a thrown value whose own inspection throws", async () => {
    // A revoked proxy refuses every operation, including the prototype lookup
    // `instanceof` performs and the property read that identifies a typed
    // error. Classifying it must not raise from inside the handler that exists
    // to report the original failure.
    const registry = new HookRegistry();
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();
    registry.register("beforeCreate", "docs", () => {
      throw revocable.proxy as never;
    });

    const error = await registry
      .execute("beforeCreate", contextFor("docs"))
      .catch((e: unknown) => e);
    expect(NextlyError.is(error)).toBe(true);
    expect((error as NextlyError).code).toBe("INTERNAL_ERROR");
  });

  it("still runs later hooks when no one throws", async () => {
    // The mirror: error handling must not change the ordinary path.
    const registry = new HookRegistry();
    const seen: string[] = [];
    registry.register("beforeCreate", "docs", ctx => {
      seen.push("first");
      return { ...(ctx.data as object), a: 1 };
    });
    registry.register("beforeCreate", "docs", ctx => {
      seen.push("second");
      return ctx.data;
    });

    const data = await registry.execute("beforeCreate", contextFor("docs"));
    expect(seen).toEqual(["first", "second"]);
    expect(data).toMatchObject({ a: 1 });
  });
});
