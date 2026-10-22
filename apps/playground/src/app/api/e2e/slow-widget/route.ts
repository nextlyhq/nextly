/**
 * Sets how long the slow fixture's card takes to answer:
 * `POST { "ms": 10000 }`, and `{ "ms": 0 }` to put it back.
 *
 * Answers 404 unless `NEXTLY_E2E_SLOW_WIDGET=1`, the switch that registers the
 * fixture at all, so a contributor's dev server has no such route.
 */
import { setSlowWidgetDelayMs } from "@/plugins/slow-widget-fixture/delay";

/** The longest delay a spec may ask for: past the per-card budget, short of a hung suite. */
const MAX_DELAY_MS = 60_000;

/** The delay a body asks for, kept within 0 and {@link MAX_DELAY_MS}; `undefined` without one. */
function delayFrom(body: unknown): number | undefined {
  const ms = (body as { ms?: unknown } | null)?.ms;
  return typeof ms === "number"
    ? Math.min(Math.max(Math.round(ms), 0), MAX_DELAY_MS)
    : undefined;
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.NEXTLY_E2E_SLOW_WIDGET !== "1") {
    return new Response(null, { status: 404 });
  }
  const ms = delayFrom(await request.json().catch(() => null));
  if (ms === undefined) {
    return Response.json({ error: "ms must be a number" }, { status: 400 });
  }
  setSlowWidgetDelayMs(ms);
  return Response.json({ ms });
}
