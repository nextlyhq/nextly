/**
 * The widget-source boot wiring.
 *
 * Before this registration existed, `clearWidgets()` and `clearSources()` had
 * no caller anywhere in the repo -- the registries were declared, validated,
 * and never populated at runtime. A test asserting `registerBuiltInSources`
 * works in isolation (`domains/widgets/__tests__/built-in-sources.test.ts`)
 * cannot see that gap: it proves the function is correct, not that boot ever
 * calls it. Only a test that starts
 * from an EMPTY registry and calls the actual boot-wiring entry point can
 * tell the two apart.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  getSource,
  clearSources,
  listSources,
} from "../../domains/widgets/sources";
import {
  registerWidget,
  clearWidgets,
  listWidgets,
} from "../../domains/widgets/registry";
import { registerBuiltInWidgetSources } from "../registrations/register-widgets";

beforeEach(() => {
  clearSources();
  clearWidgets();
});

describe("registerBuiltInWidgetSources", () => {
  it("populates the source registry from the boot config's collections", () => {
    expect(listSources()).toHaveLength(0);

    registerBuiltInWidgetSources({
      collections: [
        { slug: "posts", fields: [{ name: "title", type: "text" }] },
      ],
    });

    expect(getSource("collection:posts")?.kind).toBe("collection");
    expect(listSources()).toHaveLength(1);
  });

  it("re-registering on a hot reload does not collide with the previous boot", () => {
    const config = {
      collections: [{ slug: "posts", fields: [] }],
    };
    registerBuiltInWidgetSources(config);
    // A second boot pass over the SAME config (a dev-server hot reload) must
    // not throw "already registered" -- clear-then-register is what makes
    // that safe.
    expect(() => registerBuiltInWidgetSources(config)).not.toThrow();
    expect(listSources()).toHaveLength(1);
  });

  it("still refuses a genuine duplicate slug within one boot", () => {
    // Two distinct collections resolving to the same source id in the SAME
    // pass is a config bug, not a hot reload -- clearing happens once before
    // the loop, not between iterations, so registerSource's own conflict
    // guard still fires.
    expect(() =>
      registerBuiltInWidgetSources({
        collections: [
          { slug: "posts", fields: [] },
          { slug: "posts", fields: [{ name: "title", type: "text" }] },
        ],
      })
    ).toThrow(/already registered/);
  });

  it("clears the widget registry too, ahead of the core widgets a later boot registers", () => {
    registerWidget(
      {
        id: "core/stale",
        title: "Stale",
        archetype: "text",
        defaultSize: "sm",
      },
      { source: "core" }
    );
    expect(listWidgets()).toHaveLength(1);

    registerBuiltInWidgetSources({ collections: [] });

    expect(listWidgets()).toHaveLength(0);
  });
});
