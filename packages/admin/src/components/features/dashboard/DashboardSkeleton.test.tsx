import { describe, it, expect } from "vitest";

import { render } from "@admin/__tests__/utils";

import { StatsGridSkeleton, ActivitySkeleton } from "./DashboardSkeleton";

describe("DashboardSkeleton", () => {
  describe("StatsGridSkeleton", () => {
    it("renders 4 skeleton cards", () => {
      const { container } = render(<StatsGridSkeleton />);

      // Should have 4 skeleton cards in the grid
      const skeletons = container.querySelectorAll("[class*='animate-pulse']");
      expect(skeletons.length).toBeGreaterThanOrEqual(4);
    });

    it("has correct grid layout classes", () => {
      const { container } = render(<StatsGridSkeleton />);

      const grid = container.firstChild as HTMLElement;
      expect(grid).toHaveClass("grid");
      expect(grid).toHaveClass("grid-cols-1");
      expect(grid).toHaveClass("sm:grid-cols-2");
      expect(grid).toHaveClass("lg:grid-cols-4");
    });

    it("applies correct spacing", () => {
      const { container } = render(<StatsGridSkeleton />);

      const grid = container.firstChild as HTMLElement;
      expect(grid).toHaveClass("gap-4");
      expect(grid).toHaveClass("sm:gap-6");
    });

    it("renders skeleton elements with pulse animation", () => {
      const { container } = render(<StatsGridSkeleton />);

      const pulseElements = container.querySelectorAll(".animate-pulse");
      expect(pulseElements.length).toBeGreaterThan(0);
    });
  });

  describe("ActivitySkeleton", () => {
    it("renders skeleton for activity feed", () => {
      const { container } = render(<ActivitySkeleton />);

      // Should have skeleton elements
      const skeletons = container.querySelectorAll("[class*='animate-pulse']");
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it("has correct card structure", () => {
      const { container } = render(<ActivitySkeleton />);

      const card = container.firstChild as HTMLElement;
      expect(card).toBeInTheDocument();
    });

    it("renders multiple activity item skeletons", () => {
      const { container } = render(<ActivitySkeleton />);

      // Should have multiple skeleton items (default 5)
      const skeletonItems = container.querySelectorAll(
        "[class*='animate-pulse']"
      );
      expect(skeletonItems.length).toBeGreaterThanOrEqual(5);
    });

    it("renders skeleton elements with pulse animation", () => {
      const { container } = render(<ActivitySkeleton />);

      const pulseElements = container.querySelectorAll(".animate-pulse");
      expect(pulseElements.length).toBeGreaterThan(0);
    });
  });
});
