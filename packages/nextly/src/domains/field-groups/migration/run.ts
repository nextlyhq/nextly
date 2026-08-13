/**
 * Runs the field-group storage migration end to end.
 *
 * Everything else in this directory decides one thing well: what to rename, what
 * a marker means, how a step verifies itself. This module is the only place that
 * puts them in order, and the order is the safety argument:
 *
 *   read the world → reconcile the plan against it → take the lock →
 *   record the intent → execute → verify structurally → settle
 *
 * Recording before executing is deliberate and costs a write that is usually
 * wasted. MySQL commits DDL as it is issued, so a crash between the first rename
 * and a marker written afterwards would leave renamed objects with nothing
 * recording that a run had started — indistinguishable from a database that was
 * always that way.
 *
 * @module domains/field-groups/migration/run
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { Logger } from "../../../shared/types";
import { MetaService } from "../../meta/services/meta-service";
import { introspectLiveSnapshot } from "../../schema/pipeline/diff/introspect-live";
import { readIdentifierCaseRules } from "../../schema/utils/read-identifier-case";
import {
  indexCatalog,
  resolveCatalogName,
  type IdentifierCaseRules,
} from "../../schema/utils/resolve-catalog-name";
import {
  forgetFieldGroupStorageNames,
  resolveRegistryNameFromCatalog,
} from "../storage/resolve-storage-names";

import { resolveStorageVerdict } from "./guard";
import {
  buildMigrationManifest,
  hashManifest,
  hashRegistryIdentity,
  MIGRATION_TARGET,
  retargetName,
  tableRenamesOf,
  type ManifestEntry,
  type RegistryRow,
} from "./manifest";
import { createStorageObserver } from "./observer";
import {
  assertNoStaleParentPointers,
  ownedDataTableNames,
} from "./parent-pointers";
import {
  buildMigrationPlan,
  dataStepCount,
  directedRenameEntries,
  renamePositionOffset,
  renameRunRecord,
} from "./plan";
import {
  probeStorage,
  reconcilePlan,
  type ReconciledEntry,
  type TableColumns,
} from "./reconcile";
import {
  isTornReadRefusal,
  REFUSAL_KIND_KEY,
  type RefusalKind,
} from "./refusal-kind";
import { runMigrationSteps } from "./runner";
import {
  isMissingTable,
  observeMigrationLock,
  withMigrationSession,
  type LockObservation,
  type MigrationDialect,
} from "./session";
import {
  beginMigration,
  MIGRATION_MARKER_VERSION,
  MIN_COMPLETE_MARKER_VERSION,
  readMigrationState,
  settleMigration,
  type MigrationDirection,
  type StorageGeneration,
} from "./state";

/**
 * Stamped into every refusal this phase raises.
 *
 * Callers that treat a failed file migration as survivable have to tell the two
 * apart, and matching on message text would let a reworded message quietly turn
 * a fatal failure back into a tolerated one.
 */
export const FIELD_GROUP_MIGRATION_PHASE = "field-group-storage-migration";

/**
 * How much authority a previewed plan carries.
 *
 * 🔴 A discriminated union rather than a `reconciled: boolean` beside the plan, because the
 * interesting state is not "was it reconciled" but WHY it was not — and a flag has nowhere to put
 * that. An operator deciding whether to act on a preview needs the difference between "this database
 * would not accept the plan" and "a writer moved underneath the read", and a boolean makes those two
 * the same value.
 */
export type PlanBasis =
  /** Every rename was scored against the live catalog; the plan is what this database would accept. */
  | { readonly kind: "reconciled" }
  /**
   * The plan is the manifest's, NOT the catalog's.
   *
   * Reached only after repeated reads kept meeting a writer mid-flight. The renames reported
   * alongside are every rename the manifest declares rather than the subset still outstanding, so
   * they are an upper bound: some may already have been applied by whoever is writing.
   */
  | { readonly kind: "unreconciled"; readonly reason: string };

/** What a run did, for the caller to report. */
export type MigrationOutcome =
  | {
      ran: false;
      reason: "already-migrated" | "nothing-to-migrate";
      /**
       * Present on a DRY RUN only, and that asymmetry is deliberate.
       *
       * A dry run can reach this exit while another migration is mid-flight — an `up` preview meets
       * a settled v2 marker that a claimed `down` run has not yet replaced — and reporting a bare
       * "already migrated" there describes a database that is at this moment moving. A run that
       * WRITES holds the lock, so it has nothing to report.
       */
      lock?: LockObservation;
    }
  | {
      ran: false;
      reason: "dry-run";
      direction: MigrationDirection;
      /**
       * Every table the run would rename, in execution order, companions included.
       *
       * 🔴 Deliberately NOT a step count. A run also rewrites customer rows and passes settlement
       * gates, and those outnumber the renames; reporting a number derived from renames alone
       * would understate the work while looking authoritative, and computing a second definition
       * of the plan's size is how it drifts from the one that executes. What a caller can rely on
       * here is exactly what it says: the storage objects that change name.
       *
       * Always populated, including when `basis` reports the plan unreconciled. An empty list there
       * would read as "nothing to do" — the silent wrong answer this whole path exists to remove —
       * so a preview that could not score the plan reports the manifest's renames and says so in
       * `basis` rather than reporting none.
       */
      renames: readonly { readonly from: string; readonly to: string }[];
      /**
       * Whether the renames above were scored against this database or merely proposed by the
       * manifest. Read it before acting on `renames`: the two differ exactly when another run was
       * writing throughout the preview.
       */
      basis: PlanBasis;
      /**
       * What could be learned about the migration lock while the preview was taken.
       *
       * Three states, never `null`: `{ kind: "held", owner }` when a run is in flight,
       * `{ kind: "not-held" }` when nothing holds it, and `{ kind: "unknown", reason }` when the
       * lock could not be read at all — a restricted role denied SELECT on the lock table lands
       * there rather than being reported as an empty database.
       *
       * A dry run observes the lock rather than taking it, so a run in flight is reported here
       * instead of raising a refusal. Present because the preview is a snapshot: with another run
       * writing, the renames above describe a world that is moving, and an operator who cannot see
       * that would read a partially-applied plan as the plan.
       *
       * When `basis` reports the plan unreconciled, this is the observation that JUSTIFIED that
       * answer rather than the one the session opened with — the two differ exactly when a writer
       * claimed the lock after the preview began.
       *
       * 🔴 Informational only. It was true at the moment it was read and may not be by the time it
       * is acted on, so it can no more gate a write than any other stale read. The lock itself is
       * what makes a run exclusive.
       */
      lock: LockObservation;
    }
  | { ran: true; direction: MigrationDirection; steps: number };

