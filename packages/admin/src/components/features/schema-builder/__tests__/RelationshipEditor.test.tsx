// Why: PR E3 added the Appearance segmented control to the Admin
// Options section. Lock the wire-up.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { RelationshipEditor } from "../RelationshipEditor";

function withQuery(node: React.ReactNode) {
  // Why: RelationshipEditor uses useCollections / useSingles via
  // TanStack Query. Wrap in a QueryClientProvider so the hook can
  // mount without throwing.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe("RelationshipEditor -- Appearance toggle (PR E3)", () => {
  it("renders Select / Drawer buttons and reports onAppearanceChange", async () => {
    const user = userEvent.setup();
    const onAppearanceChange = vi.fn();
    render(
      withQuery(
        <RelationshipEditor
          relationTo="posts"
          onRelationToChange={vi.fn()}
          onHasManyChange={vi.fn()}
          appearance="select"
          onAppearanceChange={onAppearanceChange}
        />
      )
    );
    const drawerBtn = await screen.findByRole("button", { name: /^drawer$/i });
    await user.click(drawerBtn);
    expect(onAppearanceChange).toHaveBeenCalledWith("drawer");
  });

  it("does not render the appearance section when onAppearanceChange is omitted", () => {
    render(
      withQuery(
        <RelationshipEditor
          relationTo="posts"
          onRelationToChange={vi.fn()}
          onHasManyChange={vi.fn()}
        />
      )
    );
    expect(screen.queryByRole("button", { name: /^drawer$/i })).toBeNull();
  });
});
