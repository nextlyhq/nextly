/**
 * A plugin's logo may fail to load. What must not happen is one plugin's
 * broken logo suppressing the next plugin's working one: the admin router
 * renders the same detail-page component type for every `/admin/plugins/[slug]`
 * without a key, so component state survives navigation between plugins.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PluginIcon } from "@admin/components/shared/plugin-icon";
import type { PluginMetadata } from "@admin/types/branding";

const withAsset = (src: string, icon?: string) =>
  ({ appearance: { iconAsset: src, ...(icon ? { icon } : {}) } }) as Pick<
    PluginMetadata,
    "appearance"
  >;

describe("PluginIcon", () => {
  it("renders a declared asset", () => {
    render(<PluginIcon plugin={withAsset("/a.svg")} fallback="Package" />);
    expect(screen.getByRole("presentation", { hidden: true })).toBeTruthy();
  });

  it("falls back to the declared glyph when the asset fails", () => {
    const { container } = render(
      <PluginIcon
        plugin={withAsset("/broken.svg", "Puzzle")}
        fallback="Package"
      />
    );

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);

    // The image is gone and something replaced it, rather than a broken glyph
    // being left in place.
    expect(container.querySelector("img")).toBeNull();
    expect(container).not.toBeEmptyDOMElement();
  });

  /**
   * The regression this keys on. With failure tracked as a boolean, the second
   * render below would skip a perfectly good asset because the first one broke.
   */
  it("retries a different asset after an earlier one failed", () => {
    const { container, rerender } = render(
      <PluginIcon plugin={withAsset("/broken.svg")} fallback="Package" />
    );

    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();

    // Same component instance, different plugin — exactly what client-side
    // navigation between two plugin detail pages produces.
    rerender(<PluginIcon plugin={withAsset("/good.svg")} fallback="Package" />);

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "/good.svg");
  });

  it("does not retry the same asset that just failed", () => {
    const { container, rerender } = render(
      <PluginIcon plugin={withAsset("/broken.svg")} fallback="Package" />
    );

    fireEvent.error(container.querySelector("img")!);
    rerender(
      <PluginIcon plugin={withAsset("/broken.svg")} fallback="Package" />
    );

    expect(container.querySelector("img")).toBeNull();
  });
});
