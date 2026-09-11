/**
 * A `text` card whose markdown the library cannot convert still draws.
 *
 * The conversion is Lexical's, and an editor whose initial state threw commits
 * an empty one -- so one construct the library throws on would blank every
 * other line of the card. `text.test.tsx` covers the constructs known to
 * throw; this covers the boundary for the ones nobody has met yet, by making
 * the library's conversion itself throw.
 *
 * Its own file because the library is mocked here, and every other render
 * test must run against the real one.
 *
 * @module components/features/widgets/archetypes/text-conversion-fallback.test
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { textBody } from "./text";

vi.mock("@lexical/markdown", async importOriginal => {
  const actual = await importOriginal<typeof import("@lexical/markdown")>();
  return {
    ...actual,
    $convertFromMarkdownString: () => {
      throw new RangeError("Invalid code point 1114112");
    },
  };
});

beforeAll(() => {
  // Lexical scrolls the selection into view on some updates; jsdom has no
  // layout to scroll.
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a text card the library cannot convert", () => {
  it("draws its markdown as the text it was written in, line by line, and says why", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const outcome = textBody({
      id: "acme/notes",
      title: "Notes",
      archetype: "text",
      size: "md",
      content: "## Runbook\n\nRotate the keys before a release.",
    } as DashboardWidget);
    if (!outcome.ok) throw new Error(outcome.message);
    render(<>{outcome.node}</>);

    const root = await waitFor(
      () => {
        const drawn = screen.getByTestId("widget-text");
        if (!drawn.textContent) throw new Error("not drawn yet");
        return drawn;
      },
      { timeout: 5000 }
    );

    const lines = [...root.querySelectorAll("p")].map(p => p.textContent);
    expect(lines).toEqual([
      "## Runbook",
      "",
      "Rotate the keys before a release.",
    ]);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining("drawing the text as written"),
      expect.any(RangeError)
    );
  });
});
