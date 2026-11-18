// The pipeline between Save and a changed schema. Each builder page ran its own
// copy, and the parts that matter are the ones that are invisible when they go
// wrong: an early return that skips `endApply` leaves the page permanently
// "applying", and a `stopRestart` missed on one branch leaves the restart
// overlay up over a page that has finished.
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderHook } from "@admin/__tests__/utils";
import type { SchemaChangeConfirmation } from "@admin/components/features/schema-builder/types";
import { parseApiError } from "@admin/lib/api/parseApiError";
import type { SettingChange } from "@admin/lib/builder/settings-changes";
import type { SchemaPreviewResponse } from "@admin/services/schemaApi";
import type { FieldDefinition } from "@admin/types/collection";

import {
  mirrorSchemaFile,
  useSchemaSave,
  type SchemaApplyOutcome,
} from "../useSchemaSave";

const { toastError, toastWarning, startRestart, stopRestart } = vi.hoisted(
  () => ({
    toastError: vi.fn(),
    toastWarning: vi.fn(),
    startRestart: vi.fn(),
    stopRestart: vi.fn(),
  })
);

vi.mock("@admin/components/ui", () => ({
  toast: { error: toastError, warning: toastWarning, success: vi.fn() },
}));

vi.mock("@admin/context/RestartContext", () => ({
  useRestart: () => ({ startRestart, stopRestart }),
}));

const FIELDS: FieldDefinition[] = [
  {
    name: "body",
    label: "Body",
    type: "text",
    required: false,
    unique: false,
    index: false,
  },
];

function preview(
  overrides: Partial<SchemaPreviewResponse> = {}
): SchemaPreviewResponse {
  return {
    hasChanges: true,
    hasDestructiveChanges: false,
    classification: "safe",
    changes: { added: [], removed: [], changed: [], unchanged: [] },
    warnings: [],
    interactiveFields: [],
    ddlPreview: [],
    schemaVersion: 9,
    renamed: [],
    ...overrides,
  };
}

function confirmationStub(
  pending: SchemaPreviewResponse | null = null
): SchemaChangeConfirmation {
  return {
    preview: pending,
    previewId: pending === null ? 0 : 1,
    isOpen: pending !== null,
    isApplying: false,
    isBusy: false,
    request: vi.fn(),
    setOpen: vi.fn(),
    settle: vi.fn(),
    beginPreview: vi.fn(),
    endPreview: vi.fn(),
    beginApply: vi.fn(),
    endApply: vi.fn(),
  };
}

type Overrides = {
  slug?: string | undefined;
  confirmation?: SchemaChangeConfirmation;
  getValidatedFields?: () => FieldDefinition[] | null;
  previewFn?: (fields: FieldDefinition[]) => Promise<SchemaPreviewResponse>;
  applyFn?: () => Promise<SchemaApplyOutcome>;
  onNoChanges?: (fields: FieldDefinition[]) => void;
  onApplied?: (fields: FieldDefinition[]) => void | Promise<void>;
  /** The settings the preview and the apply are sent with, read at each render. */
  previewedWith?: () => unknown;
  /** The entity's settings changed since the save, read at each render. */
  settingChanges?: () => readonly SettingChange[];
  /** The field groups not saved yet that the fields use. */
  fieldGroupsFirst?: {
    creates: readonly { address: string; label: string }[];
    create: () => Promise<string | null>;
    letGoUnused?: () => void;
  };
};