export interface RunMigrationArgs {
  adapter: DrizzleAdapter;
  logger: Logger;
  /** `up` unless an operator is explicitly rolling back. */
  direction: MigrationDirection;
  /**
   * Report what the run would do, writing nothing at all.
   *
   * Read-only in the strict sense, which is the point rather than a detail. It does not take the
   * migration lock, and taking it was previously the one thing that wrote: claiming creates
   * `nextly_field_group_lock` when absent and inserts an owner, so a preview issued DDL on first
   * use and was refused outright for a role with read-only privileges — the credential an operator
   * should be previewing production with. No content, no marker, no lock, no DDL.
   *
   * What that gives up is exclusion, and the outcome says so rather than hiding it. Another run can
   * be mutating storage while this reads, so the reported plan is a snapshot; `lock` carries what
   * could be learned about the holder, and `basis` says whether the plan was scored against the
   * catalog at all, so an operator can see that their preview is describing a moving target.
   * That trade only works because a dry run performs no work — nothing acts on the answer, so a
   * stale one costs a re-read rather than a wrong write. The same reasoning would be wrong for a
   * run that writes, which is why only this path observes.
   *
   * Stops immediately after the plan has been reconciled against the live catalog, which is the
   * last point before anything is recorded. That placement is the whole value: a plan reported
   * before reconciliation describes what the manifest says rather than what this database will
   * actually accept, and the discrepancies between those two are exactly what an operator runs a
   * dry run to find.
   */
  dryRun?: boolean;
  /**
   * The operator states that a restorable backup exists.
   *
   * Required for a run that writes, and deliberately not defaulted. This migration rewrites stored
   * customer content, and while it is built to be resumable and reversible, neither property helps
   * against the failures that motivate a backup — a half-applied run on a database whose disk fills,
   * a rollback whose recorded plan was lost, an operator who discovers afterwards that the wrong
   * database was targeted.
   *
   * Asked for on every environment rather than only production. The engine cannot tell them apart
   * without reading configuration it otherwise never touches, and every guess is wrong in the
   * direction that matters: a staging database restored from production carries the same content
   * as production.
   *
   * A dry run does not require it, because a dry run writes nothing whatsoever — see `dryRun`.
   * There is no state for a backup to restore.
   */
  backupConfirmed?: boolean;
}

/**
 * Migrate field-group storage, or report why there was nothing to do.
 *
 * Idempotent: a database already at the target generation returns without
 * touching anything, which is what lets this sit on a path that runs on every
 * deploy rather than needing to be invoked once and remembered.
 */
