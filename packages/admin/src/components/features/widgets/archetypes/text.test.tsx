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

  it("declines a scheme hidden behind markdown escaping, on both spellings", async () => {
    // 🔴 The library unescapes the capture before it creates the node, so
    // `javascript\:` and `javascript&#58;` both reached the DOM as
    // `javascript:` past a guard that read the raw capture. Asserted through
    // Lexical itself, so a change in what it unescapes is caught here rather
    // than mirrored blindly.
    const root = await drawn(
      "Not [this](javascript\\:alert%281%29) nor [that](javascript&#58;alert%281%29)."
    );
    expect(root.querySelectorAll("a")).toHaveLength(0);
  });

  it("gives an allowed link the destination that was judged, not the capture", async () => {
    // 🔴 The guard admitted `\u0001https://example.com` on its stripped form,
    // then handed the library the raw capture -- which, scheme-less to the
    // link node's formatter, rendered as `https://\u0001https://example.com`.
    // The node now carries the judged destination, so the href is the
    // address the guard read.
    const root = await drawn(
      "Read [the docs](\u0001https://example.com/docs)."
    );
    const link = root.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/docs");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("leaves a bare relative destination as markdown, rather than a link off-site", async () => {
    // 🔴 `[posts](posts?status=draft)` read as a path on this site and the
    // link node rendered it as `https://posts?status=draft`, in a new tab.
    // Refused, the brackets stay on screen; the path spelled `./` is kept.
    const root = await drawn(
      "See [posts](posts?status=draft) or [drafts](./posts?status=draft)."
    );
    const links = [...root.querySelectorAll("a")];
    expect(links.map(link => link.getAttribute("href"))).toEqual([
      "./posts?status=draft",
    ]);
    expect(root.textContent).toContain("[posts](posts?status=draft)");
  });

  it("declines a link whose entity no code point can hold, and still draws the rest", async () => {
    // 🔴 The library decoded `&#1114112;` by throwing, inside the conversion
    // of the whole card, and an editor whose initial state threw committed
    // nothing: the other lines were gone with the link. Declined before the
    // library is asked, the link is text and the heading is drawn.
    const root = await drawn(
      "## Still here\n\nA [broken](https://example.com/&#1114112;) link."
    );
    expect(root.querySelector("h2")?.textContent).toBe("Still here");
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toContain(
      "[broken](https://example.com/&#1114112;)"
    );
  });

  it("is document content, not a read-only form control", async () => {
    // 🔴 `ContentEditable` names itself `role="textbox"` and, when the editor
    // is not editable, `aria-readonly` -- so a card of prose was announced as
    // a disabled field. A plain element carries neither.
    const root = await drawn("Plain prose.");
    expect(root.getAttribute("role")).toBeNull();
    expect(root.getAttribute("aria-readonly")).toBeNull();
    expect(root.getAttribute("contenteditable")).not.toBe("true");
  });

  it("marks the root so the stylesheet can announce a new tab on its links", async () => {
    // The notice itself is a pseudo-element in `globals.css`, keyed on this
    // attribute and the `target` the renderer sets; jsdom draws no
    // stylesheet, so what can be asserted here is that both hooks exist.
    const root = await drawn("Read [the docs](https://nextlyhq.com/docs).");
    expect(root.hasAttribute("data-widget-text")).toBe(true);
    expect(root.querySelector('a[target="_blank"]')).not.toBeNull();
  });
});