function setup(overrides: Overrides = {}) {
  const confirmation = overrides.confirmation ?? confirmationStub();
  const previewFn =
    overrides.previewFn ?? vi.fn(() => Promise.resolve(preview()));
  const applyFn =
    overrides.applyFn ?? vi.fn(() => Promise.resolve({ success: true }));
  const onNoChanges = overrides.onNoChanges ?? vi.fn();
  const onApplied = overrides.onApplied ?? vi.fn();

  const { result, rerender, unmount } = renderHook(() =>
    useSchemaSave({
      slug: "slug" in overrides ? overrides.slug : "posts",
      missingSlugMessage: "Collection slug is missing",
      label: "Posts",
      confirmation,
      getValidatedFields:
        overrides.getValidatedFields ??
        ((): FieldDefinition[] | null => FIELDS),
      preview: previewFn,
      apply: applyFn,
      onNoChanges,
      onApplied,
      previewedWith: overrides.previewedWith?.(),
      settingChanges: overrides.settingChanges?.() ?? [],
      fieldGroupsFirst: overrides.fieldGroupsFirst,
    })
  );

  return {
    result,
    rerender,
    unmount,
    confirmation,
    previewFn,
    applyFn,
    onNoChanges,
    onApplied,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * A refusal as the API sends it: the envelope's own message is only "Validation failed.", and the
 * reason is the field's.
 */
const REASON =
  'The translations table already has a column "code" (integer) that cannot hold every value code allows (text).';
const refusal = () =>
  parseApiError(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed.",
        requestId: "req-1",
        data: {
          errors: [
            {
              path: "fields.code",
              code: "COLUMN_ALREADY_EXISTS",
              message: REASON,
            },
          ],
        },
      },
    },
    400
  );