export async function runFieldGroupMigration(
  args: RunMigrationArgs
): Promise<MigrationOutcome> {
  const {
    adapter,
    logger,
    direction,
    dryRun = false,
    backupConfirmed = false,
  } = args;

  // 🔴 A precondition, so it runs before anything else — before the catalog reads, before the
  // lock. Placing it later would mean a refusal that has already contended for the lock and, on a
  // resumed run, already read a marker; a caller who forgot the acknowledgement would be told so
  // only after this had interfered with whatever else was trying to change schema.
  //
  // A dry run is exempt because it writes no content and records no marker, and exempting it is
  // what makes the gate usable:
  // the operator's first action is to see the plan, and demanding they assert a backup before they
  // are allowed to look at what would happen teaches them to assert it without meaning it.
  if (!dryRun && !backupConfirmed) {
    throw NextlyError.serviceUnavailable({
      logMessage:
        "field-group migration refuses to run without a confirmed backup",
      logContext: {
        phase: FIELD_GROUP_MIGRATION_PHASE,
        reason: "no backup acknowledgement",
        direction,
      },
    });
  }

  const dialect: MigrationDialect = adapter.getCapabilities().dialect;
  // Read from the server, not derived from the dialect. MySQL folds table names
  // or not depending on `lower_case_table_names`, which is configuration rather
  // than a property of the dialect, and guessing it makes a present table look
  // missing or two distinct tables look like one.
  const identifierCase = await readIdentifierCaseRules(adapter);
  const meta = new MetaService(adapter, logger);
  const generation = direction === "up" ? "field-groups-v2" : "legacy";

  // 🔴 Everything this run decides is read INSIDE the lock, the marker
  // included. Reading it first and contending afterwards leaves a window in
  // which another invocation completes the whole migration and releases the
  // lock: this one would then acquire it holding a marker that says legacy,
  // rebuild an upward plan against already-migrated storage, and overwrite a
  // settled marker with a fresh in-flight one. The same window lets a `db:sync`
  // holding this lock finish a schema change the plan was not built against.
  //
  // The cost is that even an already-migrated database claims the lock to find
  // that out. That is the correct trade here, where being wrong rewrites
  // customer data — but it makes "who calls this, and how often" a decision the
  // entry point owns: this lock refuses rather than waits, so a fleet whose
  // instances all invoke it at boot would have every instance but one refuse.
  // A run that WRITES never retries, and must not: it holds the lock that excludes the very writer
  // a retry exists to survive, so a refusal there is a fact about the database rather than a torn
  // read of one.
  const attempts = dryRun ? DRY_RUN_RECONCILE_ATTEMPTS : 1;

  /**
   * What the last attempt could learn about the lock, for the retry decision.
   *
   * 🔴 Recorded here because the decision needs two facts that live apart: the refusal escapes to
   * the loop below, while the lock was observed inside the session. Written first thing on every
   * attempt, so it always describes the attempt whose refusal is being judged.
   */
  let observedLock: LockObservation = {
    kind: "unknown",
    reason: "no attempt has read the lock yet",
  };

  /**
   * Whether a writer is demonstrably present.
   *
   * 🔴 The retry requires this, and a torn-SHAPED refusal is not enough on its own. Several of
   * these refusals cannot tell a torn read from a permanent one by reading: "an object using the
   * migrated storage name exists but no recorded progress accounts for it" is raised both by a
   * writer caught mid-rename AND by a table belonging to someone else that happens to sit on the
   * name this migration wants. Retrying the second and then reporting it as contention would
   * describe a database that is standing still as one that is moving, and bury a real storage
   * conflict — the failure this whole path exists to remove, reintroduced one level up.
   *
   * `unknown` does not qualify. A lock that could not be read is not evidence of a writer, and
   * claiming contention from it would be a guess in the one direction that loses information.
   */
  // 🔴 `dryRun` is part of the question, not a second guard. A CLAIMING session reports the lock as
  // held by its own claim, which is true and useless here: it would read as contention on every
  // writing run. Today `attempts` is 1 for those, so the loop exits before this is consulted —
  // making the correctness incidental rather than stated. Saying it here means a later change to
  // the attempt count cannot quietly turn a writing run's own claim into evidence of a rival.
  // 🔴 Asks the lock AGAIN rather than trusting the observation taken at the top of the attempt.
  // The snapshot answers "was anyone writing when this attempt started", and the question that
  // decides a retry is "was anyone writing DURING it" — a writer that claims the lock immediately
  // after the observation can still move storage between the marker and catalog reads, producing a
  // genuinely torn refusal that a stale `not-held` would dismiss. Contention counts if it is seen
  // at EITHER end, which is the union rather than a replacement: a writer that finished and
  // released before the re-read is still the explanation for what this attempt saw.
  //
  // `dryRun` is part of the expression, not a second guard. A CLAIMING session reports the lock as
  // held by its own claim — true and useless, and it would read as contention on every writing run.
  // 🔴 Returns the OBSERVATION, not a verdict about it. Reducing this to a boolean was enough to
  // decide the retry and not enough to report it: the outcome then carried the session's original
  // `lock` — `not-held`, or `unknown` — beside a `basis` that says contention, so the one field an
  // operator would check to understand the answer contradicted the answer. Whichever observation
  // proves a holder is the one the outcome reports, so the two cannot disagree.
  const observeContention = async (): Promise<LockObservation> => {
    if (!dryRun) return observedLock;
    if (observedLock.kind === "held") return observedLock;
    const now = await observeMigrationLock(adapter, dialect);
    // Held at EITHER end counts, and the later reading replaces the earlier only when it is the one
    // carrying evidence: a writer that claimed after the session began is the explanation for what
    // this attempt saw, while a quiet re-read does not undo a holder seen at the start.
    if (now.kind === "held") observedLock = now;
    return observedLock.kind === "held" ? observedLock : now;
  };

  // 🔴 The lock is NOT consulted to decide whether to re-read, and removing that gate is the point.
  //
  // Two probes cannot see a writer that acquires and releases BETWEEN them. A preview that reads the
  // old marker, is descheduled while a short migration completes, and then reads the new catalog
  // observes `not-held` at both ends — so gating on the lock refused a torn read whose sole cause
  // was contention, in the one case the retry exists for.
  //
  // The lock never could carry that weight, and this module's own outcome doc says so: informational
  // only, true at the instant it was read, unable to gate anything. Movement is the signal that
  // actually separates a writer from a standing conflict, and it is already measured — so the lock
  // goes back to being reported rather than obeyed.

  /**
   * Build a dry-run outcome, sourcing the lock rather than accepting one.
   *
   * 🔴 The lock is deliberately NOT a parameter. Three separate exits reported it, three times the
   * field drifted, and each fix corrected one site while an identical line stood a few feet away —
   * the unreconciled exit, then the already-migrated exit, then the reconciled one. A rule that
   * every exit must remember to re-read is a rule that will be broken by whoever adds the fourth.
   *
   * Making it unsupplyable is the difference between a check that looks for the mistake and a
   * boundary the mistake cannot cross: a caller here CANNOT report a stale observation, because it
   * never holds one to pass.
   */
  const previewOutcome = async (args: {
    renames: readonly { readonly from: string; readonly to: string }[];
    basis: PlanBasis;
  }): Promise<MigrationOutcome> => ({
    ran: false,
    reason: "dry-run",
    direction,
    renames: args.renames,
    basis: args.basis,
    lock: await observeContention(),
  });

  /**
   * What the last attempt saw, so the next one can tell whether anything moved.
   *
   * 🔴 A held lock is NOT evidence of a live writer. This lock has no TTL and no auto-steal by
   * design — a process that dies holding it leaves it held until an operator clears it — so
   * `{ kind: "held" }` proves that ownership was once RECORDED, not that anyone is moving now.
   * Judging contention on that alone lets a stale row plus a genuinely permanent mismatch (a
   * restored marker whose rename was never applied) spend three attempts and then be reported as
   * contention, which is precisely the storage-conflict-as-traffic answer this path exists to
   * remove, arriving through a different door.
   *
   * So contention has to be evidenced by CHANGE. A live writer moves something between attempts:
   * the refusal it provokes differs, or the lock changes hands. A dead holder moves nothing, and an
   * unchanged world across every attempt is the signature that separates the two.
   */
  let lastSignature: string | undefined;
  let worldMoved = false;

  const signatureOf = (error: unknown, lock: LockObservation): string => {
    const reason = NextlyError.is(error)
      ? JSON.stringify(error.logContext ?? {})
      : String(error);
    return `${lock.kind === "held" ? lock.owner : lock.kind}::${reason}`;
  };

  const runOnce = (finalAttempt: boolean): Promise<MigrationOutcome> =>
    withMigrationSession(
      {
        adapter,
        dialect,
        label: `field-group-migration:${direction}`,
        // A dry run observes the lock instead of taking it, so it writes nothing
        // at all and stays available to a read-only role. It reports contention
        // through `lock` rather than raising it as a refusal: nothing acts on
        // a preview, so a stale answer costs a re-read rather than a wrong write.
        mode: dryRun ? "observe" : "claim",
      },
      async session => {
        // First, so it describes this attempt whatever this attempt goes on to raise.
        observedLock = session.lock;
        const state = await readMigrationState(meta);
        const rows = await readRegistryRows(
          adapter,
          dialect,
          identifierCase,
          state.appliedManifest ?? []
        );

        // Settled at the generation this run would produce: the work is done.
        // Confirmed against the catalog rather than taken from the marker alone,
        // because the two can disagree — storage restored from a backup taken
        // before the run, or a table dropped since — and a marker believed on its
        // own would report success over storage the read path cannot serve.
        if (state.status === "settled" && state.generation === generation) {
          // 🔴 Asked before the catalog, because it is the question the catalog
          // cannot answer. A marker written by an older build claims a generation
          // that build defined, and this one performs work that build did not:
          // the tables and columns would all check out while stored field
          // definitions, ledger keys and parent pointers still held the legacy
          // vocabulary. Refusing is the only honest answer — the data steps
          // address the registry under its legacy name, so this build cannot
          // simply finish the job on storage whose registry has already moved.
          if (
            state.generation === "field-groups-v2" &&
            state.version !== undefined &&
            state.version < MIN_COMPLETE_MARKER_VERSION
          ) {
            throw NextlyError.serviceUnavailable({
              logMessage:
                "field-group migration cannot accept a marker written before this build's storage work existed",
              logContext: {
                phase: FIELD_GROUP_MIGRATION_PHASE,
                reason: "settled marker predates work this build performs",
                recordedVersion: state.version,
                requiredVersion: MIN_COMPLETE_MARKER_VERSION,
              },
            });
          }
          await assertStorageAtGeneration({
            adapter,
            dialect,
            rows,
            identifierCase,
            generation,
            // The rows are checked as well as the structure. A marker can be
            // current and the content still wrong — restored from a backup taken
            // before the run, or repaired by hand — and a stale `_parent_table`
            // is invisible to a structural check while making nested content
            // invisible to a reader. The recorded plan is what names the storage
            // this run's generation renamed away; without one there is nothing to
            // scan for.
            renamedAway: renamedAwayNames(state.appliedManifest, generation),
            owned: ownedDataTableNames({
              rows,
              entries: state.appliedManifest ?? [],
            }),
          });
          return {
            ran: false,
            reason: "already-migrated",
            // Carried on this exit too, and re-read rather than taken from the session's opening
            // observation. This exit reaches the same window every other one does: a `down` run
            // that claimed the lock AFTER the preview began is exactly what makes "already
            // migrated" a moving answer, and reporting the opening `not-held` beside it would
            // conceal the writer this field was added to expose. Both exits ask the same accessor
            // so they cannot disagree about who was holding it.
            ...(dryRun ? { lock: await observeContention() } : {}),
          };
        }

        // A rollback needs the plan that was applied; nothing else can supply it,
        // because the database cannot say which names this migration created.
        if (
          direction === "down" &&
          state.status === "settled" &&
          state.appliedManifest === undefined
        ) {
          throw NextlyError.serviceUnavailable({
            logMessage:
              "field-group migration cannot roll back: no record of what was applied",
            logContext: {
              phase: FIELD_GROUP_MIGRATION_PHASE,
              reason: "rollback has no recorded plan",
            },
          });
        }

        // Derived from the rows so a resume that has to rebuild it - a crash
        // before the marker's first write - produces the same value rather than a
        // second identity for the same work.
        const migrationId =
          state.status === "migrating"
            ? state.migrationId
            : newMigrationId(rows);

        // The canonical plan is always legacy-to-migrated. A run in flight
        // executes the one it recorded; a rollback reverses the recorded one; a
        // fresh run builds it from the registry.
        const entries: readonly ManifestEntry[] =
          state.status === "migrating"
            ? state.appliedManifest
            : direction === "down" && state.appliedManifest !== undefined
              ? state.appliedManifest
              : buildMigrationManifest(rows).entries;

        const registryHash = hashRegistryIdentity(rows);
        const manifestHash = hashManifest(entries);

        let tables: string[];
        let columns: TableColumns[];
        let reconciled: ReconciledEntry[];
        const directed = directedRenameEntries(direction, entries);
        // Above the try because the steps below the try need them, and none of
        // the three depends on the catalog read the try guards.
        //
        // Enumerated from what Nextly knows it owns rather than recognised by
        // shape. Nextly runs inside the user's own database, and a table of
        // theirs that happens to carry the parent-pointer column would otherwise
        // be rewritten. Both spellings of every rename are included, because a
        // resumed run can meet either one in the catalog.
        const owned = ownedDataTableNames({ rows, entries: directed });
        const dataSteps = dataStepCount({ meta, migrationId });
        const offset = renamePositionOffset(direction, dataSteps);
        try {
          if (state.status === "migrating") {
            if (state.plan.registryHash !== registryHash) {
              throw NextlyError.serviceUnavailable({
                logMessage:
                  "field-group migration cannot resume: the set of field groups changed since the interrupted run",
                logContext: {
                  phase: FIELD_GROUP_MIGRATION_PHASE,
                  reason:
                    "the set of field groups changed since the interrupted run",
                  recorded: state.plan.registryHash,
                  current: registryHash,
                },
              });
            }
            if (state.direction !== direction) {
              // 🔴 A preview REPORTS this, a run that writes refuses it — but reporting it requires
              // the same evidence every other contended answer does: that something MOVED.
              //
              // Answering on the first look was wrong. This lock has no TTL and survives process
              // death, so a CRASHED `down` run leaves both its migrating marker and its held row
              // behind. Read once, that is indistinguishable from a live one, and a preview would
              // describe a stranded migration awaiting recovery as ordinary traffic — the operator
              // most needing to act being told to wait.
              //
              // So it is classified and thrown like any other retryable failure, and the shared
              // machinery decides: a live run advances its step between attempts and is reported as
              // contention, while a crashed one presents the identical world every time and is
              // raised. The recorded step travels in the refusal precisely so that movement is
              // visible to the comparison.
              throw NextlyError.serviceUnavailable({
                logMessage: `field-group migration cannot run ${direction}: a ${state.direction} run is in flight`,
                logContext: {
                  phase: FIELD_GROUP_MIGRATION_PHASE,
                  reason: "a run in the other direction is in flight",
                  [REFUSAL_KIND_KEY]: "torn-read",
                  recorded: state.direction,
                  recordedStep: state.step,
                  requested: direction,
                },
              });
            }
          }

          // 🔴 The try opens HERE — before the marker's own consistency checks, not merely before the
          // catalog read — so every retryable failure in the plan-scoring window leaves by one path.
          // The recorded-hash comparison and the opposite-direction check are both raised from inside
          // it: each is a judgement about a world a writer may be moving, and each was previously
          // thrown past the only place that builds the documented fallback. A torn catalog read surfaces as the driver's
          // missing-table error rather than as a refusal, and handling that only in the outer loop
          // meant it was retried but never reported: exhaustion rethrew the database error instead of
          // the documented unreconciled outcome, so an operator met a raw driver failure in exactly
          // the contended case this path exists to describe.
          //
          // It does NOT open earlier. Before this point the registry rows have not been read, and
          // without them no manifest exists to name the renames — reporting a plan there would mean
          // reporting an empty one, which reads as "nothing to do". A preview that cannot read the
          // registry has nothing honest to say and refuses.
          ({ tables, columns } = await readCatalog(adapter, dialect));

          // Reconciled in the direction that will execute. A rollback scored
          // against the canonical plan asks whether the legacy names are present,
          // finds the migrated ones instead, and refuses the very run that would
          // restore them. Declared above the try because the fallback names its renames from it.
          reconciled = reconcilePlan({
            entries: directed,
            rows,
            tables,
            columns,
            // Translated out of whole-plan coordinates. The marker counts every
            // step, and going up the data rewrites hold the first positions, so a
            // recorded position handed over untranslated would mark that many
            // renames as already verified.
            run: renameRunRecord({
              status: state.status,
              direction:
                state.status === "migrating" ? state.direction : direction,
              step: state.status === "migrating" ? state.step : 0,
              offset,
            }),
            direction,
            identifierCase,
          });
        } catch (error) {
          // Only a preview re-reads, only for a failure a concurrent writer can manufacture, and
          // only when a writer is demonstrably there. Everything else — a run that writes, a
          // refusal about the database's actual shape, a torn-SHAPED refusal on a database nobody
          // is writing to — leaves by the same door it always did.
          //
          // Contention does not always arrive as a REFUSAL: the catalog is a table list followed by
          // introspection of that list, and a rename landing in that gap surfaces as the driver's
          // own missing-table error. Recognised by the same predicate the outer loop uses, so the
          // two cannot disagree about what is worth re-reading.
          if (!dryRun || !isRetryablePreviewFailure(error, dialect)) {
            throw error;
          }
          const signature = signatureOf(error, await observeContention());
          if (lastSignature !== undefined && signature !== lastSignature) {
            worldMoved = true;
          }
          lastSignature = signature;
          // Not the final attempt: let it out so the whole session runs again, marker included.
          if (!finalAttempt) throw error;

          // 🔴 Out of attempts, and the answer now turns on whether anything MOVED. An identical
          // failure beside an unchanged lock owner on every attempt is a world standing still, and
          // the held row behind it is a claim someone left when their process died rather than a
          // writer at work. Reporting that as contention buries a real storage conflict under the
          // word traffic — so it is raised, exactly as it would be with no lock row at all.
          if (!worldMoved) throw error;

          // Out of attempts. Report the manifest's plan and say plainly that it was never scored
          // against this database, rather than returning an empty list — which reads as "nothing to
          // do" and is the silent wrong answer this path exists to remove. Derived from `directed`,
          // already in hand, so the fallback cannot disagree with the plan that would have executed.
          const renames = directed.flatMap(tableRenamesOf);
          const reason = tornReadReason(error);
          logger.warn?.("field-group migration dry run could not reconcile", {
            phase: FIELD_GROUP_MIGRATION_PHASE,
            direction,
            renames: renames.length,
            attempts,
            reason,
          });
          return previewOutcome({
            renames,
            basis: { kind: "unreconciled", reason },
          });
        }

        // The last point at which nothing has been written. Everything above reads: the marker, the
        // registry, the catalog, and the reconciliation of the plan against them. Returning here
        // reports a plan the database has already been scored against rather than one the manifest
        // merely proposes.
        if (dryRun) {
          // Read from reconciliation rather than re-derived here, and that is the whole of it. The
          // question "which renames remain" is one catalog resolution per physical table, and
          // reconciliation has just done exactly that; asking it a second time in a second place is
          // how the two came to disagree.
          //
          // What they disagreed about: a localized field group carries its `_locales` companion on
          // the SAME entry, so an entry is unsatisfied while EITHER table remains. Filtering on that
          // reported both when a run torn between the two had already moved the base — during a
          // resume, which is precisely when an operator is judging whether the remaining work is
          // safe to continue.
          const renames = reconciled.flatMap(
            entry => entry.pendingTableRenames
          );
          logger.info?.("field-group migration dry run", {
            phase: FIELD_GROUP_MIGRATION_PHASE,
            direction,
            renames: renames.length,
          });
          return previewOutcome({ renames, basis: { kind: "reconciled" } });
        }

        // Written before the first statement, never after. A crash between a
        // rename and a post-hoc marker write would leave moved objects with no
        // record that a run had started.
        if (state.status !== "migrating") {
          await beginMigration(meta, {
            direction,
            migrationId,
            plan: { registryHash, manifestHash },
            appliedManifest: entries,
          });
        }

        const steps = buildMigrationPlan({
          direction,
          entries: reconciled,
          identifierCase,
          observer: createStorageObserver(adapter, identifierCase),
          meta,
          migrationId,
          ownedDataTables: owned,
          // Deliberately the un-memoized resolver. Its memoized sibling would
          // answer with a name read before this run moved storage, which is the
          // one answer a check running after the renames must not be given.
          resolveRegistryTable: () => resolveRegistryNameFromCatalog(adapter),
        });

        // The settlement checks are gates rather than recorded work, so a marker
        // never points past them and a resume re-enters them on its own.
        const fromStep = state.status === "migrating" ? state.step + 1 : 1;
        // 🔴 Invalidated whenever the steps may have RUN, not only when the run
        // reports success. A rename can commit and `assertStorageComplete` or
        // `settleMigration` can then throw — at which point the memoized registry
        // name in this process points at a table that no longer exists, and every
        // recovery attempt addresses the wrong one. The memo is a schema fact;
        // the moment storage may have moved, the honest answer is "I no longer
        // know", and one extra catalog read is the whole cost of saying so.
        try {
          await runMigrationSteps({
            session,
            meta,
            migrationId,
            steps,
            fromStep,
          });

          // The structural half of the question the settle steps ask about
          // vocabulary. Asked of the database rather than inferred from the steps
          // having run: a step reports its own postcondition, while this asks
          // whether the storage as a whole is now what the generation claims,
          // which is the question a settled marker will be believed on afterwards.
          await assertStorageComplete({
            adapter,
            dialect,
            rows: await readRegistryRows(adapter, dialect, identifierCase),
            identifierCase,
            // Every name this run renamed away. A row still addressing one of them
            // is content the read path would return nothing for, and it is asked
            // about here rather than per step because the failure worth catching is
            // a data table no step ever observed.
            renamedAway: directed
              .filter(entry => entry.kind === "table")
              .map(entry => entry.from),
            owned,
            generation,
          });

          await settleMigration(
            meta,
            generation === "field-groups-v2"
              ? { generation, appliedManifest: entries }
              : { generation }
          );
        } finally {
          forgetFieldGroupStorageNames(adapter);
        }

        logger.info(
          `Field group storage migrated ${direction} (${String(steps.length)} steps).`
        );
        return { ran: true, direction, steps: steps.length };
      }
    );

  // 🔴 The RETRY IS OF THE WHOLE SESSION, not of the catalog read, and that is the entire
  // correctness argument. The pair that tears is the MARKER against the catalog: the marker is read
  // at the top of the callback and decides both the already-migrated exit and which entries are
  // selected, so re-reading only the catalog converges on a stale marker — and it would LOOK right,
  // because the refusal it was raised to clear does stop appearing. Re-entering the session re-reads
  // both, which is the only way the two can come from one consistent view.
  //
  // Free to repeat because an observing session takes no lock, writes nothing and leaves nothing
  // behind; the cost is the reads.
  for (let attempt = 1; ; attempt++) {
    const finalAttempt = attempt >= attempts;
    try {
      return await runOnce(finalAttempt);
    } catch (error) {
      // Re-read only what re-reading can fix, and only while something is actually moving. A
      // refusal retried without an observed writer would exhaust its attempts and then be reported
      // as contention, turning a correct and loud refusal about the operator's storage into a soft
      // wrong answer — strictly worse than the defect being fixed.
      // Contention does not always arrive as a refusal. The registry read resolves a table name and
      // then selects from it, and the catalog is a table list followed by introspection of that
      // list; a rename landing inside either gap surfaces as the driver's own missing-table error,
      // which no refusal ever classified. Recognised by the same code-based classifier the lock
      // observation uses, so the two cannot disagree about what "not there" looks like.
      if (
        finalAttempt ||
        !dryRun ||
        !isRetryablePreviewFailure(error, dialect)
      ) {
        throw error;
      }
      // Recorded here too, so a failure that leaves by the outer door counts towards the same
      // judgement. Two paths deciding "did the world move" from different evidence is the drift
      // this file has already been corrected for twice.
      const signature = signatureOf(error, await observeContention());
      if (lastSignature !== undefined && signature !== lastSignature) {
        worldMoved = true;
      }
      lastSignature = signature;
    }
  }
}

