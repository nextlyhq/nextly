// Why: PR E1 renamed "Target Collection(s)" to "Link to" and updated
// the polymorphic helper text. PR E3 verifies this still works after
// E2 + the new appearance toggle land. Smoke-style coverage for Q1.
//
// The polymorphic helper text lives inside a Radix Tooltip on the
// FormLabelWithTooltip component; it's only mounted visibly on hover.
// We assert the visible label and the badge rendering instead, since
// those are the user-facing markers of the polymorphic case.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { RelationshipEditor } from "../RelationshipEditor";

function withQuery(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe("RelationshipEditor -- Q1 polymorphic label regression", () => {
  it("uses 'Link to' as the field label (PR E1 rename)", async () => {
    render(
      withQuery(
        <RelationshipEditor
          relationTo={undefined}
          onRelationToChange={vi.fn()}
          onHasManyChange={vi.fn()}
        />
      )
    );
    expect(await screen.findByText(/^Link to$/i)).toBeInTheDocument();
  });

  it("shows the picker call-to-action 'Select collection(s)' when no collection is picked", () => {
    render(
      withQuery(
        <RelationshipEditor
          relationTo={undefined}
          onRelationToChange={vi.fn()}
          onHasManyChange={vi.fn()}
        />
      )
    );
    expect(
      screen.getByRole("button", { name: /select collection\(s\)/i })
    ).toBeInTheDocument();
  });

  it("renders one badge per polymorphic target when multiple collections are selected", () => {
    render(
      withQuery(
        <RelationshipEditor
          relationTo={["posts", "pages"]}
          onRelationToChange={vi.fn()}
          onHasManyChange={vi.fn()}
        />
      )
    );
    // Both target slugs should render as removable badges (the badge
    // renders the slug as fallback when the collection label is not
    // hydrated from React Query in the test environment).
    expect(screen.getByText("posts")).toBeInTheDocument();
    expect(screen.getByText("pages")).toBeInTheDocument();
    // The picker CTA changes to "Add another collection" once at least
    // one target is selected.
    expect(
      screen.getByRole("button", { name: /add another collection/i })
    ).toBeInTheDocument();
  });
});
