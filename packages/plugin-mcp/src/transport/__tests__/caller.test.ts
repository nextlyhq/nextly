import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { callerNow, whileServing } from "../caller";

/**
 * The window that carries the caller from the route into the protocol layer.
 *
 * Two properties, and the second is the reason it is a scope rather than a
 * module variable. Requests are served concurrently, so a shared variable is
 * correct on every test that serves one request at a time and hands one
 * caller's context to another the moment two overlap.
 */
function ctxFor(email: string): PluginRouteContext {
  // Only the fields these cases read. The real context is the plugin context
  // plus the request's own caller, and constructing one here would be a second
  // implementation of something the integration suite exercises for real.
  return { user: { email } } as unknown as PluginRouteContext;
}

describe("the caller a request belongs to", () => {
  it("is readable anywhere inside the window", async () => {
    const ctx = ctxFor("reader@example.com");

    const seen = await whileServing(ctx, async () => {
      // Awaited first on purpose: a value readable only synchronously would
      // satisfy a test that reads it immediately, and every tool reads it
      // after at least one await.
      await Promise.resolve();
      return callerNow();
    });

    expect(seen).toBe(ctx);
  });

  it("refuses rather than answering nobody outside one", () => {
    // The fail-closed direction. Answering `undefined` here builds a server
    // with no user and no grants attached, which reads as a narrow answer and
    // is an unscoped one.
    expect(() => callerNow()).toThrow(/no caller is in scope/);
  });

  it("keeps two overlapping requests apart", async () => {
    // The property a module variable cannot have, and the only case that
    // separates the two. Both windows are open at once and each interleaves an
    // await inside the other's lifetime, so a shared variable answers with
    // whichever ran last.
    const first = ctxFor("first@example.com");
    const second = ctxFor("second@example.com");
    const order: string[] = [];

    const runFirst = whileServing(first, async () => {
      order.push("first in");
      await new Promise(resolve => setTimeout(resolve, 10));
      order.push("first out");
      return callerNow();
    });
    const runSecond = whileServing(second, async () => {
      order.push("second in");
      await new Promise(resolve => setTimeout(resolve, 1));
      order.push("second out");
      return callerNow();
    });

    const [a, b] = await Promise.all([runFirst, runSecond]);

    expect(
      order,
      "the windows must overlap, or this passes on a shared variable too"
    ).toEqual(["first in", "second in", "second out", "first out"]);
    expect(a).toBe(first);
    expect(b).toBe(second);
  });

  it("closes when the request does", async () => {
    // Without this, "readable inside" is equally satisfied by a value that is
    // set and never cleared, which is the module variable again wearing the
    // scope's name.
    await whileServing(ctxFor("done@example.com"), async () => callerNow());

    expect(() => callerNow()).toThrow(/no caller is in scope/);
  });
});