/**
 * Whether a preview should re-read rather than surface this failure.
 *
 * 🔴 ONE predicate, asked by both the catch inside the session and the loop around it. They judge
 * the same question at two depths, and a second list in either place is how the two come to
 * disagree about which failures are worth another look — the inner one deciding a failure is
 * reportable while the outer decides the same failure is fatal.
 *
 * Two shapes qualify. A refusal a writer can manufacture carries its own classification. A torn
 * CATALOG read carries none: the list of tables and the introspection of that list are separate
 * queries, so a rename landing between them comes back as the driver's missing-table error, which
 * no refusal ever saw.
 */
function isRetryablePreviewFailure(
  error: unknown,
  dialect: MigrationDialect
): boolean {
  return isTornReadRefusal(error) || isMissingTable(error, dialect);
}

/**
 * How many times a preview will re-read before reporting the plan unreconciled.
 *
 * Small on purpose. Each attempt is a fresh set of reads against a database someone else is
 * actively writing to, and a preview that retried for long enough to outlast a real migration would
 * be a slow way of reporting the same thing. Three is enough to clear the interleaving that
 * produces a torn pair, which is a window of one commit rather than of the whole run.
 */
const DRY_RUN_RECONCILE_ATTEMPTS = 3;

/**
 * The refusal's own reason, for reporting a plan that could not be scored.
 *
 * Read from `logContext`, which every refusal in `reconcile` stamps, rather than from the public
 * message — that is deliberately generic, so it would describe every refusal identically and tell an
 * operator nothing about which read tore.
 */
