/**
 * A lifecycle command's boot exists to run one plugin's hook, so it initialises
 * only that plugin. The other configured plugins may be behind, uninstalled or
 * half-removed, and their `init` must not run against that schema.
 */
import { describe, expect, it } from "vitest";

import {
  asLifecycleCommandBoot,
  isLifecycleCommandBoot,
  pluginsToInitialize,
} from "../plugin-lifecycle-state";

const target = { name: "@acme/fx" };
const sibling = { name: "@acme/core" };

describe("the plugins a boot initialises", () => {
  it("is every configured plugin outside a lifecycle command boot", () => {
    expect(isLifecycleCommandBoot()).toBe(false);
    expect(pluginsToInitialize([target, sibling])).toEqual([target, sibling]);
  });

  it("is only the target inside a lifecycle command boot", async () => {
    await asLifecycleCommandBoot("@acme/fx", async () => {
      expect(isLifecycleCommandBoot()).toBe(true);
      expect(pluginsToInitialize([target, sibling])).toEqual([target]);
    });
  });
});
