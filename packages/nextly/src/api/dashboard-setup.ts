/**
 * `/api/dashboard/setup` — what the signed-in super-admin's setup card
 * remembers for them, and the changes they make to it.
 *
 *   GET /api/dashboard/setup   `{ collapsed, dismissed, skipped, resumable }`
 *   PUT /api/dashboard/setup   `{ collapsed?, dismissed?, skip?, retire? }`, one or more
 *
 * The reader is ALWAYS the signed-in person, never a parameter. An API key is
 * refused, as a person's own dashboard is not a key's; so is anyone but a
 * super-admin, whom the card is not offered to (`domains/widgets/setup-card`).
 * The steps themselves are the card's `load`; this keeps only the reader's own
 * choices, in the dashboard preferences.
 *
 * `retire` asks for "You're all set" to be judged again over the steps the
 * card draws, with what only the admin can learn: whether the project's
 * sample-content route refuses this reader. It is judged as the card's load
 * judges it (`setupCardData`), and recorded only when every step drawn is
 * done; a reader can retire only their own card. When it is not recorded the
 * request is refused as a conflict; any other change sent with it still holds.
 *
 * Internal to the admin, not published API.
 *
 * @module api/dashboard-setup
 * @experimental
 */
import { z } from "zod";

import {
  changeSetupState,
  isSetupReader,
  setupCardData,
} from "../domains/widgets/setup-card";
import {
  readSetupState,
  type SetupState,
} from "../domains/widgets/setup-reader";
import { SETUP_SKIPPABLE_KINDS } from "../domains/widgets/setup-steps";
import { NextlyError } from "../errors/nextly-error";
import type { ReadCaller } from "../services/dashboard/readable-resources";

import { PRIVATE_NO_STORE_HEADERS, readCaller } from "./authenticated-read";
import { readBoundedJsonBody } from "./read-json-body";
import { respondData, respondMutation } from "./response-shapes";
import { signedInPerson } from "./signed-in-person";
import { withErrorHandler } from "./with-error-handler";

/** A change names a few booleans and one kind; nothing larger is a real one. */
const MAX_SETUP_BODY_BYTES = 1024;

/** The change a PUT may make: at least one of the four. */
const setupChange = z
  .object({
    collapsed: z.boolean().optional(),
    dismissed: z.boolean().optional(),
    skip: z
      .object({
        kind: z.enum(SETUP_SKIPPABLE_KINDS),
        skipped: z.boolean(),
      })
      .strict()
      .optional(),
    retire: z.object({ sampleRefused: z.boolean() }).strict().optional(),
  })
  .strict()
  .refine(
    change =>
      change.collapsed !== undefined ||
      change.dismissed !== undefined ||
      change.skip !== undefined ||
      change.retire !== undefined,
    { message: "Name at least one of collapsed, dismissed, skip or retire." }
  );

/**
 * The signed-in super-admin behind the request, or a refusal: an API key as
 * "Only a signed-in person can …", anyone else as forbidden.
 */
async function setupReader(req: Request): Promise<ReadCaller> {
  const caller = await readCaller(
    await signedInPerson(req, "set up the project from the dashboard")
  );
  if (!(await isSetupReader(caller))) {
    throw NextlyError.forbidden({
      logContext: { reason: "the setup card is for super-admins" },
    });
  }
  return caller;
}

/**
 * What the admin is told of a reader's card. `resumable` is whether the
 * header offers "Resume setup": the card was dismissed and has not yet said
 * "You're all set", after which it is gone for good.
 */
function stateView(state: SetupState) {
  return {
    collapsed: state.collapsed,
    dismissed: state.dismissed,
    skipped: SETUP_SKIPPABLE_KINDS.filter(kind => state.skipped.has(kind)),
    resumable: state.dismissed && state.retiredAt === undefined,
  };
}

export const getDashboardSetup = withErrorHandler(async (req: Request) => {
  const { user } = await setupReader(req);
  return respondData(stateView(await readSetupState(user.id)), {
    headers: PRIVATE_NO_STORE_HEADERS,
  });
});

export const putDashboardSetup = withErrorHandler(async (req: Request) => {
  const caller = await setupReader(req);
  const parsed = setupChange.safeParse(
    await readBoundedJsonBody(req, MAX_SETUP_BODY_BYTES, {
      route: "dashboard-setup",
    })
  );
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message:
        "The body must name at least one of `collapsed` or `dismissed` (true or false), `skip: { kind, skipped }` with a kind that may be skipped, or `retire: { sampleRefused }`.",
    });
  }
  const { collapsed, dismissed, skip, retire } = parsed.data;
  let state = await changeSetupState(caller.user.id, {
    ...(collapsed === undefined ? {} : { collapsed }),
    ...(dismissed === undefined ? {} : { dismissed }),
    ...(skip === undefined ? {} : { skip }),
  });
  if (retire !== undefined) {
    // After the change, so a skip sent with it counts; read again, as the
    // retirement may now be recorded.
    await setupCardData(caller, new Date(), retire);
    state = await readSetupState(caller.user.id);
    // Not recorded: a step the card draws is open as the host sees it now (the
    // site changed since the card was read), or the record could not be
    // written. Refused, so the card neither keeps saying it will not show
    // again nor takes the request as done.
    if (state.retiredAt === undefined) {
      throw NextlyError.conflict({
        reason: "state",
        message:
          "Setup is not all set: a step is still open. Reload the dashboard to see it.",
      });
    }
  }
  return respondMutation("Saved.", stateView(state));
});
