import { describe, expect, it, vi } from "vitest";

import type { SingleRegistryService } from "../domains/singles/services/single-registry-service";
import { wrapSinglesForPlugin } from "./plugin-singles";

/**
 * A registry that records every method reached through it.
 *
 * A `vi.fn()` per method would only observe the methods the test remembered to
 * declare, and the property being checked is about the ones it did NOT — so the
 * double is a Proxy, and any access at all is recorded whether or not this file
 * knows the name.
 */
function recordingRegistry(): {
  registry: SingleRegistryService;
  touched: string[];
} {
  const touched: string[] = [];
  const registry = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        touched.push(prop);
        return vi.fn().mockResolvedValue({ data: [], total: 0 });
      },
    }
  ) as SingleRegistryService;
  return { registry, touched };
}

describe("wrapSinglesForPlugin", () => {
  it("forwards a list to the registry's listSingles", async () => {
    const listSingles = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const registry = { listSingles } as unknown as SingleRegistryService;

    await wrapSinglesForPlugin(registry).list({ source: "code" });

    // The ARGUMENT is asserted, not just the call: a wrapper that dropped its
    // options would still be "called once" while silently listing everything.
    expect(listSingles).toHaveBeenCalledWith({ source: "code" });
  });

  it("reaches nothing on the registry except the listing", async () => {
    // The surface is public API, so what it does NOT expose is the load-bearing
    // part. The registry can register, lock and rewrite migration status; a
    // wrapper that handed the service through would publish all of that, and
    // the mistake would be invisible at the call site.
    const { registry, touched } = recordingRegistry();

    await wrapSinglesForPlugin(registry).list();

    expect(touched).toEqual(["listSingles"]);
  });

  it("exposes exactly one method", async () => {
    // Pairs with the test above, which watches what the wrapper REACHES. This
    // watches what a plugin can CALL — a method added here that forwards
    // nowhere would satisfy the other test and still widen the surface.
    const { registry } = recordingRegistry();

    const surface = wrapSinglesForPlugin(registry);

    expect(Object.keys(surface)).toEqual(["list"]);
  });

  it("performs no write on the registry when a plugin lists", async () => {
    // The property the founder ruling named: listing must not bring Singles
    // into existence. A read-shaped call on the Single path is not free of
    // side effects in general — the readable half of `assertSinglePreviewable`
    // creates a Single's row when it is absent — so this asserts the absence
    // of that whole class rather than of one named method.
    const { registry, touched } = recordingRegistry();

    await wrapSinglesForPlugin(registry).list();

    const writes = touched.filter(name =>
      /^(register|unregister|update|set|create|delete|ensure|sync|lock)/i.test(
        name
      )
    );
    expect(writes).toEqual([]);
  });
});
