/**
 * The document panel sticks under the document bar, so it has to know how
 * tall the bar really is: one row usually, two when a feature's wide control
 * or a narrow editor wraps it. The bar measures itself and publishes its
 * height on the editor's frame, and the panel's offset and height read it.
 *
 * jsdom lays nothing out, so the measurement is handed in through a stand-in
 * `ResizeObserver`, which is the browser's own way of reporting it.
 */
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import {
  DOCUMENT_PANEL_STICKY,
  DocumentEditorLayout,
} from "../DocumentEditorLayout";

import { BarUnderTest as DocumentBar } from "./bar-under-test";

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

/** What the stand-in observer was given, so a test can report a size. */
const observed = vi.hoisted(() => ({
  callbacks: [] as ResizeObserverCallback[],
  targets: [] as Element[],
  disconnected: 0,
}));

class ReportingObserver {
  constructor(callback: ResizeObserverCallback) {
    observed.callbacks.push(callback);
  }
  observe(target: Element) {
    observed.targets.push(target);
  }
  unobserve() {}
  disconnect() {
    observed.disconnected += 1;
  }
}

/** Reports a border-box height for everything observed. */
function report(height: number) {
  const entries = observed.targets.map(
    target =>
      ({
        target,
        borderBoxSize: [{ blockSize: height, inlineSize: 600 }],
      }) as unknown as ResizeObserverEntry
  );
  for (const callback of observed.callbacks) {
    callback(entries, {} as ResizeObserver);
  }
}

function Editor({ children }: { children?: ReactNode }) {
  const methods = useForm({ defaultValues: { title: "" } });
  return (
    <FormProvider {...methods}>
      <DocumentEditorLayout
        bar={
          <DocumentBar
            mode="edit"
            hasStatus={false}
            isDirty={false}
            isSubmitting={false}
            entry={{ id: "e1", status: "draft" }}
            collectionSlug="posts"
            onSaveDraft={vi.fn()}
            onPublish={vi.fn()}
            onSaveChanges={vi.fn()}
          />
        }
        banners={null}
      >
        {children ?? (
          <div data-testid="panel" className={DOCUMENT_PANEL_STICKY} />
        )}
      </DocumentEditorLayout>
    </FormProvider>
  );
}

beforeEach(() => {
  observed.callbacks = [];
  observed.targets = [];
  observed.disconnected = 0;
  vi.stubGlobal("ResizeObserver", ReportingObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the document bar's height", () => {
  it("is measured from the bar itself and published on the editor's frame", () => {
    render(<Editor />);
    const bar = screen.getByTestId("document-bar");
    expect(observed.targets).toContain(bar);

    // A bar wrapped to two rows.
    report(104);
    const panel = screen.getByTestId("panel");
    // Read where the panel inherits it from: an ancestor of the panel.
    let carrier: HTMLElement | null = panel.parentElement;
    while (
      carrier &&
      carrier.style.getPropertyValue("--document-bar-height") === ""
    ) {
      carrier = carrier.parentElement;
    }
    expect(carrier?.style.getPropertyValue("--document-bar-height")).toBe(
      "104px"
    );
    expect(carrier?.contains(bar)).toBe(true);

    // Back to one row.
    report(53);
    expect(carrier?.style.getPropertyValue("--document-bar-height")).toBe(
      "53px"
    );
  });

  it("is what the panel sticks under and is shortened by, one row's height until it is measured", () => {
    // jsdom evaluates no CSS, so this reads the classes: the offset and the
    // height both come from the published height, with the one-row height
    // (3.25rem) as the fallback before the first measurement.
    expect(DOCUMENT_PANEL_STICKY).toContain(
      "@4xl/content:top-[var(--document-bar-height,3.25rem)]"
    );
    expect(DOCUMENT_PANEL_STICKY).toMatch(
      /@4xl\/content:h-\[calc\(.*-var\(--document-bar-height,3\.25rem\)\)\]/
    );
    expect(DOCUMENT_PANEL_STICKY).not.toMatch(/top-13|-3\.25rem\)/);
  });

  it("is withdrawn, and no longer watched, once the bar is gone", () => {
    const { unmount } = render(<Editor />);
    report(104);
    unmount();
    expect(observed.disconnected).toBeGreaterThan(0);
  });
});
