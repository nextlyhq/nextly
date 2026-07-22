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
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { EntrySystemHeader } from "../EntrySystemHeader";

// The Publish and Unpublish affordances are permission-gated. The matrix cases
// below are about lifecycle state, not authorization, so the caller holds every
// permission by default; the gating cases override this per test.
const { canFor } = vi.hoisted(() => ({
  canFor: vi.fn((_slug: string) => true),
}));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => canFor(slug),
}));

beforeEach(() => {
  canFor.mockReset();
  canFor.mockImplementation(() => true);
});

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

describe("EntrySystemHeader — publish permission gating", () => {
  it("hides Publish for a caller without publish-<slug>, keeping Save Draft", () => {
    // An author who may edit but not publish: the primary action for them is
    // to save a draft, and the server would refuse a publish anyway.
    canFor.mockImplementation((slug: string) => slug !== "publish-posts");

    render(<Harness mode="edit" entry={{ id: "1", status: "draft" }} />);

    expect(
      screen.getByRole("button", { name: /^save draft$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^publish$/i })
    ).not.toBeInTheDocument();
  });

  it("hides Publish in create mode without the permission", () => {
    // Create-as-published requires publish; without it the author creates a
    // draft only.
    canFor.mockImplementation((slug: string) => slug !== "publish-posts");

    render(<Harness mode="create" />);

    expect(
      screen.getByRole("button", { name: /^save draft$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^publish$/i })
    ).not.toBeInTheDocument();
  });

  it("hides Unpublish for a caller without unpublish-<slug>", () => {
    // Editing published content: they may save changes but not take it down.
    canFor.mockImplementation((slug: string) => slug !== "unpublish-posts");

    render(
      <Harness mode="edit" entry={{ id: "1", status: "published" }} isDirty />
    );

    expect(
      screen.getByRole("button", { name: /^save changes$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^unpublish$/i })
    ).not.toBeInTheDocument();
  });

  it("still shows Publish when the permission is held", () => {
    canFor.mockImplementation(() => true);

    render(<Harness mode="edit" entry={{ id: "1", status: "draft" }} />);

    expect(
      screen.getByRole("button", { name: /^publish$/i })
    ).toBeInTheDocument();
  });
});
