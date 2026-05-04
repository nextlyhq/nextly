import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { SettingsTableToolbar } from "./SettingsTableToolbar";

describe("SettingsTableToolbar", () => {
  it("renders the search slot", () => {
    render(<SettingsTableToolbar search={<input data-testid="s" />} />);
    expect(screen.getByTestId("s")).toBeInTheDocument();
  });

  it("renders filters and columns slots when provided", () => {
    render(
      <SettingsTableToolbar
        search={<div />}
        filters={<button data-testid="f">filter</button>}
        columns={<button data-testid="c">cols</button>}
      />
    );
    expect(screen.getByTestId("f")).toBeInTheDocument();
    expect(screen.getByTestId("c")).toBeInTheDocument();
  });

  it("works without filters/columns", () => {
    const { container } = render(
      <SettingsTableToolbar search={<div data-testid="s" />} />
    );
    expect(screen.getByTestId("s")).toBeInTheDocument();
    expect(container.querySelector("button")).toBeNull();
  });
});
