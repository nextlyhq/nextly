/**
 * `/api/dashboard/setup` — what the signed-in super-admin's setup card
 * remembers for them, and the changes they make to it.
 *
 *   GET /api/dashboard/setup   `{ collapsed, dismissed, skipped, resumable }`
 *   PUT /api/dashboard/setup   `{ collapsed?, dismissed?, skip?, retire?, sample? }`, one or more
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
 * `sample` answers sample content for the whole site, not for the reader:
 * `"decline"` declines it, and `{ record: <run> }` records a load that loaded
 * but could not be recorded, without loading again
 * (`database/seeders/sample-content`). Both live here rather than in the
 * project's sample-content route, so neither can reach a route that loads. A
 * decline or record the site's answer has moved past is refused as a conflict
 * saying why; a record that fails again is an error, and the run stays as it
 * was. The answer carries the site's answer after the change.
 *
 * Internal to the admin, not published API.
 *
 * @module api/dashboard-setup
 * @experimental
 */
import { z } from "zod";

import {
  declineSampleContent,
  readSampleContent,
  recordSampleContent,
  SAMPLE_REFUSAL_MESSAGE,
  type SampleContentState,
  type SampleRefusal,
} from "../database/seeders/sample-content";
import { getService } from "../di";
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
    sample: z
      .union([
        z.literal("decline"),
        // A run is a random token: nothing longer is one.
        z.object({ record: z.string().min(1).max(100) }).strict(),
      ])
      .optional(),
  })
  .strict()
  .refine(
    change =>
      change.collapsed !== undefined ||
      change.dismissed !== undefined ||
      change.skip !== undefined ||
      change.retire !== undefined ||
      change.sample !== undefined,
    {
      message:
        "Name at least one of collapsed, dismissed, skip, retire or sample.",
    }
  );

/** A sample-content answer the site has moved past: refused, saying why. */
function sampleRefused(refusal: SampleRefusal): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message: SAMPLE_REFUSAL_MESSAGE[refusal.reason],
    logContext: { sample: refusal.reason },
  });
}

/**
 * Applies a sample-content answer for the whole site, as `by`, and answers
 * the site's answer after it. A refusal or a record that failed again throws.
 */
async function answerSample(
  sample: "decline" | { record: string },
  by: string
): Promise<SampleContentState> {
  const store = getService("metaService");
  if (sample === "decline") {
    const declined = await declineSampleContent(store, { by });
    if (declined.outcome === "refused") throw sampleRefused(declined);
    return readSampleContent(store);
  }
  const recorded = await recordSampleContent(store, { run: sample.record });
  if (recorded.outcome === "refused") throw sampleRefused(recorded);
  if (recorded.outcome === "unrecorded") {
    throw NextlyError.internal({
      logContext: {
        reason: "sample-content-unrecorded",
        failure: recorded.failure,
      },
    });
  }
  return readSampleContent(store);
}

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
        'The body must name at least one of `collapsed` or `dismissed` (true or false), `skip: { kind, skipped }` with a kind that may be skipped, `retire: { sampleRefused }`, or `sample` as `"decline"` or `{ record }`.',
    });
  }
  const { collapsed, dismissed, skip, retire, sample } = parsed.data;
  // First, so a retirement sent with it is judged with the site's answer.
  const answered =
    sample === undefined
      ? undefined
      : await answerSample(sample, caller.user.id);
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
  return respondMutation("Saved.", {
    ...stateView(state),
    ...(answered === undefined ? {} : { sample: answered }),
  });
});
