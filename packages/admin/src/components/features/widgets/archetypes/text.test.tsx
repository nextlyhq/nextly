/**
 * The `text` archetype draws its markdown, and nothing the markdown should not
 * be able to do.
 *
 * Rendered through the real lazy body and the real Lexical composer, so what
 * is asserted is what the dashboard would show: the elements the markdown
 * asked for, raw HTML as text, an unsafe link left as the markdown it was
 * written in, and an external link that opens in a new tab.
 *
 * @module components/features/widgets/archetypes/text.test
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { textBody } from "./text";

beforeAll(() => {
  // Lexical scrolls the selection into view on some updates; jsdom has no
  // layout to scroll.
  Element.prototype.scrollIntoView = () => undefined;
});

function widget(content: string): DashboardWidget {
  return {
    id: "acme/notes",
    title: "Notes",
    archetype: "text",
    size: "md",
    content,
  } as DashboardWidget;
}

async function drawn(content: string): Promise<HTMLElement> {
  const outcome = textBody(widget(content));
  if (!outcome.ok) throw new Error(outcome.message);
  render(<>{outcome.node}</>);
  // The renderer is lazy; the prose is there once the composer has drawn it.
  // Given longer than the default second, because the lazy chunk and the
  // composer both load on the first draw and a full suite runs them under
  // load: measured at 1060ms once, which is a slow machine and not a defect.
  return waitFor(
    () => {
      const root = screen.getByTestId("widget-text");
      if (!root.textContent) throw new Error("not drawn yet");
      return root;
    },
    { timeout: 5000 }
  );
}

describe("the text archetype", () => {
  it("draws headings, lists, emphasis and a link from markdown", async () => {
    const root = await drawn(
      "## Runbook\n\nBefore a release, **check** the queue.\n\n- one\n- two\n\nSee [the wiki](/admin/plugins/wiki)."
    );
    expect(root.querySelector("h2")?.textContent).toBe("Runbook");
    expect(root.querySelectorAll("li")).toHaveLength(2);
    expect(root.querySelector("strong")?.textContent).toBe("check");
    const link = root.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/admin/plugins/wiki");
    // A path on this site stays in this tab.
    expect(link?.getAttribute("target")).toBeNull();
  });

  it("shows raw HTML as the text it is", async () => {
    // 🔴 No transformer parses HTML, so a tag in the markdown is a text node
    // whose text is the tag. Asserted on BOTH halves: the text is present and
    // no element was created from it.
    const root = await drawn('Hello <script>alert("x")</script> <b>there</b>');
    expect(root.textContent).toContain('<script>alert("x")</script>');
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("b")).toBeNull();
  });

  it("leaves a link to a scheme that runs code as the markdown it was written in", async () => {
    // 🔴 `LINK` would have set `href="javascript:..."` verbatim. Declined, the
    // brackets stay on screen -- a refusal the author can see -- and no
    // anchor exists to click. The payload carries no parentheses on purpose:
    // the library's own URL pattern excludes them, so a `javascript:alert(1)`
    // here is refused by the pattern rather than by the guard, and a control
    // the guard cannot fail proves nothing about the guard.
    const root = await drawn(
      "Do not [click](javascript:alert%28document.cookie%29) this."
    );
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toContain(
      "[click](javascript:alert%28document.cookie%29)"
    );
  });

  it("opens an external link in a new tab, and says so to the browser", async () => {
    const root = await drawn("Read [the docs](https://nextlyhq.com/docs).");
    const link = root.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://nextlyhq.com/docs");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
