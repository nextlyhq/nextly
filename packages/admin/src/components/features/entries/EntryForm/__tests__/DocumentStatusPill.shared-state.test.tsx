/**
 * The bar's status pill and the panel's Status section read where the
 * document stands from ONE helper (`savedPillState`), so the two cannot come
 * to disagree. The helper is replaced here by one that answers differently
 * from any sensible rule, and both surfaces must follow it: a surface still
 * deriving the state on its own would keep its own answer and fail.
 */
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

vi.mock("../panels/pill-state", async importOriginal => ({
  ...(await importOriginal<typeof import("../panels/pill-state")>()),
  // Every document reads as Changed, whatever its status.
  savedPillState: () => "changed" as const,
}));

import { DocumentStatusPill } from "../DocumentStatusPill";
import { StatusSection } from "../panels/StatusSection";

describe("the status pill and the Status section", () => {
  it("both read the shared helper's answer, not one of their own", () => {
    render(
      <>
        <DocumentStatusPill status="draft" hasWorkingDraft={false} />
        <StatusSection
          documentStatus={{ status: "draft", hasWorkingDraft: false }}
        />
      </>
    );
    const pill = screen.getByText("Changed");
    expect(pill).toHaveAttribute("data-status", "changed");
    expect(
      screen.getByRole("region", { name: "Status" }).querySelector("p")
    ).toHaveAttribute("data-status", "changed");
  });
});
