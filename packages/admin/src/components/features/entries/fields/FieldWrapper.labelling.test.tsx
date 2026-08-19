/**
 * FieldWrapper — how a field gets an accessible name.
 *
 * `FieldWrapper` renders `{children}` without cloning, so a `<label for>` only
 * resolves when the input independently sets a matching `id`. Text-like inputs
 * do; composite widgets (rich text, relationship, upload) cannot, because there
 * is no single element to put it on. Those are exposed as `role="group"` with
 * `aria-labelledby` instead.
 *
 * Every assertion here carries its control INSIDE the test rather than relying
 * on a neighbouring one: a query that resolves nothing and a query for an
 * element that was never rendered return the same thing, so each negative is
 * paired with a positive on the same render.
 */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EntryLocaleProvider } from "../EntryLocaleContext";

import { FieldWrapper } from "./FieldWrapper";

const locale = {
  rtl: false,
  collectionLocalized: false,
  isNonDefaultLocale: false,
};

/** A control that claims the id FieldWrapper points its label at. */
function renderWith(
  field: { name: string; type: string; label: string },
  opts: { editorIsOpaque?: boolean; controlCarriesId?: boolean } = {}
) {
  const { editorIsOpaque = false, controlCarriesId = true } = opts;
  return render(
    <EntryLocaleProvider value={locale as never}>
      <FieldWrapper field={field as never} editorIsOpaque={editorIsOpaque}>
        <input
          data-testid="control"
          {...(controlCarriesId ? { id: field.name } : {})}
        />
      </FieldWrapper>
    </EntryLocaleProvider>
  );
}

/** The wrapper element FieldWrapper puts `data-field-type` on. */
function wrapper(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>("[data-field-type]");
  if (!el)
    throw new Error("FieldWrapper rendered no [data-field-type] element");
  return el;
}

describe("FieldWrapper labelling — atomic fields", () => {
  it("points its label at the control, and that control exists", () => {
    const { container } = renderWith({
      name: "title",
      type: "text",
      label: "Title",
    });

    const label = container.querySelector<HTMLLabelElement>("label[for]");
    expect(label, "a text field renders a <label for>").not.toBeNull();

    // The control is the positive half: it proves the query below can resolve
    // at all, so a null result means a broken association rather than a
    // missing render.
    const control = screen.getByTestId("control");
    expect(control.id).toBe("title");
    expect(label?.htmlFor).toBe(control.id);
    expect(container.ownerDocument.getElementById(label!.htmlFor)).toBe(
      control
    );
  });

  it("is NOT exposed as a group", () => {
    const { container } = renderWith({
      name: "title",
      type: "text",
      label: "Title",
    });
    // Paired with the positive above: the wrapper exists, it simply is not a
    // group — so this is not passing because nothing rendered.
    expect(wrapper(container).getAttribute("role")).toBeNull();
  });
});

describe("FieldWrapper labelling — composite fields are named groups", () => {
  // These are the types measured as having a label pointing at nothing before
  // the group treatment existed.
  it.each([
    ["richText", "content", "Content"],
    ["relationship", "categories", "Categories"],
    ["upload", "featuredImage", "Featured Image"],
    // Measured on the page-builder `pages` collection: the code editor builds
    // its focusable surface at runtime, so the label had nothing to land on.
    ["code", "customCss", "Custom Css"],
  ])("names a %s field through role=group", (type, name, label) => {
    const { container } = renderWith({ name, type, label });
    const el = wrapper(container);

    expect(el.getAttribute("role")).toBe("group");

    const labelledBy = el.getAttribute("aria-labelledby");
    expect(labelledBy, "the group declares what names it").toBeTruthy();

    // The reference must RESOLVE, and to the right text. Asserting only that
    // the attribute is present would pass against an id nothing carries, which
    // is the exact defect this treatment replaced.
    const namer = container.ownerDocument.getElementById(labelledBy!);
    expect(namer, `#${labelledBy} exists`).not.toBeNull();
    expect(namer).toHaveTextContent(label);
  });

  it("does not also emit a dangling label[for]", () => {
    const { container } = renderWith({
      name: "content",
      type: "richText",
      label: "Content",
    });

    // Positive control on the same render: the group naming IS present, so a
    // null label below means "no label was emitted", not "nothing rendered".
    expect(wrapper(container).getAttribute("role")).toBe("group");
    expect(container.querySelector("label[for]")).toBeNull();
  });
});

describe("FieldWrapper labelling — a plugin-supplied editor is opaque", () => {
  it("names a plugin-rendered field as a group even when its type is atomic", () => {
    // `json` is not in the composite list. A per-field `admin.component`
    // override replaces the component while leaving the type untouched, so
    // classifying by type name cannot see it — which is why the renderer states
    // the fact instead. Measured: the page builder renders over a `json` field.
    const { container } = renderWith(
      { name: "content", type: "json", label: "Page Builder" },
      { editorIsOpaque: true }
    );

    const el = wrapper(container);
    expect(el.getAttribute("role")).toBe("group");
    const namer = container.ownerDocument.getElementById(
      el.getAttribute("aria-labelledby")!
    );
    expect(namer).not.toBeNull();
    expect(namer).toHaveTextContent("Page Builder");
  });

  it("leaves the same field as a labelled control when it is NOT opaque", () => {
    // The discriminating half: same type, same name, only `editorIsOpaque`
    // differs. Without this pair the test above would pass for a component
    // that made every field a group.
    const { container } = renderWith({
      name: "content",
      type: "json",
      label: "Page Builder",
    });

    expect(wrapper(container).getAttribute("role")).toBeNull();
    const label = container.querySelector<HTMLLabelElement>("label[for]");
    expect(label).not.toBeNull();
    expect(container.ownerDocument.getElementById(label!.htmlFor)).toBe(
      screen.getByTestId("control")
    );
  });
});

describe("FieldWrapper labelling — the group carries its own description", () => {
  it("points aria-describedby at a description that renders", () => {
    const { container } = render(
      <EntryLocaleProvider value={locale as never}>
        <FieldWrapper
          field={
            {
              name: "content",
              type: "richText",
              label: "Content",
              admin: { description: "The body of the post." },
            } as never
          }
        >
          <input data-testid="control" />
        </FieldWrapper>
      </EntryLocaleProvider>
    );

    const el = wrapper(container);
    const describedBy = el.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();

    const described = container.ownerDocument.getElementById(describedBy!);
    expect(described, `#${describedBy} exists`).not.toBeNull();
    expect(within(described!).getByText("The body of the post.")).toBeTruthy();
  });

  it("omits aria-describedby entirely when there is nothing to describe", () => {
    const { container } = renderWith({
      name: "content",
      type: "richText",
      label: "Content",
    });
    const el = wrapper(container);
    // Control: the group itself IS present, so the null below is about the
    // description rather than about the render.
    expect(el.getAttribute("role")).toBe("group");
    expect(el.getAttribute("aria-describedby")).toBeNull();
  });
});
