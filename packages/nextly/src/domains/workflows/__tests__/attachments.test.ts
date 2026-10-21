/**
 * Attaching a workflow: one workflow serves any number of collections and
 * Singles, an attachment to one that cannot keep drafts is refused saying
 * why, and the registry carries each workflow's hash, configuration path and
 * attachments.
 */
import { afterEach, describe, expect, it } from "vitest";

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

  it("refuses a collection with no Draft/Published lifecycle, saying why", () => {
    expect(
      refusalOf(() =>
        workflowAttachmentsOf({
          collections: [target("posts", reviewWorkflow(), { status: false })],
        })
      )
    ).toEqual([
      "collections.posts.workflow: `review` cannot be attached to `posts`: it has no Draft/Published lifecycle: set `status: true`.",
    ]);
  });

  it("refuses a Single that does not keep drafts, saying why", () => {
    expect(
      refusalOf(() =>
        workflowAttachmentsOf({
          singles: [target("home", reviewWorkflow(), { versions: false })],
        })
      )
    ).toEqual([
      "singles.home.workflow: `review` cannot be attached to `home`: it does not keep drafts: set `versions: { drafts: true }`.",
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
          { judgeComponents: false }
        )
      )
    ).toEqual([
      "collections.accounts.workflow: `review` cannot be attached to `accounts`: it has a password field, so it cannot keep a draft beside the live version.",
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
