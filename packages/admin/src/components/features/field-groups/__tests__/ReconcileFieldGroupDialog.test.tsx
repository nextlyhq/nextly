/**
 * The dialog an operator approves a definition repair from.
 *
 * Its job is to be accurate about three things they would otherwise have to guess: what the repair
 * will change, which parts of that need following up afterwards, and whether pressing the button
 * does anything at all. Each is asserted by IDENTITY rather than by shape, because the operator's
 * real question is whether their own field is in the list.
 */
import userEvent from "@testing-library/user-event";
import type { ReconcileFieldGroupPreview } from "nextly/field-group-reconcile";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { ReconcileFieldGroupDialog } from "../ReconcileFieldGroupDialog";

const mutate = vi.fn();

const previewState: {
  data?: ReconcileFieldGroupPreview;
  isPending: boolean;
  isError: boolean;
  error?: Error;
} = { isPending: false, isError: false };

const repairState: {
  data?: unknown;
  isPending: boolean;
  isError: boolean;
  error?: Error;
} = { isPending: false, isError: false };

vi.mock("@admin/hooks/queries/useFieldGroupReconcile", () => ({
  useFieldGroupReconcilePreview: () => previewState,
  useFieldGroupReconcile: () => ({ ...repairState, mutate, reset: vi.fn() }),
}));

/** A plan with nothing to do, which each test narrows to the case it is about. */
function plan(
  over: Partial<ReconcileFieldGroupPreview> = {}
): ReconcileFieldGroupPreview {
  return {
    slug: "hero",
    localized: false,
    removed: [],
    repaired: [],
    adopted: [],
    blockers: [],
    unchanged: true,
    wouldWrite: false,
    schemaVersion: 7,
    ...over,
  };
}

beforeEach(() => {
  mutate.mockClear();
  previewState.data = undefined;
  previewState.isPending = false;
  previewState.isError = false;
  repairState.data = undefined;
  repairState.isPending = false;
  repairState.isError = false;
});

function open() {
  return render(
    <ReconcileFieldGroupDialog
      open
      onOpenChange={vi.fn()}
      fieldGroupSlug="hero"
      fieldGroupLabel="Hero"
    />
  );
}

describe("ReconcileFieldGroupDialog", () => {
  it("names an adopted column and the type that was guessed for it", () => {
    // The one category carrying follow-up work. A count would answer a question nobody asked --
    // the operator needs to know it was THEIR field and what it became.
    previewState.data = plan({
      unchanged: false,
      wouldWrite: true,
      adopted: [
        {
          fieldName: "contact_email",
          columnName: "contact_email",
          table: "main",
          liveType: "varchar(255)",
          guessedType: "text",
        },
      ],
    });
    open();

    expect(screen.getByText(/contact_email → text/)).toBeInTheDocument();
    expect(screen.getByText(/varchar\(255\)/)).toBeInTheDocument();
    expect(screen.getByText(/needs your attention/i)).toBeInTheDocument();
  });

  it("names every blocker and offers no way to apply", () => {
    // A refusal that showed a live button would invite the operator to press something that
    // cannot work, and the reason differs per blocker, so each is named.
    previewState.data = plan({
      blockers: [
        {
          fieldName: "title",
          columnName: "title",
          kind: "column-on-both-tables",
          detail: "The column exists on both tables.",
        },
      ],
    });
    open();

    expect(screen.getByText(/exists on both tables/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /repair definition/i })
    ).not.toBeInTheDocument();
  });

  it("says there is nothing to repair on a healthy field group", () => {
    previewState.data = plan();
    open();

    expect(screen.getByText(/nothing to repair/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /repair definition/i })
    ).not.toBeInTheDocument();
  });

  it("explains why applying still writes when only the status is stale", () => {
    // 🔴 The case where the plan and the write decision genuinely differ. Reading `unchanged`
    // alone would render an empty change list beside an enabled button, so the dialog has to say
    // what applying is FOR when no field is changing.
    previewState.data = plan({
      unchanged: true,
      wouldWrite: true,
      staleStatus: "diverged",
    });
    open();

    expect(screen.getByText(/already match the tables/i)).toBeInTheDocument();
    expect(screen.getByText(/diverged/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /repair definition/i })
    ).toBeEnabled();
  });

  it("approves the exact version the plan was read against", async () => {
    // The pin. Sending anything else -- or nothing -- would let the server repair against a row
    // this operator never saw.
    previewState.data = plan({
      unchanged: false,
      wouldWrite: true,
      schemaVersion: 42,
      removed: [{ fieldName: "subtitle", columnName: "subtitle" }],
    });
    open();

    await userEvent.click(
      screen.getByRole("button", { name: /repair definition/i })
    );

    expect(mutate).toHaveBeenCalledWith({
      fieldGroupSlug: "hero",
      expectedSchemaVersion: 42,
    });
  });

  it("warns that a landed repair has not reached the running server", () => {
    // Reported rather than folded into success: the database is correct and the process is not,
    // and only a restart fixes the second. Telling the operator "done" would strand them.
    repairState.data = {
      slug: "hero",
      localized: false,
      removed: [],
      repaired: [],
      adopted: [],
      unchanged: false,
      schemaVersion: 43,
      runtimeRefreshed: false,
    };
    previewState.data = plan({ unchanged: false, wouldWrite: true });
    open();

    expect(screen.getByText(/Restart it before editing/i)).toBeInTheDocument();
  });

  it("carries no hardcoded colours, so it renders in both themes", () => {
    // Every colour comes from a --nx-* backed token class. A literal hex, rgb() or black/white
    // utility is the recurring defect this guards, and it only shows up in one mode.
    previewState.data = plan({
      unchanged: false,
      wouldWrite: true,
      adopted: [
        {
          fieldName: "x",
          columnName: "x",
          table: "main",
          liveType: "text",
          guessedType: "text",
        },
      ],
    });
    const { baseElement } = open();

    const markup = baseElement.innerHTML;
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(markup).not.toMatch(/rgba?\(/);
    expect(markup).not.toMatch(/\b(?:text|bg|border)-(?:white|black)\b/);
    // The control: the tokens ARE present, so the assertions above are checking real markup
    // rather than an element that failed to render.
    expect(markup).toMatch(/text-destructive/);
  });
});
