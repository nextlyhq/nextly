/**
 * Every core widget is declared with `defineWidget`, as a plugin's widget is,
 * and reaches the registry through the same call.
 *
 * 🔴 Core has no list of definitions any more, and startup takes none: every
 * widget registered under core after boot must be one of core's declarations,
 * kept as a declaration. A core widget written as a definition again, however
 * it is registered, fails here, and so does an id core names without a
 * declaration behind it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetWidgetRegistries } from "../../../di/registrations/register-widgets";
import * as loggerModule from "../../../observability/logger";
import { CORE_DECLARATIONS, CORE_WIDGET_IDS } from "../core-widgets";
import { CORE_WIDGET_ID } from "../core-widgets/ids";
import { CORE_OWNER, declaredWidget } from "../declaration/declared-widgets";
import { getWidget, listWidgets, widgetSource } from "../registry";

beforeEach(() => {
  vi.spyOn(loggerModule, "getNextlyLogger").mockReturnValue({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as ReturnType<typeof loggerModule.getNextlyLogger>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sorted = (ids: readonly string[]) => [...ids].sort();

describe("core's widgets", () => {
  it("are each a defineWidget declaration, and nothing under core is a definition", () => {
    const declared = CORE_DECLARATIONS.map(declaration => declaration.id);
    // Every id core has is declared, once.
    expect(sorted(declared)).toEqual(sorted(CORE_WIDGET_IDS));
    expect(new Set(declared).size).toBe(declared.length);
    // After boot, every widget the registry holds under core is one of those
    // declarations, kept as one: a definition registered under core by any
    // door is named here.
    resetWidgetRegistries();
    const underCore = listWidgets()
      .map(widget => widget.id)
      .filter(id => widgetSource(id) === CORE_OWNER);
    expect(sorted(underCore)).toEqual(sorted(CORE_WIDGET_IDS));
    expect(
      underCore.filter(id => declaredWidget(id)?.owner !== CORE_OWNER)
    ).toEqual([]);
  });

  it("declare a load and a view, as every declaration does", () => {
    for (const declaration of CORE_DECLARATIONS) {
      expect([declaration.id, typeof declaration.load]).toEqual([
        declaration.id,
        "function",
      ]);
      expect(declaration.view, declaration.id).toBeDefined();
    }
  });

  it("reach the registry through the one call a plugin's take, under core", () => {
    resetWidgetRegistries();
    for (const { id } of CORE_DECLARATIONS) {
      // Kept as a declaration, and published under core.
      expect(declaredWidget(id)?.owner, id).toBe(CORE_OWNER);
      expect(getWidget(id), id).toBeDefined();
      expect(widgetSource(id), id).toBe(CORE_OWNER);
    }
    // The control: the registry answers an id core never declared with nothing.
    expect(getWidget(`${CORE_WIDGET_ID.setup}-not-declared`)).toBeUndefined();
  });
});
