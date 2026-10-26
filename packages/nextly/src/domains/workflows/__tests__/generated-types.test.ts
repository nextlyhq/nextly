/**
 * The generated types carry each attached workflow's stage and step names:
 * a Stage and a Step union per collection and Single, and a `workflows`
 * entry in `Config`, from the registered workflows. Nothing is emitted when
 * no workflow is attached, and a name a workflow's unions would share with
 * another generated type is refused.
 */
import { afterEach, describe, expect, it } from "vitest";

import { TypeGenerator } from "../../schema/services/type-generator";
import type { DynamicCollectionRecord } from "../../../schemas/dynamic-collections/types";
import type { DynamicSingleRecord } from "../../../schemas/dynamic-singles/types";
import { reviewWorkflow } from "../preset";
import { buildWorkflowRegistry, publishWorkflows } from "../registry";

const collection = (slug: string) =>
  ({
    slug,
    labels: { singular: slug, plural: slug },
    fields: [{ name: "title", type: "text" }],
    timestamps: true,
    status: true,
  }) as unknown as DynamicCollectionRecord;

const single = (slug: string) =>
  ({
    slug,
    label: slug,
    fields: [{ name: "title", type: "text" }],
    status: true,
  }) as unknown as DynamicSingleRecord;

/** Attach the review workflow to these collections and Singles. */
async function attach(collections: string[], singles: string[]): Promise<void> {
  const target = (slug: string) => ({
    slug,
    status: true,
    versions: { drafts: true },
    fields: [],
    workflow: reviewWorkflow(),
  });
  publishWorkflows(
    await buildWorkflowRegistry(
      { collections: collections.map(target), singles: singles.map(target) },
      null
    )
  );
}

function generate(collections: string[], singles: string[]): string {
  return new TypeGenerator({ generateConfig: true }).generateTypesFile(
    collections.map(collection),
    singles.map(single)
  ).code;
}

afterEach(() => {
  publishWorkflows(new Map());
});

describe("generated types for an attached workflow", () => {
  it("emits a Stage and a Step union for each collection and Single it is attached to", async () => {
    await attach(["posts"], ["home"]);
    const code = generate(["posts", "tags"], ["home"]);
    expect(code).toContain(
      'export type PostsWorkflowStage = "drafting" | "inReview" | "approved";'
    );
    expect(code).toContain(
      'export type PostsWorkflowStep = "submit" | "approve" | "requestChanges";'
    );
    expect(code).toContain(
      'export type HomeWorkflowStage = "drafting" | "inReview" | "approved";'
    );
    // A collection with no workflow gets no unions.
    expect(code).not.toContain("TagsWorkflow");
  });

  it("maps each attachment in Config, by collection and Single", async () => {
    await attach(["posts"], ["home"]);
    const code = generate(["posts", "tags"], ["home"]);
    expect(code).toContain(
      [
        "  workflows: {",
        "    collections: {",
        '      "posts": { stage: PostsWorkflowStage; step: PostsWorkflowStep };',
        "    };",
        "    singles: {",
        '      "home": { stage: HomeWorkflowStage; step: HomeWorkflowStep };',
        "    };",
        "  };",
      ].join("\n")
    );
  });

  it("emits nothing for workflows when none is attached", () => {
    const code = generate(["posts"], ["home"]);
    expect(code).not.toContain("Workflow");
    expect(code).not.toContain("workflows:");
  });

  it("refuses a collection whose name is the one a workflow's union takes", async () => {
    await attach(["posts"], []);
    expect(() => generate(["posts", "posts-workflow-stage"], [])).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "GENERATED_TYPE_NAME_COLLISION",
              message: expect.stringContaining("PostsWorkflowStage"),
            }),
          ],
        },
      })
    );
  });
});
