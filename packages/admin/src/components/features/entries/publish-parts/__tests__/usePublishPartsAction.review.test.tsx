/**
 * Whether "Choose what to publish…" offers publishing without review is the server's answer
 * (`mayPublishWithoutReview` on the review state), never the admin's reading of a permission's
 * name: a person the server says may not is not offered it, whatever their permissions list.
 */
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { PublishPartsChoice } from "@admin/services/publishParts";
import type { PartReview } from "@admin/types/workflows";

import { usePublishPartsAction } from "../usePublishPartsAction";

const api = vi.hoisted(() => ({
  publishParts: vi.fn(),
  findByID: vi.fn(),
  reviewState: vi.fn(),
  can: { all: true },
}));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: {
      ...actual.entryApi,
      publishParts: api.publishParts,
      findByID: api.findByID,
    },
  };
});
vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: api.reviewState,
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => api.can.all }));

const notApproved: PartReview = {
  part: null,
  stage: "inReview",
  stageLabel: "In review",
  publishable: false,
  enteredAt: null,
  enteredBy: null,
  assignee: null,
  dueAt: null,
  approval: null,
  revision: 1,
  version: "v1",
  steps: [],
  waitingFor: null,
  lastMove: null,
};

function answer(mayPublishWithoutReview: boolean) {
  return {
    attached: true,
    review: {
      workflow: { slug: "review", label: "Review" },
      parts: [notApproved],
      mayPublishWithoutReview,
    },
  };
}

function Page(): ReactElement {
  const action = usePublishPartsAction({
    target: { kind: "collection", slug: "posts", id: "post-1" },
    lifecycleEnabled: true,
    languages: [],
    labelOf: code => code,
    currentLocale: undefined,
    defaultLocale: undefined,
    sharedPending: true,
  });
  return (
    <>
      <button
        type="button"
        onClick={() => action.contributed?.binding.onSelect({ values: {} })}
      >
        Open
      </button>
      {action.dialog}
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.publishParts.mockImplementation(
    (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
      Promise.resolve({
        id: "post-1",
        languages: [],
        shared: { changes: choice.shared === true, added: false },
      })
  );
  api.findByID.mockResolvedValue({ id: "post-1", _rev: "1" });
});

describe("publishing without review, as the server allows it", () => {
  it("is not offered where the server says no, whatever the permissions list holds", async () => {
    api.can.all = true;
    api.reviewState.mockResolvedValue(answer(false));
    render(<Page />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("region", { name: "Ready to publish?" });
    expect(
      screen.queryByRole("button", { name: "Publish without review…" })
    ).toBeNull();
  });

  it("is offered where the server says yes", async () => {
    api.can.all = true;
    api.reviewState.mockResolvedValue(answer(true));
    render(<Page />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(
      await screen.findByRole("button", { name: "Publish without review…" })
    ).toBeVisible();
  });
});
