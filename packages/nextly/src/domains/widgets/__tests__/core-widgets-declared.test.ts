/**
 * Every core widget is declared with `defineWidget`, as a plugin's widget is,
 * and reaches the registry through the same call.
 *
 * 🔴 Five of core's widgets are still written as definitions, answered from a
 * query, and they are NAMED below rather than counted: the list can only
 * shrink. A core widget added as a definition fails here, and so does one of
 * the five once it is declared and not taken off the list, so the list always
 * says exactly which are left. When it is empty, every entry of core's list is
 * a declaration.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetWidgetRegistries } from "../../../di/registrations/register-widgets";
import * as loggerModule from "../../../observability/logger";
import {
  CORE_DECLARATIONS,
  CORE_WIDGET_IDS,
  CORE_WIDGETS,
} from "../core-widgets";
import { CORE_WIDGET_ID } from "../core-widgets/ids";
import { CORE_OWNER, declaredWidget } from "../declaration/declared-widgets";
import { getWidget, widgetSource } from "../registry";

/** Core's widgets still written as definitions, each to be declared. */
const STILL_DEFINITIONS: readonly string[] = [
  CORE_WIDGET_ID.contentTable,
  CORE_WIDGET_ID.team,
  CORE_WIDGET_ID.continue,
  CORE_WIDGET_ID.upcomingReleases,
  CORE_WIDGET_ID.teamActivity,
];

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
  it("are each a defineWidget declaration, but for the named ones still written as definitions", () => {
    const declared = CORE_DECLARATIONS.map(declaration => declaration.id);
    // Every id core has is declared or named, and none is both.
    expect(sorted([...declared, ...STILL_DEFINITIONS])).toEqual(
      sorted(CORE_WIDGET_IDS)
    );
    expect(declared.filter(id => STILL_DEFINITIONS.includes(id))).toEqual([]);
    // The named list is exactly what is still a definition: it shrinks as
    // each one is declared, and grows for nothing.
    expect(sorted(CORE_WIDGETS.map(definition => definition.id))).toEqual(
      sorted(STILL_DEFINITIONS)
    );
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
      // Kept as a declaration, its card answered on the server.
      expect(declaredWidget(id)?.owner, id).toBe(CORE_OWNER);
      expect(getWidget(id)?.serverData, id).toBe(true);
      expect(widgetSource(id), id).toBe(CORE_OWNER);
    }
    // The control: a definition is registered too, but kept as no declaration.
    for (const id of STILL_DEFINITIONS) {
      expect(getWidget(id), id).toBeDefined();
      expect(declaredWidget(id), id).toBeUndefined();
    }
  });
});
