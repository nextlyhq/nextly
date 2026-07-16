/**
 * The guard's whole subtlety is the difference between "the server said the
 * builder is off" and "the server has not answered yet". Both read as falsy on
 * `showBuilder`, and treating the second as the first bounces people out of a
 * legitimate page during the admin-meta load gap — so the in-flight case is
 * asserted as explicitly as the disabled one.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BuilderGuard } from "../BuilderGuard";

const mockUseBranding = vi.fn();
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockUseBranding(),
}));

const mockNavigateTo = vi.fn();
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (path: string) => mockNavigateTo(path),
}));

function renderGuard() {
  return render(
    <BuilderGuard>
      <span>builder</span>
    </BuilderGuard>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BuilderGuard", () => {
  it("sends the visit to the dashboard when the builder is disabled", () => {
    mockUseBranding.mockReturnValue({ showBuilder: false });
    renderGuard();
    expect(mockNavigateTo).toHaveBeenCalledWith("/admin");
  });

  it("renders nothing when the builder is disabled", () => {
    mockUseBranding.mockReturnValue({ showBuilder: false });
    const { container } = renderGuard();
    expect(screen.queryByText("builder")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the builder when it is enabled", () => {
    mockUseBranding.mockReturnValue({ showBuilder: true });
    renderGuard();
    expect(screen.getByText("builder")).toBeInTheDocument();
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("waits rather than redirecting while admin-meta is in flight", () => {
    mockUseBranding.mockReturnValue({ showBuilder: undefined });
    renderGuard();
    expect(mockNavigateTo).not.toHaveBeenCalled();
    expect(screen.getByText("builder")).toBeInTheDocument();
  });

  it("waits rather than redirecting when branding has not resolved at all", () => {
    mockUseBranding.mockReturnValue({});
    renderGuard();
    expect(mockNavigateTo).not.toHaveBeenCalled();
    expect(screen.getByText("builder")).toBeInTheDocument();
  });

  it("redirects once the server resolves the builder to off", () => {
    mockUseBranding.mockReturnValue({ showBuilder: undefined });
    const { rerender } = renderGuard();
    expect(mockNavigateTo).not.toHaveBeenCalled();

    mockUseBranding.mockReturnValue({ showBuilder: false });
    rerender(
      <BuilderGuard>
        <span>builder</span>
      </BuilderGuard>
    );

    expect(mockNavigateTo).toHaveBeenCalledWith("/admin");
    expect(screen.queryByText("builder")).not.toBeInTheDocument();
  });

  it("does not re-issue the redirect on an unrelated re-render", () => {
    mockUseBranding.mockReturnValue({ showBuilder: false });
    const { rerender } = renderGuard();
    rerender(
      <BuilderGuard>
        <span>builder</span>
      </BuilderGuard>
    );
    expect(mockNavigateTo).toHaveBeenCalledTimes(1);
  });
});
