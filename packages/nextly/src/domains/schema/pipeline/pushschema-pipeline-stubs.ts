// No-op stub implementations of the F3 plug-in interfaces.
// F4-F8 each replace one stub with a real implementation.
//
// Behavior contract:
//   - RenameDetector stub: never detects a rename (returns empty array).
//   - Classifier stub: every change is "safe".
//   - PromptDispatcher stub: auto-confirms (returns empty result).
//     Will only ever be called if RenameDetector or Classifier ever
//     return non-default values, so in F3 (with all stubs) it never runs.
//   - PreRenameExecutor stub: no-op.
//   - MigrationJournal stub: returns dummy IDs, writes nothing.

import type {
  Classifier,
  MigrationJournal,
  PreRenameExecutor,
  PromptDispatcher,
  RenameDetector,
} from "./pushschema-pipeline-interfaces.js";

// Updated for F4 Option E: detect() reads Operation[] instead of SQL strings.
// The noop body is unchanged; the type signature shift comes from the
// interface change in pushschema-pipeline-interfaces.ts.
export const noopRenameDetector: RenameDetector = {
  detect: () => [],
};

// F5 PR 1: signature returns ClassificationResult { level, events } now.
// F2-style empty noop preserves "every change is safe" behavior.
export const noopClassifier: Classifier = {
  classify: () => Promise.resolve({ level: "safe" as const, events: [] }),
};

// F5 PR 1: dispatch() now returns proceed flag and typed Resolution[].
// Auto-confirm with proceed=true matches old "auto-resolve" intent.
export const noopPromptDispatcher: PromptDispatcher = {
  dispatch: () =>
    Promise.resolve({
      confirmedRenames: [],
      resolutions: [],
      proceed: true,
    }),
};

export const noopPreRenameExecutor: PreRenameExecutor = {
  execute: () => Promise.resolve(),
};

export const noopMigrationJournal: MigrationJournal = {
  recordStart: () => Promise.resolve("noop-journal-id"),
  recordEnd: () => Promise.resolve(),
};
