/**
 * Performing a release through the ORDINARY content mutation.
 *
 * ## Why this is thin on purpose
 *
 * Publishing already knows how to publish. `updateEntry` authorizes the
 * transition, runs the hooks, records the outbox event, and — for a
 * draft-split collection — folds the pending working draft into the live write
 * and deletes the sidecar in the same transaction. A materialiser that wrote
 * rows itself would be a second implementation of publishing, and the first one
 * a scheduled publish diverged from would be the one nobody was watching.
 *
 * So this maps a decision onto a call and does nothing else.
 *
 * ## Why it goes through the bound content client
 *
 * The write runs as the member's author, and `createJobContentApi` is where
 * that binding already lives — including clearing every authorization-bearing
 * option so an instance default cannot reinstate one. Binding the identity here
 * instead would be a second place to get that right, and the first version of
 * that binding had five ways through it.
 *
 * ## Why the locale travels
 *
 * A member may name one language. The READ seam deliberately ignores such a
 * member, because per-locale lifecycle is not on the row it filters — but the
 * write can express it, by writing that language's companion row and leaving
 * the main row alone, which is exactly what an ordinary localized publish does.
 * Passing the locale through is what keeps a one-language release from
 * publishing every language.
 *
 * ## Why a document-wide member sends the wildcard
 *
 * A member that names NO language means the document — all of it. Sending
 * `undefined` said something quieter and wrong: "use the default language",
 * which moved the main row and the default translation and left every other
 * translation where it was. A scheduled takedown therefore pulled a page down
 * and went on serving its German version, which is worse than not scheduling
 * it, because the release reported success.
 *
 * {@link EVERY_LOCALE} says the thing that was meant. It rides the ordinary
 * mutation like any other locale, so this module keeps its one job of mapping a
 * decision onto a call — the sweep is the write path's business, and lives
 * beside the write that has to be atomic with it.
 *
 * ## Why the member is marked inside the write
 *
 * The drain needs to know afterwards whether a member's write landed: a pass
 * the host ends part-way leaves the next pass to plan the same documents, and
 * a write that rejected may still have committed. So the write carries a
 * receipt (`runWithWriteReceipt`) that the content write path performs in its
 * own transaction, once it has stored the live row: the member is marked with
 * the release revision when the stored status is the one the action names.
 * It commits exactly when the write does. A refused write rolls back and
 * leaves no mark, and a write whose hook changed the status leaves none, so
 * nothing needs to read the document back, where a read hook could rewrite
 * what it reports.
 *
 * @module domains/releases/release-mutations
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import {
  runWithWriteReceipt,
  type WrittenState,
} from "../../shared/lib/write-receipt";
import { EVERY_LOCALE } from "../i18n/locale-selector";
import { createJobContentApi } from "../jobs/job-content-api";
import type { JobContentSource } from "../jobs/job-content-api";

import type { ReleaseMutations, ReleaseWrite } from "./apply-due-releases";
import { recordMemberApplied } from "./releases-repository";

/**
 * The status an unpublish lands on.
 *
 * Not a separate operation: the lifecycle has two values, and the transition
 * gate reads the status a write NAMES — `transitionNextStatus === "published"`
 * is a publish and anything else is an unpublish. Naming the target status is
 * therefore the whole of it.
 */
const WITHDRAWN_STATUS = "draft";

export function createReleaseMutations(deps: {
  /** The Direct API. Injected for the reason the applier's own deps are. */
  contentApi: JobContentSource;
}): ReleaseMutations {
  const write = async (
    { ref, user, receipt }: ReleaseWrite,
    status: string
  ): Promise<void> => {
    const content = createJobContentApi(user, deps.contentApi);
    // A member that names no language means the whole document; see the module
    // note. `undefined` would mean "the default language" and leave the rest live.
    const locale = ref.locale ?? EVERY_LOCALE;

    // Marks the member only when the write stored the status this action
    // names; a hook that changed it means the action did not happen.
    const record = async (
      tx: TransactionContext,
      written: WrittenState
    ): Promise<void> => {
      if (written.status !== status) return;
      await recordMemberApplied(tx, {
        id: receipt.memberId,
        revision: receipt.revision,
        ref,
      });
    };

    await runWithWriteReceipt(
      {
        target: {
          // The write below goes to a Single or else to a collection entry.
          scopeKind: ref.scopeKind === "single" ? "single" : "collection",
          scopeSlug: ref.scopeSlug,
          entryId: ref.entryId,
        },
        record,
      },
      async () => {
        if (ref.scopeKind === "single") {
          await content.updateSingle({
            slug: ref.scopeSlug as never,
            data: { status },
            locale,
          });
          return;
        }

        await content.update({
          collection: ref.scopeSlug as never,
          id: ref.entryId,
          data: { status },
          locale,
        });
      }
    );
  };

  return {
    publish: input => write(input, "published"),
    unpublish: input => write(input, WITHDRAWN_STATUS),
  };
}
