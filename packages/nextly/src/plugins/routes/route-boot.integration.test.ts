import { afterEach, describe, expect, it } from "vitest";

import { definePlugin } from "../plugin-context";
import type { TestNextly } from "../test-nextly";
import { createTestNextly } from "../test-nextly";

import { getPluginRouteRegistry } from "./route-registry";

const routePlugin = definePlugin({
  name: "@test/routes-boot",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    routes: [
      {
        method: "GET",
        path: "/ping",
        public: true,
        handler: () => Response.json({ pong: true }),
      },
    ],
  },
});

let handle: TestNextly | undefined;
afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

describe("plugin route registration at boot", () => {
  it("registers a contributed route with the plugin's base context", async () => {
    handle = await createTestNextly({ plugins: [routePlugin] });
    const match = getPluginRouteRegistry().match(
      "GET",
      "/plugins/@test/routes-boot/ping"
    );
    expect(match).not.toBeNull();
    expect(match?.pluginName).toBe("@test/routes-boot");
    expect(match?.baseCtx.self.name).toBe("@test/routes-boot");
  });

  it("does not accumulate routes across boots (registry reset)", async () => {
    handle = await createTestNextly({ plugins: [routePlugin] });
    await handle.destroy();
    handle = await createTestNextly({ plugins: [routePlugin] });
    expect(getPluginRouteRegistry().list()).toHaveLength(1);
  });
});
