/**
 *
 * Locks the button matrix per lifecycle state:
 *  - hasStatus + create / draft → Save Draft + Publish (Globe icon)
 *  - hasStatus + edit + published clean → Save changes (disabled) + Unpublish
 *  - hasStatus + edit + published dirty → Save changes (enabled) + Unpublish
 *  - !hasStatus → single Save / Create button
 *
 */
import { useForm, FormProvider } from "react-hook-form";
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { EntrySystemHeader } from "../EntrySystemHeader";

interface HarnessProps {
  mode: "create" | "edit";
  hasStatus?: boolean;
  entry?: {
    id: string;
    status?: string;
    title?: string;
    slug?: string;
  } | null;
  isDirty?: boolean;
}

function Harness({
  mode,
  hasStatus = true,
  entry = null,
  isDirty = false,
}: HarnessProps) {
  const methods = useForm({ defaultValues: { title: entry?.title ?? "" } });
  return (
    <FormProvider {...methods}>
      <EntrySystemHeader
        mode={mode}
        hasStatus={hasStatus}
        isDirty={isDirty}
        entry={entry}
        collectionSlug="posts"
        onSaveDraft={vi.fn()}
        onPublish={vi.fn()}
        onSaveChanges={vi.fn()}
        onUnpublish={vi.fn()}
      />
    </FormProvider>
  );
}

describe("EntrySystemHeader — button matrix", () => {
  it("create + hasStatus → Save Draft + Publish", () => {
    render(<Harness mode="create" hasStatus />);
    expect(
      screen.getByRole("button", { name: /^save draft$/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^publish$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^save changes$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^unpublish$/i })
    ).not.toBeInTheDocument();
  });

  it("edit + draft entry → Save Draft + Publish", () => {
    render(
      <Harness
        mode="edit"
        hasStatus
        entry={{ id: "x", status: "draft", title: "Untitled" }}
      />
    );
    expect(
      screen.getByRole("button", { name: /^save draft$/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^publish$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^unpublish$/i })
    ).not.toBeInTheDocument();
  });

  it("edit + published clean → Save changes (disabled) + Unpublish", () => {
    render(
      <Harness
        mode="edit"
        hasStatus
        entry={{ id: "x", status: "published", title: "Live" }}
        isDirty={false}
      />
    );
    const saveChanges = screen.getByRole("button", {
      name: /^save changes$/i,
    });
    expect(saveChanges).toBeInTheDocument();
    expect(saveChanges).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /^unpublish$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^save draft$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^publish$/i })
    ).not.toBeInTheDocument();
  });

  it("edit + published dirty → Save changes (enabled) + Unpublish", () => {
    render(
      <Harness
        mode="edit"
        hasStatus
        entry={{ id: "x", status: "published", title: "Live" }}
        isDirty
      />
    );
    const saveChanges = screen.getByRole("button", {
      name: /^save changes$/i,
    });
    expect(saveChanges).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /^unpublish$/i })
    ).toBeInTheDocument();
  });

  it("!hasStatus → single Save / Create button", () => {
    render(<Harness mode="create" hasStatus={false} />);
    // In create mode the single submit button reads "Create".
    expect(
      screen.getByRole("button", { name: /^create$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^save draft$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^unpublish$/i })
    ).not.toBeInTheDocument();
  });
});
