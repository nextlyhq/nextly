import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { commerce } from "../plugin";
import { PLUGIN_NAME } from "../schema/definition";

import {
  CART_SERVICE,
  CATALOGUE_SERVICE,
  forgetInstalled,
  fromInstalled,
  rememberInstalled,
} from "./server";

/** A context carrying commerce's two services, marked so a test can tell them apart. */
function contextWith(mark: string): PluginContext {
  const service = {
    mark,
    get() {},
    add() {},
    setQuantity() {},
    remove() {},
    clear() {},
    find() {},
    list() {},
  };
  return {
    services: {
      plugins: {
        [PLUGIN_NAME]: {
          [CART_SERVICE]: service,
          [CATALOGUE_SERVICE]: service,
        },
      },
    },
  } as unknown as PluginContext;
}

function markOf(): string {
  return (fromInstalled().cart as unknown as { mark: string }).mark;
}

describe("the started plugin's context", () => {
  it("is forgotten by the plugin that recorded it, and by no other", () => {
    const first = contextWith("first");
    const second = contextWith("second");
    rememberInstalled(first);
    expect(markOf()).toBe("first");

    // A newer boot records its own before the older one's teardown runs.
    rememberInstalled(second);
    forgetInstalled(first);
    expect(markOf()).toBe("second");

    forgetInstalled(second);
    expect(() => fromInstalled()).toThrow(/has not started/);
  });

  it("is recorded when commerce starts and forgotten when it stops", async () => {
    const ctx = contextWith("booted");
    const plugin = commerce({ currency: "USD" });
    await plugin.init?.(ctx);
    expect(markOf()).toBe("booted");
    await plugin.destroy?.(ctx);
    expect(() => fromInstalled()).toThrow(/has not started/);
  });
});
