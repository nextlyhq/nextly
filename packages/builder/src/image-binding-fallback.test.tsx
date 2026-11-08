// @vitest-environment jsdom

/**
 * A bound image's Fallback row on its own: an address committed through
 * `onFallback`, anything else held back with the reason, a stored address
 * named in full and pictured, and the place kept for the library action
 * drawn empty.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageBindingFallback } from "./image-binding-fallback";

afterEach(cleanup);

const ADDRESS = "https://cdn.example.test/campaigns/spring-banner.jpg";

describe("a bound image's Fallback", () => {
  it("commits a typed image address through onFallback", () => {
    const onFallback = vi.fn();
    render(
      <ImageBindingFallback
        binding={{ $bind: "cover" }}
        onFallback={onFallback}
        services={undefined}
      />
    );
    const field = screen.getByRole("textbox", { name: "Fallback" });
    fireEvent.change(field, { target: { value: `  ${ADDRESS}  ` } });
    fireEvent.blur(field);
    // Trimmed, as the address a visitor's page draws.
    expect(onFallback.mock.calls).toEqual([[ADDRESS]]);
  });

  it("holds back what is not an image address, and says why", () => {
    // The control for the test above: the same commit, with a value the page
    // would never draw a fallback from, writes nothing.
    const onFallback = vi.fn();
    render(
      <ImageBindingFallback
        binding={{ $bind: "cover" }}
        onFallback={onFallback}
        services={undefined}
      />
    );
    const field = screen.getByRole("textbox", { name: "Fallback" });
    fireEvent.change(field, { target: { value: "spring-banner.jpg" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onFallback).not.toHaveBeenCalled();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toMatch(
      /^Enter an image address/
    );
  });

  it("clears the fallback when the field is emptied", () => {
    const onFallback = vi.fn();
    render(
      <ImageBindingFallback
        binding={{ $bind: "cover", fallback: ADDRESS }}
        onFallback={onFallback}
        services={undefined}
      />
    );
    const field = screen.getByRole("textbox", { name: `Fallback: ${ADDRESS}` });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(onFallback.mock.calls).toEqual([[""]]);
  });

  it("names a stored address in full, on its tooltip too, beside its picture", () => {
    const { container } = render(
      <ImageBindingFallback
        binding={{ $bind: "cover", fallback: ADDRESS }}
        onFallback={vi.fn()}
        services={undefined}
      />
    );
    // The field cuts a long address; its name and tooltip carry all of it.
    const field = screen.getByRole("textbox", {
      name: `Fallback: ${ADDRESS}`,
    });
    expect(field.getAttribute("title")).toBe(`Fallback: ${ADDRESS}`);
    expect((field as HTMLInputElement).value).toBe(ADDRESS);
    const picture = container.querySelector("img");
    expect(picture?.getAttribute("src")).toBe(ADDRESS);
    // Decorative: the address beside it already names it.
    expect(picture?.getAttribute("alt")).toBe("");
  });

  it("draws no picture for a fallback that is not an image address", () => {
    // The control for the picture above: a stored value the page can't draw
    // from (a media id, as one may arrive through the API) has none.
    const { container } = render(
      <ImageBindingFallback
        binding={{ $bind: "cover", fallback: "media-1" }}
        onFallback={vi.fn()}
        services={undefined}
      />
    );
    expect(container.querySelector("img")).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Fallback: media-1" })
    ).toBeTruthy();
  });

  it("keeps an empty place for the library action", () => {
    const { container } = render(
      <ImageBindingFallback
        binding={{ $bind: "cover" }}
        onFallback={vi.fn()}
        services={undefined}
      />
    );
    const place = container.querySelector("[data-fallback-actions]");
    // There, so an action added to it lands in the row's layout, and empty,
    // so nothing is offered before it is.
    expect(place).not.toBeNull();
    expect(place?.childElementCount).toBe(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
