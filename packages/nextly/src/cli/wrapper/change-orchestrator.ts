// What: coordinates the end-to-end schema change flow for the wrapper CLI.
// Detects change -> classifies via SchemaChangeService -> notifies child of
// pending state -> pauses child stdin -> shows terminal prompt -> runs DDL
// via SchemaChangeService.apply -> notifies child of applied state -> respawns
// child with fresh runtime.
// Why as its own class: each dep (schema service, supervisor, IPC client,
// prompt renderer, stdin mutex, lock) has a clear boundary and is independently
// testable. The orchestrator just wires them in a deterministic sequence and
// owns error paths. Tests inject mocks for every dep so unit tests cover the
// sequence without needing a real DB or real next dev process.

import type {
  SchemaClassification,
  SchemaPreviewResult,
} from "../../domains/schema/services/schema-change-types.js";
import type {
  ApplyRequest,
  ApplyRequestResult,
} from "../../domains/schema/types/ipc-types.js";
import type { FieldDefinition } from "../../schemas/dynamic-collections.js";

import type { AsyncLock } from "./async-lock.js";
import type { IpcClient } from "./ipc-client.js";
import type { StdinMutex } from "./stdin-mutex.js";
import type { Supervisor } from "./supervisor.js";

// Minimal contract the orchestrator needs from the schema change service.
// Keeping it narrow lets us unit-test with a small mock and lets the real
// SchemaChangeService satisfy it structurally.
export interface SchemaChangeFacade {
  preview(
    tableName: string,
    currentFields: FieldDefinition[],
    newFields: FieldDefinition[]
  ): Promise<SchemaPreviewResult>;
  apply(
    slug: string,
    tableName: string,
    currentFields: FieldDefinition[],
    newFields: FieldDefinition[],
    currentSchemaVersion: number,
    registry: unknown,
    resolutions?: Record<string, unknown>,
    options?: { source?: "code" | "ui" }
  ): Promise<{
    success: boolean;
    message: string;
    newSchemaVersion: number;
    error?: string;
  }>;
}

// Represents one collection as understood by the wrapper after config load.
// `currentSchemaVersion` and `currentFields` come from the wrapper's query
// against dynamic_collections; `newFields` come from the parsed config.
export interface CollectionDelta {
  slug: string;
  tableName: string;
  currentFields: FieldDefinition[];
  newFields: FieldDefinition[];
  currentSchemaVersion: number;
}

// Prompt renderer abstraction. The real implementation uses @clack/prompts.
// The test double can assert that render was called with the expected preview
// and return a programmed confirmation.
export interface SchemaChangePromptRenderer {
  render(input: {
    slug: string;
    preview: SchemaPreviewResult;
    classification: SchemaClassification;
  }): Promise<{
    confirmed: boolean;
    resolutions?: Record<string, unknown>;
  }>;
}

export interface ChangeOrchestratorDeps {
  schemaChangeService: SchemaChangeFacade;
  collectionRegistry: unknown;
  supervisor: Supervisor;
  ipcClient: IpcClient;
  stdinMutex: StdinMutex;
  prompt: SchemaChangePromptRenderer;
  mutex: AsyncLock;
  // Hook the wrapper uses to fetch the current set of collections for diffing.
  // Provided by the caller so the orchestrator doesn't need to know where the
  // data comes from (dynamic_collections table vs in-memory cache).
  listCollectionDeltas: () => Promise<CollectionDelta[]>;
  logger: {
    info: (m: string) => void;
    warn: (m: string) => void;
    error: (m: string) => void;
  };
}

export class ChangeOrchestrator {
  constructor(private deps: ChangeOrchestratorDeps) {}

