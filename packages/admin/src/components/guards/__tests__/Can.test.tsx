import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Can } from "../Can";

const mockUseCan = vi.fn();
vi.mock("../../../hooks/useCan", () => ({
  useCan: (p: string) => mockUseCan(p),
}));

describe("Can", () => {
  it("renders children when the user can", () => {
    mockUseCan.mockReturnValue(true);
    render(
      <Can permission="manage-seo">
        <span>secret</span>
      </Can>
    );
    expect(screen.getByText("secret")).toBeInTheDocument();
  });

  it("renders the fallback when the user cannot", () => {
    mockUseCan.mockReturnValue(false);
    render(
      <Can permission="manage-seo" fallback={<span>nope</span>}>
        <span>secret</span>
      </Can>
    );
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
    expect(screen.getByText("nope")).toBeInTheDocument();
  });

  it("renders nothing when denied and no fallback is given", () => {
    mockUseCan.mockReturnValue(false);
    const { container } = render(
      <Can permission="manage-seo">
        <span>secret</span>
      </Can>
    );
    expect(container).toBeEmptyDOMElement();
  });
});
