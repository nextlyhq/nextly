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

/**
 * Whether the plugin list has answered. Mutable so one test can put the
 * renderer in the moment BEFORE it arrives, which is the state every
 * plugin-typed field passes through on load.
 */
let pluginsPending = false;

/**
 * Whether the plugin list NEVER answered. Distinct from `pluginsPending`
 * because the two are different facts and only one of them ends: a request in
 * flight resolves, a failed one does not.
 */
let pluginsUnavailable = false;

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
  useBrandingStatus: () => ({
    isPending: pluginsPending,
    isUnavailable: pluginsUnavailable,
    isBrandingUnavailable: false,
  }),
}));

afterEach(() => {
  clearRegistry();
  vi.restoreAllMocks();
  pluginsPending = false;
  pluginsUnavailable = false;
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

  it("does not call a type unknown while the plugin list is still loading", () => {
    // The list lives in the session-gated half of admin-meta, so it is absent
    // for a moment on every load — and a plugin-typed field decides what to
    // render during exactly that moment. Reporting "unknown" there states a
    // conclusion the data does not support, and it is wrong for every
    // correctly-configured plugin field on the page.
    pluginsPending = true;
    render(
      <Form>
        <FieldRenderer field={field("blocks")} />
      </Form>
    );
    expect(screen.queryByText(/unknown field type/i)).not.toBeInTheDocument();
  });

  it("does not call a type unknown when the plugin list never arrived", () => {
    // THE case behind a bug that read as an intermittent fault in the page
    // builder. A failed request leaves `branding` undefined, which is the same
    // value as a project with no plugins — so the field reported "Unknown field
    // type" and blamed a correctly-installed plugin for a fetch that failed.
    // A reload retries and usually succeeds, which is what made it look
    // intermittent.
    pluginsUnavailable = true;
    render(
      <Form>
        <FieldRenderer field={field("blocks")} />
      </Form>
    );
    expect(screen.queryByText(/unknown field type/i)).not.toBeInTheDocument();
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
  });

  it("shows the loading editor while the list is still in flight", () => {
    // The POSITIVE CONTROL for the case below. Without it, asserting that the
    // failed state shows no loading editor would be satisfied by a renderer
    // that never shows one at all — and the selector being wrong looks exactly
    // the same as the behaviour being right.
    pluginsPending = true;
    render(
      <Form>
        <FieldRenderer field={field("blocks")} />
      </Form>
    );
    expect(screen.getByText(/loading editor/i)).toBeInTheDocument();
  });

  it("says the list is unavailable rather than loading forever", () => {
    // A loading state says something is coming. The request is issued with
    // `retry: false`, so after it fails nothing is coming, and folding this
    // state into the loading one would leave the field pretending to load for
    // as long as the server stays unreachable.
    pluginsUnavailable = true;
    render(
      <Form>
        <FieldRenderer field={field("blocks")} />
      </Form>
    );
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/loading editor/i)).not.toBeInTheDocument();
  });

  it("still reports an unknown type once the list has ARRIVED without it", () => {
    // The control for the assertion above: it passes on absence, so without
    // this the same green would follow from a renderer that never reports an
    // unknown type at all.
    pluginsPending = false;
    render(
      <Form>
        <FieldRenderer field={field("blocks")} />
      </Form>
    );
    expect(screen.getByText(/unknown field type/i)).toBeInTheDocument();
  });
});
