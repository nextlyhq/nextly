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
import { cardAnswerResult } from "../domains/widgets/declaration/card-answer";
import { toDefinition } from "../domains/widgets/declaration/declared-widgets";
import type {
  AnyWidget,
  WidgetData,
  WidgetSettingValues,
} from "../domains/widgets/declaration/define-widget";
import { displayOfView } from "../domains/widgets/declaration/displays";
import type { WidgetDefinition } from "../domains/widgets/definition";
import type { WidgetSlot } from "../domains/widgets/result";
import { UNAVAILABLE_SOURCE_MESSAGE } from "../domains/widgets/sources";
import { NextlyError } from "../errors/nextly-error";
import { env } from "../lib/env";

import type { TestNextly } from "./test-nextly";

/**
 * What one card answers, in the card's own states: its data, ready or empty;
 * the setting it waits for; not available to this person; not shown to them
 * by its `shows`; or the error its card would show.
 */
export type WidgetLoadResult<W> =
  | { state: "ready"; data: WidgetData<W> }
  | { state: "empty"; data: WidgetData<W> }
  | { state: "needs-setting"; setting: string }
  | { state: "unavailable" }
  | { state: "not-shown" }
  | { state: "error"; error: string };

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

/**
 * A widget as the registry publishes it to the admin: what a test draws its
 * card from, so the card is described exactly as the dashboard describes it.
 *
 * @internal For the SDK's test helpers; not a runtime API.
 */
export function publishedWidgetDefinition(
  widget: AnyWidget,
  owner = 'plugin "test"'
): WidgetDefinition {
  return toDefinition(
    widget as unknown as Parameters<typeof toDefinition>[0],
    owner
  );
}

/**
 * The answer a card is drawn with for a load result, as the dashboard's route
 * carries it: the data through the server's own `cardAnswerResult`, the other
 * states in the slot each would come back as. `undefined` while it loads.
 *
 * @internal For the SDK's test helpers; not a runtime API.
 */
export function widgetCardSlot<W extends AnyWidget>(
  widget: W,
  result: WidgetLoadResult<W> | { state: "loading" }
): WidgetSlot | undefined {
  switch (result.state) {
    case "loading":
      return undefined;
    case "ready":
    case "empty": {
      const answer = cardAnswerResult(displayOfView(widget.view), result.data, {
        widget: widget.id,
        owner: "test",
      });
      return result.state === "empty"
        ? { ok: true, result: answer, empty: true }
        : { ok: true, result: answer };
    }
    case "needs-setting":
      return {
        ok: false,
        error: `No ${result.setting} chosen yet`,
        code: "needs-setting",
        setting: result.setting,
      };
    case "unavailable":
      return {
        ok: false,
        error: UNAVAILABLE_SOURCE_MESSAGE,
        code: "unavailable",
      };
    case "not-shown":
      return { ok: false, error: "Not shown for you", code: "not-shown" };
    case "error":
      return { ok: false, error: result.error };
  }
}
