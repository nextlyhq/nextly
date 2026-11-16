/**
 * An entry's address sits in a chip under its title: the site's address and
 * the entry's path, with copy, edit and open-live buttons that are always on
 * screen, never only on hover. Edit opens the slug in its place in the
 * address: Enter stores the edit in the form, as does leaving the field, and
 * Esc puts it back. Held read-only, there is no edit button. Without the
 * site's address the chip shows the path alone; for a type with no public
 * address, the slug alone; with neither, no chip, as for a Single.
 */
import userEvent from "@testing-library/user-event";
import type { FieldConfig } from "nextly/config";
import { useEffect } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { afterEach, describe, it, expect, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { DocumentTitleBlock } from "../DocumentTitleBlock";
import type { EntryAddress } from "../entry-details-read";

const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast,
}));

const slugField = {
  type: "text",
  name: "slug",
  label: "Slug",
} as unknown as FieldConfig;

/** A page on a site with an address, served at `/<slug>`. */
const PAGE: EntryAddress = {
  site: "https://ridgeline.com/",
  path: "/homepage",
  aroundSlug: { before: "/", after: "" },
};

let stored: unknown;

function Harness({
  live,
  locked,
  withSlug = true,
  initialSlug = "homepage",
  error,
  address,
  status = "published",
}: {
  live?: boolean;
  locked?: boolean;
  withSlug?: boolean;
  initialSlug?: string;
  error?: string;
  address?: EntryAddress | null;
  status?: string;
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
        slug={
          withSlug
            ? { field: slugField, locked, hasPublicAddress: live === true }
            : undefined
        }
        address={address}
        status={{ status, hasWorkingDraft: false }}
      />
    </FormProvider>
  );
}

function clipboard(
  value: { writeText: (text: string) => Promise<void> } | undefined
) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    writable: true,
    value,
  });
}

const chip = () => screen.getByTestId("document-address");

afterEach(() => {
  vi.clearAllMocks();
});

describe("DocumentTitleBlock — the address chip", () => {
  it("shows a page's full address and its three buttons", () => {
    render(<Harness address={PAGE} />);
    expect(chip()).toHaveTextContent("ridgeline.com/homepage");
    for (const name of ["Copy address", "Edit address", "Open live page"]) {
      expect(
        within(chip()).getByRole(
          name === "Open live page" ? "link" : "button",
          { name }
        )
      ).toBeInTheDocument();
    }
    expect(
      within(chip()).getByRole("link", { name: "Open live page" })
    ).toHaveAttribute("href", "https://ridgeline.com/homepage");
  });

  it("draws its buttons at all times, never only on hover", () => {
    render(<Harness address={PAGE} />);
    for (const control of [
      ...within(chip()).getAllByRole("button"),
      within(chip()).getByRole("link"),
    ]) {
      // Nothing hides a button until a pointer comes near it.
      expect(control.className).not.toMatch(/opacity-0|invisible|hidden/);
      expect(control).toBeVisible();
    }
  });

  it("shows the path alone, with no live page, while the site's address isn't set", () => {
    render(<Harness address={{ ...PAGE, site: null }} />);
    expect(chip()).toHaveTextContent(/^\/homepage$/);
    expect(
      screen.queryByRole("link", { name: "Open live page" })
    ).not.toBeInTheDocument();
  });

  it("offers no live page for an entry that isn't published", () => {
    render(<Harness address={PAGE} status="draft" />);
    expect(chip()).toHaveTextContent("ridgeline.com/homepage");
    expect(
      screen.queryByRole("link", { name: "Open live page" })
    ).not.toBeInTheDocument();
  });

  it("copies what the chip shows, as a full address, and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    clipboard({ writeText });
    render(<Harness address={PAGE} />);
    await userEvent.click(
      within(chip()).getByRole("button", { name: "Copy address" })
    );
    expect(writeText).toHaveBeenCalledWith("https://ridgeline.com/homepage");
    expect(toast.success).toHaveBeenCalledWith("Address copied");
  });

  it("shows the slug alone for a type with no public address", () => {
    render(<Harness address={null} />);
    expect(chip()).toHaveTextContent(/^homepage$/);
    expect(
      within(chip()).getByRole("button", { name: "Copy address" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open live page" })
    ).not.toBeInTheDocument();
  });

  it("draws no chip for a type with neither an address nor a slug", () => {
    render(<Harness withSlug={false} address={null} />);
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.queryByTestId("document-address")).not.toBeInTheDocument();
  });

  it("shows the address read-only with no edit button when it is locked", () => {
    render(<Harness locked address={PAGE} />);
    expect(screen.getByText("homepage")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit address" })
    ).not.toBeInTheDocument();
  });

  it("says no word for it but address: no slug label or line", () => {
    render(<Harness address={PAGE} />);
    expect(screen.queryByText(/slug/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /slug/i })
    ).not.toBeInTheDocument();
  });

  it("comes after the title", () => {
    render(<Harness />);
    const title = screen.getByLabelText("Title");
    const slug = screen.getByText("homepage");
    expect(
      title.compareDocumentPosition(slug) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("stores an edit on Enter, and shows it in the address", async () => {
    const user = userEvent.setup();
    render(<Harness address={PAGE} />);
    await user.click(screen.getByRole("button", { name: "Edit address" }));
    const input = screen.getByRole("textbox", { name: "Address" });
    await user.clear(input);
    await user.type(input, "home{Enter}");
    expect(stored).toBe("home");
    expect(chip()).toHaveTextContent("ridgeline.com/home");
  });

  it("puts the slug back on Esc", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Edit address" }));
    const input = screen.getByRole("textbox", { name: "Address" });
    await user.clear(input);
    await user.type(input, "elsewhere{Escape}");
    expect(stored).toBe("homepage");
    expect(screen.getByText("homepage")).toBeInTheDocument();
  });

  it("stores an edit when the field is left", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Edit address" }));
    const input = screen.getByRole("textbox", { name: "Address" });
    await user.clear(input);
    await user.type(input, "home");
    await user.tab();
    expect(stored).toBe("home");
    expect(
      screen.queryByRole("textbox", { name: "Address" })
    ).not.toBeInTheDocument();
  });

  it("says an entry has no slug yet, and offers nothing to copy", () => {
    render(<Harness initialSlug="" address={null} />);
    expect(screen.getByText("(unset)")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy address" })
    ).not.toBeInTheDocument();
  });

  it("warns that an edit retires a live address", async () => {
    const user = userEvent.setup();
    render(<Harness live address={PAGE} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit address" }));
    const input = screen.getByRole("textbox", { name: "Address" });
    await user.clear(input);
    await user.type(input, "home{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Changes the public URL. The old one will stop working."
    );
  });

  it("announces a refused slug's message", async () => {
    render(<Harness error="This slug is already in use" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This slug is already in use"
    );
  });
});
