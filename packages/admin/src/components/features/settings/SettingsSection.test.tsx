import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { SettingsSection } from "./SettingsSection";

describe("SettingsSection", () => {
  it("renders the uppercase label", () => {
    render(
      <SettingsSection label="Locale & Formatting">
        <div>row content</div>
      </SettingsSection>
    );
    expect(screen.getByText("Locale & Formatting")).toBeInTheDocument();
  });

  it("renders children inside the card body", () => {
    render(
      <SettingsSection label="Whatever">
        <div data-testid="row-1">a</div>
        <div data-testid="row-2">b</div>
      </SettingsSection>
    );
    expect(screen.getByTestId("row-1")).toBeInTheDocument();
    expect(screen.getByTestId("row-2")).toBeInTheDocument();
  });

  it("uses the shared Card's container-tier token classes", () => {
    // The section now composes @nextlyhq/ui's Card rather than hand-rolling
    // its own border, so it carries the CONTAINER radius/border tier
    // (`rounded-lg`/`border-border`) instead of the CONTROL tier
    // (`rounded-md`/`border-input`) the old hand-rolled markup used.
    const { container } = render(
      <SettingsSection label="X">
        <div />
      </SettingsSection>
    );
    expect(container.querySelector(".border-border")).not.toBeNull();
    expect(container.querySelector(".border-input")).toBeNull();
  });
});
