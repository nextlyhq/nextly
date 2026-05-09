import { useForm, FormProvider } from "react-hook-form";
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { EntrySystemHeader } from "../EntrySystemHeader";

interface HarnessProps {
  mode: "create" | "edit";
  entry?: {
    id: string;
    status?: string;
    title?: string;
    slug?: string;
  } | null;
  isDirty?: boolean;
}

function Harness({ mode, entry = null, isDirty = false }: HarnessProps) {
  const methods = useForm({ defaultValues: { title: entry?.title ?? "" } });
  return (
    <FormProvider {...methods}>
      <EntrySystemHeader
        mode={mode}
        hasStatus
        isDirty={isDirty}
        entry={entry}
        collectionSlug="posts"
        onSaveDraft={vi.fn()}
        onPublish={vi.fn()}
        onSaveChanges={vi.fn()}
        onUnpublish={vi.fn()}
        onCancel={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onViewApi={vi.fn()}
      />
    </FormProvider>
  );
}

describe("EntrySystemHeader — action dropdown visibility (Task 7 PR-8)", () => {
  it("hides the entire action dropdown in create mode (clean form)", () => {
    render(<Harness mode="create" />);
    expect(
      screen.queryByRole("button", { name: /more actions/i })
    ).not.toBeInTheDocument();
  });

  it("hides the entire action dropdown in create mode (dirty form)", () => {
    render(<Harness mode="create" isDirty />);
    expect(
      screen.queryByRole("button", { name: /more actions/i })
    ).not.toBeInTheDocument();
  });

  it("renders the action dropdown in edit mode once the entry has an id", () => {
    render(
      <Harness
        mode="edit"
        entry={{ id: "abc", status: "draft", title: "Hello" }}
      />
    );
    expect(
      screen.getByRole("button", { name: /more actions/i })
    ).toBeInTheDocument();
  });
});
