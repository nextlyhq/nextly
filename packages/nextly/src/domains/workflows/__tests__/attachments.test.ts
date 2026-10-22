/**
 * Attaching a workflow: one workflow serves any number of collections and
 * Singles, an attachment to one that cannot keep drafts is refused saying
 * why, and the registry carries each workflow's hash, configuration path and
 * attachments.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// The component registry, for the components a configuration does not define.
const { getComponentBySlug } = vi.hoisted(() => ({
  getComponentBySlug: vi.fn(),
}));

vi.mock("../../../di", () => ({
  getService: vi.fn((name: string) =>
    name === "fieldGroupRegistryService" ? { getComponentBySlug } : {}
  ),
}));

import type { FieldConfig } from "../../../collections/fields/types";
import { workflowAttachmentsOf, type WorkflowTarget } from "../attachments";
import { defineWorkflow } from "../define-workflow";
import { workflowDefinitionHash } from "../hash";
import { reviewWorkflow } from "../preset";
import {
  buildWorkflowRegistry,
  publishedWorkflows,
  publishWorkflows,
  registeredWorkflows,
  workflowAttachedTo,
} from "../registry";
import type { Workflow } from "../types";

const TITLE = { name: "title", type: "text" } as FieldConfig;

/** A collection or Single that keeps drafts, with `workflow` attached. */
function target(
  slug: string,
  workflow?: Workflow,
  extra: Partial<WorkflowTarget> = {}
): WorkflowTarget {
  return {
    slug,
    status: true,
    versions: { drafts: true },
    fields: [TITLE],
    ...(workflow === undefined ? {} : { workflow }),
    ...extra,
  };
}

/** The problems a configuration is refused with, as `path: message` lines. */
function refusalOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    const data = (
      error as { publicData?: { errors?: { path: string; message: string }[] } }
    ).publicData;
    return (data?.errors ?? []).map(e => `${e.path}: ${e.message}`);
  }
  return [];
}

async function asyncRefusalOf(run: () => Promise<unknown>): Promise<string[]> {
  try {
    await run();
  } catch (error) {
    const data = (
      error as { publicData?: { errors?: { path: string; message: string }[] } }
    ).publicData;
    return (data?.errors ?? []).map(e => `${e.path}: ${e.message}`);
  }
  return [];
}

afterEach(() => {
  publishWorkflows(new Map());
  getComponentBySlug.mockReset();
});

describe("workflowAttachmentsOf", () => {
  it("attaches one workflow to a collection and a Single, once each", () => {
    const review = reviewWorkflow();
    const attached = workflowAttachmentsOf({
      collections: [
        target("posts", review),
        target("pages", review),
        target("tags"),
      ],
      singles: [target("home", review)],
    });
    expect(attached).toHaveLength(1);
    expect(attached[0]).toMatchObject({
      collections: ["posts", "pages"],
      singles: ["home"],
    });
    expect(attached[0]?.workflow).toBe(review);
  });

  it("leaves whether a target can keep drafts to the registry, which asks the draft split", async () => {
    // One place decides it: the configuration's own check holds no copy of
    // the rule, and the registry refuses the same attachment.
    const config = {
      collections: [target("posts", reviewWorkflow(), { status: false })],
    };
    expect(workflowAttachmentsOf(config)).toHaveLength(1);
    expect(
      await asyncRefusalOf(() =>
        buildWorkflowRegistry(config, null, { readRegistry: false })
      )
    ).toEqual([
      "collections.posts.workflow: `review` cannot be attached to `posts`: it has no Draft/Published lifecycle: set `status: true`.",
    ]);
  });

  it("refuses an object that did not come from defineWorkflow", () => {
    const handBuilt = {
      ...reviewWorkflow(),
      kind: "something-else",
    } as unknown as Workflow;
    expect(
      refusalOf(() =>
        workflowAttachmentsOf({ collections: [target("posts", handBuilt)] })
      )
    ).toEqual([
      "collections.posts.workflow: Pass a workflow from `defineWorkflow` or `reviewWorkflow`.",
    ]);
  });

  it("checks a hand-built workflow as fully as a declared one, whatever its marker says", () => {
    const review = reviewWorkflow();
    const forged = {
      ...review,
      steps: review.steps.map(step =>
        step.name === "approve" ? { ...step, to: "nowhere" } : step
      ),
    } as unknown as Workflow;
    expect(
      refusalOf(() =>
        workflowAttachmentsOf({ collections: [target("posts", forged)] })
      )
    ).toContain(
      "collections.posts.workflow.steps[1].to: `nowhere` is not a stage. Known stages: drafting, inReview, approved."
    );

    // Sound as a definition, but not what `defineWorkflow` answers for it.
    const misresolved = {
      ...review,
      firstStage: "approved",
    } as unknown as Workflow;
    expect(
      refusalOf(() =>
        workflowAttachmentsOf({ collections: [target("posts", misresolved)] })
      )
    ).toEqual([
      "collections.posts.workflow: It is not the workflow `defineWorkflow` answers for its own definition: pass the value `defineWorkflow` or `reviewWorkflow` returned.",
    ]);
  });

  it("refuses two different definitions under one slug", () => {
    const other = defineWorkflow({
      slug: "review",
      label: "Another review",
      stages: [
        { name: "draft", label: "Draft" },
        { name: "live", label: "Live", allowsPublish: true },
      ],
      steps: [
        { name: "ok", label: "OK", kind: "approve", from: "draft", to: "live" },
      ],
    });
    expect(
      refusalOf(() =>
        workflowAttachmentsOf({
          collections: [
            target("posts", reviewWorkflow()),
            target("pages", other),
          ],
        })
      )
    ).toEqual([
      "collections.pages.workflow: Another workflow is already named `review`; give each definition its own slug.",
    ]);
  });
});

