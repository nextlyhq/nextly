/**
 * The guard shows the builder on one answer only: the server's explicit
 * `true`. `showBuilder` is `undefined` both while the answer is in flight and
 * after the request failed, so each of those is asserted as explicitly as the
 * two answers, and each asserts that the page inside never rendered.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BuilderGuard } from "../BuilderGuard";

const mockUseBranding = vi.fn();
const mockUseBrandingStatus = vi.fn();
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockUseBranding(),
  useBrandingStatus: () => mockUseBrandingStatus(),
}));

const mockNavigateTo = vi.fn();
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (path: string) => mockNavigateTo(path),
}));

const SETTLED = { isPending: false, isUnavailable: false };
const PENDING = { isPending: true, isUnavailable: false };
const FAILED = { isPending: false, isUnavailable: true };

/** Counts its renders, so a page shown for one frame and then replaced still counts. */
const builderRendered = vi.fn();
function Builder() {
  builderRendered();
  return <span>builder</span>;
}

/** A new element each time: React skips a re-render handed the element it already has. */
function guarded() {
  return (
    <BuilderGuard>
      <Builder />
    </BuilderGuard>
  );
}

function renderGuard() {
  return render(guarded());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseBrandingStatus.mockReturnValue(SETTLED);
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
    expect(builderRendered).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the builder when it is enabled", () => {
    mockUseBranding.mockReturnValue({ showBuilder: true });
    renderGuard();
    expect(screen.getByText("builder")).toBeInTheDocument();
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("withholds the builder while the answer is in flight", () => {
    mockUseBranding.mockReturnValue({ showBuilder: undefined });
    mockUseBrandingStatus.mockReturnValue(PENDING);
    const { container } = renderGuard();
    expect(builderRendered).not.toHaveBeenCalled();
    expect(mockNavigateTo).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-slot="builder-guard-pending"]')
    ).toHaveAttribute("aria-busy", "true");
  });

  it("withholds the builder when branding has not resolved at all", () => {
    mockUseBranding.mockReturnValue({});
    mockUseBrandingStatus.mockReturnValue(PENDING);
    renderGuard();
    expect(builderRendered).not.toHaveBeenCalled();
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("redirects once the server resolves the builder to off, never having shown it", () => {
    mockUseBranding.mockReturnValue({ showBuilder: undefined });
    mockUseBrandingStatus.mockReturnValue(PENDING);
    const { rerender } = renderGuard();
    expect(mockNavigateTo).not.toHaveBeenCalled();

    mockUseBranding.mockReturnValue({ showBuilder: false });
    mockUseBrandingStatus.mockReturnValue(SETTLED);
    rerender(guarded());

    expect(mockNavigateTo).toHaveBeenCalledWith("/admin");
    expect(builderRendered).not.toHaveBeenCalled();
  });

  it("shows the builder once the server resolves it to on", () => {
    mockUseBranding.mockReturnValue({ showBuilder: undefined });
    mockUseBrandingStatus.mockReturnValue(PENDING);
    const { rerender } = renderGuard();
    expect(builderRendered).not.toHaveBeenCalled();

    mockUseBranding.mockReturnValue({ showBuilder: true });
    mockUseBrandingStatus.mockReturnValue(SETTLED);
    rerender(guarded());

    expect(screen.getByText("builder")).toBeInTheDocument();
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("says the builder could not be loaded when the request failed", () => {
    mockUseBranding.mockReturnValue({});
    mockUseBrandingStatus.mockReturnValue(FAILED);
    renderGuard();
    expect(builderRendered).not.toHaveBeenCalled();
    expect(mockNavigateTo).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", {
        name: "The schema builder could not be loaded",
      })
    ).toBeInTheDocument();
  });

  it("withholds the builder when the answer arrived without saying", () => {
    mockUseBranding.mockReturnValue({ logoText: "Acme" });
    renderGuard();
    expect(builderRendered).not.toHaveBeenCalled();
    expect(mockNavigateTo).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", {
        name: "The schema builder could not be loaded",
      })
    ).toBeInTheDocument();
  });

  it("does not re-issue the redirect on an unrelated re-render", () => {
    mockUseBranding.mockReturnValue({ showBuilder: false });
    const { rerender } = renderGuard();
    rerender(guarded());
    expect(mockNavigateTo).toHaveBeenCalledTimes(1);
  });
});
