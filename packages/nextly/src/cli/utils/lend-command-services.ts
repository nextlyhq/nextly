/**
 * Lending a command's own connection to the services a grants change reaches.
 *
 * A CLI command starts no Nextly in its process, so its service container is
 * empty. A command that changes permissions or grants (`nextly upgrade`'s role
 * conversion, `nextly migrate`'s permission phase) still owes what such a
 * change owes in a running app, and both halves go through the container:
 * - the cached permission answers: emptied, and the shared role version every
 *   running instance watches published, through the `adapter`;
 * - the cached content reads, which hold what each role could read when they
 *   ran: every collection's and Single's tags expired after the change
 *   (`expireContentAfterGrantsChange`). Outside a request that means the cache
 *   tag expiry ledger, which every instance's cache handlers read, reached
 *   through the hand-off revalidator; the scopes are read from the registry
 *   services; and the expiry is queued ahead of the change as a job, so one that
 *   cannot be recorded is still owed to the app's next jobs run.
 * Lent for the command's write, and taken back after.
 *
 * @module cli/utils/lend-command-services
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { Container, container } from "../../di/container";
import { JobsRepository } from "../../domains/jobs/jobs-repository";
import { SingleRegistryService } from "../../domains/singles/services/single-registry-service";
import { createDefaultRevalidator } from "../../revalidation/default-revalidator";
import {
  installTagExpiryLedger,
  withdrawTagExpiryLedger,
} from "../../runtime/cache/ledger-wiring";
import { tagExpiryLedgerPublished } from "../../runtime/cache/tag-expiry-view";
import { CollectionRegistryService } from "../../services/collections/collection-registry-service";
import { FieldGroupRegistryService } from "../../services/field-groups";
import type { Logger } from "../../services/shared";

/**
 * Runs `run` with `adapter` lent to the service container, with the services
 * built on it that a grants change and the workflows' judgement read, and the
 * tag expiry ledger on it installed; takes all of it back after, whether `run`
 * resolved or threw. A process that already registered any of these (a server,
 * a test that booted an instance) keeps its own: `restore` lends only a name
 * not already registered, `withdraw` takes out only what it lent, and a ledger
 * already published is left as it is.
 */
export async function withCommandServicesLent<T>(
  adapter: DrizzleAdapter,
  logger: Logger,
  run: () => Promise<T>
): Promise<T> {
  const lent = container.restore(
    new Container()
      .register("adapter", () => adapter)
      // Singletons, so each lookup during the write finds the one instance.
      .registerSingleton("jobsRepository", () => new JobsRepository(adapter))
      .registerSingleton("cacheRevalidator", () => createDefaultRevalidator())
      .registerSingleton(
        "collectionRegistryService",
        () => new CollectionRegistryService(adapter, logger)
      )
      .registerSingleton(
        "singleRegistryService",
        () => new SingleRegistryService(adapter, logger)
      )
      .registerSingleton(
        "fieldGroupRegistryService",
        () => new FieldGroupRegistryService(adapter, logger)
      )
  );
  const ownLedger = !tagExpiryLedgerPublished();
  if (ownLedger) installTagExpiryLedger(adapter);
  try {
    return await run();
  } finally {
    if (ownLedger) withdrawTagExpiryLedger();
    container.withdraw(lent);
  }
}
