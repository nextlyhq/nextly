/**
 * The setup card as a browser test needs it: placed first on the dashboard
 * with an answer of the test's choosing, and the project's sample-content
 * probe answered as the route would for this person.
 *
 * The playground ships no sample-content route, and the card's own answer
 * depends on what other specs in the run have created, so the layout read is
 * passed through with the card placed, and the card's slot in the dashboard's
 * batch (`POST /dashboard/query`) is replaced. Everything else is the real
 * admin and the server's own answers.
 *
 * @module tests/support/setup-card
 */
import type { Page, Request, Route } from "@playwright/test";

import { isLayoutRead } from "./dashboard-layout";

/** The setup card's widget id, as core registers it. */
const SETUP_WIDGET_ID = "core/setup";

/** The card's id in the mocked layout. */
const SETUP_CARD_ID = "e2e-setup";

/**
 * Answer the sample-content probe with `status`, as the route would for this
 * person. Resolves `release` lets a test hold the answer, to look at the page
 * while the offer is still unanswered. Returns the probes seen, so a test can
 * show the probe was asked: an offer that is absent because nothing asked is
 * not an offer refused.
 */
export async function answerProbe(
  page: Page,
  status: 200 | 403,
  hold?: Promise<void>
): Promise<Request[]> {
  const probes: Request[] = [];
  await page.route("**/admin/api/seed", async (route: Route) => {
    if (route.request().method() !== "HEAD") return route.fallback();
    probes.push(route.request());
    if (hold) await hold;
    await route.fulfill({
      status,
      headers:
        status === 200
          ? {
              "x-nextly-seed-template": "blog",
              "x-nextly-seed-template-label": "Blog",
            }
          : {},
      body: "",
    });
  });
  return probes;
}

/** The dashboard's batch, whatever its query string. */
const isBatchRead = (url: URL) => url.pathname.endsWith("/dashboard/query");

/**
 * Pass the layout read through with the setup card placed first, at `w`
 * columns, and the dashboard's batch through with the card's own slot answered
 * with `data`, the card's `load` answer (`SetupCardData`). The batch is fetched for real and answered whole
 * (`{ results }`), which the admin reads as it reads a stream, so every other
 * card is drawn from the server's own answer.
 */
export async function placeSetupCard(
  page: Page,
  data: unknown,
  w = 6
): Promise<void> {
  // Whether the reader's last write took the card off. Writes are answered here and never reach
  // the server, so a test that hides the card leaves the stored dashboard as it found it.
  let removed = false;
  await page.route(isLayoutRead, async (route: Route) => {
    if (route.request().method() === "PUT") {
      const sent = route.request().postDataJSON() as {
        placements?: Array<{ id?: string; removed?: boolean }>;
      };
      const card = sent.placements?.find(p => p.id === SETUP_CARD_ID);
      removed = card === undefined || card.removed === true;
      await route.fulfill({ status: 200, json: { message: "ok", item: {} } });
      return;
    }
    if (route.request().method() !== "GET") return route.fallback();
    // A read still in flight when the test ends fails its fetch. Aborted rather
    // than thrown: a throw out of the handler fails a test that had passed,
    // and its message prints the request, session cookie included.
    let response: Awaited<ReturnType<Route["fetch"]>>;
    try {
      response = await route.fetch();
    } catch {
      await route.abort().catch(() => {});
      return;
    }
    const body = (await response.json()) as Record<string, unknown>;
    // The read may come bare or in a `data` envelope; place the card in
    // whichever holds the placements.
    const layout = (Array.isArray(body.placements) ? body : body.data) as {
      placements: Array<Record<string, unknown>>;
    };
    // The array order IS the dashboard's order, so the card goes first by
    // being first in the list. A mocked read, so the size is the card's drawn
    // one, not checked by a write.
    layout.placements = [
      {
        id: SETUP_CARD_ID,
        widgetId: SETUP_WIDGET_ID,
        w,
        h: 4,
        removed,
      },
      ...layout.placements.filter(p => p.widgetId !== SETUP_WIDGET_ID),
    ];
    await route.fulfill({ response, json: body });
  });
  await page.route(isBatchRead, async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const asked = (
      route.request().postDataJSON() as {
        queries?: Array<{ widget?: string } | null>;
      }
    ).queries;
    let response: Awaited<ReturnType<Route["fetch"]>>;
    try {
      response = await route.fetch();
    } catch {
      await route.abort().catch(() => {});
      return;
    }
    // The server streams one `{ index, slot }` line per settled slot, or
    // answers `{ results }` whole: read either into slots by position.
    // The page may move on, or the test end, while the body is read: the
    // response is then disposed, and the request is aborted rather than thrown.
    let text: string;
    try {
      text = await response.text();
    } catch {
      await route.abort().catch(() => {});
      return;
    }
    const results: unknown[] = [];
    try {
      const whole = JSON.parse(text) as { results?: unknown[] };
      results.push(...(whole.results ?? []));
    } catch {
      for (const line of text.split("\n")) {
        if (line.trim() === "") continue;
        const { index, slot } = JSON.parse(line) as {
          index: number;
          slot: unknown;
        };
        results[index] = slot;
      }
    }
    (asked ?? []).forEach((query, index) => {
      if (query?.widget === SETUP_WIDGET_ID) {
        results[index] = { ok: true, result: { op: "data", data } };
      }
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { results },
    });
  });
}
