/**
 * Runs one of core's declared cards' `load` as a person, against whatever
 * instance the calling test booted: the settings resolved as core's batch
 * resolves a stored card's, and read services bound to the person as the batch
 * binds them, core's own reads beside them.
 *
 * The one check the batch adds is left out: whether the person may read the
 * card's source at all, which the route asks. Each read is still validated as
 * a card's query is, and runs with the person's own read rules, which is what
 * these tests are about.
 *
 * @module domains/widgets/__tests__/core-card-load
 */

import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { resolveCardSettings } from "../declaration/card-settings";
import type {
  WidgetDataInput,
  WidgetLoadSize,
} from "../declaration/define-widget";
import { bindReadServices } from "../declaration/read-services";
import { validateWidgetQuery, type WidgetQuery } from "../query";

/** A medium card at its widget's usual size, where a test does not say. */
const MEDIUM: WidgetLoadSize = { w: 6, h: 3, tier: "medium" };

/**
 * Read services bound to `caller` at the batch's instant `now`, as the batch
 * binds a card's, each read validated as a card's query is and told to `asked`.
 */
export function servicesFor(
  caller: ReadCaller,
  now: Date,
  signal: AbortSignal = new AbortController().signal,
  asked?: (query: WidgetQuery) => void
) {
  return bindReadServices({
    caller,
    prepare: async query => {
      const checked = validateWidgetQuery(query);
      asked?.(checked);
      return checked;
    },
    signal,
    now,
  });
}

/** What `widget` answers for a card holding `stored`, asked by `caller`. */
export async function loadCard<Data>(
  widget: {
    settings?: unknown;
    load: (input: WidgetDataInput<never>) => Promise<Data>;
  },
  stored: Record<string, unknown>,
  caller: ReadCaller,
  options: {
    size?: WidgetLoadSize;
    now?: Date;
    /** Told each query the load asks, as it was checked, before it runs. */
    asked?: (query: WidgetQuery) => void;
  } = {}
): Promise<Data> {
  const now = options.now ?? new Date();
  const signal = new AbortController().signal;
  const input = {
    settings: resolveCardSettings(widget.settings, stored),
    user: caller.user,
    signal,
    now,
    size: options.size ?? MEDIUM,
    scope: {
      getOrCompute: <T>(_key: string, compute: () => Promise<T>) => compute(),
    },
    services: servicesFor(caller, now, signal, options.asked),
  };
  // The settings are typed by each widget's declaration; resolved here as the
  // batch resolves them, they are the same values under a wider type.
  return widget.load(input as unknown as WidgetDataInput<never>);
}
