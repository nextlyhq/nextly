/**
 * A plugin's `text` widget reaches the dashboard as prose.
 *
 * The unit tests draw the archetype from a hand-built declaration. This is
 * the path a plugin author actually takes: the contribution boots through the
 * validator, the layout offers the card, the grid draws it through the lazy
 * renderer, and what the reader sees is markdown made into elements -- with
 * the one link that must not become a link left as text.
 */
import { expect, test } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

test("a plugin's text widget draws its markdown on the dashboard", async ({
  page,
}) => {
  await gotoAdmin(page, "/", "light");

  const card = page.getByTestId("widget-cell-style-fixture/notes");
  await expect(card).toBeVisible({ timeout: 30_000 });

  const prose = card.getByTestId("widget-text");
  await expect(
    prose.getByRole("heading", { name: "Release checklist" })
  ).toBeVisible();
  await expect(prose.getByRole("listitem")).toHaveCount(2);

  // The runbook link is external, so it opens in a new tab and says so.
  const runbook = prose.getByRole("link", { name: "the runbook" });
  await expect(runbook).toHaveAttribute("href", "https://nextlyhq.com/docs");
  await expect(runbook).toHaveAttribute("target", "_blank");
  await expect(runbook).toHaveAttribute("rel", "noopener noreferrer");

  // The javascript: link was declined and left as the markdown it was written
  // in: no anchor exists for it, and the brackets are on screen.
  await expect(prose.getByRole("link", { name: "run this" })).toHaveCount(0);
  await expect(prose).toContainText(
    "[run this](javascript:alert%28document.cookie%29)"
  );
});