function tornReadReason(error: unknown): string {
  const reason = NextlyError.is(error) ? error.logContext?.reason : undefined;
  return typeof reason === "string"
    ? reason
    : "the plan could not be reconciled against a database being written to";
}

/**
 * Verification, run before the marker is allowed to settle.
 *
 * Two questions, because storage can be structurally complete and still unable
 * to serve what it holds: the structural one below, and whether any row still
 * addresses a table this run renamed away. The verdict is a judgement about
 * tables and columns and says nothing about what the rows inside them point at.
 */
async function assertStorageComplete(args: {
  adapter: DrizzleAdapter;
  dialect: MigrationDialect;
  rows: readonly RegistryRow[];
  identifierCase: IdentifierCaseRules;
  renamedAway: readonly string[];
  owned: readonly string[];
  generation: StorageGeneration;
}): Promise<void> {
  const { tables, columns } = await readCatalog(args.adapter, args.dialect);
  await assertNoStaleParentPointers({
    query: statement => args.adapter.queryStatement(statement),
    columns,
    identifierCase: args.identifierCase,
    owned: args.owned,
    staleNames: args.renamedAway,
    // Honoured rather than assumed generous: SQLite advertises 999 where the
    // other two advertise 65535, and this runs after every rename has
    // committed, so an over-long statement would strand a finished migration.
    maxParams: args.adapter.getCapabilities().maxParamsPerQuery,
  });
  assertProbeMatchesGeneration({
    rows: args.rows,
    tables,
    columns,
    identifierCase: args.identifierCase,
    generation: args.generation,
    reason: "structural verification failed after the steps ran",
    // This run holds the lock and just performed the work being checked, so a
    // mismatch is a fact about what the steps produced rather than a read torn
    // by someone else. Re-reading would return the same thing.
    kind: "permanent",
  });
}

