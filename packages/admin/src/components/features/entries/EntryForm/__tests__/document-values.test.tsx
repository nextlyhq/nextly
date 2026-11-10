/**
 * Reading and writing the document's live values from a plugin's component:
 * what is typed, before any save, from the document's own form whatever form
 * the component sits in; a write that waits while the document's content is
 * held; and nothing at all outside a document.
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import {
  useDocumentField,
  useDocumentValues,
  type DocumentField,
} from "../document-values";
import { EntryFormProvider } from "../EntryFormProvider";

/** The document's form, as the editors mount it, with two fields. */
function Document({
  contentHeld = false,
  children,
}: {
  contentHeld?: boolean;
  children: ReactNode;
}) {
  const form = useForm<Record<string, unknown>>({
    defaultValues: { title: "Saved title", body: "", seo: { title: "" } },
  });
  return (
    <EntryFormProvider
      form={form}
      onSubmit={async () => {}}
      contentHeld={contentHeld}
    >
      <input aria-label="Title" {...form.register("title")} />
      <input aria-label="Body" {...form.register("body")} />
      <input aria-label="SEO title" {...form.register("seo.title")} />
      <output aria-label="Dirty">{String(form.formState.isDirty)}</output>
      {children}
    </EntryFormProvider>
  );
}

/** A plugin's component showing the values it reads, as JSON. */
function Preview({ paths }: { paths: readonly string[] }) {
  const values = useDocumentValues(paths);
  return <pre data-testid="preview">{JSON.stringify(values)}</pre>;
}

function preview(): unknown {
  return JSON.parse(screen.getByTestId("preview").textContent ?? "");
}

