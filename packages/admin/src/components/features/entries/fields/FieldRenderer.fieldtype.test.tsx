/**
 * C7 / D16 — plugin-registered custom field types render in the admin.
 *
 * A field whose `type` is not built-in renders the editor component the plugin
 * declared via `contributes.fieldTypes` (delivered through /admin-meta →
 * branding), instead of the "Unknown field type" fallback.
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
  useBranding: () => ({
    plugins: [
      {
        name: "@acme/p",
        collections: [],
        fieldTypes: [{ type: "rating", component: "@acme/p/admin#Rating" }],
      },
    ],
  }),
}));

afterEach(() => {
  clearRegistry();
  vi.restoreAllMocks();
});

function Form({ children }: { children: ReactNode }) {
  const form = useForm();
  return <FormProvider {...form}>{children}</FormProvider>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const field = (type: string): any => ({ name: "score", type });

describe("FieldRenderer custom field types (C7/D16)", () => {
  it("renders the plugin's editor component for a registered custom type", () => {
    registerComponent("@acme/p/admin#Rating", () => <div>rating editor</div>);
    render(
      <Form>
        <FieldRenderer field={field("rating")} />
      </Form>
    );
    expect(screen.getByText("rating editor")).toBeInTheDocument();
  });

  it("falls back to the unknown-type message for an unregistered type", () => {
    render(
      <Form>
        <FieldRenderer field={field("totally-unknown")} />
      </Form>
    );
    expect(screen.getByText(/unknown field type/i)).toBeInTheDocument();
  });
});
