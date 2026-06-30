/**
 * C9-C / D24 — per-field admin component override.
 *
 * A field with `admin.component` (a registered component path) renders that
 * component instead of the built-in type dispatch, contained by the plugin
 * error boundary.
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

afterEach(() => {
  clearRegistry();
  vi.restoreAllMocks();
});

function Form({ children }: { children: ReactNode }) {
  const form = useForm();
  return <FormProvider {...form}>{children}</FormProvider>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const field = (admin: Record<string, unknown>): any => ({
  name: "color",
  type: "text",
  admin,
});

describe("FieldRenderer per-field component override (C9-C/D24)", () => {
  it("renders the override component instead of the built-in type input", () => {
    registerComponent("@acme/p/admin#Color", () => (
      <div>custom color editor</div>
    ));
    render(
      <Form>
        <FieldRenderer field={field({ component: "@acme/p/admin#Color" })} />
      </Form>
    );
    expect(screen.getByText("custom color editor")).toBeInTheDocument();
  });

  it("contains a throwing override behind the boundary (D53)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerComponent("@acme/p/admin#Boom", () => {
      throw new Error("boom");
    });
    render(
      <Form>
        <FieldRenderer field={field({ component: "@acme/p/admin#Boom" })} />
      </Form>
    );
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
  });
});