describe("handleSave", () => {
  it("refuses without a slug and previews nothing", async () => {
    const { result, previewFn } = setup({ slug: undefined });
    await act(async () => result.current.handleSave());
    expect(toastError).toHaveBeenCalledWith("Collection slug is missing");
    expect(previewFn).not.toHaveBeenCalled();
  });

  // The fields failing validation has already been reported to the user by the
  // validator, so this path must stay silent and simply not preview.
  it("stops quietly when the fields do not validate", async () => {
    const { result, previewFn } = setup({ getValidatedFields: () => null });
    await act(async () => result.current.handleSave());
    expect(previewFn).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("asks nothing when neither the schema nor a setting changed", async () => {
    const { result, confirmation, onNoChanges } = setup({
      previewFn: vi.fn(() => Promise.resolve(preview({ hasChanges: false }))),
    });
    await act(async () => result.current.handleSave());
    expect(onNoChanges).toHaveBeenCalledWith(FIELDS);
    expect(confirmation.request).not.toHaveBeenCalled();
  });

  it("puts a real schema change in front of the user", async () => {
    const changed = preview();
    const { result, confirmation, onNoChanges } = setup({
      previewFn: vi.fn(() => Promise.resolve(changed)),
    });
    await act(async () => result.current.handleSave());
    expect(confirmation.request).toHaveBeenCalledWith(changed);
    expect(onNoChanges).not.toHaveBeenCalled();
  });

  it("reports a failed preview and confirms nothing", async () => {
    const { result, confirmation } = setup({
      previewFn: vi.fn(() => Promise.reject(new Error("server exploded"))),
    });
    await act(async () => result.current.handleSave());
    expect(toastError).toHaveBeenCalledWith("server exploded");
    expect(confirmation.request).not.toHaveBeenCalled();
  });
});

describe("a refusal's reasons", () => {
  it("shows a refused preview's field reasons, not its summary", async () => {
    const { result } = setup({
      previewFn: vi.fn(() => Promise.reject(refusal())),
    });
    await act(async () => result.current.handleSave());
    expect(toastError).toHaveBeenCalledWith(REASON);
  });

  it("shows a refused apply's field reasons, not its summary", async () => {
    const confirmation = confirmationStub(preview());
    const { result } = setup({
      confirmation,
      applyFn: vi.fn(() => Promise.reject(refusal())),
    });

    await act(async () => result.current.confirmApply({}, []));

    await waitFor(() => expect(confirmation.endApply).toHaveBeenCalledTimes(1));
    expect(stopRestart).toHaveBeenCalledWith(false, REASON);
  });

  it("names the reason ui-schema.json could not be written", async () => {
    await mirrorSchemaFile(
      () => Promise.reject(refusal()),
      "Collection updated"
    );
    expect(toastWarning).toHaveBeenCalledWith(
      `Collection updated, but ui-schema.json could not be updated: ${REASON}.`
    );
  });

  it("names the reason a follow-up step was refused", async () => {
    const confirmation = confirmationStub(preview());
    const { result } = setup({
      confirmation,
      onApplied: vi.fn(() => Promise.reject(refusal())),
    });

    await act(async () => result.current.confirmApply({}, []));

    await waitFor(() =>
      expect(toastWarning).toHaveBeenCalledWith(
        `Posts schema updated, but a follow-up step did not complete: ${REASON}.`
      )
    );
  });
});

describe("confirmApply", () => {
  // What the dialog showed is what is applied: fields changed after the
  // preview, by an edit or an undo while it was on its way, are not applied
  // unseen. The person saves again and reviews them.
  it("applies nothing when the fields changed after the preview", async () => {
    const pending = preview();
    const confirmation = confirmationStub(pending);
    let fields = FIELDS;
    const { result, applyFn } = setup({
      confirmation,
      getValidatedFields: () => fields,
      previewFn: vi.fn(() => Promise.resolve(pending)),
    });
    await act(async () => {
      result.current.handleSave();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(confirmation.request).toHaveBeenCalledWith(pending)
    );

    fields = [...FIELDS, { ...FIELDS[0]!, name: "added_later" }];
    await act(async () => result.current.confirmApply({}, []));

    expect(applyFn).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "The fields or settings changed after the preview. Save again to review what changes."
    );
    expect(confirmation.settle).toHaveBeenCalledTimes(1);
  });

  // The preview and the apply are both sent the entity's localization, read at
  // their own renders. A change to it after the preview (turned off, or reset
  // by Discard all) would apply a storage the dialog never showed.
  it("applies nothing when the localization the preview was made with changed", async () => {
    const pending = preview();
    const confirmation = confirmationStub(pending);
    let localized = true;
    const { result, rerender, applyFn } = setup({
      confirmation,
      previewFn: vi.fn(() => Promise.resolve(pending)),
      previewedWith: () => ({ localized }),
    });
    await act(async () => {
      result.current.handleSave();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(confirmation.request).toHaveBeenCalledWith(pending)
    );

    localized = false;
    rerender();
    await act(async () => result.current.confirmApply({}, []));

    expect(applyFn).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "The fields or settings changed after the preview. Save again to review what changes."
    );
    expect(confirmation.settle).toHaveBeenCalledTimes(1);
  });

  // While the preview is on its way nothing is on screen to say a save has
  // started, yet what it answers is acted on: the page is told it is busy so
  // Discard all cannot clear what the save is about to keep.
  // Leaving the page drops its pending changes; a preview that answers after
  // that must not save them, nor put a confirmation in front of nobody.
  it("persists nothing when the preview answers after the page has gone", async () => {
    let answer: (value: SchemaPreviewResponse) => void = () => {};
    const confirmation = confirmationStub();
    const { result, unmount, onNoChanges } = setup({
      confirmation,
      previewFn: vi.fn(
        () =>
          new Promise<SchemaPreviewResponse>(resolve => {
            answer = resolve;
          })
      ),
    });
    await act(async () => {
      result.current.handleSave();
      await Promise.resolve();
    });

    unmount();
    await act(async () => answer(preview({ hasChanges: false })));
    await act(async () => answer(preview()));

    expect(onNoChanges).not.toHaveBeenCalled();
    expect(confirmation.request).not.toHaveBeenCalled();
  });

  it("marks the save busy while its preview is on its way", async () => {
    let answer: (value: SchemaPreviewResponse) => void = () => {};
    const confirmation = confirmationStub();
    const { result } = setup({
      confirmation,
      previewFn: vi.fn(
        () =>
          new Promise<SchemaPreviewResponse>(resolve => {
            answer = resolve;
          })
      ),
    });
    await act(async () => {
      result.current.handleSave();
      await Promise.resolve();
    });
    expect(confirmation.beginPreview).toHaveBeenCalledTimes(1);
    expect(confirmation.endPreview).not.toHaveBeenCalled();

    await act(async () => answer(preview()));
    await waitFor(() =>
      expect(confirmation.endPreview).toHaveBeenCalledTimes(1)
    );
  });

  it("applies the confirmed change and reports it once", async () => {
    const pending = preview();
    const confirmation = confirmationStub(pending);
    const { result, applyFn, onApplied } = setup({
      confirmation,
      applyFn: vi.fn(() =>
        Promise.resolve({ success: true, toastSummary: "1 field added" })
      ),
    });

    await act(async () => result.current.confirmApply({}, []));

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(FIELDS));
    // The version applied is the one the user was shown, not a re-read.
    expect(applyFn).toHaveBeenCalledWith(FIELDS, 9, {}, [], []);
    expect(startRestart).toHaveBeenCalledTimes(1);
    expect(stopRestart).toHaveBeenCalledWith(
      true,
      "Posts schema updated. 1 field added"
    );
    expect(confirmation.settle).toHaveBeenCalledTimes(1);
    expect(confirmation.beginApply).toHaveBeenCalledTimes(1);
    expect(confirmation.endApply).toHaveBeenCalledTimes(1);
  });

  // The review listed what the save brings up to date in a table an earlier version made, and its
  // Save confirmed them: the apply sends the key of every conversion that preview named, so the
  // server writes those and no other.
  it("confirms each conversion the reviewed preview named, by its key", async () => {
    const pending = preview({
      conversions: [
        {
          table: "dc_posts",
          column: "dc_posts",
          from: "as an earlier version made it",
          to: "as Nextly declares it (add index)",
          change: "adds an index on created_at",
          deletesValues: false,
        },
        {
          table: "dc_posts",
          column: "body",
          from: "text",
          to: "varchar(255)",
          change: "changes body from text to varchar(255)",
          deletesValues: false,
        },
      ],
    });
    const { result, applyFn } = setup({
      confirmation: confirmationStub(pending),
    });

    await act(async () => result.current.confirmApply({}, []));

    await waitFor(() =>
      expect(applyFn).toHaveBeenCalledWith(
        FIELDS,
        9,
        {},
        [],
        ["dc_posts", "body"]
      )
    );
  });

  // "no changes" is the server saying the apply was a no-op, which reads as
  // nonsense appended to a success line.
  it("leaves a no-op summary off the success message", async () => {
    const confirmation = confirmationStub(preview());
    const { result } = setup({
      confirmation,
      applyFn: vi.fn(() =>
        Promise.resolve({ success: true, toastSummary: "no changes" })
      ),
    });

    await act(async () => result.current.confirmApply({}, []));

    await waitFor(() =>
      expect(stopRestart).toHaveBeenCalledWith(true, "Posts schema updated")
    );
  });

  it("reports a refused apply, and does not clear the pending change", async () => {
    const confirmation = confirmationStub(preview());
    const { result, onApplied } = setup({
      confirmation,
      applyFn: vi.fn(() =>
        Promise.resolve({ success: false, message: "column still in use" })
      ),
    });

    await act(async () => result.current.confirmApply({}, []));

    await waitFor(() =>
      expect(stopRestart).toHaveBeenCalledWith(false, "column still in use")
    );
    expect(confirmation.settle).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    // Still released, or the page would sit "applying" forever.
    expect(confirmation.endApply).toHaveBeenCalledTimes(1);
  });

  it("releases the applying state when the apply throws", async () => {
    const confirmation = confirmationStub(preview());
    const { result } = setup({
      confirmation,
      applyFn: vi.fn(() => Promise.reject(new Error("network died"))),
    });

    await act(async () => result.current.confirmApply({}, []));

    await waitFor(() => expect(confirmation.endApply).toHaveBeenCalledTimes(1));
    expect(stopRestart).toHaveBeenCalledWith(false, "network died");
    expect(confirmation.settle).not.toHaveBeenCalled();
  });

  it("does nothing when there is no pending change to apply", async () => {
    const confirmation = confirmationStub(null);
    const { result, applyFn } = setup({ confirmation });

    await act(async () => result.current.confirmApply({}, []));

    expect(applyFn).not.toHaveBeenCalled();
    expect(startRestart).not.toHaveBeenCalled();
    expect(confirmation.beginApply).not.toHaveBeenCalled();
  });
});

// A change of the entity's settings alone is a pending change like a field's,
// so it is reviewed before it is saved: the review lists it, and only its
// confirmation saves it.
describe("a settings-only save", () => {
  const RENAMED: SettingChange = {
    key: "singularName",
    label: "name",
    from: "Post",
    to: "Article",
  };

  it("is put in front of the user, and saved only once confirmed", async () => {
    const unchanged = preview({ hasChanges: false });
    const confirmation = confirmationStub(unchanged);
    const { result, onNoChanges, applyFn } = setup({
      confirmation,
      previewFn: vi.fn(() => Promise.resolve(unchanged)),
      settingChanges: () => [RENAMED],
    });
    await act(async () => {
      result.current.handleSave();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(confirmation.request).toHaveBeenCalledWith(unchanged)
    );
    expect(onNoChanges).not.toHaveBeenCalled();

    await act(async () => result.current.confirmApply({}, []));
    expect(onNoChanges).toHaveBeenCalledWith(FIELDS);
    // No schema change, so nothing is applied and nothing restarts.
    expect(applyFn).not.toHaveBeenCalled();
    expect(startRestart).not.toHaveBeenCalled();
    expect(confirmation.settle).toHaveBeenCalledTimes(1);
  });

  it("saves nothing when a setting changed after it was reviewed", async () => {
    const unchanged = preview({ hasChanges: false });
    const confirmation = confirmationStub(unchanged);
    let changes: SettingChange[] = [RENAMED];
    const { result, rerender, onNoChanges } = setup({
      confirmation,
      previewFn: vi.fn(() => Promise.resolve(unchanged)),
      settingChanges: () => changes,
    });
    await act(async () => {
      result.current.handleSave();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(confirmation.request).toHaveBeenCalledWith(unchanged)
    );

    changes = [{ ...RENAMED, to: "Story" }];
    rerender();
    await act(async () => result.current.confirmApply({}, []));

    expect(onNoChanges).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "The fields or settings changed after the preview. Save again to review what changes."
    );
  });
});

// A field group made from the picker and not saved yet is created by its host's save: listed in
// the review, and created only once the review is confirmed, before the host, so cancelling
// creates nothing and a refused group leaves the host as it was.
describe("field groups not saved yet", () => {
  const HERO = { address: "hero", label: "Hero" };

  it("creates them after the confirmation and before the apply", async () => {
    const order: string[] = [];
    const create = vi.fn(async () => {
      order.push("create the field groups");
      return null;
    });
    const confirmation = confirmationStub(preview());
    const { result, onApplied } = setup({
      confirmation,
      fieldGroupsFirst: { creates: [HERO], create },
      applyFn: vi.fn(async () => {
        order.push("apply the host");
        return { success: true };
      }),
    });

    await act(async () => result.current.confirmApply({}, []));

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["create the field groups", "apply the host"]);
  });

  it("stops before the host when one is refused, keeping the change pending", async () => {
    const confirmation = confirmationStub(preview());
    const { result, applyFn, onApplied } = setup({
      confirmation,
      fieldGroupsFirst: {
        creates: [HERO],
        create: vi.fn(
          async () => "Another field group already uses this address."
        ),
      },
    });

    await act(async () => result.current.confirmApply({}, []));

    await waitFor(() => expect(confirmation.endApply).toHaveBeenCalledTimes(1));
    expect(applyFn).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    expect(confirmation.settle).not.toHaveBeenCalled();
    expect(stopRestart).toHaveBeenCalledWith(
      false,
      "Another field group already uses this address."
    );
  });

  it("creates nothing before the review is confirmed", async () => {
    const create = vi.fn(async () => null);
    const { result, confirmation } = setup({
      fieldGroupsFirst: { creates: [HERO], create },
    });

    await act(async () => result.current.handleSave());

    expect(confirmation.request).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it("puts a save in front of the user when a field group is all it creates", async () => {
    const { result, confirmation, onNoChanges } = setup({
      previewFn: vi.fn(() => Promise.resolve(preview({ hasChanges: false }))),
      fieldGroupsFirst: { creates: [HERO], create: vi.fn(async () => null) },
    });

    await act(async () => result.current.handleSave());

    expect(confirmation.request).toHaveBeenCalledTimes(1);
    expect(onNoChanges).not.toHaveBeenCalled();
  });

  it("creates them first when the confirmed save changes no schema", async () => {
    const order: string[] = [];
    const confirmation = confirmationStub(preview({ hasChanges: false }));
    const { result } = setup({
      confirmation,
      fieldGroupsFirst: {
        creates: [HERO],
        create: vi.fn(async () => {
          order.push("create the field groups");
          return null;
        }),
      },
      onNoChanges: vi.fn(() => {
        order.push("save the host");
      }),
    });

    await act(async () => result.current.confirmApply({}, []));

    await waitFor(() =>
      expect(order).toEqual(["create the field groups", "save the host"])
    );
  });

  it("lets go of the host's unused ones once the save has landed", async () => {
    const letGoUnused = vi.fn();
    const confirmation = confirmationStub(preview());
    const { result, onApplied } = setup({
      confirmation,
      fieldGroupsFirst: {
        creates: [HERO],
        create: vi.fn(async () => null),
        letGoUnused,
      },
    });

    await act(async () => result.current.confirmApply({}, []));

    await waitFor(() => expect(letGoUnused).toHaveBeenCalledTimes(1));
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("keeps them when the save is refused", async () => {
    const letGoUnused = vi.fn();
    const confirmation = confirmationStub(preview());
    const { result } = setup({
      confirmation,
      applyFn: vi.fn(async () => ({ success: false, message: "Refused." })),
      fieldGroupsFirst: {
        creates: [],
        create: vi.fn(async () => null),
        letGoUnused,
      },
    });

    await act(async () => result.current.confirmApply({}, []));

    await waitFor(() => expect(confirmation.endApply).toHaveBeenCalledTimes(1));
    expect(letGoUnused).not.toHaveBeenCalled();
  });

  it("keeps them through a save with nothing to review, whose write lands later", async () => {
    const letGoUnused = vi.fn();
    const { result, onNoChanges } = setup({
      previewFn: vi.fn(() => Promise.resolve(preview({ hasChanges: false }))),
      fieldGroupsFirst: {
        creates: [],
        create: vi.fn(async () => null),
        letGoUnused,
      },
    });

    await act(async () => result.current.handleSave());

    expect(onNoChanges).toHaveBeenCalledTimes(1);
    expect(letGoUnused).not.toHaveBeenCalled();
  });
});

describe("the settings a review shows", () => {
  it("are those its preview was made with, not ones changed while it was on its way", async () => {
    const RENAMED: SettingChange = {
      key: "singularName",
      label: "name",
      from: "Post",
      to: "Article",
    };
    const unchanged = preview({ hasChanges: false });
    let changes: SettingChange[] = [RENAMED];
    const confirmation = confirmationStub(unchanged);
    const { result, rerender } = setup({
      confirmation,
      previewFn: vi.fn(() => Promise.resolve(unchanged)),
      settingChanges: () => changes,
    });
    await act(async () => {
      result.current.handleSave();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(confirmation.request).toHaveBeenCalledWith(unchanged)
    );
    changes = [{ ...RENAMED, to: "Story" }];
    rerender();
    expect(result.current.reviewedSettingChanges).toEqual([RENAMED]);
  });
});
