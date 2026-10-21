/**
 * One workflow attached to a collection and a Single, registered at boot on
 * every dialect, and an attachment to a collection that cannot keep drafts
 * refused at boot, saying why.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { workflowDefinitionHash } from "../hash";
import { reviewWorkflow } from "../preset";
import { registeredWorkflows, workflowAttachedTo } from "../registry";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe.each(getConfiguredTestDialects())(
  "attaching a workflow (%s)",
  dialect => {
    it("registers one workflow attached to a collection and a Single, with its hash", async () => {
      const review = reviewWorkflow();
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "posts",
            status: true,
            versions: { drafts: true },
            workflow: review,
            fields: [text({ name: "title" })],
          }),
          // Beside it, a collection with no workflow keeps none.
          defineCollection({
            slug: "tags",
            fields: [text({ name: "title" })],
          }),
        ],
        singles: [
          defineSingle({
            slug: "home",
            status: true,
            versions: { drafts: true },
            workflow: review,
            fields: [text({ name: "headline" })],
          }),
        ],
      });

      expect(registeredWorkflows()).toEqual([
        expect.objectContaining({
          workflow: review,
          definitionHash: workflowDefinitionHash(review),
          collections: ["posts"],
          singles: ["home"],
        }),
      ]);
      expect(workflowAttachedTo("collection", "posts")?.workflow.slug).toBe(
        "review"
      );
      expect(workflowAttachedTo("single", "home")?.workflow.slug).toBe(
        "review"
      );
      expect(workflowAttachedTo("collection", "tags")).toBeUndefined();
    });

    it("refuses to boot with a workflow on a collection that does not keep drafts", async () => {
      const boot = createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "notes",
            status: true,
            workflow: reviewWorkflow(),
            fields: [text({ name: "title" })],
          }),
        ],
      });
      await expect(boot).rejects.toMatchObject({
        publicData: {
          errors: [
            {
              path: "collections.notes.workflow",
              message:
                "`review` cannot be attached to `notes`: it does not keep drafts: set `versions: { drafts: true }`.",
            },
          ],
        },
      });
    });
  }
);
