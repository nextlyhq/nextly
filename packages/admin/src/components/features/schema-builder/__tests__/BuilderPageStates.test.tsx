// The three screens a builder page shows instead of the builder. They replaced
// per-page copies, so what is locked here is that each still says what its page
// said: a named heading for the missing-slug case, skeletons rather than an
// empty frame while loading, and the shared page fallback on failure.
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import {
  BuilderErrorScreen,
  BuilderLoadingScreen,
  BuilderNotFoundScreen,
} from "../BuilderPageStates";

describe("BuilderNotFoundScreen", () => {
  it("renders the kind's own heading and body copy", () => {
    render(
      <BuilderNotFoundScreen
        title="Collection Not Found"
        description="No collection slug was provided."
      />
    );
    expect(
      screen.getByRole("heading", { name: "Collection Not Found" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("No collection slug was provided.")
    ).toBeInTheDocument();
  });

  it("is reusable for another builder kind without changing the component", () => {
    render(
      <BuilderNotFoundScreen
        title="Field Group Not Found"
        description="No field group slug was provided."
      />
    );
    expect(
      screen.getByRole("heading", { name: "Field Group Not Found" })
    ).toBeInTheDocument();
  });
});

describe("BuilderLoadingScreen", () => {
  // The header block stands in for the toolbar and the body block for the
  // field rows, so the page does not jump when the entity arrives. Skeletons
  // carry no text, so the count is the only thing to assert on.
  it("renders a header pair over three field rows", () => {
    const { container } = render(<BuilderLoadingScreen />);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
      5
    );
  });
});

describe("BuilderErrorScreen", () => {
  it("renders the shared page error fallback", () => {
    render(<BuilderErrorScreen />);
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });
});
