/**
 * A field of a past version the reader may not read.
 *
 * The version read names what it held back, path by path, and a list row is
 * named by its own index (`items.1.secret`). The field is still drawn, so the
 * reader is told a value exists and is held back rather than shown a version
 * that silently lacks it — and one row losing a field never hides the same
 * field in the row beside it.
 *
 * Every assertion pairs the hidden field with a readable one on the same
 * render: a query that resolves nothing and a query for an element that was
 * never rendered return the same thing.
 */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";
import { WithheldFieldsProvider } from "@admin/components/features/versions/withheld-fields-context";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [] }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));

const HIDDEN = "Hidden: you don't have access to this field.";

function Form({ children }: { children: ReactNode }) {
  const form = useForm();
  return <FormProvider {...form}>{children}</FormProvider>;
}

/** A field, drawn inside a version that withheld `withheld`. */
function renderVersion(
  withheld: string[],
  fields: { name: string; label: string; basePath?: string }[]
) {
  return render(
    <WithheldFieldsProvider paths={withheld}>
      <Form>
        {fields.map(({ name, label, basePath }) => (
          <FieldRenderer
            key={basePath ? `${basePath}.${name}` : name}
            field={{ name, type: "text", label } as never}
            {...(basePath ? ({ basePath } as never) : {})}
          />
        ))}
      </Form>
    </WithheldFieldsProvider>
  );
}

describe("a withheld field of a version", () => {
  it("is named and says so, while a readable field beside it is drawn", () => {
    renderVersion(
      ["secret"],
      [
        { name: "secret", label: "Secret" },
        { name: "title", label: "Title" },
      ]
    );

    // Named, so the reader knows the field exists.
    expect(screen.getByText(HIDDEN)).toBeInTheDocument();
    // It keeps its name, as a group: there is no control for a label to point
    // at once the value is held back.
    expect(screen.getByRole("group", { name: "Secret" })).toBeInTheDocument();
    // And no control: there is no value to show, and none to edit.
    expect(screen.queryByRole("textbox", { name: "Secret" })).toBeNull();
    // The contrast: the field that was never held back is drawn as usual.
    expect(screen.getByRole("textbox", { name: "Title" })).toBeInTheDocument();
  });

  it("hides the field in its own row only", () => {
    renderVersion(
      ["items.1.secret"],
      [
        { name: "secret", label: "Secret", basePath: "items.0" },
        { name: "secret", label: "Secret", basePath: "items.1" },
      ]
    );

    // One row lost it; the row beside it keeps its control.
    expect(screen.getAllByText(HIDDEN)).toHaveLength(1);
    expect(screen.getAllByRole("textbox", { name: "Secret" })).toHaveLength(1);
  });

  it("says nothing on a field no row of the version withheld", () => {
    renderVersion(
      ["items.1.secret"],
      [{ name: "secret", label: "Secret", basePath: "items.0" }]
    );

    expect(screen.queryByText(HIDDEN)).toBeNull();
    expect(screen.getByRole("textbox", { name: "Secret" })).toBeInTheDocument();
  });

  it("says so on a withheld component, which otherwise draws its own card", () => {
    // A component skips the wrapper to draw its own header, so drawn as usual
    // a withheld one would read as a component holding nothing.
    const component = (name: string, label: string) =>
      ({
        type: "component",
        name,
        label,
        component: name,
        repeatable: false,
        componentFields: [
          { type: "text", name: "metaTitle", label: `${label} title` },
        ],
      }) as never;
    render(
      <WithheldFieldsProvider paths={["seo"]}>
        <Form>
          <FieldRenderer field={component("seo", "SEO")} />
          <FieldRenderer field={component("hero", "Hero")} />
        </Form>
      </WithheldFieldsProvider>
    );

    expect(screen.getAllByText(HIDDEN)).toHaveLength(1);
    expect(screen.getByRole("group", { name: "SEO" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "SEO title" })).toBeNull();
    // The readable component beside it is drawn whole.
    expect(
      screen.getByRole("textbox", { name: "Hero title" })
    ).toBeInTheDocument();
  });

  it("withholds nothing in the live editor, which has no version on screen", () => {
    render(
      <Form>
        <FieldRenderer
          field={{ name: "secret", type: "text", label: "Secret" } as never}
        />
      </Form>
    );

    expect(screen.queryByText(HIDDEN)).toBeNull();
    expect(screen.getByRole("textbox", { name: "Secret" })).toBeInTheDocument();
  });
});
