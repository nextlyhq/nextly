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
 * @module domains/releases/release-mutations
 */

import { NextlyError } from "../../errors/nextly-error";
import type { UserContext } from "../collections/services/collection-types";
import { createJobContentApi } from "../jobs/job-content-api";
import type { JobContentSource } from "../jobs/job-content-api";

import type { ReleaseMutations } from "./apply-due-releases";
import type { DocumentRef } from "./releases-repository";

/**
 * The status an unpublish lands on.
 *
 * Not a separate operation: the lifecycle has two values, and the transition
 * gate reads the status a write NAMES — `transitionNextStatus === "published"`
 * is a publish and anything else is an unpublish. Naming the target status is
 * therefore the whole of it.
 */
const WITHDRAWN_STATUS = "draft";

/**
 * The document-wide lifecycle operations, as a release needs them.
 *
 * Separate from the Direct API port above because they are not on it: setting a
 * document's status across every language lives on the collections handler, and
 * the Direct API exposes only the ordinary per-locale `update`. Threading it as
 * its own narrow port keeps this module from acquiring the whole handler, and
 * keeps the shape of what a release is allowed to do visible in one place.
 */
export interface AllLocalesLifecyclePort {
  publishAllLocales(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
  }): Promise<{ success: boolean; message?: string }>;
  unpublishAllLocales(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
  }): Promise<{ success: boolean; message?: string }>;
}

export function createReleaseMutations(deps: {
  /** The Direct API. Injected for the reason the applier's own deps are. */
  contentApi: JobContentSource;
  /**
   * The all-languages lifecycle, used for every DOCUMENT-WIDE collection member.
   *
   * Optional so a runtime that has not wired it keeps the previous behaviour
   * rather than failing to construct — but a localized collection then has the
   * defect this port exists to close, so every real wiring site supplies it.
   */
  allLocales?: AllLocalesLifecyclePort;
}): ReleaseMutations {
  const write = async (
    ref: DocumentRef,
    user: UserContext,
    status: string
  ): Promise<void> => {
    const content = createJobContentApi(user, deps.contentApi);
    const locale = ref.locale ?? undefined;

    if (ref.scopeKind === "single") {
      await content.updateSingle({
        slug: ref.scopeSlug as never,
        data: { status },
        locale,
      });
      return;
    }

    // A DOCUMENT-WIDE member goes through the all-languages operation, because
    // an ordinary update carrying no locale reaches the default language only.
    // On a localized collection that is the defect: a withdrawal would leave
    // every other translation published while the read seam hid the whole entry,
    // so a translation reappears the moment the projection goes away.
    //
    // Safe for a NON-localized collection too — `publishAllLocales` states that
    // it is then a plain publish of the single row — so this needs no knowledge
    // of whether the collection is localized, which this module does not have.
    if (deps.allLocales !== undefined && ref.locale == null) {
      const result =
        status === "published"
          ? await deps.allLocales.publishAllLocales({
              collectionName: ref.scopeSlug,
              entryId: ref.entryId,
              user,
            })
          : await deps.allLocales.unpublishAllLocales({
              collectionName: ref.scopeSlug,
              entryId: ref.entryId,
              user,
            });
      // THROWN, not returned. The applier reads a rejection as WRITE_FAILED and
      // holds the release open for the next pass; a refusal returned as a value
      // would be read as success, and the release would discharge having taken
      // nothing down. The handler answers with an envelope rather than throwing,
      // so this boundary is where the two conventions meet.
      if (!result.success) {
        // A NextlyError, not a bare one: this refusal is caller-fixable — the
        // handler's own message names the collection and tells an operator to
        // run `nextly migrate` — and a bare Error would reach the API layer
        // without a code and be reported as a 500, which reads as "the server
        // broke" rather than "this document cannot be taken down yet".
        throw NextlyError.conflict({
          reason: "state",
          message:
            result.message ?? "the all-languages lifecycle write was refused",
        });
      }
      return;
    }

    await content.update({
      collection: ref.scopeSlug as never,
      id: ref.entryId,
      data: { status },
      locale,
    });
  };

  /** The stored lifecycle of whatever a document read returned. */
  const statusOf = (doc: unknown): string | undefined => {
    if (doc === null || typeof doc !== "object") return undefined;
    const status = (doc as Record<string, unknown>).status;
    return typeof status === "string" ? status : undefined;
  };

  const currentStatus = async (
    ref: DocumentRef
  ): Promise<string | undefined> => {
    // TRUSTED, and deliberately not through the bound client. This read is not
    // the member's action — it asks the database whether a write committed, so
    // that a post-commit hook failure is not replayed forever. Running it as the
    // author would deny it whenever that person may publish this scope but has
    // no independent READ permission on it, and the verification would then
    // report every committed write as failed for exactly the roles most likely
    // to own a scheduled publish.
    const content = deps.contentApi;
    const locale = ref.locale ?? undefined;

    if (ref.scopeKind === "single") {
      const doc = await content.findSingle({
        slug: ref.scopeSlug as never,
        locale,
        overrideAccess: true,
        // The stored lifecycle, not what a published read would admit: a due
        // release is applied AT READ TIME, so a bounded read would report the
        // document as published whether or not this write landed.
        status: "all",
      } as never);
      return statusOf(doc);
    }

    const doc = await content.findByID({
      collection: ref.scopeSlug as never,
      id: ref.entryId,
      locale,
      overrideAccess: true,
      status: "all",
    } as never);
    return statusOf(doc);
  };

  return {
    publish: ({ ref, user }) => write(ref, user, "published"),
    unpublish: ({ ref, user }) => write(ref, user, WITHDRAWN_STATUS),
    applied: async ({ ref, effect }) => {
      const status = await currentStatus(ref);
      return effect === "publish"
        ? status === "published"
        : status === WITHDRAWN_STATUS;
    },
  };
}