describe("the workflow registry", () => {
  it("refuses a Single that does not keep drafts, saying why", async () => {
    expect(
      await asyncRefusalOf(() =>
        buildWorkflowRegistry(
          { singles: [target("home", reviewWorkflow(), { versions: false })] },
          null,
          { readRegistry: false }
        )
      )
    ).toEqual([
      "singles.home.workflow: `review` cannot be attached to `home`: it does not keep drafts: set `status: true` and `versions: { drafts: true }`.",
    ]);
  });

  it("carries each workflow's definition hash, configuration path and attachments", async () => {
    const review = reviewWorkflow();
    const registry = await buildWorkflowRegistry(
      {
        collections: [target("posts", review)],
        singles: [target("home", review)],
      },
      "/app/nextly.config.ts"
    );
    expect([...registry.values()]).toEqual([
      {
        workflow: review,
        definitionHash: workflowDefinitionHash(review),
        configPath: "/app/nextly.config.ts",
        collections: ["posts"],
        singles: ["home"],
      },
    ]);
  });

  it("refuses an attachment the server can see cannot keep drafts: a password field", async () => {
    const secret = { name: "secret", type: "password" } as FieldConfig;
    expect(
      await asyncRefusalOf(() =>
        buildWorkflowRegistry(
          {
            collections: [
              target("accounts", reviewWorkflow(), { fields: [TITLE, secret] }),
            ],
          },
          null,
          { readRegistry: false }
        )
      )
    ).toEqual([
      "collections.accounts.workflow: `review` cannot be attached to `accounts`: it has a password field, so it cannot keep a draft beside the live version.",
    ]);
  });

  it("judges a component the configuration defines, as a build does: a password field inside it is refused", async () => {
    const login = {
      name: "login",
      type: "component",
      component: "credentials",
    } as unknown as FieldConfig;
    const credentials = {
      slug: "credentials",
      fields: [{ name: "secret", type: "password" } as FieldConfig],
    };
    expect(
      await asyncRefusalOf(() =>
        buildWorkflowRegistry(
          {
            collections: [
              target("accounts", reviewWorkflow(), { fields: [TITLE, login] }),
            ],
          },
          null,
          { components: [credentials], readRegistry: false }
        )
      )
    ).toEqual([
      "collections.accounts.workflow: `review` cannot be attached to `accounts`: its component `credentials` has a password field, so it cannot keep a draft beside the live version.",
    ]);
    // The control: the same component without a password field is accepted.
    await expect(
      buildWorkflowRegistry(
        {
          collections: [
            target("accounts", reviewWorkflow(), { fields: [TITLE, login] }),
          ],
        },
        null,
        {
          components: [{ slug: "credentials", fields: [TITLE] }],
          readRegistry: false,
        }
      )
    ).resolves.toHaveProperty("size", 1);
    expect(getComponentBySlug).not.toHaveBeenCalled();
  });

  it("reads a component the configuration does not define from the registry, and the configuration's own over the registry's", async () => {
    const fields = [
      TITLE,
      { name: "login", type: "component", component: "credentials" },
      { name: "hero", type: "component", component: "hero" },
    ] as unknown as FieldConfig[];
    // Every component the registry holds has a password field. `credentials`
    // was made in the admin, so only the registry knows it.
    getComponentBySlug.mockResolvedValue({
      fields: [{ name: "secret", type: "password" }],
    });
    const config = {
      collections: [target("accounts", reviewWorkflow(), { fields })],
    };
    expect(
      await asyncRefusalOf(() =>
        buildWorkflowRegistry(config, null, {
          // `hero` is being changed in this configuration: the registry's older
          // definition, with its password field, is not the one judged.
          components: [{ slug: "hero", fields: [TITLE] }],
        })
      )
    ).toEqual([
      "collections.accounts.workflow: `review` cannot be attached to `accounts`: its component `credentials` has a password field, so it cannot keep a draft beside the live version.",
    ]);
    expect(getComponentBySlug.mock.calls.map(([slug]) => slug)).toEqual([
      "credentials",
    ]);
  });

  it("answers the workflow a collection or Single is attached to once published", async () => {
    const review = reviewWorkflow();
    const previous = publishWorkflows(
      await buildWorkflowRegistry(
        { collections: [target("posts", review)] },
        null
      )
    );
    expect(previous.size).toBe(0);
    expect(workflowAttachedTo("collection", "posts")?.workflow).toBe(review);
    expect(workflowAttachedTo("single", "posts")).toBeUndefined();
    expect(registeredWorkflows()).toHaveLength(1);
    expect(publishedWorkflows().get("review")?.collections).toEqual(["posts"]);
  });
});
