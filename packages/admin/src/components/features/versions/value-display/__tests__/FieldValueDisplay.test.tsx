/**
 * Read-only value display. The cases that matter are the ones where showing the
 * wrong thing is worse than showing nothing: secrets, references the caller may
 * not read, and values whose stored shape differs from their display shape.
 */
import type { FieldConfig } from "nextly/config";
import { describe, it, expect } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { FieldValueDisplay } from "../FieldValueDisplay";

function field(type: string, extra: Record<string, unknown> = {}): FieldConfig {
  return { name: "sample", type, ...extra } as FieldConfig;
}

describe("FieldValueDisplay", () => {
  it("shows the field label alongside the value", () => {
    render(
      <FieldValueDisplay field={field("text", { label: "Title" })} value="Hi" />
    );

    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Hi")).toBeInTheDocument();
  });

  it("falls back to the field name when it has no label", () => {
    render(<FieldValueDisplay field={field("text")} value="Hi" />);

    expect(screen.getByText("sample")).toBeInTheDocument();
  });

  it("marks an empty value rather than rendering blank space", () => {
    render(<FieldValueDisplay field={field("text")} value={null} />);

    expect(screen.getByText("Not set")).toBeInTheDocument();
  });

  it("never renders a stored password", () => {
    // The entry list renderer shows passwords in plain text; that is a defect,
    // and a history view has even less reason to.
    render(<FieldValueDisplay field={field("password")} value="hunter2" />);

    expect(screen.queryByText("hunter2")).not.toBeInTheDocument();
    expect(screen.getByText("••••••••")).toBeInTheDocument();
  });

  it("shows a checkbox as a word, including a deliberate no", () => {
    const { unmount } = render(
      <FieldValueDisplay field={field("checkbox")} value={1} />
    );
    expect(screen.getByText("Yes")).toBeInTheDocument();
    unmount();

    // false must read as "No", not as "Not set" — the distinction is the point.
    render(<FieldValueDisplay field={field("checkbox")} value={false} />);
    expect(screen.getByText("No")).toBeInTheDocument();
  });

  it("resolves a select value to its option label", () => {
    const f = field("select", {
      options: [{ label: "Published", value: "pub" }],
    });

    render(<FieldValueDisplay field={f} value="pub" />);

    expect(screen.getByText("Published")).toBeInTheDocument();
  });

  it("renders chips stored as a JSON string", () => {
    render(<FieldValueDisplay field={field("chips")} value='["a","b"]' />);

    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
  });

  it("shows a resolved relationship by name", () => {
    render(
      <FieldValueDisplay
        field={field("relationship")}
        value={{ id: "u1", label: "Ada Lovelace" }}
      />
    );

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("shows an unreadable relationship as present but unnamed", () => {
    // A reference the caller may not read is kept visible: hiding it would make
    // the historical value look empty.
    render(
      <FieldValueDisplay
        field={field("relationship")}
        value={{ id: "secret-id", label: null }}
      />
    );

    expect(screen.getByText("secret-id")).toBeInTheDocument();
  });

  it("shows an upload by filename with its thumbnail", () => {
    render(
      <FieldValueDisplay
        field={field("upload")}
        value={{ id: "m1", filename: "hero.jpg", thumbnailUrl: "/t.jpg" }}
      />
    );

    expect(screen.getByText("hero.jpg")).toBeInTheDocument();
    // Decorative: the filename beside it is the accessible name.
    expect(screen.getByRole("presentation", { hidden: true })).toBeTruthy();
  });

  it("renders rich text as readable text, not as editor JSON", () => {
    const doc = {
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", text: "Hello world" }],
          },
        ],
      },
    };

    render(<FieldValueDisplay field={field("richText")} value={doc} />);

    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(screen.queryByText(/"root"/)).not.toBeInTheDocument();
  });

  it("renders each row of a repeater with its child values", () => {
    const f = field("repeater", {
      fields: [{ name: "title", type: "text", label: "Title" }],
    });

    render(
      <FieldValueDisplay
        field={f}
        value={JSON.stringify([{ title: "One" }, { title: "Two" }])}
      />
    );

    expect(screen.getByText("Item 1")).toBeInTheDocument();
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
  });

  it("renders a group's child values", () => {
    const f = field("group", {
      fields: [{ name: "city", type: "text", label: "City" }],
    });

    render(<FieldValueDisplay field={f} value={{ city: "Lisbon" }} />);

    expect(screen.getByText("City")).toBeInTheDocument();
    expect(screen.getByText("Lisbon")).toBeInTheDocument();
  });

  it("unwraps a non-repeatable component and names its type", () => {
    const f = field("component", {
      fields: [{ name: "heading", type: "text", label: "Heading" }],
    });

    render(
      <FieldValueDisplay
        field={f}
        value={[{ _componentType: "hero", heading: "Welcome" }]}
      />
    );

    expect(screen.getByText("hero")).toBeInTheDocument();
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });

  it("falls back to text for a field type with no renderer", () => {
    // A plugin field type must still show its value rather than nothing.
    render(
      <FieldValueDisplay field={field("some-plugin-type")} value="value" />
    );

    expect(screen.getByText("value")).toBeInTheDocument();
  });
});
