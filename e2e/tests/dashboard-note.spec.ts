/**
 * A reader's Note in a browser: their Markdown, drawn on their dashboard, with
 * an external link opening safely and nothing in it able to run; and a note
 * over its bound refused by the layout write.
 *
 * Placed by the test through the layout, as the Count spec places its card, so
 * the spec is about what the card draws and what the write accepts.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { defaultSizeOf } from "./support/dashboard-sizes";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

const API = "/admin/api";
const CARD = "core/note";

interface Layout {
  version: number;
  scope: string;
  placements: Array<{ widgetId: string }>;
}

/** Ask to put one Note with `text` on the reader's dashboard; the response, whatever it is. */
async function putNote(page: Page, text: string) {
  const layout = await ok<Layout>(
    await page.request.get(`${API}/dashboard/layout`)
  );
  const others = layout.placements.filter(p => p.widgetId !== CARD);
  return page.request.put(`${API}/dashboard/layout`, {
    data: {
      placements: [
        {
          id: "e2e-note",
          widgetId: CARD,
          ...(await defaultSizeOf(page, CARD)),
          removed: false,
          config: { text },
        },
        ...others,
      ],
      version: layout.version,
      scope: layout.scope,
    },
  });
}

test("a Note draws its reader's Markdown, and runs none of it", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  await gotoAdmin(page, "/");
  await ok(
    await putNote(
      page,
      `## Before Friday ${stamp}\n\n- **ship** it\n\n[docs](https://nextlyhq.com/docs)\n\n<script>window.__noteRan = true</script>`
    )
  );
  await gotoAdmin(page, "/");

  const card = page.getByTestId(`widget-cell-${CARD}`);
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("heading", { name: `Before Friday ${stamp}` })
  ).toBeVisible();
  const link = card.getByRole("link", { name: "docs" });
  await expect(link).toHaveAttribute("href", "https://nextlyhq.com/docs");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  // The script is shown as the text it is, and never ran.
  await expect(card).toContainText("<script>");
  expect(
    await page.evaluate(
      () => (window as unknown as { __noteRan?: boolean }).__noteRan
    )
  ).toBeUndefined();
});

test("an unwritten Note is empty by its declaration, saying where to write it", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  // Whitespace alone is no note: judged on the server by the declaration's
  // `isEmpty`, and drawn by the frame with the declared message.
  await ok(await putNote(page, "   "));
  await gotoAdmin(page, "/");
  const card = page.getByTestId(`widget-cell-${CARD}`);
  await expect(card.getByTestId("card-empty")).toHaveText(
    "Nothing written yet. Write it in the card's settings."
  );
});

test("a Note over its bound is refused by the layout write", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const res = await putNote(page, "x".repeat(2001));
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("is at most 2000 characters");
});
