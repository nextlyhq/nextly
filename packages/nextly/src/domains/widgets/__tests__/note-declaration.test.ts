/**
 * Core's Note card, declared with `defineWidget`: it passes the checks every
 * declaration is held to, answers its own text, is empty while that text is
 * blank, and is published as a card answered on the server that is never
 * placed by default and may be added more than once, under core, with its
 * "Note" label and no category label.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetWidgetRegistries } from "../../../di/registrations/register-widgets";
import * as loggerModule from "../../../observability/logger";
import { declaredWidgets, placedByDefault, sizeFacts } from "../canonical";
import {
  CORE_DECLARATIONS,
  CORE_WIDGET_IDS,
  CORE_WIDGETS,
} from "../core-widgets";
import { noteWidget } from "../core-widgets/note";
import { declaredWidget } from "../declaration/declared-widgets";
import { widgetDeclarationFaults } from "../declaration/validate";
import { getWidget, widgetSource } from "../registry";

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

/** The note's load function: it answers by one, not by a query. */
function noteLoad() {
  const { load } = noteWidget;
  if (typeof load !== "function") {
    throw new Error("the note answers by a load function");
  }
  return load;
}

/** What the note's load answers for this text, as a card's settings hand it. */
async function answerFor(text: string): Promise<{ text: string }> {
  const load = noteLoad();
  // Its settings alone: the note reads nothing else it is handed.
  return load({ settings: { text } } as Parameters<typeof load>[0]);
}

/** The note's verdict on an answer, by its declaration's own test. */
function isEmpty(data: { text: string }): boolean {
  const test = noteWidget.isEmpty;
  if (test === undefined) throw new Error("the note declares its empty test");
  return test(data);
}

describe("core's Note, declared", () => {
  it("passes the checks every declaration is held to, as core's own", () => {
    expect(widgetDeclarationFaults(noteWidget, "core", true)).toEqual([]);
  });

  it("answers its own text, and is empty while it is blank", async () => {
    const written = await answerFor("## Before Friday");
    expect(written).toEqual({ text: "## Before Friday" });
    expect(isEmpty(written)).toBe(false);
    // Blank as well as absent: whitespace alone draws nothing.
    expect(isEmpty(await answerFor(""))).toBe(true);
    expect(isEmpty(await answerFor("  \n\t"))).toBe(true);
  });

  it("is one of core's ids, in core's order, and no longer one of its definitions", () => {
    expect(CORE_DECLARATIONS.map(widget => widget.id)).toEqual(["core/note"]);
    expect(CORE_WIDGET_IDS).toContain("core/note");
    // Where it always sorted: after Breakdown, before Recent entries.
    const at = CORE_WIDGET_IDS.indexOf("core/note");
    expect(CORE_WIDGET_IDS[at - 1]).toBe("core/breakdown");
    expect(CORE_WIDGET_IDS[at + 1]).toBe("core/recent-entries");
    expect(CORE_WIDGETS.map(widget => widget.id)).not.toContain("core/note");
    // Every core widget is in exactly one of the two lists.
    expect(
      [...CORE_WIDGETS.map(widget => widget.id), "core/note"].sort()
    ).toEqual([...CORE_WIDGET_IDS].sort());
  });

  it("is published under core as a card answered on the server", () => {
    resetWidgetRegistries([]);
    expect(declaredWidget("core/note")?.owner).toBe("core");
    expect(widgetSource("core/note")).toBe("core");
    const published = getWidget("core/note");
    expect(published).toMatchObject({
      archetype: "custom",
      component: "core#Note",
      serverData: true,
      allowsSeveral: true,
      empty: {
        message: "Nothing written yet. Write it in the card's settings.",
      },
      settings: [
        expect.objectContaining({
          name: "text",
          label: "Note",
          type: "textarea",
          maxLength: 2000,
        }),
      ],
    });
    // Core's cards carry no category label in the add panel.
    expect(published?.category).toBeUndefined();
    // Asked for from the add panel, as when it was offered on request: never
    // on the default dashboard, and as many cards as its reader wants.
    const canonical = declaredWidgets().find(
      widget => widget.id === "core/note"
    );
    expect(canonical).toBeDefined();
    if (canonical === undefined) return;
    expect(placedByDefault(canonical)).toBe(false);
    expect(sizeFacts(canonical).allowsSeveral).toBe(true);
  });
});
