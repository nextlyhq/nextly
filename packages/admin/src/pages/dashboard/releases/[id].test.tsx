/**
 * A release's page says where it is in the top bar's trail: under Releases,
 * by the release's own title once it is read.
 */
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

vi.mock("@admin/components/features/releases/ReleaseDetail", () => ({
  ReleaseDetail: () => null,
}));
vi.mock("@admin/hooks/queries/useReleases", () => ({
  useRelease: () => ({ data: { id: "r1", title: "Autumn launch" } }),
}));

import ReleaseDetailPage from "./[id]";

describe("a release page's trail", () => {
  it("leads from the dashboard through Releases to the release", () => {
    render(<ReleaseDetailPage params={{ id: "r1" }} />);

    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(trail).toHaveTextContent("Dashboard");
    expect(screen.getByRole("link", { name: "Releases" })).toHaveAttribute(
      "href",
      "/admin/releases"
    );
    expect(trail).toHaveTextContent("Autumn launch");
  });
});
