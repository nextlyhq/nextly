/**
 * A control drawn behind the AI gate is absent unless the server's status
 * lets it be drawn. Every "absent" case first waits until the status has
 * arrived, so absence is the gate's answer and not a status still loading.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AIStatus } from "nextly/runtime";

const answer = vi.hoisted(() => ({
  status: undefined as unknown,
  // The status for one piece of content, by its collection, where a test
  // gives one; asked targets are recorded.
  byTarget: new Map<string, unknown>(),
  asked: [] as unknown[],
}));

vi.mock("@admin/services/aiApi", () => ({
  aiApi: {
    getAIStatus: async (target?: { collection: string }) => {
      answer.asked.push(target);
      return target === undefined
        ? answer.status
        : (answer.byTarget.get(target.collection) ?? answer.status);
    },
  },
}));

import { useAIStatus } from "@admin/hooks/queries/useAIStatus";

import { AIGate } from "./index";

const NO_ROLES = {
  fast: false,
  writer: false,
  vision: false,
  embedding: false,
  image: false,
};

const CONFIGURED: AIStatus = {
  configured: true,
  roles: { ...NO_ROLES, vision: true },
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
};

/** Says when the status has arrived, so an absent control is a real answer. */
function StatusArrived() {
  const { data } = useAIStatus();
  return data === undefined ? null : <span>status arrived</span>;
}

function renderGate(status: AIStatus, gate: ReactNode) {
  answer.status = status;
  answer.asked.length = 0;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <StatusArrived />
      {gate}
    </QueryClientProvider>
  );
}

const BUTTON = <button type="button">Write alt text</button>;

describe("the AI gate", () => {
  it("draws the control when AI is configured and the person may use it", async () => {
    renderGate(CONFIGURED, <AIGate>{BUTTON}</AIGate>);
    expect(
      await screen.findByRole("button", { name: "Write alt text" })
    ).toBeTruthy();
  });

  it("draws nothing when the status says AI is not configured", async () => {
    renderGate(
      {
        ...CONFIGURED,
        configured: false,
        reason: "no-ai-package",
        roles: NO_ROLES,
        tasks: [],
      },
      <AIGate>{BUTTON}</AIGate>
    );
    await screen.findByText("status arrived");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("draws nothing when the person lacks Use AI", async () => {
    renderGate(
      {
        ...CONFIGURED,
        permissions: { use: false, bulk: false, manage: false },
      },
      <AIGate>{BUTTON}</AIGate>
    );
    await screen.findByText("status arrived");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("draws a task's control only when that task is available to the person", async () => {
    renderGate(
      CONFIGURED,
      <>
        <AIGate task={{ owner: "@nextlyhq/ai", name: "alt-text" }}>
          <button type="button">Alt text</button>
        </AIGate>
        <AIGate task={{ owner: "plugin-seo", name: "summary" }}>
          <button type="button">Summary</button>
        </AIGate>
      </>
    );
    expect(
      await screen.findByRole("button", { name: "Alt text" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Summary" })).toBeNull();
  });

  it("draws a bulk control only for a person who may run bulk jobs", async () => {
    renderGate(
      CONFIGURED,
      <AIGate permission="bulk">
        <button type="button">Run on all</button>
      </AIGate>
    );
    await screen.findByText("status arrived");
    expect(screen.queryByRole("button", { name: "Run on all" })).toBeNull();
  });

  it("draws a bulk control for a person who may use AI and run bulk jobs", async () => {
    renderGate(
      { ...CONFIGURED, permissions: { use: true, bulk: true, manage: false } },
      <AIGate permission="bulk">
        <button type="button">Run on all</button>
      </AIGate>
    );
    expect(
      await screen.findByRole("button", { name: "Run on all" })
    ).toBeTruthy();
  });

  it("draws no bulk control for a person who may run bulk jobs but not use AI", async () => {
    // The server refuses such a person's bulk job ("You can't use AI."), so
    // offering the button would only lead to that refusal.
    renderGate(
      { ...CONFIGURED, permissions: { use: false, bulk: true, manage: false } },
      <AIGate permission="bulk">
        <button type="button">Run on all</button>
      </AIGate>
    );
    await screen.findByText("status arrived");
    expect(screen.queryByRole("button", { name: "Run on all" })).toBeNull();
  });

  it("asks about the content a control acts on, and draws it only where the task is available there", async () => {
    answer.byTarget.set("posts", {
      ...CONFIGURED,
      tasks: [
        {
          owner: "@nextlyhq/ai",
          name: "alt-text",
          role: "vision",
          available: false,
          reason: "missing-permission",
          permission: "update-posts",
        },
      ],
    });
    try {
      renderGate(
        CONFIGURED,
        <>
          <AIGate
            task={{ owner: "@nextlyhq/ai", name: "alt-text" }}
            target={{ collection: "posts", id: "p1" }}
          >
            <button type="button">On this post</button>
          </AIGate>
          <AIGate task={{ owner: "@nextlyhq/ai", name: "alt-text" }}>
            <button type="button">Anywhere</button>
          </AIGate>
        </>
      );
      expect(
        await screen.findByRole("button", { name: "Anywhere" })
      ).toBeTruthy();
      expect(answer.asked).toContainEqual({ collection: "posts", id: "p1" });
      expect(screen.queryByRole("button", { name: "On this post" })).toBeNull();
    } finally {
      answer.byTarget.clear();
    }
  });
});
