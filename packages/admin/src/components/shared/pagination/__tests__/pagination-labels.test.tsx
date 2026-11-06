// @vitest-environment jsdom

/**
 * The names the pagination's controls are announced by, in English as they
 * always were and in the interface language when the admin has its catalog.
 *
 * Both layouts are rendered: every page numbered when they fit, and the
 * shortened one with the first and last page beside an ellipsis, whose page
 * buttons take the first- and last-page names.
 *
 * @module components/shared/pagination/__tests__/pagination-labels.test
 */
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@admin/lib/i18n/I18nProvider";
import { BUILT_IN_CATALOGS } from "@admin/lib/i18n/translate";

import { Pagination } from "../index";

afterEach(cleanup);

const french = {
  ...BUILT_IN_CATALOGS,
  fr: {
    "nextly.pagination.label": "Navigation des pages",
    "nextly.pagination.first": "Aller à la première page",
    "nextly.pagination.previous": "Aller à la page précédente",
    "nextly.pagination.next": "Aller à la page suivante",
    "nextly.pagination.last": "Aller à la dernière page",
    "nextly.pagination.page": "Aller à la page {page}",
  },
};

const fitting = {
  currentPage: 0,
  totalPages: 3,
  pageSize: 20,
  onPageChange: () => undefined,
};

// Ten pages from the sixth: the first and last page sit beside ellipses.
const shortened = { ...fitting, currentPage: 5, totalPages: 10 };

const button = (name: string) => screen.getAllByRole("button", { name });

describe("the pagination's control names", () => {
  it("read as they always have in English", () => {
    render(<Pagination {...fitting} />);

    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeTruthy();
    expect(button("Go to first page")).toHaveLength(1);
    expect(button("Go to previous page")).toHaveLength(1);
    expect(button("Go to next page")).toHaveLength(1);
    expect(button("Go to last page")).toHaveLength(1);
    expect(button("Go to page 1")).toHaveLength(1);
    expect(button("Go to page 3")).toHaveLength(1);
  });

  it("read as they always have in English, shortened", () => {
    render(<Pagination {...shortened} />);

    expect(button("Go to first page")).toHaveLength(2);
    expect(button("Go to last page")).toHaveLength(2);
    expect(button("Go to page 6")).toHaveLength(1);
  });

  it("read in the interface language when the admin has its catalog", () => {
    render(
      <I18nProvider interfaceLanguage="fr" catalogs={french}>
        <Pagination {...fitting} />
      </I18nProvider>
    );

    expect(
      screen.getByRole("navigation", { name: "Navigation des pages" })
    ).toBeTruthy();
    expect(button("Aller à la première page")).toHaveLength(1);
    expect(button("Aller à la page précédente")).toHaveLength(1);
    expect(button("Aller à la page suivante")).toHaveLength(1);
    expect(button("Aller à la dernière page")).toHaveLength(1);
    expect(button("Aller à la page 1")).toHaveLength(1);
    expect(button("Aller à la page 3")).toHaveLength(1);
  });

  it("read in the interface language when the admin has its catalog, shortened", () => {
    render(
      <I18nProvider interfaceLanguage="fr" catalogs={french}>
        <Pagination {...shortened} />
      </I18nProvider>
    );

    expect(button("Aller à la première page")).toHaveLength(2);
    expect(button("Aller à la dernière page")).toHaveLength(2);
    expect(button("Aller à la page 6")).toHaveLength(1);
  });

  it("shows a caller's own navigation name as given, in any interface language", () => {
    render(
      <I18nProvider interfaceLanguage="fr" catalogs={french}>
        <Pagination {...fitting} ariaLabel="Deliveries pages" />
      </I18nProvider>
    );

    expect(
      screen.getByRole("navigation", { name: "Deliveries pages" })
    ).toBeTruthy();
  });
});
