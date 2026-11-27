/**
 * Core's AI service against a stub provider: what it hands the provider, what
 * it refuses before the provider is asked, and the one usage event every run
 * ends in.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../../../auth/middleware";
import { NextlyError } from "../../../errors/nextly-error";
import {
  AI_PERMISSIONS,
  type AIProvider,
  type AIProviderRunRequest,
  type AIRunTarget,
  type AITaskRef,
  type AIUsageEvent,
} from "../ai-contract";
import { createAIService, type AIServiceDeps } from "../ai-service";
import { aiTurnedOff } from "../ai-switch";
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

/** A provider that records what it was asked, with every role mapped. */
function stubProvider(roles: Partial<Record<string, boolean>> = {}) {
  const settings = {
    roles: { vision: true, writer: true, embedding: true, ...roles },
  };
  const asked: AIProviderRunRequest[] = [];
  const provider = {
    settings,
    asked,
    status: vi.fn(() => ({ roles: { ...settings.roles } })),
    run: vi.fn(async (request: AIProviderRunRequest) => {
      asked.push(request);
      return { output: { alt: "A red bicycle" }, usage: USAGE };
    }),
    stream: vi.fn(async (request: AIProviderRunRequest) => {
      asked.push(request);
      return {
        text: (async function* () {
          yield "A red ";
          yield "bicycle";
        })(),
        usage: Promise.resolve(USAGE),
      };
    }),
    embed: vi.fn(async () => ({ vectors: [[0.1, 0.2]], usage: USAGE })),
  } satisfies AIProvider & Record<string, unknown>;
  return provider;
}

function person(id = "user-1"): AuthContext {
  return { userId: id, permissions: [], roles: [], authMethod: "session" };
}

const ALL_AI = [
  AI_PERMISSIONS.use.slug,
  AI_PERMISSIONS.bulk.slug,
  AI_PERMISSIONS.manage.slug,
];

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
  const deps: AIServiceDeps = {
    provider: () => options.provider,
    turnedOff: () => env.off,
    tasks: () => options.tasks ?? [ALT_TEXT, SUMMARY],
    holds: async (_caller, permission) =>
      (options.held ?? ALL_AI).includes(
        `${permission.action}-${permission.resource}`
      ),
    authorizeTarget,
    emit: async event => {
      events.push(event);
    },
    now: () => new Date("2026-11-27T10:00:00Z"),
  };
  return { service: createAIService(deps), events, env, authorizeTarget };
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
      held: [AI_PERMISSIONS.use.slug],
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
      expect(error.publicMessage).toContain("nextly ai setup");
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
    expect(error.publicMessage).toContain("NEXTLY_AI_DISABLED");
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
    ["0", false],
    ["false", false],
    [" FALSE ", false],
    ["1", true],
    ["true", true],
    ["yes", true],
    ["TRUE", true],
  ])("NEXTLY_AI_DISABLED=%j turns AI off: %s", (value, off) => {
    expect(aiTurnedOff({ NEXTLY_AI_DISABLED: value })).toBe(off);
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
    expect(error.publicData).toEqual({
      reason: "no-permission",
      permission: "use-ai",
    });
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
      held: [AI_PERMISSIONS.use.slug],
    });
    const error = await refusal(service.checkBulkJob(person()));
    expect(error.publicData).toEqual({
      reason: "no-permission",
      permission: "run-bulk-ai-jobs",
    });
  });

  it("lets a caller holding both through", async () => {
    const { service } = setup({ provider: stubProvider() });
    await expect(service.checkBulkJob(person())).resolves.toBeUndefined();
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
