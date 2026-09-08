/**
 * The version body renders the snapshot from the version's FULL value map,
 * inside contexts that cannot reach the live document.
 *
 * Two contracts one render cannot show: the layout is a SUBSET of what the
 * version stored (takeover filtering omits condition controllers, and the
 * snapshot's form still needs their values), and translation mode's
 * source-fill affordance must not survive into an area whose contents are
 * frozen. Both are asserted through what the snapshot form actually received.
 */
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { TranslationFieldProvider } from "@admin/components/features/entries/TranslationMode/TranslationFieldContext";
import { useTranslationField } from "@admin/components/features/entries/TranslationMode/TranslationFieldContext";
import { DocumentHistoryContext } from "@admin/components/features/versions/document-history-context";
import type { ViewedVersion } from "@admin/components/features/versions/document-history-context";

const { snapshotProps } = vi.hoisted(() => ({
  snapshotProps: {
    current: null as {
      fields?: unknown[];
      values?: Record<string, unknown>;
      source?: Record<string, unknown>;
    } | null,
  },
}));

vi.mock("@admin/components/features/versions/VersionSnapshotForm", () => ({
  VersionSnapshotForm: (props: {
    fields?: unknown[];
    values?: Record<string, unknown>;
  }) => {
    // The source-fill context is read INSIDE the snapshot, where a field
    // would read it: whatever lands here is what its affordances would use.
    const source = useTranslationField();
    snapshotProps.current = {
      fields: props.fields,
      values: props.values,
      source: { ...source },
    };
    return <div data-testid="snapshot-form" />;
  },
}));

import { ViewedVersionBody } from "../viewed-version-host";
import type { FieldConfig } from "nextly/config";

const viewing: ViewedVersion = {
  versionNo: 4,
  snapshot: { title: "as it was", mode: "read" },
  locale: null,
  isLoading: false,
  error: null,
};

const historyValue = {
  viewing,
  setViewing: () => {},
  restore: null,
  setRestore: () => {},
};

function renderBody(overrides?: {
  fields?: FieldConfig[];
  values?: Record<string, unknown>;
}) {
  return render(
    <DocumentHistoryContext.Provider value={historyValue}>
      <ViewedVersionBody
        fields={overrides?.fields ?? [{ name: "title", type: "text" }]}
        values={overrides?.values ?? { title: "as it was", mode: "read" }}
      >
        <input aria-label="Live field" />
      </ViewedVersionBody>
    </DocumentHistoryContext.Provider>
  );
}

describe("ViewedVersionBody — the snapshot's inputs and inherited context", () => {
  it("builds the snapshot form from the full value map, not the rendered subset", () => {
    // The rendered layout omits the takeover controller; the form must still
    // receive its value, or the version's own conditional fields are judged
    // against values it never had.
    renderBody();

    expect(snapshotProps.current?.values).toEqual({
      title: "as it was",
      mode: "read",
    });
    expect(
      (snapshotProps.current?.fields as unknown[]).some(f => f === "mode")
    ).toBe(false);
  });

  it("clears the translation-source context inside the snapshot", () => {
    // History opened from inside translation mode inherits the mode's
    // context; an inherited source would put a write into the frozen version.
    render(
      <TranslationFieldProvider
        value={{ sourceValues: { title: "EN" }, sourceLabel: "English" }}
      >
        <DocumentHistoryContext.Provider value={historyValue}>
          <ViewedVersionBody
            fields={[{ name: "title", type: "text" }]}
            values={{ title: "as it was" }}
          >
            <input aria-label="Live field" />
          </ViewedVersionBody>
        </DocumentHistoryContext.Provider>
      </TranslationFieldProvider>
    );

    expect(snapshotProps.current?.source).toEqual({});
  });

  it("hides the live body while keeping it mounted", () => {
    renderBody();

    expect(screen.getByLabelText("Live field")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Live field").closest("[aria-hidden='true']")
    ).not.toBeNull();
  });
});
