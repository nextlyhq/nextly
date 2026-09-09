/**
 * A root-mounted plugin route answers its own path, and never core's.
 *
 * The registry keeps the two mounts in separate matching passes; this drives
 * the real catch-all to prove the passes are ASKED in the order that makes the
 * separation a guarantee. A reordering that consulted root routes before the
 * built-in router would leave every unit test green while letting a plugin
 * answer for `/collections`.
 *
 * @module plugins/routes/route-root-mount.integration
 */
import { afterEach, describe, expect, it } from "vitest";

import { createDynamicHandlers } from "../../routeHandler";
import { definePlugin } from "../plugin-context";
import type { TestNextly } from "../test-nextly";
import { createTestNextly } from "../test-nextly";

const PLUGIN = "@test/root-mount";
let handle: TestNextly | undefined;

/** Claims a path core serves AND one it does not, so both halves are driven. */
const rootPlugin = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    routes: [
      {
        method: "GET",
        path: "/newsletter-signup",
        mount: "root",
        public: true,
        handler: () => Response.json({ servedBy: "plugin" }),
      },
      {
        method: "GET",
        path: "/collections",
        mount: "root",
        public: true,
        handler: () => Response.json({ servedBy: "plugin" }),
      },
    ],
  },
});

function get(segments: string[]): Promise<Response> {
  const handlers = createDynamicHandlers();
  return handlers.GET(
    new Request(`http://localhost/api/${segments.join("/")}`),
    { params: Promise.resolve({ params: segments }) }
  );
}

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

describe("a root-mounted plugin route", () => {
  it("answers a path core does not serve", async () => {
    handle = await createTestNextly({ plugins: [rootPlugin] });
    const res = await get(["newsletter-signup"]);
    expect(await res.json()).toEqual({ servedBy: "plugin" });
  });

  it("does NOT answer a path core serves", async () => {
    handle = await createTestNextly({ plugins: [rootPlugin] });
    const res = await get(["collections"]);
    // Core's own answer, whatever it is. The plugin declared this path first
    // and still does not get it, because the built-in router is asked first.
    const body: unknown = await res.json().catch(() => null);
    expect(body).not.toEqual({ servedBy: "plugin" });
  });
});
