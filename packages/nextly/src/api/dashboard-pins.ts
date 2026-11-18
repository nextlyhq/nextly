/**
 * `/api/dashboard/pins` — the signed-in person's pinned entries and Singles.
 *
 *   GET    /api/dashboard/pins   their pins they may read, newest first, titled,
 *                                 and `unreadableCount`: how many of their pins
 *                                 name documents they may no longer read (a
 *                                 count alone; no target of one is answered)
 *   POST   /api/dashboard/pins   pin `{ targetType, targetSlug, entryId? }`
 *   DELETE /api/dashboard/pins   unpin the same body
 *   DELETE /api/dashboard/pins?unreadable=1
 *                                 remove their pins of documents they may not
 *                                 read now, asked again per pin; no body
 *
 * The person is ALWAYS the signed-in user, never a parameter. An API key is
 * refused: pins are a person's own dashboard, and a key has none.
 *
 * @module api/dashboard-pins
 */
import { z } from "zod";

import {
  MAX_PINS_PER_READER,
  type PinTarget,
} from "../domains/dashboard/dashboard-pins";
import { NextlyError } from "../errors/nextly-error";
import { dashboardPinsService as service } from "../services/dashboard/dashboard-pins-service";

import { PRIVATE_NO_STORE_HEADERS, readCaller } from "./authenticated-read";
import { readBoundedJsonBody } from "./read-json-body";
import { respondAction, respondData } from "./response-shapes";
import { signedInPerson } from "./signed-in-person";
import { withErrorHandler } from "./with-error-handler";

/** A pin body names one target; nothing larger is a real one. */
const MAX_PIN_BODY_BYTES = 4 * 1024;

/** What a pin or an unpin names: an entry of a collection, or a Single. */
const pinTarget = z.discriminatedUnion("targetType", [
  z
    .object({
      targetType: z.literal("collection"),
      targetSlug: z.string().min(1).max(191),
      entryId: z.string().min(1).max(191),
    })
    .strict(),
  z
    .object({
      targetType: z.literal("single"),
      targetSlug: z.string().min(1).max(191),
    })
    .strict(),
]);

/** The target a pin or unpin body names, or a refusal saying what it must be. */
async function targetOf(req: Request): Promise<PinTarget> {
  const parsed = pinTarget.safeParse(
    await readBoundedJsonBody(req, MAX_PIN_BODY_BYTES, {
      route: "dashboard-pins",
    })
  );
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message:
        'The body must be `{ targetType: "collection", targetSlug, entryId }` or `{ targetType: "single", targetSlug }`.',
    });
  }
  return parsed.data;
}

export const getDashboardPins = withErrorHandler(async (req: Request) => {
  const caller = await readCaller(
    await signedInPerson(req, "have dashboard pins")
  );
  const { shown, unreadableCount } = await service().read(caller);
  return respondData(
    {
      items: shown,
      meta: {
        total: shown.length,
        page: 1,
        // One page holds every pin a reader can keep.
        limit: MAX_PINS_PER_READER,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
      // Still counted toward the limit, so the reader may remove them; a
      // count alone, since `DELETE ?unreadable=1` finds them on the server.
      unreadableCount,
    },
    { headers: PRIVATE_NO_STORE_HEADERS }
  );
});

export const postDashboardPin = withErrorHandler(async (req: Request) => {
  const caller = await readCaller(
    await signedInPerson(req, "have dashboard pins")
  );
  const target = await targetOf(req);
  await service().pin(caller, target);
  return respondAction("Pinned.", { pinned: true });
});

/**
 * Whether a DELETE asks to remove every pin the caller may no longer read
 * (`?unreadable=1`) rather than unpin the one target its body names; any
 * other value of `unreadable` is refused, so a typo never falls through to
 * the body.
 */
function removesUnreadable(req: Request): boolean {
  const asked = new URL(req.url).searchParams.get("unreadable");
  if (asked === null) return false;
  if (asked !== "1") {
    throw NextlyError.invalidInput({
      message:
        "`unreadable` must be 1, to remove the pins you can no longer open.",
    });
  }
  return true;
}

/** How a removal of the caller's closed pins says what it did. */
function removedMessage(removed: number): string {
  return removed === 1
    ? "Removed 1 pin you could no longer open."
    : `Removed ${removed} pins you could no longer open.`;
}

export const deleteDashboardPin = withErrorHandler(async (req: Request) => {
  const caller = await readCaller(
    await signedInPerson(req, "have dashboard pins")
  );
  if (removesUnreadable(req)) {
    // The service asks again, as the caller, which of their own pins they
    // may not read, and removes those alone; the request names none.
    const removed = await service().removeUnreadable(caller);
    return respondAction(removedMessage(removed), { removed });
  }
  const target = await targetOf(req);
  const removed = await service().unpin(caller, target);
  return respondAction(removed ? "Unpinned." : "Not pinned.", {
    unpinned: removed,
  });
});
