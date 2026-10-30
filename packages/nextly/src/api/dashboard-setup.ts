/**
 * `/api/dashboard/setup` — what the signed-in super-admin's setup card
 * remembers for them, and the changes they make to it.
 *
 *   GET /api/dashboard/setup   `{ collapsed, dismissed, skipped, resumable }`
 *   PUT /api/dashboard/setup   `{ collapsed?, dismissed?, skip? }`, one or more
 *
 * The reader is ALWAYS the signed-in person, never a parameter. An API key is
 * refused, as a person's own dashboard is not a key's; so is anyone but a
 * super-admin, whom the card is not offered to (`domains/widgets/setup-card`).
 * The steps themselves are the card's `load`; this keeps only the reader's own
 * choices, in the dashboard preferences.
 *
 * Internal to the admin, not published API.
 *
 * @module api/dashboard-setup
 * @experimental Until the dashboard's header reads `resumable`.
 */
import { z } from "zod";

import {
  changeSetupState,
  isSetupReader,
  readSetupState,
  type SetupState,
} from "../domains/widgets/setup-card";
import { SETUP_SKIPPABLE_KINDS } from "../domains/widgets/setup-steps";
import { NextlyError } from "../errors/nextly-error";

import { PRIVATE_NO_STORE_HEADERS, readCaller } from "./authenticated-read";
import { readBoundedJsonBody } from "./read-json-body";
import { respondData, respondMutation } from "./response-shapes";
import { signedInPerson } from "./signed-in-person";
import { withErrorHandler } from "./with-error-handler";

/** A change names a few booleans and one kind; nothing larger is a real one. */
const MAX_SETUP_BODY_BYTES = 1024;

/** The change a PUT may make: at least one of the three. */
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
  })
  .strict()
  .refine(
    change =>
      change.collapsed !== undefined ||
      change.dismissed !== undefined ||
      change.skip !== undefined,
    { message: "Name at least one of collapsed, dismissed or skip." }
  );

/**
 * The signed-in super-admin behind the request, or a refusal: an API key as
 * "Only a signed-in person can …", anyone else as forbidden.
 */
async function setupReader(req: Request): Promise<string> {
  const caller = await readCaller(
    await signedInPerson(req, "set up the project from the dashboard")
  );
  if (!(await isSetupReader(caller))) {
    throw NextlyError.forbidden({
      logContext: { reason: "the setup card is for super-admins" },
    });
  }
  return caller.user.id;
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
  const userId = await setupReader(req);
  return respondData(stateView(await readSetupState(userId)), {
    headers: PRIVATE_NO_STORE_HEADERS,
  });
});

export const putDashboardSetup = withErrorHandler(async (req: Request) => {
  const userId = await setupReader(req);
  const parsed = setupChange.safeParse(
    await readBoundedJsonBody(req, MAX_SETUP_BODY_BYTES, {
      route: "dashboard-setup",
    })
  );
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message:
        "The body must name at least one of `collapsed` or `dismissed` (true or false), or `skip: { kind, skipped }` with a kind that may be skipped.",
    });
  }
  const { collapsed, dismissed, skip } = parsed.data;
  const state = await changeSetupState(userId, {
    ...(collapsed === undefined ? {} : { collapsed }),
    ...(dismissed === undefined ? {} : { dismissed }),
    ...(skip === undefined ? {} : { skip }),
  });
  return respondMutation("Saved.", stateView(state));
});