  // Called by the file watcher when the wrapper detects a config change.
  // Serialized via the async lock so a file save during an in-flight apply
  // does not race. The whole flow (detect -> prompt -> apply -> respawn) runs
  // atomically from the user's perspective.
  async handleConfigChange(): Promise<void> {
    await this.deps.mutex.acquire(async () => {
      const deltas = await this.deps.listCollectionDeltas();

      for (const delta of deltas) {
        const preview = await this.deps.schemaChangeService.preview(
          delta.tableName,
          delta.currentFields,
          delta.newFields
        );
        if (!preview.hasChanges) continue;

        // Notify the child so the admin UI's PendingSchemaBanner lights up
        // and any open Schema Builder sessions know a config-side change is
        // in flight. Even if the admin is closed, subsequent requests will
        // get the bumped X-Nextly-Schema-Version header.
        try {
          await this.deps.ipcClient.postPending({
            slug: delta.slug,
            classification: preview.classification,
            diff: preview.changes,
            ddlPreview: preview.ddlPreview,
            requestedAt: new Date().toISOString(),
          });
        } catch (err) {
          // IPC failure is non-fatal for the code-first flow - we can still
          // prompt and apply. Banner just won't update until the next /pending
          // call succeeds or the child restarts.
          this.deps.logger.warn(
            `Could not notify child of pending change: ${err instanceof Error ? err.message : String(err)}`
          );
        }

        // Pause child stdin so next dev's keyboard shortcuts don't fight
        // @clack/prompts. Resume in finally so we never leave the child
        // frozen even on unexpected errors during prompting.
        const childPid = this.deps.supervisor.pid;
        if (childPid) {
          try {
            await this.deps.stdinMutex.pauseChild(childPid);
          } catch (err) {
            this.deps.logger.warn(
              `Could not pause child stdin: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }

        let promptResult: Awaited<
          ReturnType<SchemaChangePromptRenderer["render"]>
        >;
        try {
          promptResult = await this.deps.prompt.render({
            slug: delta.slug,
            preview,
            classification: preview.classification,
          });
        } finally {
          if (childPid) {
            try {
              await this.deps.stdinMutex.resumeChild(childPid);
            } catch {
              // Resume best-effort; supervisor restart below would recover.
            }
          }
        }

        if (!promptResult.confirmed) {
          this.deps.logger.info(
            `Schema change to '${delta.slug}' cancelled. Your config edit is still on disk. Revert or re-save to retry.`
          );
          continue;
        }

        const applyResult = await this.deps.schemaChangeService.apply(
          delta.slug,
          delta.tableName,
          delta.currentFields,
          delta.newFields,
          delta.currentSchemaVersion,
          this.deps.collectionRegistry,
          promptResult.resolutions,
          // Code-first path: tell SchemaChangeService this is a legitimate
          // config-side edit so the lock check on updateCollection allows
          // writing to rows registered with source="code".
          { source: "code" }
        );

        if (!applyResult.success) {
          this.deps.logger.error(
            `Apply failed for '${delta.slug}': ${applyResult.error ?? applyResult.message}`
          );
          // Don't respawn or post /applied - database state is unchanged
          // (SchemaChangeService rolled back metadata in Sub-task 1's fix).
          continue;
        }

        try {
          await this.deps.ipcClient.postApplied({
            slug: delta.slug,
            newFields: delta.newFields,
            newSchemaVersion: applyResult.newSchemaVersion,
            appliedAt: new Date().toISOString(),
          });
        } catch (err) {
          // Non-fatal - restart below will surface the new schema anyway.
          this.deps.logger.warn(
            `Could not notify child of applied change: ${err instanceof Error ? err.message : String(err)}`
          );
        }

        this.deps.logger.info(
          `Applied schema change for '${delta.slug}'. Restarting dev server...`
        );
        await this.deps.supervisor.restart();
      }
    });
  }

  // Called by the wrapper polling loop when the child's IPC dispatcher has
  // queued UI-first apply requests. Same apply + respawn flow as code-first
  // but without the terminal prompt - the user already confirmed in the
  // admin dialog, so resolutions come pre-packaged on the request.
  async handleApplyRequest(request: ApplyRequest): Promise<ApplyRequestResult> {
    return this.deps.mutex.acquire(async () => {
      try {
        // Fetch current state for this one slug. Reuse the generic delta
        // lister and pick the matching entry; if the collection vanished
        // between admin save and wrapper pickup, the apply-request is stale.
        const deltas = await this.deps.listCollectionDeltas();
        const delta = deltas.find(d => d.slug === request.slug);
        if (!delta) {
          return {
            id: request.id,
            success: false,
            error: `Collection '${request.slug}' not found in wrapper state.`,
          };
        }

        const applyResult = await this.deps.schemaChangeService.apply(
          request.slug,
          delta.tableName,
          delta.currentFields,
          request.newFields,
          delta.currentSchemaVersion,
          this.deps.collectionRegistry,
          request.resolutions
        );

        if (!applyResult.success) {
          return {
            id: request.id,
            success: false,
            error: applyResult.error ?? applyResult.message,
          };
        }

        try {
          await this.deps.ipcClient.postApplied({
            slug: request.slug,
            newFields: request.newFields,
            newSchemaVersion: applyResult.newSchemaVersion,
            appliedAt: new Date().toISOString(),
          });
        } catch {
          // Non-fatal; restart surfaces the schema.
        }

        this.deps.logger.info(
          `Applied UI-first schema change for '${request.slug}'. Restarting dev server...`
        );
        await this.deps.supervisor.restart();

        return {
          id: request.id,
          success: true,
          newSchemaVersion: applyResult.newSchemaVersion,
        };
      } catch (err) {
        return {
          id: request.id,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
  }
}
