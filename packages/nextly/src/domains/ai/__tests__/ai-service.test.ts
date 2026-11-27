/**
 * Core's AI service against a stub provider: what it hands the provider, what
 * it refuses before the provider is asked, and the one usage event every run
 * ends in.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../../../auth/middleware";
import { NextlyError } from "../../../errors/nextly-error";
import {
  type AIProvider,
  type AIProviderRunRequest,
  type AIProviderStream,
  type AIRunTarget,
  type AITaskRef,
  type AIUsageEvent,
} from "../ai-contract";
import {
  createAIService,
  STREAM_USAGE_WAIT_MS,
  type AIServiceDeps,
} from "../ai-service";
import {
  aiLockedOff,
  aiTurnedOff,
  forgetAILock,
  recordAILock,
} from "../ai-switch";
import { emitAIUsage, onAIUsage } from "../ai-usage-events";

const ALT_TEXT: AITaskRef = {
  owner: "@nextlyhq/ai",
  name: "alt-text",
  role: "vision",
  writesToTarget: true,
};
const SUMMARY: AITaskRef = {
  owner: "plugin-seo",
  name: "summary",
  role: "writer",
  writesToTarget: false,
};

const USAGE = {
  model: "stub-model",
  tokensIn: 12,
  tokensOut: 34,
  estimatedCostMicroUsd: 56,
};

/**
 * The permissions the stub provider declares for the three, as the AI
 * package declares its own. Core names none of them.
 */
const DECLARED = {
  use: { action: "use", resource: "ai" },
  bulk: { action: "run", resource: "bulk-ai-jobs" },
  manage: { action: "manage", resource: "ai-settings" },
};

/** A provider that records what it was asked, with every role mapped. */
function stubProvider(roles: Partial<Record<string, boolean>> = {}) {
  const settings = {
    roles: { vision: true, writer: true, embedding: true, ...roles },
  };
  const asked: AIProviderRunRequest[] = [];
  const provider = {
    settings,
    asked,
    permissions: { ...DECLARED },
    status: vi.fn(() => ({ roles: { ...settings.roles } })),
    run: vi.fn(async (request: AIProviderRunRequest) => {
      asked.push(request);
      return { output: { alt: "A red bicycle" }, usage: USAGE };
    }),
    stream: vi.fn(
      async (request: AIProviderRunRequest): Promise<AIProviderStream> => {
        asked.push(request);
        return {
          text: (async function* () {
            yield "A red ";
            yield "bicycle";
          })(),
          usage: Promise.resolve(USAGE),
        };
      }
    ),
    embed: vi.fn(async () => ({ vectors: [[0.1, 0.2]], usage: USAGE })),
  } satisfies AIProvider & Record<string, unknown>;
  return provider;
}

function person(id = "user-1"): AuthContext {
  return { userId: id, permissions: [], roles: [], authMethod: "session" };
}

const ALL_AI = ["use-ai", "run-bulk-ai-jobs", "manage-ai-settings"];

interface Setup {
  provider?: AIProvider;
  off?: boolean;
  held?: readonly string[];
  /** Target permissions the caller holds, as `read-posts`. */
  targets?: readonly string[];
  tasks?: readonly AITaskRef[];
}

function setup(options: Setup = {}) {
  const events: AIUsageEvent[] = [];
  const env = { off: options.off ?? false };
  const authorizeTarget = vi.fn(
    async (_caller: AuthContext, action: string, target: AIRunTarget) => {
      if (!(options.targets ?? []).includes(`${action}-${target.collection}`)) {
        throw NextlyError.forbidden();
      }
    }
  );
  const held = (permission: { action: string; resource: string }) =>
    (options.held ?? ALL_AI).includes(
      `${permission.action}-${permission.resource}`
    );
  // Resolving the provider runs its plugin's factory; counted so a test can
  // say it was never reached for.
  const resolveProvider = vi.fn(() => options.provider);
  const deps: AIServiceDeps = {
    provider: resolveProvider,
    turnedOff: () => env.off,
    tasks: () => options.tasks ?? [ALT_TEXT, SUMMARY],
    holds: async (_caller, permission) => held(permission),
    // Names the permission it refused, so a test sees which one was asked.
    requirePermission: async (_caller, permission) => {
      if (!held(permission)) {
        throw new NextlyError({
          code: "FORBIDDEN",
          publicMessage: `refused ${permission.action}-${permission.resource}`,
        });
      }
    },
    authorizeTarget,
    mayTarget: async (_caller, action, target) =>
      (options.targets ?? []).includes(`${action}-${target.collection}`),
    emit: async event => {
      events.push(event);
    },
    now: () => new Date("2026-11-27T10:00:00Z"),
  };
  return {
    service: createAIService(deps),
    events,
    env,
    authorizeTarget,
    resolveProvider,
  };
}