describe("useDocumentValues", () => {
  it("reads what is typed into a field, before any save", async () => {
    render(
      <Document>
        <Preview paths={["title", "seo.title"]} />
      </Document>
    );
    expect(preview()).toEqual({ title: "Saved title", "seo.title": "" });

    await userEvent.clear(screen.getByLabelText("Title"));
    await userEvent.type(screen.getByLabelText("Title"), "Typed");
    await userEvent.type(screen.getByLabelText("SEO title"), "Search");
    expect(preview()).toEqual({ title: "Typed", "seo.title": "Search" });
  });

  it("is null outside a document", () => {
    render(<Preview paths={["title"]} />);
    expect(preview()).toBeNull();
  });

  it("reads the document's values from inside a form of the plugin's own", async () => {
    // A plugin's component with its own react-hook-form: what it reads is
    // still the document's, not its own form's.
    function OwnForm({ children }: { children: ReactNode }) {
      const own = useForm({ defaultValues: { title: "The plugin's own" } });
      return <FormProvider {...own}>{children}</FormProvider>;
    }
    render(
      <Document>
        <OwnForm>
          <Preview paths={["title"]} />
        </OwnForm>
      </Document>
    );
    expect(preview()).toEqual({ title: "Saved title" });

    await userEvent.type(screen.getByLabelText("Title"), "!");
    expect(preview()).toEqual({ title: "Saved title!" });
  });

  it("draws again when a field inside a group it reads changes", async () => {
    // The form keeps a group's object and changes it in place, so the group
    // read must not be judged unchanged by its identity.
    const groups: unknown[] = [];
    function Group() {
      const values = useDocumentValues(["seo"]);
      groups.push(values?.seo);
      return <pre data-testid="preview">{JSON.stringify(values)}</pre>;
    }
    render(
      <Document>
        <Group />
      </Document>
    );
    await userEvent.type(screen.getByLabelText("SEO title"), "Search");
    expect(preview()).toEqual({ seo: { title: "Search" } });
    const kept = groups.at(-1);

    await userEvent.type(screen.getByLabelText("SEO title"), "!");
    expect(preview()).toEqual({ seo: { title: "Search!" } });
    // A group handed out is the reader's own: the next keystroke gives a new
    // one rather than changing the one a component kept.
    expect(groups.at(-1)).not.toBe(kept);
    expect(kept).toEqual({ title: "Search" });
  });

  it("draws again only when a field it reads changes", async () => {
    const drawn = vi.fn();
    function Counted() {
      drawn(useDocumentValues(["title"]));
      return null;
    }
    render(
      <Document>
        <Counted />
      </Document>
    );
    const before = drawn.mock.calls.length;

    await userEvent.type(screen.getByLabelText("Body"), "unrelated");
    expect(drawn.mock.calls.length).toBe(before);

    await userEvent.type(screen.getByLabelText("Title"), "!");
    expect(drawn.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("useDocumentField", () => {
  /** A plugin's control for one field, with its last answer exposed. */
  function FieldControl({
    path,
    onField,
  }: {
    path: string;
    onField: (field: DocumentField | null) => void;
  }) {
    const field = useDocumentField(path);
    onField(field);
    return (
      <pre data-testid="field">{JSON.stringify(field?.value ?? null)}</pre>
    );
  }

  it("writes a field the person sees, and marks the document changed", () => {
    let field: DocumentField | null = null;
    render(
      <Document>
        <FieldControl path="seo.title" onField={f => (field = f)} />
      </Document>
    );
    expect(field).not.toBeNull();
    expect(field!.writable).toBe(true);

    let wrote = false;
    act(() => {
      wrote = field!.set("Chosen");
    });
    expect(wrote).toBe(true);
    expect(screen.getByLabelText("SEO title")).toHaveValue("Chosen");
    expect(screen.getByLabelText("Dirty")).toHaveTextContent("true");
    expect(screen.getByTestId("field")).toHaveTextContent('"Chosen"');
  });

  it("returns a field to automatic by setting it to null", () => {
    let field: DocumentField | null = null;
    render(
      <Document>
        <FieldControl path="title" onField={f => (field = f)} />
      </Document>
    );
    act(() => {
      field!.set(null);
    });
    expect(screen.getByTestId("field")).toHaveTextContent("null");
  });

  it("writes nothing while the document's content is held", () => {
    let field: DocumentField | null = null;
    render(
      <Document contentHeld>
        <FieldControl path="seo.title" onField={f => (field = f)} />
      </Document>
    );
    expect(field!.writable).toBe(false);

    let wrote = true;
    act(() => {
      wrote = field!.set("Chosen");
    });
    expect(wrote).toBe(false);
    expect(screen.getByLabelText("SEO title")).toHaveValue("");
    expect(screen.getByLabelText("Dirty")).toHaveTextContent("false");
  });

  it("checks a write again once a save has been refused, as typing would", async () => {
    // The editors check a field as it changes only after a refused save,
    // and a plugin's write is checked the same way.
    let field: DocumentField | null = null;
    function Checked() {
      const form = useForm<Record<string, unknown>>({
        defaultValues: { title: "" },
        mode: "onSubmit",
        reValidateMode: "onChange",
      });
      return (
        <EntryFormProvider
          form={form}
          onSubmit={form.handleSubmit(() => {})}
          contentHeld={false}
        >
          <input
            aria-label="Title"
            {...form.register("title", { required: "Give it a title" })}
          />
          <p role="alert">
            {String(form.formState.errors.title?.message ?? "")}
          </p>
          <button type="submit">Save</button>
          <FieldControl path="title" onField={f => (field = f)} />
        </EntryFormProvider>
      );
    }
    render(<Checked />);
    // Before any save, a write is not checked, however long it is waited on.
    await act(async () => {
      field!.set("");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Give it a title");

    await act(async () => {
      field!.set("A title");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("");
  });

  it("writes nothing through a setter kept from before the content was held", () => {
    let field: DocumentField | null = null;
    const { rerender } = render(
      <Document contentHeld={false}>
        <FieldControl path="seo.title" onField={f => (field = f)} />
      </Document>
    );
    const kept = field!;
    rerender(
      <Document contentHeld>
        <FieldControl path="seo.title" onField={f => (field = f)} />
      </Document>
    );

    let wrote = true;
    act(() => {
      wrote = kept.set("Late");
    });
    expect(wrote).toBe(false);
    expect(screen.getByLabelText("SEO title")).toHaveValue("");
  });

  it("is null outside a document", () => {
    let field: DocumentField | null | undefined;
    render(<FieldControl path="title" onField={f => (field = f)} />);
    expect(field).toBeNull();
  });
});
