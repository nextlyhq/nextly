/**
 * The Single editor hosting a plugin's document view, on the terms the entry
 * editor does: the view's own form never saves, the save shortcut does, and
 * the view is told which Single it is of.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
// RTL's own `render`: the shared one fixes its wrapper, and these need a
// shortcut owner that listens.
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { useFormContext } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  act,
  cleanup,
  createTestQueryClient,
  screen,
  waitFor,
} from "@admin/__tests__/utils";
import {
  clearRegistry,
  registerComponent,
  type DocumentViewProps,
} from "@admin/lib/plugins/component-registry";

const { useDocumentLock } = vi.hoisted(() => ({ useDocumentLock: vi.fn() }));

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave: () => ({ status: "idle", lastSavedAt: null }),
}));

import {
  SingleForm,
  type SingleDocumentData,
  type SingleSchema,
} from "../SingleForm";

const VIEW = "@acme/pb/admin#Builder";
const schema = {
  slug: "homepage",
  label: "Homepage",
  fields: [{ type: "text", name: "heroTitle", label: "Hero Title" }],
} as unknown as SingleSchema;
const singleDocument = {
  id: "homepage",
  updatedAt: "2026-01-01T00:00:00.000Z",
  heroTitle: "Welcome",
} as unknown as SingleDocumentData;

const received = vi.fn();

function BuilderView(props: DocumentViewProps): ReactElement {
  received(props);
  const { register } = useFormContext();
  return (
    <div data-testid="builder-view">
      <input aria-label="Hero heading" {...register("heroTitle")} />
      <form
        aria-label="Find a block"
        onSubmit={event => event.preventDefault()}
      >
        <button type="submit">Find</button>
      </form>
    </div>
  );
}

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>{children}</ShortcutProvider>
    </QueryClientProvider>
  );
}

function renderView(
  onSubmit: (data: Record<string, unknown>) => Promise<void>,
  extra: Partial<ComponentProps<typeof SingleForm>> = {}
) {
  return render(
    <SingleForm
      schema={schema}
      document={singleDocument}
      onSubmit={onSubmit}
      documentView={{ component: VIEW, onExit: vi.fn() }}
      {...extra}
    />,
    { wrapper: Providers }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  registerComponent(VIEW, BuilderView);
  useDocumentLock.mockReturnValue({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  clearRegistry();
});

describe("SingleForm with a document view", () => {
  it("tells the view which Single it is of, and renders no entry form element", () => {
    renderView(vi.fn().mockResolvedValue(undefined));

    expect(screen.getByTestId("builder-view")).toBeInTheDocument();
    expect(document.querySelector("form#entry-form")).toBeNull();
    const props = received.mock.lastCall?.[0] as DocumentViewProps;
    expect(props.singleSlug).toBe("homepage");
    // A Single is addressed by its slug alone.
    expect(props.collectionSlug).toBeUndefined();
    expect(props.entryId).toBeUndefined();
  });

  it("does not save when the view's own form submits, and does on Mod+S", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderView(onSubmit);

    const heading = screen.getByLabelText("Hero heading");
    await user.type(heading, "!");
    await user.click(screen.getByRole("button", { name: "Find" }));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(onSubmit).not.toHaveBeenCalled();

    heading.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ heroTitle: "Welcome!" })
    );
  });

  it("leaves Escape to the view", () => {
    const onCancel = vi.fn();
    renderView(vi.fn().mockResolvedValue(undefined), { onCancel });

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })
    );

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("draws the view alone when the address asks for translation mode", () => {
    renderView(vi.fn().mockResolvedValue(undefined), {
      translation: { from: "fr", sourceDocument: { heroTitle: "Bienvenue" } },
    });

    expect(screen.getByTestId("builder-view")).toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: "Source and translation" })
    ).toBeNull();
  });
});
