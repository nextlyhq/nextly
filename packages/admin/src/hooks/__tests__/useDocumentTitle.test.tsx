/**
 * Which item the tab names when more than one part of a screen offers one.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useAppName: () => "Golden Shop",
  useBranding: () => ({}),
}));

import { createTestQueryClient } from "@admin/__tests__/utils";
import { DocumentTitleProvider } from "@admin/context/providers/DocumentTitleProvider";
import { resolveRoute } from "@admin/lib/routing";

import { useDocumentTitle } from "../useDocumentTitle";

const ROLES_PATH = "/admin/security/roles";
const ROLES = resolveRoute(ROLES_PATH, "");

function Named({ name }: { name: string | undefined }) {
  useDocumentTitle(name);
  return null;
}

const client = createTestQueryClient();

function screen(outer: string | undefined, inner: string | undefined | null) {
  return (
    <QueryClientProvider client={client}>
      <DocumentTitleProvider route={ROLES} pathname={ROLES_PATH}>
        <Named name={outer} />
        {inner !== null && <Named name={inner} />}
      </DocumentTitleProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  document.title = "Host title";
});

describe("useDocumentTitle", () => {
  it("names the item of the part mounted last", () => {
    render(screen("Editor", "Author"));

    expect(document.title).toBe("Author · Roles · Golden Shop");
  });

  it("keeps the mount order when the earlier part is renamed", () => {
    const view = render(screen("Editor", "Author"));

    view.rerender(screen("Chief Editor", "Author"));

    expect(document.title).toBe("Author · Roles · Golden Shop");
  });

  it("falls back to the earlier part once the later one has no name or is gone", () => {
    const view = render(screen("Editor", "Author"));

    view.rerender(screen("Editor", undefined));
    expect(document.title).toBe("Editor · Roles · Golden Shop");

    view.rerender(screen("Editor", null));
    expect(document.title).toBe("Editor · Roles · Golden Shop");
  });

  it("does nothing outside the admin's title provider", () => {
    render(<Named name="Editor" />);

    expect(document.title).toBe("Host title");
  });
});
