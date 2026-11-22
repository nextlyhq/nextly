/**
 * The status pill sits beside the title, and the sticky bar takes it over
 * only while the title is scrolled out of view, so the status is on screen
 * exactly once. A bar with no title handing it the pill (a Single's) keeps
 * its own.
 */
import { act } from "@testing-library/react";
import { useForm, FormProvider } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { DocumentTitleBlock } from "../DocumentTitleBlock";
import { TitlePillProvider } from "../title-in-view";

import { BarUnderTest } from "./bar-under-test";

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

/** The observers made, so a test can say the title left or came back. */
let observers: { callback: IntersectionObserverCallback; target?: Element }[] =
  [];

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private readonly record: (typeof observers)[number];
      constructor(callback: IntersectionObserverCallback) {
        this.record = { callback };
        observers.push(this.record);
      }
      observe(target: Element) {
        this.record.target = target;
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function scrollTitle(inView: boolean) {
  act(() => {
    for (const { callback, target } of observers) {
      callback(
        [{ isIntersecting: inView, target } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    }
  });
}

const STATUS = { status: "published", hasWorkingDraft: false };

function Editor({ provided = true }: { provided?: boolean }) {
  const methods = useForm({ defaultValues: { title: "Pricing" } });
  const page = (
    <FormProvider {...methods}>
      <div data-testid="bar">
        <BarUnderTest
          mode="edit"
          hasStatus
          entry={{ id: "e1", status: "published" }}
          collectionSlug="pages"
          documentStatus={STATUS}
          onSaveDraft={vi.fn()}
          onPublish={vi.fn()}
          onSaveChanges={vi.fn()}
          onSaveWorkingDraft={vi.fn()}
          onUnpublish={vi.fn()}
          onDiscardWorkingDraft={vi.fn()}
        />
      </div>
      <div data-testid="title">
        <DocumentTitleBlock mode="edit" status={STATUS} />
      </div>
    </FormProvider>
  );
  return provided ? <TitlePillProvider>{page}</TitlePillProvider> : page;
}

const pills = () =>
  Array.from(document.querySelectorAll('[data-status="published"]'));

const inBar = () =>
  pills().filter(pill => screen.getByTestId("bar").contains(pill));
const byTitle = () =>
  pills().filter(pill => screen.getByTestId("title").contains(pill));

describe("the status pill, on screen once", () => {
  it("sits beside the title while the title is in view, and not in the bar", () => {
    render(<Editor />);
    expect(byTitle()).toHaveLength(1);
    expect(inBar()).toHaveLength(0);
  });

  it("is drawn in the bar only while the title is scrolled away", () => {
    render(<Editor />);
    // The title's own pill scrolls away with the title, off screen.
    scrollTitle(false);
    expect(inBar()).toHaveLength(1);
    scrollTitle(true);
    expect(inBar()).toHaveLength(0);
    expect(byTitle()).toHaveLength(1);
  });

  it("stays in the bar where no title takes it over, as on a Single", () => {
    render(<Editor provided={false} />);
    expect(inBar()).toHaveLength(1);
    expect(byTitle()).toHaveLength(0);
  });
});
