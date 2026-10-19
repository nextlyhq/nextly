/**
 * The form's decision about whether to draw a field at all.
 *
 * `admin.hidden` is decided by the renderer, through the same gate a document
 * view asks, so a field the form never draws is one no view's address opens.
 * That holds for a field drawn by its own editor too, which never passes
 * through the wrapper that used to decide it.
 */
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";
import {
  clearRegistry,
  registerComponent,
} from "@admin/lib/plugins/component-registry";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [] }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));

afterEach(() => {
  clearRegistry();
});

function Form({ children }: { children: ReactNode }) {
  const form = useForm();
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe("a hidden field", () => {
  it("is not drawn, and the same field without the gate is", () => {
    const { unmount } = render(
      <Form>
        <FieldRenderer
          field={{ name: "subtitle", type: "text", label: "Subtitle" } as never}
        />
      </Form>
    );
    // The control: the gate is what removes it, not the fixture.
    expect(screen.getByLabelText("Subtitle")).toBeInTheDocument();
    unmount();

    render(
      <Form>
        <FieldRenderer
          field={
            {
              name: "subtitle",
              type: "text",
              label: "Subtitle",
              admin: { hidden: true },
            } as never
          }
        />
      </Form>
    );
    expect(screen.queryByLabelText("Subtitle")).toBeNull();
  });

  it("is not drawn when its own editor would draw it", () => {
    registerComponent("@acme/p/admin#Map", () => <div>map editor</div>);
    render(
      <Form>
        <FieldRenderer
          field={
            {
              name: "where",
              type: "json",
              admin: { hidden: true, component: "@acme/p/admin#Map" },
            } as never
          }
        />
      </Form>
    );
    expect(screen.queryByText("map editor")).toBeNull();
  });
});
