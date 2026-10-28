/**
 * Next.js keeps a visited route mounted but hidden under Cache Components,
 * through React's Activity. A dialog renders through a portal into the
 * document's body, outside the page's own elements, so a dialog left open on a
 * page that is then hidden must be hidden with it, and must give back what it
 * took from the page showing in its place: the body's pointer events and
 * focus.
 */
import { render, screen } from "@testing-library/react";
import { Activity } from "react";
import { describe, expect, it } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "@nextlyhq/ui";

function page(mode: "visible" | "hidden") {
  return (
    <>
      <button type="button">Site</button>
      <Activity mode={mode}>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Delete entry</DialogTitle>
          </DialogContent>
        </Dialog>
      </Activity>
    </>
  );
}

describe("a dialog under Activity", () => {
  it("locks the page while shown, and is hidden with its page, giving the body and focus back", () => {
    const { rerender, unmount } = render(page("visible"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeVisible();
    // What a modal dialog takes from the page, so its release can be seen.
    expect(document.body.style.pointerEvents).toBe("none");
    // Its focus trap holds: the page's own control cannot take focus.
    const site = screen.getByRole("button", { name: "Site", hidden: true });
    site.focus();
    expect(dialog.contains(document.activeElement)).toBe(true);

    rerender(page("hidden"));
    expect(dialog).not.toBeVisible();
    expect(document.body.style.pointerEvents).not.toBe("none");
    // The trap is gone with it, so the page showing in its place has focus
    // back. (Moving focus off an element display:none hides is the browser's
    // own rule, which jsdom does not apply; a trap left behind is the
    // dialog's, and is what this can see.)
    site.focus();
    expect(document.activeElement).toBe(site);

    rerender(page("visible"));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(document.body.style.pointerEvents).toBe("none");
    unmount();
  });
});
