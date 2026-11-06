/**
 * `/api/dashboard/pins` — the signed-in person's pinned entries and Singles.
 *
 *   GET    /api/dashboard/pins   their pins they may read, newest first, titled
 *   POST   /api/dashboard/pins   pin `{ targetType, targetSlug, entryId? }`
 *   DELETE /api/dashboard/pins   unpin the same body
 *
 * The person is ALWAYS the signed-in user, never a parameter. An API key is
 * refused: pins are a person's own dashboard, and a key has none.
 *
 * @module api/dashboard-pins
 * @experimental Until the dashboard draws its pins.
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
import { respondAction, respondList } from "./response-shapes";
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
  const pins = await service().list(caller);
  return respondList(
    pins,
    {
      total: pins.length,
      page: 1,
      // One page holds every pin a reader can keep.
      limit: MAX_PINS_PER_READER,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
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

export const deleteDashboardPin = withErrorHandler(async (req: Request) => {
  const caller = await readCaller(
    await signedInPerson(req, "have dashboard pins")
  );
  const target = await targetOf(req);
  const removed = await service().unpin(caller, target);
  return respondAction(removed ? "Unpinned." : "Not pinned.", {
    unpinned: removed,
  });
});
