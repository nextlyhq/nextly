/**
 * An entry's slug sits on the line under its title: a pencil opens it, Enter
 * stores the edit in the form, as does leaving the field, and Esc puts it
 * back. Held read-only, it is text with no pencil. An entry with no slug yet
 * says so, and a refused slug's message is announced beside it. A Single
 * passes no slug, and no line is drawn.
 */
import userEvent from "@testing-library/user-event";
import type { FieldConfig } from "nextly/config";
import { useEffect } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { describe, it, expect } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { DocumentTitleBlock } from "../DocumentTitleBlock";

const slugField = {
  type: "text",
  name: "slug",
  label: "Slug",
} as unknown as FieldConfig;

let stored: unknown;

function Harness({
  locked,
  withSlug = true,
  initialSlug = "homepage",
  error,
}: {
  locked?: boolean;
  withSlug?: boolean;
  initialSlug?: string;
  error?: string;
}) {
  const methods = useForm({
    defaultValues: { title: "Home", slug: initialSlug },
  });
  stored = methods.watch("slug");
  const { setError } = methods;
  useEffect(() => {
    if (error) setError("slug", { message: error });
  }, [error, setError]);
  return (
    <FormProvider {...methods}>
      <DocumentTitleBlock
        mode="edit"
        slug={withSlug ? { field: slugField, locked } : undefined}
      />
    </FormProvider>
  );
}

describe("DocumentTitleBlock — the slug line", () => {
  it("shows the slug read-only with no edit affordance when it is locked", () => {
    render(<Harness locked />);
    expect(screen.getByText("homepage")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /edit slug/i })
    ).not.toBeInTheDocument();
  });

  it("keeps the inline edit affordance when it is not locked", () => {
    render(<Harness />);
    expect(
      screen.getByRole("button", { name: /edit slug/i })
    ).toBeInTheDocument();
  });

  it("comes after the title", () => {
    render(<Harness />);
    const title = screen.getByLabelText("Title");
    const slug = screen.getByText("homepage");
    expect(
      title.compareDocumentPosition(slug) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("stores an edit on Enter", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /edit slug/i }));
    const input = screen.getByRole("textbox", { name: "Slug" });
    await user.clear(input);
    await user.type(input, "home{Enter}");
    expect(stored).toBe("home");
    expect(screen.getByText("home")).toBeInTheDocument();
  });

  it("puts the slug back on Esc", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /edit slug/i }));
    const input = screen.getByRole("textbox", { name: "Slug" });
    await user.clear(input);
    await user.type(input, "elsewhere{Escape}");
    expect(stored).toBe("homepage");
    expect(screen.getByText("homepage")).toBeInTheDocument();
  });

  it("stores an edit when the field is left", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /edit slug/i }));
    const input = screen.getByRole("textbox", { name: "Slug" });
    await user.clear(input);
    await user.type(input, "home");
    await user.tab();
    expect(stored).toBe("home");
    expect(
      screen.queryByRole("textbox", { name: "Slug" })
    ).not.toBeInTheDocument();
  });

  it("says an entry has no slug yet", () => {
    render(<Harness initialSlug="" />);
    expect(screen.getByText("(unset)")).toBeInTheDocument();
  });

  it("announces a refused slug's message", async () => {
    render(<Harness error="This slug is already in use" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This slug is already in use"
    );
  });

  it("draws no slug line where none is given, as for a Single", () => {
    render(<Harness withSlug={false} />);
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.queryByText("homepage")).not.toBeInTheDocument();
    expect(screen.queryByText(/slug:/)).not.toBeInTheDocument();
  });
});
