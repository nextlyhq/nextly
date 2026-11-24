/**
 * The Translations page says where it is in the top bar's trail, as every
 * other page does, rather than leaving the bar empty.
 */
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

vi.mock("@admin/components/features/translations/TranslationWorklist", () => ({
  TranslationWorklist: () => null,
}));

import TranslationsPage from "./index";

describe("the Translations page's trail", () => {
  it("names the page under the dashboard", () => {
    render(<TranslationsPage />);

    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(trail).toHaveTextContent("Dashboard");
    expect(trail).toHaveTextContent("Translations");
  });
});