/**
 * The names a completed run of this direction renamed away.
 *
 * Taken from the recorded plan rather than recomputed, for the reason a
 * rollback needs it recorded at all: nothing in the database distinguishes an
 * `fg_*` name this migration created from one an author chose before it
 * existed. Going up, the legacy spellings are the ones no row may still
 * address; going down it is the migrated ones.
 */
function renamedAwayNames(
  applied: readonly ManifestEntry[] | undefined,
  generation: StorageGeneration
): string[] {
  if (applied === undefined) return [];
  return applied
    .filter(entry => entry.kind === "table")
    .map(entry => (generation === "field-groups-v2" ? entry.from : entry.to));
}

/**
 * The structural half on its own, for a run that executed nothing.
 *
 * A marker claiming a generation and storage actually being at one are separate
 * facts, and they come apart in ways no run causes: a restore from a backup
 * taken before the migration, a table dropped by hand, a partial recovery. The
 * marker is the faster answer and the less trustworthy one, so reporting
 * `already-migrated` on its word alone would turn every later invocation into a
 * report of success over storage the read path cannot serve.
 */
async function assertStorageAtGeneration(args: {
  adapter: DrizzleAdapter;
  dialect: MigrationDialect;
  rows: readonly RegistryRow[];
  identifierCase: IdentifierCaseRules;
  generation: StorageGeneration;
  renamedAway: readonly string[];
  owned: readonly string[];
}): Promise<void> {
  const { tables, columns } = await readCatalog(args.adapter, args.dialect);
  await assertNoStaleParentPointers({
    query: statement => args.adapter.queryStatement(statement),
    columns,
    identifierCase: args.identifierCase,
    owned: args.owned,
    staleNames: args.renamedAway,
    maxParams: args.adapter.getCapabilities().maxParamsPerQuery,
    // Classified alongside the probe below rather than left to the default, because it runs FIRST
    // and would otherwise be the refusal an unlocked preview actually meets — a rollback rewriting
    // `_parent_table` back to its legacy spelling trips this before the probe is ever consulted.
    kind: "torn-read",
  });
  assertProbeMatchesGeneration({
    rows: args.rows,
    tables,
    columns,
    identifierCase: args.identifierCase,
    generation: args.generation,
    // 🔴 Retryable for an unlocked preview, because the marker and the catalog are separate reads
    // here and nothing holds them together. A rollback renames the registry back before its own
    // marker settles, so a preview that captured the v2 marker first sees a catalog already moving
    // past it — a pair the database was never in.
    //
    // Reaching THIS refusal at all is rare: `resolveStorageVerdict` classifies the same tears
    // first and more precisely, and most mismatches leave by one of its refusals rather than this
    // one. It is classified alike so the two cannot disagree about the same situation.
    kind: "torn-read",
    reason: "a settled marker does not match the storage it describes",
  });
}

