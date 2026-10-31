/**
 * `runWidgetLoad`: one card of a widget answered for a given person, against a
 * test instance, exactly as the dashboard answers it.
 *
 * It asks the dashboard's own query route (`POST /api/dashboard/query`) with
 * that person's session and a card of the widget with the settings given, as
 * the settings sheet's preview does. So every gate is the dashboard's: the
 * widget offered to the person at all, its `access`, `shows`, the settings
 * resolved with the site's overrides, `load` with reads bound to the person,
 * and its `isEmpty`. Nothing here judges access a second way.
 *
 * @module plugins/test-widget-load
 * @experimental Until the widget SDK's test helpers settle.
 */
import { postWidgetQuery } from "../api/widget-query";
import { buildClaims } from "../auth/jwt/claims";
import { signAccessToken } from "../auth/jwt/sign";
import type {
  AnyWidget,
  WidgetData,
  WidgetSettingValues,
} from "../domains/widgets/declaration/define-widget";
import type { WidgetSlot } from "../domains/widgets/result";
import { NextlyError } from "../errors/nextly-error";
import { env } from "../lib/env";

import type { TestNextly } from "./test-nextly";
// The card's states are declared beside the card helpers, which draw them in
// a browser test, so this module's server graph stays out of that one.
import type { WidgetLoadResult } from "./test-widget-card";

export interface RunWidgetLoadOptions<W> {
  /** The person the card is answered for, by user id; `null` for nobody signed in. */
  as: { id: string } | null;
  /** Settings the card is asked with; each left out takes its starting value. */
  settings?: Partial<WidgetSettingValues<W>>;
  /** The size the card is drawn at, which its `load` is handed. */
  size?: { w: number; h: number; tier: "small" | "medium" | "large" };
  /** Aborts the request, as a reader leaving the dashboard does. */
  signal?: AbortSignal;
}

/** An answered slot: its data, ready or empty as the route judged it. */
function answeredResult<W>(
  slot: Extract<WidgetSlot, { ok: true }>
): WidgetLoadResult<W> {
  // A view of the widget's own travels as `{ op: "data", data }`; a core
  // view's data is the answer itself, its `op` added by core.
  const { op, ...rest } = slot.result as { op: string; data?: unknown };
  const data = (op === "data" ? rest.data : rest) as WidgetData<W>;
  return slot.empty ? { state: "empty", data } : { state: "ready", data };
}

/** A slot the route answered without data, by its code; any other is an error. */
function unansweredResult<W>(
  slot: Extract<WidgetSlot, { ok: false }>
): WidgetLoadResult<W> {
  if ("code" in slot && slot.code === "needs-setting") {
    return { state: "needs-setting", setting: slot.setting };
  }
  if ("code" in slot && slot.code === "unavailable") {
    return { state: "unavailable" };
  }
  if ("code" in slot && slot.code === "not-shown")
    return { state: "not-shown" };
  return { state: "error", error: slot.error };
}

/** A card's slot as the route answers it, in the states the result names. */
function resultOf<W>(slot: WidgetSlot): WidgetLoadResult<W> {
  return slot.ok ? answeredResult<W>(slot) : unansweredResult<W>(slot);
}

/**
 * Answers one card of `widget` for the person `as` names, on the test
 * instance `t` the widget is registered on, as the dashboard would.
 *
 * Nobody signed in (`as: null`) is answered "unavailable": the dashboard
 * answers no card to a request without a session.
 */
export async function runWidgetLoad<W extends AnyWidget>(
  t: TestNextly,
  widget: W,
  options: RunWidgetLoadOptions<W>
): Promise<WidgetLoadResult<W>> {
  if (options.as === null) return { state: "unavailable" };
  // The person as the instance holds them, so the session names who they are
  // and a test naming nobody it created fails here, not as a refused card.
  const person = await t.nextly.users.findByID({ id: options.as.id });
  if (person === null) {
    throw NextlyError.invalidInput({
      message: `runWidgetLoad: no user ${options.as.id} on this test instance.`,
    });
  }
  // Read as the route reads it, so the session signed here is one it accepts.
  const secret = env.NEXTLY_SECRET;
  if (!secret) {
    throw NextlyError.invalidInput({
      message:
        "runWidgetLoad signs the person in, so NEXTLY_SECRET must be set before the test instance boots.",
    });
  }
  const token = await signAccessToken(
    buildClaims({
      userId: person.id,
      email: person.email,
      name: person.name ?? "",
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    secret
  );
  const response = await postWidgetQuery(
    new Request("http://localhost/api/dashboard/query", {
      method: "POST",
      headers: {
        cookie: `nextly_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        queries: [
          {
            widget: widget.id,
            settings: options.settings ?? {},
            ...(options.size === undefined ? {} : { size: options.size }),
          },
        ],
      }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  );
  if (!response.ok) {
    return {
      state: "error",
      error: `The dashboard answered ${response.status}`,
    };
  }
  // The route answers one slot per entry asked for, in order, and one was.
  const { results } = (await response.json()) as { results: [WidgetSlot] };
  return resultOf<W>(results[0]);
}
