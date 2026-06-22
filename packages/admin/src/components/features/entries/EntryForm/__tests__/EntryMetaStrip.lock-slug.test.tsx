import type { FieldConfig } from "nextly/config";
import { useForm, FormProvider } from "react-hook-form";
import { describe, it, expect } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { EntryMetaStrip } from "../EntryMetaStrip";

const slugField = {
  type: "text",
  name: "slug",
  label: "Slug",
} as unknown as FieldConfig;

function Harness({ lockSlug }: { lockSlug?: boolean }) {
  const methods = useForm({ defaultValues: { slug: "homepage" } });
  return (
    <FormProvider {...methods}>
      <EntryMetaStrip
        slugField={slugField}
        hasStatus={false}
        isRailCollapsed={false}
        lockSlug={lockSlug}
      />
    </FormProvider>
  );
}

describe("EntryMetaStrip — lockSlug", () => {
  it("shows the slug read-only with no edit affordance when lockSlug is set", () => {
    render(<Harness lockSlug />);
    expect(screen.getByText("homepage")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /edit slug/i })
    ).not.toBeInTheDocument();
  });

  it("keeps the inline edit affordance when lockSlug is not set", () => {
    render(<Harness />);
    expect(
      screen.getByRole("button", { name: /edit slug/i })
    ).toBeInTheDocument();
  });
});
