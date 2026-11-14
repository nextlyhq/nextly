/**
 * Every translated entity's translation table resolved once at boot, in the background.
 *
 * A write inside a caller's own transaction can only read a readiness verdict already resolved
 * (`cachedCompanionReadiness`): resolving queries, and inside the transaction that query could
 * abort it on PostgreSQL or wait for the connection it holds. After a restart nothing has resolved
 * one yet, so such a write treats the table as unusable — a rule's filter on a translated field
 * then matches nothing, and a write the filter allows is refused. Resolving each translated
 * entity's table here leaves a `ready` verdict for those writes, whichever way their transaction
 * was opened.
 *
 * Not awaited by the boot: it costs one probe per translated entity, and a cold start should not
 * wait for them. Until it finishes, a write inside a transaction refuses as it did before, failing
 * closed; a probe that fails is logged and the others go on.
 *
 * @module init/warm-companion-readiness
 */
import type { CompanionIntrospectAdapter } from "../domains/i18n/runtime/companion-io";
import { isCompanionReady } from "../domains/i18n/runtime/companion-readiness";
import {
  storedLocalizableEntities,
  type StoredRegistries,
} from "../domains/i18n/runtime/translated-unique-boot-check";
import { NextlyError } from "../errors/nextly-error";
import type { Logger } from "../services/shared";

import { awaitStartInFlight } from "./start-in-flight";

/** The warm-up the last boot started; already settled before any boot. */
let warmed: Promise<void> = Promise.resolve();

/** A failure as its code alone: a driver's message can name a table or a credential. */
const codeOf = (error: unknown): string =>
  NextlyError.is(error) ? error.code : "UNKNOWN";

/** Start resolving every translated entity's translation table; returns at once. */
export function startCompanionReadinessWarmUp(deps: {
  adapter: CompanionIntrospectAdapter;
  registries: StoredRegistries;
  logger: Pick<Logger, "warn">;
}): void {
  // Begun once the start in flight, if any, has handed its instance over, and
  // then after that turn, as the post-start tasks are. Registration calls this
  // part way through a start, and a turn alone ends at the start's next wait
  // on the database: begun then, the warm-up's registry listings ran among the
  // start's own statements and on its time, and whether one was still running
  // when the start resolved was a matter of timing. On SQLite, whose driver
  // blocks, reads begun before the turn would run on the start's time as well.
  warmed = awaitStartInFlight()
    .then(() => new Promise<void>(resolve => setImmediate(resolve)))
    .then(async () => {
      let entities: Awaited<ReturnType<typeof storedLocalizableEntities>>;
      try {
        entities = await storedLocalizableEntities(deps.registries);
      } catch (error) {
        deps.logger.warn(
          "The translated entities could not be listed to resolve their tables at boot",
          { code: codeOf(error) }
        );
        return;
      }
      for (const entity of entities) {
        try {
          await isCompanionReady(deps.adapter, entity.companionTable);
        } catch (error) {
          deps.logger.warn(
            "A translation table's readiness could not be resolved at boot",
            { table: entity.companionTable, code: codeOf(error) }
          );
        }
      }
    });
}

/**
 * The warm-up the last boot started, for a test that must not race it. Internal: not part of
 * any published entry point.
 */
export function companionReadinessWarmedForTests(): Promise<void> {
  return warmed;
}