/**
 * Refuse unless the catalog says what the generation claims.
 *
 * Reuses the read path's own verdict rather than asking a second, similar
 * question: whatever would refuse to *serve* this storage must also refuse to
 * call it migrated, or the two would disagree and the marker would be the more
 * trusted of the pair.
 */
function assertProbeMatchesGeneration(args: {
  rows: readonly RegistryRow[];
  tables: string[];
  columns: TableColumns[];
  identifierCase: IdentifierCaseRules;
  generation: StorageGeneration;
  reason: string;
  /**
   * Whether re-reading could change this verdict, which depends entirely on
   * which caller is asking.
   *
   * Verifying a SETTLED marker compares a marker read at one instant against a
   * catalog read at a later one, and a rollback running concurrently moves
   * storage between them — so an unlocked preview meets a mismatch the database
   * was never actually in. Verifying after this run's OWN steps compares the
   * storage those steps just produced, under a lock that excludes anyone else;
   * a mismatch there is real and must stay loud.
   */
  kind: RefusalKind;
}): void {
  const probe = probeStorage({
    rows: args.rows,
    tables: args.tables,
    columns: args.columns,
    identifierCase: args.identifierCase,
    generation: args.generation,
  });

  // `resolveStorageVerdict` throws on anything it cannot explain, so reaching a
  // verdict at all is most of the check. What remains is that the verdict names
  // the generation being claimed: an `up` run that leaves storage the read path
  // would still serve as legacy has not finished.
  const expected =
    args.generation === "field-groups-v2"
      ? "use-field-groups-v2"
      : "use-legacy";
  const verdict = resolveStorageVerdict({
    state: {
      status: "settled",
      generation: args.generation,
      recorded: true,
    },
    probe,
  });

  if (verdict.action === expected) return;

  throw NextlyError.serviceUnavailable({
    logMessage:
      "field-group migration will not report success: storage is not in the state the marker claims",
    logContext: {
      phase: FIELD_GROUP_MIGRATION_PHASE,
      reason: args.reason,
      [REFUSAL_KIND_KEY]: args.kind,
      generation: args.generation,
      expected,
      actual: verdict.action,
    },
  });
}

/**
 * Registry rows, read from whichever registry is present.
 *
 * Exported for its own tests: `hasCompanion` decides whether a table enters the
 * rename plan, and that decision is not observable from the outcome of a run
 * that reports there is nothing to do.
 *
 * Legacy first, then the migrated name. The registry renames last, so for every
 * step but the final one the rows are still under the legacy name — and the
 * final step has the same commit-before-marker window as any other, so a resume
 * has to find them under the new one.
 */
export async function readRegistryRows(
  adapter: DrizzleAdapter,
  dialect: MigrationDialect,
  identifierCase: IdentifierCaseRules,
  /**
   * The plan a run in flight recorded, when there is one.
   *
   * Supplies the REVERSE of every rename it applied. Nothing else can: a field group whose author
   * named its table `fg_hero` before this migration existed is left untouched going up, so a prefix
   * rule going down would rename it to `comp_hero` and destroy an identifier this migration never
   * created. Only the record distinguishes a name we made from one that was always there.
   */
  recordedRenames: readonly ManifestEntry[] = []
): Promise<RegistryRow[]> {
  // 🔴 Both names resolved from ONE catalog listing, not two existence checks. The registry is
  // renamed by this very migration, so a rollback moving the migrated name back to the legacy one
  // between two separate checks is observed by neither: the first sees the legacy name absent
  // because the rename has not landed, the second sees the migrated name absent because it has.
  // The result is "no registry at all" — a state the database was never in — and it does not
  // announce itself as a failure. It returns an empty row set, which reads downstream as a database
  // with no field groups and refuses on a registry-hash mismatch instead of on the tear that caused
  // it. One snapshot cannot disagree with itself, which removes the window rather than
  // compensating for it afterwards.
  const catalog = indexCatalog(
    await adapter.listTables(),
    identifierCase.tables
  );
  const table =
    resolveCatalogName(catalog, STORAGE_FORMAT.registryTable) ??
    resolveCatalogName(catalog, MIGRATION_TARGET.registryTable);
  if (table === undefined) return [];

  const rows = await readRegistryTable(adapter, dialect, identifierCase, table);

  const suffix = STORAGE_FORMAT.companionSuffix;
  const out: RegistryRow[] = [];
  for (const row of rows) {
    // 🔴 Both conditions, and neither alone is enough.
    //
    // The catalog is asked because a localized group with no translatable
    // fields has no companion, and the plan must not name a table that was
    // never created. The registry's own flag is asked because presence is not
    // ownership: Nextly runs inside the user's database, and a table of theirs
    // that happens to be called `<field group>_locales` would otherwise be
    // adopted into the plan and renamed out from under them. A group that is
    // not localized has no companion, whatever sits on the derived name.
    //
    // A leftover companion from a group since un-localized is left behind by
    // this rule rather than renamed. That is the safe direction: nothing reads
    // it, whereas renaming a table Nextly does not own is not recoverable.
    // 🔴 Answered from the SAME snapshot that resolved the registry, not a fresh `tableExists`. A
    // localized group's companion is renamed by this migration too, so a separate lookup lets the
    // row and its companion describe different instants: a rename committing between them reports
    // a row still under its old `table_name` whose companion has already moved, which reads as
    // `hasCompanion: false`. That feeds the registry hash, so an in-flight run then fails the
    // recorded-hash comparison and raises a PERMANENT refusal — a refusal manufactured by the
    // reading, at the one moment a writer is demonstrably active.
    // 🔴 BOTH spellings, because the registry row and its companion move in separate commits. MySQL
    // commits each `RENAME TABLE` as it is issued and the registry row is updated after, so there is
    // a valid window in which one consistent catalog holds the MIGRATED companion beside a
    // still-legacy row. Asking only the legacy name there answers "no companion", which changes the
    // registry hash — and an in-flight run then fails the recorded-hash comparison and refuses
    // PERMANENTLY, before the retryable block, while the lock reports the writer that caused it.
    //
    // Reading both is not a widening: the two names denote the same table on either side of a
    // rename this migration itself performs, so finding either one is finding the companion.
    const counterpart = counterpartTableName(
      String(row.slug),
      String(row.table_name),
      recordedRenames
    );
    const hasCompanion =
      isLocalized(row.localized) &&
      (resolveCatalogName(catalog, `${row.table_name}${suffix}`) !==
        undefined ||
        (counterpart !== null &&
          resolveCatalogName(catalog, `${counterpart}${suffix}`) !==
            undefined));
    out.push({
      id: String(row.id),
      slug: String(row.slug),
      tableName: String(row.table_name),
      hasCompanion,
    });
  }
  return out;
}

