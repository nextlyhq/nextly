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
    <Activity mode={mode}>
      <Dialog open>
        <DialogContent>
          <DialogTitle>Delete entry</DialogTitle>
        </DialogContent>
      </Dialog>
    </Activity>
  );
}

describe("a dialog under Activity", () => {
  it("is hidden with the page that opened it, and gives the body back", () => {
    const { rerender, unmount } = render(page("visible"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeVisible();

    rerender(page("hidden"));
    expect(dialog).not.toBeVisible();
    expect(document.body.style.pointerEvents).not.toBe("none");

    rerender(page("visible"));
    expect(screen.getByRole("dialog")).toBeVisible();
    unmount();
  });
});
