/**
 * The signed-in reader's dashboard pins: the entries and Singles they keep to
 * come back to, read from and written to the server so they follow the reader
 * across devices.
 *
 * The server decides what a reader is shown (a pin they may no longer read is
 * left out) and refuses a pin past the limit; this hook only reads that answer
 * and writes the reader's choices, then reads the answer again.
 *
 * @experimental Until the dashboard draws its pins.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useCallback } from "react";

import { protectedApi } from "@admin/lib/api/protectedApi";

/** The one query key this feature owns, so a pin can invalidate exactly it. */
const DASHBOARD_PINS_KEY = ["dashboard", "pins"] as const;

const PINS_PATH = "/dashboard/pins";

/** What a pin names: an entry of a collection, or a Single. */
export type PinTarget =
  | { targetType: "collection"; targetSlug: string; entryId: string }
  | { targetType: "single"; targetSlug: string };

/** One pin as the reader is shown it. */
interface ShownPin {
  targetType: "collection" | "single";
  targetSlug: string;
  /** The pinned entry's id; "" for a Single. */
  entryId: string;
  title: string;
  pinnedAt: string;
}

/** Whether a shown pin names `target`. */
function pinNames(pin: ShownPin, target: PinTarget): boolean {
  return (
    pin.targetType === target.targetType &&
    pin.targetSlug === target.targetSlug &&
    pin.entryId === (target.targetType === "collection" ? target.entryId : "")
  );
}

/** The reader's pins they may read, newest first. */
function useDashboardPins() {
  return useQuery({
    queryKey: DASHBOARD_PINS_KEY,
    queryFn: async () =>
      (await protectedApi.get<{ items: ShownPin[] }>(PINS_PATH)).items,
  });
}

/** Pin or unpin a target, then read the reader's pins again. */
function useSetPinned(): UseMutationResult<
  unknown,
  Error,
  { target: PinTarget; pinned: boolean }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ target, pinned }) =>
      pinned
        ? protectedApi.post(PINS_PATH, target)
        : protectedApi.delete(PINS_PATH, target),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: DASHBOARD_PINS_KEY }),
  });
}

/**
 * Whether `target` is pinned, as the reader is shown it, and a way to set it.
 * `null` while the pins are still being read, so a control can wait rather
 * than offer the wrong verb. `set` takes the state wanted rather than
 * flipping the current one, so an undo restores what was there before the
 * choice, whatever the pins read since.
 */
export function usePinned(target: PinTarget | null): {
  pinned: boolean | null;
  set: (pinned: boolean) => Promise<unknown>;
  pending: boolean;
} {
  const pins = useDashboardPins();
  const setPinned = useSetPinned();
  const pinned =
    target === null || pins.data === undefined
      ? null
      : pins.data.some(pin => pinNames(pin, target));
  const { mutateAsync } = setPinned;
  const set = useCallback(
    (wanted: boolean) =>
      target === null
        ? Promise.resolve()
        : mutateAsync({ target, pinned: wanted }),
    [mutateAsync, target]
  );
  return { pinned, set, pending: setPinned.isPending };
}
