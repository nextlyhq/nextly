/**
 * The permissions a workflow seeds on what it is attached to, and the definitions refused because
 * those permissions could not be stored as their own.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import { entityPermissionSpelling } from "../../auth/services/entity-permission-spelling";
import { workflowAttachmentsOf, type WorkflowTarget } from "../attachments";
import { defineWorkflow } from "../define-workflow";
import {
  isPublishWithoutReview,
  PUBLISH_WITHOUT_REVIEW,
  workflowPermissionActions,
} from "../permissions";
import { reviewWorkflow } from "../preset";
import type { Workflow } from "../types";

const TITLE = { name: "title", type: "text" } as FieldConfig;

function target(slug: string, workflow?: Workflow): WorkflowTarget {
  return {
    slug,
    status: true,
    versions: { drafts: true },
    fields: [TITLE],
    ...(workflow === undefined ? {} : { workflow }),
  };
}

/** A workflow whose approve step asks for `permission`, under `slug`. */
function approvedBy(permission: string, slug = "custom") {
  return () =>
    defineWorkflow({
      slug,
      label: "Custom",
      stages: [
        { name: "drafting", label: "Drafting" },
        { name: "inReview", label: "In review" },
        { name: "approved", label: "Approved", allowsPublish: true },
      ],
      steps: [
        {
          name: "submit",
          label: "Submit",
          kind: "submit",
          from: "drafting",
          to: "inReview",
        },
        {
          name: "approve",
          label: "Approve",
          kind: "approve",
          from: "inReview",
          to: "approved",
          permission,
        },
      ],
      onEdit: { to: "inReview" },
      afterPublish: "drafting",
    });
}

/** The codes a run is refused with. */
function codesOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    const data = (error as { publicData?: { errors?: { code: string }[] } })
      .publicData;
    return (data?.errors ?? []).map(e => e.code);
  }
  return [];
}

describe("workflowPermissionActions", () => {
  it("names each step's own action once, then publish-without-review", () => {
    // The preset's approve and request-changes steps both ask for `approve`.
    expect(workflowPermissionActions(reviewWorkflow())).toEqual([
      "approve",
      PUBLISH_WITHOUT_REVIEW,
    ]);
  });

  it("leaves out a step that asks for a built-in action, already seeded", () => {
    expect(workflowPermissionActions(approvedBy("publish")())).toEqual([
      PUBLISH_WITHOUT_REVIEW,
    ]);
  });
});

describe("isPublishWithoutReview", () => {
  it("knows the permission by its action, whatever its slug", () => {
    expect(
      isPublishWithoutReview({
        action: "publish-without-review",
        slug: "urgent-posts",
      })
    ).toBe(true);
  });

  it("knows it by its slug, whatever its action", () => {
    expect(
      isPublishWithoutReview({
        action: "publish",
        slug: "publish-without-review-posts",
      })
    ).toBe(true);
  });

  it("leaves the permissions beside it", () => {
    expect(
      isPublishWithoutReview({ action: "publish", slug: "publish-posts" })
    ).toBe(false);
    expect(
      isPublishWithoutReview({ action: "approve", slug: "approve-posts" })
    ).toBe(false);
  });
});

describe("the name a seeded permission is stored with", () => {
  it("reads an action of several words as words", () => {
    // Capitalising only the first letter gave `Publish-without-review Blog Posts`.
    expect(
      entityPermissionSpelling(PUBLISH_WITHOUT_REVIEW, "blog-posts")
    ).toEqual({
      slug: "publish-without-review-blog-posts",
      name: "Publish Without Review Blog Posts",
      description: "Permission to publish without review blog posts",
    });
  });
});

describe("a workflow whose permissions could not be its own", () => {
  it("refuses a step asking for publish-without-review", () => {
    expect(codesOf(approvedBy(PUBLISH_WITHOUT_REVIEW))).toContain(
      "workflow_permission_reserved"
    );
  });

  it("refuses a step action too long to store", () => {
    expect(codesOf(approvedBy(`approve-${"x".repeat(50)}`))).toContain(
      "workflow_permission_too_long"
    );
  });

  it("refuses attaching to an entity whose publish-without-review is another entity's publish", () => {
    expect(
      codesOf(() =>
        workflowAttachmentsOf({
          collections: [
            target("posts", reviewWorkflow()),
            target("without-review-posts"),
          ],
        })
      )
    ).toEqual(["workflow_permission_collides"]);
  });

  it("refuses a step action whose seeded slug is another entity's built-in permission, naming both", () => {
    // `read-without-review` on posts and `read` on `without-review-posts` are one slug.
    let message = "";
    try {
      workflowAttachmentsOf({
        collections: [
          target("posts", approvedBy("read-without-review")()),
          target("without-review-posts"),
        ],
      });
    } catch (error) {
      const data = (
        error as { publicData?: { errors?: { message: string }[] } }
      ).publicData;
      message = (data?.errors ?? []).map(e => e.message).join(" ");
    }
    expect(
      codesOf(() =>
        workflowAttachmentsOf({
          collections: [
            target("posts", approvedBy("read-without-review")()),
            target("without-review-posts"),
          ],
        })
      )
    ).toContain("workflow_permission_collides");
    expect(message).toMatch(
      /read-without-review-posts.*`read`.*without-review-posts/s
    );
  });

  it("refuses two workflows whose seeded slugs are one", () => {
    // `sign-off-legal` on `legal` and `sign` on `off-legal` are one slug.
    expect(
      codesOf(() =>
        workflowAttachmentsOf({
          collections: [
            target("legal", approvedBy("sign-off")()),
            target("off-legal", approvedBy("sign", "custom-sign")()),
          ],
        })
      )
    ).toContain("workflow_permission_collides");
  });

  it("refuses a seeded permission slug too long to store", () => {
    expect(
      codesOf(() =>
        workflowAttachmentsOf({
          collections: [target("p".repeat(90), reviewWorkflow())],
        })
      )
    ).toContain("workflow_permission_too_long");
  });

  it("attaches as before when nothing collides", () => {
    expect(
      workflowAttachmentsOf({
        collections: [target("posts", reviewWorkflow()), target("pages")],
      })
    ).toHaveLength(1);
  });
});
