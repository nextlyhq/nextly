/**
 * The entry form's `icon` field: drawn through the renderer, chosen from the
 * picker, and saved as the icon's id.
 *
 * The icon set is replaced by a two-icon source, because what is under test is
 * the form's wiring: the renderer's dispatch, the value React Hook Form holds
 * and the group the wrapper names. The set's own search is tested beside it in
 * `blocks-react`.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { IconSource, IconSourceIcon } from "@nextlyhq/ui";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [] }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));

const icon = (name: string): IconSourceIcon => ({
  id: `lucide:${name}`,
  name,
  body: '<path d="M4 4h16"/>',
  viewBox: "0 0 24 24",
});

const SOURCE: IconSource = {
  prefix: "lucide",
  label: "Lucide",
  search: async query =>
    ["star", "truck"].filter(name => name.includes(query)).map(icon),
  resolve: async id =>
    ["lucide:star", "lucide:truck"].includes(id)
      ? icon(id.replace("lucide:", ""))
      : null,
};

vi.mock(
  "@admin/components/features/entries/fields/special/lucide-icon-source",
  () => ({ loadLucideIcons: async () => SOURCE })
);

beforeAll(() => {
  // The picker's grid draws only the rows in view, measured through a
  // ResizeObserver and the scroll box's offset size; jsdom has neither, and
  // without them the grid draws no icon to choose.
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: target.getBoundingClientRect(),
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 320,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 360,
  });
});

/** The form, with the field's current value printed beside it. */
function Form({ value }: { value?: string }) {
  const form = useForm({ defaultValues: { badge: value ?? "" } });
  return (
    <FormProvider {...form}>
      <FieldRenderer
        field={{ name: "badge", type: "icon", label: "Badge" } as never}
      />
      <Stored />
    </FormProvider>
  );
}

function Stored() {
  const badge: unknown = useWatch({ name: "badge" });
  return <output data-testid="stored">{JSON.stringify(badge)}</output>;
}

describe("an icon field in the entry form", () => {
  it("renders the picker button, named by the label, in a named group", async () => {
    render(<Form />);
    const button = await screen.findByRole("button", {
      name: "Badge: none chosen",
    });
    // Two buttons, the picker and the clear, so the wrapper names a group.
    expect(screen.getByRole("group", { name: "Badge" })).toContainElement(
      button
    );
  });

  it("saves the chosen icon as its id", async () => {
    render(<Form />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Badge: none chosen" })
    );
    fireEvent.click(await screen.findByRole("option", { name: "Truck" }));
    await waitFor(() =>
      expect(screen.getByTestId("stored").textContent).toBe('"lucide:truck"')
    );
    expect(
      await screen.findByRole("button", { name: "Badge: Truck" })
    ).toBeInTheDocument();
  });

  it("clears to the empty value the text fields hold", async () => {
    render(<Form value="lucide:star" />);
    fireEvent.click(await screen.findByRole("button", { name: "Clear icon" }));
    await waitFor(() =>
      expect(screen.getByTestId("stored").textContent).toBe('""')
    );
  });
});
