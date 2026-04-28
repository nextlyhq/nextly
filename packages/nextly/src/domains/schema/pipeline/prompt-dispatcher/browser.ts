// PromptDispatcher implementation for the UI-first (admin Schema Builder)
// path. Unlike the clack terminal dispatcher, this never actually prompts:
// the admin UI's SchemaChangeDialog has already collected the user's
// rename choices BEFORE the apply HTTP request fires, and those choices
// arrive on the request body. The dispatcher's only job is to translate
// those pre-attached resolutions into the PromptDispatcher contract the
// pipeline expects.
//
// Why this exists rather than calling applyResolutionsToOperations
// directly: the pipeline's seam is PromptDispatcher.dispatch(). Reusing
// it (instead of bypassing) means the same Phase B flow runs on both
// channels, and a future F10 SSE-based browser channel can swap this
// implementation out without touching the pipeline.

import type {
  PromptDispatcher,
  PromptDispatchResult,
  RenameCandidate,
} from "../pushschema-pipeline-interfaces.js";

// Pre-attached rename choice from the admin UI. Mirrors the shape the
// admin SchemaChangeDialog renders + posts.
export interface BrowserRenameResolution {
  tableName: string;
  fromColumn: string;
  toColumn: string;
  choice: "rename" | "drop_and_add";
}

export class BrowserPromptDispatcher implements PromptDispatcher {
  constructor(private readonly resolutions: BrowserRenameResolution[]) {}

  dispatch(args: {
    candidates: RenameCandidate[];
    classification: "safe" | "destructive" | "interactive";
    channel: "browser" | "terminal";
  }): Promise<PromptDispatchResult> {
    const { candidates } = args;
    if (candidates.length === 0) {
      // Pure additive apply. No prompt would have been needed anyway.
      return Promise.resolve({ confirmedRenames: [], resolutions: {} });
    }

    // Index resolutions by (table, from, to) so we can match them to
    // each candidate. Entries with choice "drop_and_add" are silently
    // dropped — they're equivalent to "no resolution attached," which
    // means applyResolutionsToOperations leaves the drop+add as-is.
    const confirmedKeys = new Set(
      this.resolutions
        .filter(r => r.choice === "rename")
        .map(r => `${r.tableName}::${r.fromColumn}::${r.toColumn}`)
    );

    const confirmedRenames = candidates.filter(c =>
      confirmedKeys.has(`${c.tableName}::${c.fromColumn}::${c.toColumn}`)
    );

    return Promise.resolve({
      confirmedRenames,
      resolutions: {},
    });
  }
}