async function refusal(promise: Promise<unknown>): Promise<NextlyError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown
  );
  if (!NextlyError.is(error)) throw new Error("expected a NextlyError");
  return error;
}

describe("the AI contract against a stub provider", () => {
  it("runs a task, handing the provider the task, input, target, person and agent", async () => {
    const provider = stubProvider();
    const { service } = setup({
      provider,
      targets: ["read-posts", "update-posts"],
    });

    const result = await service.run(person("ana"), {
      task: { owner: "@nextlyhq/ai", name: "alt-text" },
      input: { image: "media-1" },
      target: { collection: "posts", id: "p1" },
      agent: { id: "agent-7", name: "Claude Desktop" },
    });

    expect(result).toEqual({ output: { alt: "A red bicycle" }, usage: USAGE });
    expect(provider.asked).toEqual([
      {
        task: ALT_TEXT,
        input: { image: "media-1" },
        target: { collection: "posts", id: "p1" },
        personId: "ana",
        agent: { id: "agent-7", name: "Claude Desktop" },
      },
    ]);
  });

  it("streams a task's text as the provider sends it", async () => {
    const provider = stubProvider();
    const { service } = setup({ provider });
    const chunks: string[] = [];
    for await (const chunk of await service.stream(person(), {
      task: { owner: "plugin-seo", name: "summary" },
      input: "text",
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(["A red ", "bicycle"]);
  });

  it("embeds text through the provider", async () => {
    const provider = stubProvider();
    const { service } = setup({ provider });
    await expect(
      service.embed(person(), { texts: ["hello"] })
    ).resolves.toEqual({ vectors: [[0.1, 0.2]], usage: USAGE });
    expect(provider.embed).toHaveBeenCalledWith({
      texts: ["hello"],
      personId: "user-1",
      agent: null,
    });
  });

  it("reports configured, which roles have a model, the caller's permissions and their tasks", async () => {
    const { service } = setup({
      provider: stubProvider({ writer: false }),
      held: ["use-ai"],
    });
    await expect(service.status(person())).resolves.toEqual({
      configured: true,
      roles: {
        fast: false,
        writer: false,
        vision: true,
        embedding: true,
        image: false,
      },
      permissions: { use: true, bulk: false, manage: false },
      tasks: [
        {
          owner: "@nextlyhq/ai",
          name: "alt-text",
          role: "vision",
          available: true,
        },
        {
          owner: "plugin-seo",
          name: "summary",
          role: "writer",
          available: false,
          reason: "no-model-for-role",
        },
      ],
    });
  });
});

describe("with no AI package", () => {
  it("reports not configured, no role with a model, and every task unavailable", async () => {
    const { service } = setup();
    const status = await service.status(person());
    expect(status.configured).toBe(false);
    expect(status.reason).toBe("no-ai-package");
    expect(Object.values(status.roles).every(has => !has)).toBe(true);
    expect(status.tasks.map(t => [t.name, t.available, t.reason])).toEqual([
      ["alt-text", false, "not-configured"],
      ["summary", false, "not-configured"],
    ]);
  });

  it("refuses every run with a message that says how to set AI up", async () => {
    const { service } = setup();
    const args = { task: { owner: "plugin-seo", name: "summary" }, input: "x" };
    for (const attempt of [
      service.run(person(), args),
      service.stream(person(), args),
      service.embed(person(), { texts: ["x"] }),
      service.checkBulkJob(person()),
    ]) {
      const error = await refusal(attempt);
      expect(error.code).toBe("SERVICE_UNAVAILABLE");
      expect(error.publicMessage).toContain("@nextlyhq/ai");
      // No command is named that the CLI does not have.
      expect(error.publicMessage).not.toContain("nextly ai");
    }
  });
});

describe("the environment switch", () => {
  it("behaves as if no package were configured, and asks the provider nothing", async () => {
    const provider = stubProvider();
    const { service, env } = setup({ provider });
    env.off = true;

    const status = await service.status(person());
    expect(status).toMatchObject({ configured: false, reason: "turned-off" });
    expect(status.tasks.every(t => t.reason === "not-configured")).toBe(true);
    const error = await refusal(
      service.run(person(), {
        task: { owner: "plugin-seo", name: "summary" },
        input: "x",
      })
    );
    expect(error.code).toBe("SERVICE_UNAVAILABLE");
    expect(error.publicMessage).toContain("NEXTLY_AI=off");
    expect(provider.run).not.toHaveBeenCalled();
    expect(provider.status).not.toHaveBeenCalled();
  });

  it("keeps the provider's settings, so turning it back on restores AI as it was", async () => {
    const provider = stubProvider({ writer: false });
    const before = structuredClone(provider.settings);
    const { service, env } = setup({ provider });
    const on = await service.status(person());

    env.off = true;
    await service.status(person());
    env.off = false;

    expect(provider.settings).toEqual(before);
    await expect(service.status(person())).resolves.toEqual(on);
  });

  it.each([
    [undefined, false],
    ["", false],
    ["on", false],
    ["0", false],
    ["false", false],
    ["disabled", false],
    ["off", true],
    [" OFF ", true],
    ["Off", true],
  ])("NEXTLY_AI=%j locks AI off: %s", (value, off) => {
    expect(aiLockedOff({ environment: { NEXTLY_AI: value } })).toBe(off);
  });

  it("is locked by the configuration's setting too, which cannot lift the environment's", () => {
    expect(aiLockedOff({ environment: {}, configuration: true })).toBe(true);
    expect(
      aiLockedOff({ environment: { NEXTLY_AI: "off" }, configuration: false })
    ).toBe(true);
    expect(aiLockedOff({ environment: {}, configuration: false })).toBe(false);
  });
});

describe("the lock, as a boot records it", () => {
  const saved = process.env.NEXTLY_AI;
  afterEach(() => {
    forgetAILock();
    if (saved === undefined) delete process.env.NEXTLY_AI;
    else process.env.NEXTLY_AI = saved;
  });

  it("holds for the whole boot, whatever the environment says later", () => {
    recordAILock({ environment: { NEXTLY_AI: "off" } });
    process.env.NEXTLY_AI = "on";
    expect(aiTurnedOff()).toBe(true);
  });

  it("is read from the environment before any boot has recorded it", () => {
    forgetAILock();
    process.env.NEXTLY_AI = "off";
    expect(aiTurnedOff()).toBe(true);
    delete process.env.NEXTLY_AI;
    expect(aiTurnedOff()).toBe(false);
  });
});

describe("with no AI package", () => {
  it("holds no AI permission, whoever asks", async () => {
    const { service } = setup();
    expect((await service.status(person())).permissions).toEqual({
      use: false,
      bulk: false,
      manage: false,
    });
  });
});

describe("the permissions asked", () => {
  it("are the ones the provider declares", async () => {
    const provider = stubProvider();
    const asked: string[] = [];
    // A provider whose "use" permission core has never heard of.
    provider.permissions = {
      ...provider.permissions,
      use: { action: "employ", resource: "robots" },
    };
    const status = await createAIService({
      provider: () => provider,
      turnedOff: () => false,
      tasks: () => [SUMMARY],
      holds: async (_caller, permission) => {
        asked.push(`${permission.action}-${permission.resource}`);
        return false;
      },
      requirePermission: async () => undefined,
      authorizeTarget: async () => undefined,
      mayTarget: async () => true,
      emit: async () => undefined,
      now: () => new Date(),
    }).status(person());
    expect(asked).toEqual([
      "employ-robots",
      "run-bulk-ai-jobs",
      "manage-ai-settings",
    ]);
    expect(status.tasks[0]).toMatchObject({
      reason: "missing-permission",
      permission: "employ-robots",
    });
  });
});

describe("a task not available to the caller", () => {
  it("is refused, naming the permission, when the caller lacks Use AI", async () => {
    const provider = stubProvider();
    const { service } = setup({ provider, held: [] });

    const status = await service.status(person());
    expect(status.tasks[0]).toMatchObject({
      available: false,
      reason: "missing-permission",
      permission: "use-ai",
    });
    const error = await refusal(
      service.run(person(), {
        task: { owner: "@nextlyhq/ai", name: "alt-text" },
        input: {},
      })
    );
    expect(error.code).toBe("FORBIDDEN");
    expect(error.publicMessage).toBe("refused use-ai");
    expect(provider.run).not.toHaveBeenCalled();
  });

  it("is refused, naming the role, when the role it needs has no model", async () => {
    const provider = stubProvider({ vision: false });
    const { service } = setup({ provider });

    const status = await service.status(person());
    expect(status.tasks[0]).toMatchObject({
      available: false,
      reason: "no-model-for-role",
    });
    const error = await refusal(
      service.run(person(), {
        task: { owner: "@nextlyhq/ai", name: "alt-text" },
        input: {},
      })
    );
    expect(error.code).toBe("SERVICE_UNAVAILABLE");
    expect(error.publicMessage).toContain('"vision" role');
    expect(provider.run).not.toHaveBeenCalled();
  });

  it("refuses an embedding when the embedding role has no model", async () => {
    const provider = stubProvider({ embedding: false });
    const { service } = setup({ provider });
    const error = await refusal(service.embed(person(), { texts: ["x"] }));
    expect(error.publicMessage).toContain('"embedding" role');
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it("refuses a task nobody registered as not found", async () => {
    const provider = stubProvider();
    const { service } = setup({ provider });
    const error = await refusal(
      service.run(person(), { task: { owner: "x", name: "nope" }, input: {} })
    );
    expect(error.code).toBe("NOT_FOUND");
    expect(provider.run).not.toHaveBeenCalled();
  });
});

describe("the caller's rights on the target", () => {
  const altText = {
    task: { owner: "@nextlyhq/ai", name: "alt-text" },
    input: {},
    target: { collection: "posts", id: "p1" },
  };

  it("asks to read the target and to edit it where the task writes its result", async () => {
    const provider = stubProvider();
    const { service, authorizeTarget } = setup({
      provider,
      targets: ["read-posts", "update-posts"],
    });
    await service.run(person(), altText);
    expect(authorizeTarget.mock.calls.map(([, action]) => action)).toEqual([
      "read",
      "update",
    ]);
  });

  it("refuses a person who may use AI and read the target but not edit it, before the provider is asked", async () => {
    const provider = stubProvider();
    const { service } = setup({ provider, targets: ["read-posts"] });
    const error = await refusal(service.run(person(), altText));
    expect(error.code).toBe("FORBIDDEN");
    expect(provider.run).not.toHaveBeenCalled();
  });

  it("asks only to read for a task whose result goes back to the caller", async () => {
    const provider = stubProvider();
    const { service, authorizeTarget } = setup({
      provider,
      targets: ["read-posts"],
    });
    await service.run(person(), {
      task: { owner: "plugin-seo", name: "summary" },
      input: {},
      target: { collection: "posts" },
    });
    expect(authorizeTarget.mock.calls.map(([, action]) => action)).toEqual([
      "read",
    ]);
  });

  it("asks nothing of trusted server code", async () => {
    const provider = stubProvider();
    const { service, authorizeTarget } = setup({ provider, held: [] });
    await service.run(null, altText);
    expect(authorizeTarget).not.toHaveBeenCalled();
    expect(provider.asked[0]?.personId).toBeNull();
  });
});

describe("bulk jobs", () => {
  it("refuses a caller who may use AI but not run bulk jobs", async () => {
    const { service } = setup({
      provider: stubProvider(),
      held: ["use-ai"],
    });
    const error = await refusal(service.checkBulkJob(person()));
    expect(error.publicMessage).toBe("refused run-bulk-ai-jobs");
  });

  it("lets a caller holding both through", async () => {
    const { service } = setup({ provider: stubProvider() });
    await expect(service.checkBulkJob(person())).resolves.toBeUndefined();
  });
});

describe("while switched off", () => {
  it("never resolves the provider, so a broken one cannot fail the status", async () => {
    const { service, env, resolveProvider } = setup({
      provider: stubProvider(),
    });
    env.off = true;
    await service.status(person());
    await refusal(
      service.run(person(), {
        task: { owner: "plugin-seo", name: "summary" },
        input: "x",
      })
    );
    expect(resolveProvider).not.toHaveBeenCalled();
  });
});

/** A provider whose stream is driven by the test. */
function controlledStream(
  cleanup: () => Promise<unknown> = async () => undefined
) {
  const provider = stubProvider();
  let settle!: (usage: typeof USAGE) => void;
  let fail!: (error: Error) => void;
  const usage = new Promise<typeof USAGE>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const stopped = vi.fn();
  provider.stream.mockImplementation(async () => ({
    text: {
      [Symbol.asyncIterator]: () => {
        let sent = 0;
        return {
          next: async () =>
            sent < 2
              ? { done: false as const, value: `chunk ${++sent}` }
              : { done: true as const, value: undefined },
          return: async () => {
            stopped();
            await cleanup();
            return { done: true as const, value: undefined };
          },
        };
      },
    },
    usage,
  }));
  return { provider, settle, fail, stopped };
}

describe("a task's availability for one piece of content", () => {
  it("is judged as its run would be: read the target, and edit it where the result goes", async () => {
    const { service } = setup({
      provider: stubProvider(),
      targets: ["read-posts"],
    });
    const status = await service.status(person(), {
      target: { collection: "posts", id: "p1" },
    });
    expect(status.tasks).toEqual([
      {
        owner: "@nextlyhq/ai",
        name: "alt-text",
        role: "vision",
        available: false,
        reason: "missing-permission",
        permission: "update-posts",
      },
      {
        owner: "plugin-seo",
        name: "summary",
        role: "writer",
        available: true,
      },
    ]);
  });

  it("names the read a caller lacks", async () => {
    const { service } = setup({ provider: stubProvider(), targets: [] });
    const status = await service.status(person(), {
      target: { collection: "posts" },
    });
    expect(status.tasks.map(t => t.permission)).toEqual([
      "read-posts",
      "read-posts",
    ]);
  });

  it("asks nothing of the content when no target is named", async () => {
    const { service } = setup({ provider: stubProvider(), targets: [] });
    const status = await service.status(person());
    expect(status.tasks.every(t => t.available)).toBe(true);
  });
});

describe("a provider that cannot be reached for", () => {
  it("records the run as failed, not refused", async () => {
    const { service, events, resolveProvider } = setup({
      provider: stubProvider(),
    });
    resolveProvider.mockImplementation(() => {
      throw new Error("factory broke");
    });
    await expect(
      service.run(person(), {
        task: { owner: "plugin-seo", name: "summary" },
        input: "x",
      })
    ).rejects.toThrow("factory broke");
    await expect(
      service.stream(person(), {
        task: { owner: "plugin-seo", name: "summary" },
        input: "x",
      })
    ).rejects.toThrow("factory broke");
    await expect(service.embed(person(), { texts: ["x"] })).rejects.toThrow(
      "factory broke"
    );
    expect(events.map(e => e.result)).toEqual(["failed", "failed", "failed"]);
  });
});

describe("a provider that answers with something unreadable", () => {
  const summary = {
    task: { owner: "plugin-seo", name: "summary" },
    input: "x",
  };

  it.each([
    ["negative tokens", { ...USAGE, tokensIn: -1 }],
    ["fractional tokens", { ...USAGE, tokensOut: 1.5 }],
    [
      "a cost that is not a whole number",
      { ...USAGE, estimatedCostMicroUsd: 0.5 },
    ],
    [
      "a cost that is not a number",
      { ...USAGE, estimatedCostMicroUsd: Number.NaN },
    ],
  ])(
    "refuses a run whose usage has %s, and records it failed with none",
    async (_what, usage) => {
      const provider = stubProvider();
      provider.run.mockResolvedValueOnce({ output: { alt: "x" }, usage });
      const { service, events } = setup({ provider });
      const error = await refusal(service.run(person(), summary));
      expect(error.code).toBe("EXTERNAL_SERVICE_ERROR");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        result: "failed",
        tokensIn: 0,
        estimatedCostMicroUsd: null,
      });
    }
  );

  it("refuses a stream whose usage is unreadable, once its text is read", async () => {
    const { provider, settle } = controlledStream();
    const { service, events } = setup({ provider });
    settle({ ...USAGE, tokensIn: -5 });
    const read = async () => {
      for await (const _chunk of await service.stream(person(), summary)) {
        // read to the end
      }
    };
    await expect(read()).rejects.toMatchObject({
      code: "EXTERNAL_SERVICE_ERROR",
    });
    expect(events.map(e => [e.result, e.tokensIn])).toEqual([["failed", 0]]);
  });

  it.each([
    ["too few", [[0.1]]],
    ["too many", [[0.1], [0.2], [0.3]]],
  ])(
    "refuses an embedding with %s vectors for the texts it was given",
    async (_what, vectors) => {
      const provider = stubProvider();
      provider.embed.mockResolvedValueOnce({ vectors, usage: USAGE });
      const { service, events } = setup({ provider });
      const error = await refusal(
        service.embed(person(), { texts: ["a", "b"] })
      );
      expect(error.code).toBe("EXTERNAL_SERVICE_ERROR");
      expect(events.map(e => e.result)).toEqual(["failed"]);
    }
  );

  it.each([
    ["text that cannot be read", { text: {}, usage: Promise.resolve(USAGE) }],
    ["no usage", { text: (async function* () {})(), usage: undefined }],
  ])(
    "refuses a stream answered with %s, and records it failed",
    async (_what, answer) => {
      const provider = stubProvider();
      provider.stream.mockResolvedValueOnce(
        answer as unknown as AIProviderStream
      );
      const { service, events } = setup({ provider });
      const error = await refusal(service.stream(person(), summary));
      expect(error.code).toBe("EXTERNAL_SERVICE_ERROR");
      expect(events.map(e => [e.kind, e.result])).toEqual([
        ["stream", "failed"],
      ]);
    }
  );

  it("refuses an embedding whose vectors are not numbers", async () => {
    const provider = stubProvider();
    provider.embed.mockResolvedValueOnce({
      vectors: [["a"]] as unknown as number[][],
      usage: USAGE,
    });
    const { service, events } = setup({ provider });
    const error = await refusal(service.embed(person(), { texts: ["x"] }));
    expect(error.code).toBe("EXTERNAL_SERVICE_ERROR");
    expect(events.map(e => e.result)).toEqual(["failed"]);
  });
});

describe("a provider that fails while a run is admitted", () => {
  it("records the run as failed, not refused, and passes its error on", async () => {
    const provider = stubProvider();
    provider.status.mockImplementation(() => {
      throw new Error("provider down");
    });
    const { service, events } = setup({ provider });
    await expect(
      service.run(person(), {
        task: { owner: "plugin-seo", name: "summary" },
        input: "x",
      })
    ).rejects.toThrow("provider down");
    await expect(
      service.stream(person(), {
        task: { owner: "plugin-seo", name: "summary" },
        input: "x",
      })
    ).rejects.toThrow("provider down");
    await expect(service.embed(person(), { texts: ["x"] })).rejects.toThrow(
      "provider down"
    );
    expect(events.map(e => [e.kind, e.result])).toEqual([
      ["run", "failed"],
      ["stream", "failed"],
      ["embed", "failed"],
    ]);
  });
});

describe("one usage event per stream, however it ends", () => {
  const summary = {
    task: { owner: "plugin-seo", name: "summary" },
    input: "x",
  };

  it("records a stream stopped before it is read as cancelled, and stops the provider", async () => {
    const { provider, settle, stopped } = controlledStream();
    const { service, events } = setup({ provider });
    const iterator = (await service.stream(person(), summary))[
      Symbol.asyncIterator
    ]();
    settle(USAGE);
    await iterator.return?.();
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(events.map(e => e.result)).toEqual(["cancelled"]);
  });

  it("records what a stream stopped early used, once the provider says", async () => {
    const { provider, settle } = controlledStream();
    const { service, events } = setup({ provider });
    const iterator = (await service.stream(person(), summary))[
      Symbol.asyncIterator
    ]();
    await iterator.next();
    const stopping = iterator.return?.();
    settle(USAGE);
    await stopping;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ result: "cancelled", ...USAGE });
  });

  it("records a stream whose usage fails after its text as failed, and tells the reader", async () => {
    const { provider, fail } = controlledStream();
    const { service, events } = setup({ provider });
    fail(new Error("usage unavailable"));
    const read = async () => {
      for await (const _chunk of await service.stream(person(), summary)) {
        // read to the end
      }
    };
    await expect(read()).rejects.toThrow("usage unavailable");
    expect(events.map(e => e.result)).toEqual(["failed"]);
  });

  it("records a stop with no usage when the provider never says, after a bounded wait", async () => {
    vi.useFakeTimers();
    try {
      const { provider } = controlledStream();
      const { service, events } = setup({ provider });
      const iterator = (await service.stream(person(), summary))[
        Symbol.asyncIterator
      ]();
      await iterator.next();
      const stopping = iterator.return?.();
      await vi.advanceTimersByTimeAsync(STREAM_USAGE_WAIT_MS);
      await stopping;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ result: "cancelled", tokensIn: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles a usage that fails while the text is still being read", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const { provider, fail } = controlledStream();
      const { service, events } = setup({ provider });
      const iterator = (await service.stream(person(), summary))[
        Symbol.asyncIterator
      ]();
      await iterator.next();
      fail(new Error("usage lost"));
      // Long enough for Node to report a rejection nobody handles.
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
      await iterator.next();
      await expect(iterator.next()).rejects.toThrow("usage lost");
      expect(events.map(e => e.result)).toEqual(["failed"]);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("records one event when the last read and a stop race", async () => {
    const { provider, settle } = controlledStream();
    const { service, events } = setup({ provider });
    settle(USAGE);
    const iterator = (await service.stream(person(), summary))[
      Symbol.asyncIterator
    ]();
    await iterator.next();
    await iterator.next();
    await Promise.all([iterator.next(), iterator.return?.()]);
    expect(events).toHaveLength(1);
  });

  it("records one event when two reads reach the end together", async () => {
    const { provider, settle } = controlledStream();
    const { service, events } = setup({ provider });
    settle(USAGE);
    const iterator = (await service.stream(person(), summary))[
      Symbol.asyncIterator
    ]();
    await iterator.next();
    await iterator.next();
    await Promise.all([iterator.next(), iterator.next()]);
    expect(events.map(e => e.result)).toEqual(["succeeded"]);
  });

  it("records a stop whose provider never finishes stopping, after the bounded wait", async () => {
    vi.useFakeTimers();
    try {
      const { provider, settle } = controlledStream(
        () => new Promise(() => undefined)
      );
      const { service, events } = setup({ provider });
      settle(USAGE);
      const iterator = (await service.stream(person(), summary))[
        Symbol.asyncIterator
      ]();
      await iterator.next();
      const stopping = iterator.return?.();
      await vi.advanceTimersByTimeAsync(STREAM_USAGE_WAIT_MS);
      await stopping;
      expect(events.map(e => [e.result, e.tokensIn])).toEqual([
        ["cancelled", USAGE.tokensIn],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records a stop whose provider fails to stop", async () => {
    const { provider, settle } = controlledStream(async () => {
      throw new Error("cleanup broke");
    });
    const { service, events } = setup({ provider });
    settle(USAGE);
    const iterator = (await service.stream(person(), summary))[
      Symbol.asyncIterator
    ]();
    await iterator.next();
    await iterator.return?.();
    expect(events.map(e => e.result)).toEqual(["cancelled"]);
  });

  it("records nothing twice when the reader stops after the end", async () => {
    const { provider, settle } = controlledStream();
    const { service, events } = setup({ provider });
    settle(USAGE);
    const iterator = (await service.stream(person(), summary))[
      Symbol.asyncIterator
    ]();
    while (!(await iterator.next()).done) {
      // read to the end
    }
    await iterator.return?.();
    expect(events.map(e => e.result)).toEqual(["succeeded"]);
  });
});

describe("one usage event per run", () => {
  const summary = {
    task: { owner: "plugin-seo", name: "summary" },
    input: "x",
  };

  it("records a finished run's task, model, tokens, cost, person, agent and result", async () => {
    const { service, events } = setup({ provider: stubProvider() });
    await service.run(person("ana"), { ...summary, agent: { id: "a1" } });
    expect(events).toEqual([
      {
        kind: "run",
        task: { owner: "plugin-seo", name: "summary" },
        ...USAGE,
        personId: "ana",
        agent: { id: "a1" },
        result: "succeeded",
        endedAt: new Date("2026-11-27T10:00:00Z"),
      },
    ]);
  });

  it("records a refused run as refused, with nothing used", async () => {
    const { service, events } = setup({ provider: stubProvider(), held: [] });
    await refusal(service.run(person(), summary));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      result: "refused",
      tokensIn: 0,
      model: null,
    });
  });

  it("records a run the provider failed as failed, and passes its error on", async () => {
    const provider = stubProvider();
    provider.run.mockRejectedValueOnce(NextlyError.serviceUnavailable());
    const { service, events } = setup({ provider });
    await expect(service.run(person(), summary)).rejects.toThrow();
    expect(events.map(e => e.result)).toEqual(["failed"]);
  });

  it("records a stream read to its end as succeeded with its usage", async () => {
    const { service, events } = setup({ provider: stubProvider() });
    for await (const _chunk of await service.stream(person(), summary)) {
      // read every chunk
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "stream",
      result: "succeeded",
      ...USAGE,
    });
  });

  it("records a stream left early as cancelled", async () => {
    const { service, events } = setup({ provider: stubProvider() });
    for await (const _chunk of await service.stream(person(), summary)) break;
    expect(events.map(e => [e.kind, e.result])).toEqual([
      ["stream", "cancelled"],
    ]);
  });

  it("records an embedding with no task", async () => {
    const { service, events } = setup({ provider: stubProvider() });
    await service.embed(person(), { texts: ["x"] });
    expect(events[0]).toMatchObject({
      kind: "embed",
      task: null,
      result: "succeeded",
    });
  });
});

describe("the usage-event hook", () => {
  const stops: Array<() => void> = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
  });

  it("tells every listener, though one throws, and the run's result stands", async () => {
    const heard: AIUsageEvent[] = [];
    stops.push(
      onAIUsage(() => {
        throw new Error("listener broke");
      })
    );
    stops.push(onAIUsage(event => void heard.push(event)));
    const provider = stubProvider();
    const service = createAIService({
      provider: () => provider,
      turnedOff: () => false,
      tasks: () => [SUMMARY],
      holds: async () => true,
      requirePermission: async () => undefined,
      mayTarget: async () => true,
      authorizeTarget: async () => undefined,
      emit: emitAIUsage,
      now: () => new Date(),
    });

    const result = await service.run(person(), {
      task: { owner: "plugin-seo", name: "summary" },
      input: "x",
    });

    expect(result.output).toEqual({ alt: "A red bicycle" });
    expect(heard).toHaveLength(1);
    expect(heard[0]?.result).toBe("succeeded");
  });

  it("stops telling a listener once it is removed", async () => {
    const heard: AIUsageEvent[] = [];
    const stop = onAIUsage(event => void heard.push(event));
    stop();
    await emitAIUsage({
      kind: "embed",
      task: null,
      model: null,
      tokensIn: 0,
      tokensOut: 0,
      estimatedCostMicroUsd: null,
      personId: null,
      agent: null,
      result: "refused",
      endedAt: new Date(),
    });
    expect(heard).toEqual([]);
  });
});
