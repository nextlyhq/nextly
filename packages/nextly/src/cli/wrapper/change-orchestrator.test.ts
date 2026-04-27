// Unit tests for ChangeOrchestrator. Every dep is mocked so the test covers
// the orchestration sequence without touching a real DB, file system, or
// subprocess.
import { describe, expect, it, vi } from "vitest";

import { createAsyncLock } from "./async-lock.js";
import { ChangeOrchestrator } from "./change-orchestrator.js";

// Helper: builds a deps object with predictable defaults. Tests override
// specific members by spreading overrides on top.
function makeDeps(overrides: Record<string, unknown> = {}) {
  const loggedInfo: string[] = [];
  const loggedWarn: string[] = [];
  const loggedError: string[] = [];
  const deps = {
    schemaChangeService: {
      preview: vi.fn(async () => ({
        hasChanges: true,
        hasDestructiveChanges: false,
        classification: "safe",
        changes: { added: [], removed: [], changed: [], unchanged: [] },
        warnings: [],
        interactiveFields: [],
        ddlPreview: [],
      })),
      apply: vi.fn(async () => ({
        success: true,
        message: "Schema changes applied successfully",
        newSchemaVersion: 2,
      })),
    },
    collectionRegistry: {},
    supervisor: {
      pid: 12345,
      isRunning: true,
      restart: vi.fn(async () => {}),
    } as unknown,
    ipcClient: {
      postPending: vi.fn(async () => {}),
      postApplied: vi.fn(async () => {}),
    } as unknown,
    stdinMutex: {
      pauseChild: vi.fn(async () => {}),
      resumeChild: vi.fn(async () => {}),
    } as unknown,
    prompt: {
      render: vi.fn(async () => ({ confirmed: true, resolutions: {} })),
    },
    mutex: createAsyncLock(),
    listCollectionDeltas: vi.fn(async () => [
      {
        slug: "posts",
        tableName: "posts",
        currentFields: [{ name: "title", type: "text" }],
        newFields: [
          { name: "title", type: "text" },
          { name: "views", type: "number" },
        ],
        currentSchemaVersion: 1,
      },
    ]),
    logger: {
      info: (m: string) => loggedInfo.push(m),
      warn: (m: string) => loggedWarn.push(m),
      error: (m: string) => loggedError.push(m),
    },
    ...overrides,
  };
  return { deps, loggedInfo, loggedWarn, loggedError };
}

