/**
 * A reader's note draws its Markdown, and nothing a note should not be able to
 * do: raw HTML is text, a link to a scheme that runs code is no link, and an
 * external link opens safely. Rendered through the real lazy renderer, so what
 * is asserted is what the dashboard would show.
 *
 * @module components/features/dashboard/NoteCard.test
 */

import { render, screen, waitFor } from "@testing-library/react";
import type { WidgetComponentProps } from "nextly/widget-result";
import { beforeAll, describe, expect, it } from "vitest";

import { NoteCard } from "./NoteCard";

beforeAll(() => {
  // Lexical scrolls the selection into view on some updates; jsdom has no
  // layout to scroll.
  Element.prototype.scrollIntoView = () => undefined;
});

function props(text: unknown): WidgetComponentProps {
  return {
    widgetId: "core/note",
    placementId: "note-1",
    settings: { text },
    slot: undefined,
    isFetching: false,
  };
}

async function drawn(text: string): Promise<HTMLElement> {
  render(<NoteCard {...props(text)} />);
  // Lazy, as the text archetype's renderer is; given longer than the default
  // second for the same reason its own test gives.
  return waitFor(
    () => {
      const root = screen.getByTestId("widget-text");
      if (!root.textContent) throw new Error("not drawn yet");
      return root;
    },
    { timeout: 5000 }
  );
}

describe("a note", () => {
  it("draws its Markdown", async () => {
    const root = await drawn("## Before Friday\n\n- **ship** the release");
    expect(root.querySelector("h2")?.textContent).toBe("Before Friday");
    expect(root.querySelector("strong")?.textContent).toBe("ship");
  });

  it("shows raw HTML as the text it is, and runs none of it", async () => {
    const root = await drawn('<script>alert("x")</script> and <b>bold</b>');
    expect(root.textContent).toContain('<script>alert("x")</script>');
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("b")).toBeNull();
  });

  it("makes no link of a scheme that runs code", async () => {
    const root = await drawn("[click](javascript:alert(1))");
    expect(root.querySelector("a")).toBeNull();
  });

  it("opens an external link in a new tab, with no way back to the dashboard", async () => {
    const root = await drawn("[docs](https://nextlyhq.com/docs)");
    const link = root.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://nextlyhq.com/docs");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("draws its text as written, so a leading indent keeps its meaning", async () => {
    // 🔴 Four leading spaces nest a list item one level in. Trimmed before it
    // is drawn, the note's first item came out at the top level instead.
    const root = await drawn("    - nested");
    expect(root.querySelector("ul ul")).not.toBeNull();
  });

  it("says it is empty until it is written, and for a value that is not text", () => {
    const { unmount } = render(<NoteCard {...props("   ")} />);
    expect(screen.getByTestId("card-empty")).toHaveTextContent("An empty note");
    unmount();
    render(<NoteCard {...props(42)} />);
    expect(screen.getByTestId("card-empty")).toBeInTheDocument();
  });
});