/**
 * The other name this migration knows a field-group table by, in EITHER direction.
 *
 * 🔴 Both sides, because a companion and its registry row move in separate commits and either can
 * be ahead. Going up the row still says `comp_hero` while the companion may already be
 * `fg_hero_locales`; going DOWN the row still says `fg_hero` while the companion may already be
 * back at `comp_hero_locales`. Reading one side only answers "no companion" in the other case,
 * which changes the registry hash and strands an in-flight run on the recorded-hash check.
 *
 * The two directions come from different sources, and that asymmetry is not an oversight.
 * Forward is DERIVED, safely: `retargetName` compares against the canonical name for the slug, so a
 * table an author happened to call `comp_archive` is not adopted. Backward is READ FROM THE RECORD,
 * because it cannot be derived at all — a prefix rule going down would rename an author's own
 * `fg_hero` to `comp_hero`, and nothing in the database distinguishes a name this migration made
 * from one that was always there.
 */
function counterpartTableName(
  slug: string,
  tableName: string,
  recorded: readonly ManifestEntry[]
): string | null {
  const forward = retargetName({ slug, tableName });
  if (forward !== null) return forward;
  for (const entry of recorded) {
    if (entry.kind === "column") continue;
    if (entry.to === tableName) return entry.from;
    if (entry.from === tableName) return entry.to;
  }
  return null;
}

/** One registry row, as far as reading it here is concerned. */
interface RegistryTableRow {
  id: string;
  slug: string;
  table_name: string;
  localized?: boolean | number | null;
}

/**
 * Whether a registry row's localization flag is set.
 *
 * Both forms are accepted because both are stored: Postgres holds a boolean
 * where MySQL and SQLite hold `1`/`0`. Anything else — including the column
 * being absent on a database that predates it — reads as not localized, which
 * is the true answer there rather than a guess. Matches
 * `di/load-dynamic-tables.ts`, which reads the same column for the same reason.
 */
function isLocalized(value: boolean | number | null | undefined): boolean {
  return value === true || value === 1;
}

/**
 * Read the registry, asking the catalog whether the i18n column is there.
 *
 * `localized` is added by the core-schema reconcile, so a database that has not
 * run it yet does not have the column and selecting it would throw. Such a
 * database also has no companion tables at all, which is why its absence means
 * every row is not localized rather than unknown: that is the true answer
 * there, not a guess.
 *
 * 🔴 Decided from the catalog rather than by catching the failed select and
 * matching its message. Drizzle wraps a driver error as `Failed query: <the
 * SQL>`, so the query's own text — which names `localized` — is inside every
 * message it can produce. A predicate reading that would fall back on *any*
 * failure, a permission error on that one column included, then classify every
 * companion as absent and settle the migration with localized storage still
 * under its legacy name. Asking what the columns are is the same question
 * without the ambiguity.
 *
 * Issued as Drizzle statements rather than through the typed query builder: that
 * resolves a table through the schema registry, and mid-run the registry is
 * under whichever name the plan has reached.
 */
async function readRegistryTable(
  adapter: DrizzleAdapter,
  dialect: MigrationDialect,
  identifierCase: IdentifierCaseRules,
  table: string
): Promise<RegistryTableRow[]> {
  const columns = [
    sql.identifier("id"),
    sql.identifier("slug"),
    sql.identifier("table_name"),
  ];
  if (await hasLocalizedColumn(adapter, dialect, identifierCase, table)) {
    columns.push(sql.identifier("localized"));
  }
  return adapter.queryStatement<RegistryTableRow>(
    sql`SELECT ${sql.join(columns, sql`, `)} FROM ${sql.identifier(table)}`
  );
}

/** Whether the registry carries the i18n flag, per the catalog. */
async function hasLocalizedColumn(
  adapter: DrizzleAdapter,
  dialect: MigrationDialect,
  identifierCase: IdentifierCaseRules,
  table: string
): Promise<boolean> {
  const snapshot = await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [
    table,
  ]);
  // Matched under the server's own rules, not by exact spelling: MySQL with
  // `lower_case_table_names=1` reports a lowercased name for a table asked for
  // under another case, and an exact comparison would discard the snapshot
  // describing the very table requested.
  const catalog = indexCatalog(
    snapshot.tables.map(entry => entry.name),
    identifierCase.tables
  );
  const resolved = resolveCatalogName(catalog, table);
  const spec = snapshot.tables.find(entry => entry.name === resolved);
  if (spec === undefined) return false;
  return (
    resolveCatalogName(
      indexCatalog(
        spec.columns.map(column => column.name),
        identifierCase.columns
      ),
      "localized"
    ) !== undefined
  );
}

/** Every table name, and the columns of the ones the plan cares about. */
async function readCatalog(
  adapter: DrizzleAdapter,
  dialect: MigrationDialect
): Promise<{ tables: string[]; columns: TableColumns[] }> {
  const tables = await adapter.listTables();
  const snapshot = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    dialect,
    tables
  );
  return {
    tables,
    columns: snapshot.tables.map(table => ({
      table: table.name,
      columns: table.columns.map(column => column.name),
    })),
  };
}

/**
 * A run identifier derived from what the run is against.
 *
 * Deterministic rather than random, so a resume that has to rebuild it — a
 * crash before the marker's first write — produces the same value instead of
 * a second identity for the same work.
 */
function newMigrationId(rows: readonly RegistryRow[]): string {
  return `fg-${hashRegistryIdentity(rows).slice(0, 16)}`;
}

/** Exported for the caller that reports what a marker version means. */
export { MIGRATION_MARKER_VERSION };