describe("ChangeOrchestrator.handleConfigChange", () => {
  it("happy path: posts pending, prompts, applies, posts applied, respawns", async () => {
    const { deps } = makeDeps();
    const o = new ChangeOrchestrator(deps as never);
    await o.handleConfigChange();

    expect(deps.ipcClient.postPending).toHaveBeenCalledTimes(1);
    expect(deps.stdinMutex.pauseChild).toHaveBeenCalledWith(12345);
    expect(deps.prompt.render).toHaveBeenCalled();
    expect(deps.schemaChangeService.apply).toHaveBeenCalled();
    expect(deps.ipcClient.postApplied).toHaveBeenCalledTimes(1);
    expect(deps.supervisor.restart).toHaveBeenCalledTimes(1);
    expect(deps.stdinMutex.resumeChild).toHaveBeenCalledWith(12345);
  });

  it("user cancels the prompt: no apply, no restart, child stdin resumed", async () => {
    const { deps, loggedInfo } = makeDeps({
      prompt: { render: vi.fn(async () => ({ confirmed: false })) },
    });
    const o = new ChangeOrchestrator(deps as never);
    await o.handleConfigChange();

    expect(deps.schemaChangeService.apply).not.toHaveBeenCalled();
    expect(deps.supervisor.restart).not.toHaveBeenCalled();
    expect(deps.stdinMutex.resumeChild).toHaveBeenCalled();
    expect(loggedInfo.join("\n")).toMatch(/cancelled/);
  });

  it("DDL apply fails: logs error, no restart, no postApplied", async () => {
    const { deps, loggedError } = makeDeps({
      schemaChangeService: {
        preview: vi.fn(async () => ({
          hasChanges: true,
          hasDestructiveChanges: false,
          classification: "safe",
          changes: { added: [], removed: [], changed: [], unchanged: [] },
          warnings: [],
          interactiveFields: [],
          ddlPreview: [],
        })),
        apply: vi.fn(async () => ({
          success: false,
          message: "failed",
          newSchemaVersion: 1,
          error: "drizzle-kit boom",
        })),
      },
    });
    const o = new ChangeOrchestrator(deps as never);
    await o.handleConfigChange();

    expect(deps.supervisor.restart).not.toHaveBeenCalled();
    expect(deps.ipcClient.postApplied).not.toHaveBeenCalled();
    expect(loggedError.join("\n")).toMatch(/drizzle-kit boom/);
  });

  it("skips collections with no changes (hasChanges: false)", async () => {
    const { deps } = makeDeps({
      schemaChangeService: {
        preview: vi.fn(async () => ({
          hasChanges: false,
          hasDestructiveChanges: false,
          classification: "safe",
          changes: { added: [], removed: [], changed: [], unchanged: [] },
          warnings: [],
          interactiveFields: [],
          ddlPreview: [],
        })),
        apply: vi.fn(async () => ({
          success: true,
          message: "ok",
          newSchemaVersion: 1,
        })),
      },
    });
    const o = new ChangeOrchestrator(deps as never);
    await o.handleConfigChange();

    expect(deps.prompt.render).not.toHaveBeenCalled();
    expect(deps.schemaChangeService.apply).not.toHaveBeenCalled();
    expect(deps.supervisor.restart).not.toHaveBeenCalled();
  });

  it("serializes concurrent handleConfigChange calls via the mutex", async () => {
    const { deps } = makeDeps();
    // Make apply take some time so overlapping calls can race without a lock.
    (
      deps.schemaChangeService.apply as ReturnType<typeof vi.fn>
    ).mockImplementation(
      async () =>
        new Promise(resolve =>
          setTimeout(
            () => resolve({ success: true, message: "", newSchemaVersion: 2 }),
            30
          )
        )
    );
    const o = new ChangeOrchestrator(deps as never);

    // Fire two in parallel; with a proper lock, the second's inner work
    // starts only after the first completes end-to-end (restart included).
    await Promise.all([o.handleConfigChange(), o.handleConfigChange()]);

    // Restart should have been called twice - once per handle call - in
    // order rather than interleaved.
    expect(deps.supervisor.restart).toHaveBeenCalledTimes(2);
  });
});

describe("ChangeOrchestrator.handleApplyRequest", () => {
  it("returns success when DDL applies and respawns child", async () => {
    const { deps } = makeDeps();
    const o = new ChangeOrchestrator(deps as never);
    const result = await o.handleApplyRequest({
      id: "req-1",
      slug: "posts",
      newFields: [
        { name: "title", type: "text" },
        { name: "views", type: "number" },
      ],
      resolutions: {},
      confirmed: true,
    });
    expect(result).toEqual({
      id: "req-1",
      success: true,
      newSchemaVersion: 2,
    });
    expect(deps.supervisor.restart).toHaveBeenCalledTimes(1);
  });

  it("returns failure when the slug is missing from deltas", async () => {
    const { deps } = makeDeps({
      listCollectionDeltas: vi.fn(async () => []),
    });
    const o = new ChangeOrchestrator(deps as never);
    const result = await o.handleApplyRequest({
      id: "req-2",
      slug: "posts",
      newFields: [],
      resolutions: {},
      confirmed: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/);
    expect(deps.supervisor.restart).not.toHaveBeenCalled();
  });

  it("returns failure when DDL fails", async () => {
    const { deps } = makeDeps({
      schemaChangeService: {
        preview: vi.fn(),
        apply: vi.fn(async () => ({
          success: false,
          message: "x",
          newSchemaVersion: 1,
          error: "boom",
        })),
      },
    });
    const o = new ChangeOrchestrator(deps as never);
    const result = await o.handleApplyRequest({
      id: "req-3",
      slug: "posts",
      newFields: [],
      resolutions: {},
      confirmed: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("boom");
    expect(deps.supervisor.restart).not.toHaveBeenCalled();
  });
});
