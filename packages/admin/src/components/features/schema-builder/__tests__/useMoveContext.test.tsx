/**
 * What the page tells the move rule about the field groups an entity uses: every user of each, read
 * through field groups so one using it through another comes with that one, whether the reader may
 * read every user, and, while that list is not there or could not be read, that it is not there.
 * And for a field group's own row, the field it stands for. A plausible broken page reads the
 * direct list (no `via`, no Single through a second field group), takes a missing answer for "used
 * nowhere", or names the field placing the field group in place of the row's own field.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { protectedApi } from "@admin/lib/api/protectedApi";
import { buildOutline } from "@admin/lib/builder/outline/outline-model";

import {
  nestedFixtureFieldGroups,
  nestedFixtureFields,
} from "../__fixtures__/nested-fixture";
import type { BuilderConfig } from "../builder-config";
import { useMoveContext } from "../useMoveContext";

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: vi.fn() },
}));

const config: BuilderConfig = {
  kind: "collection",
  basicsFields: [],
  advancedFields: [],
  toolbar: { previewSchemaChange: true },
  picker: {},
};

/** The users of the fixture's field group: c1, c2, the field group b, and the Single s through b. */
const USES = [
  { entityType: "collection", entitySlug: "c1", fieldPath: "seo" },
  { entityType: "collection", entitySlug: "c2", fieldPath: "seo" },
  { entityType: "fieldGroup", entitySlug: "b", fieldPath: "card" },
  { entityType: "single", entitySlug: "s", fieldPath: "frame", via: ["b"] },
];

function render() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const fields = nestedFixtureFields();
  const outline = buildOutline(fields, {
    entityReadOnly: false,
    fieldGroups: nestedFixtureFieldGroups(),
  });
  const { result } = renderHook(
    () =>
      useMoveContext({
        config,
        locked: false,
        fields,
        saved: fields,
        lifecycleEnabled: false,
        outline,
      }),
    { wrapper }
  );
  return { result, client };
}

const get = vi.mocked(protectedApi.get);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useMoveContext's field groups", () => {
  it("reads each used field group's users through field groups, and says whether that is all", async () => {
    get.mockImplementation(async (path: string) => {
      if (path === "/field-groups/seo/used-by?through=field-groups") {
        return { items: USES, meta: { total: 4, complete: false } };
      }
      return { items: [], meta: { total: 0, complete: true } };
    });
    const { result } = render();

    await waitFor(() =>
      expect(result.current.describeFieldGroup?.("seo")?.uses).not.toBeNull()
    );
    expect(result.current.describeFieldGroup?.("seo")).toEqual({
      uses: USES,
      complete: false,
    });
    // Only the read through field groups, never the direct list alone.
    expect(get.mock.calls.map(([path]) => path)).toContain(
      "/field-groups/seo/used-by?through=field-groups"
    );
    expect(get.mock.calls.map(([path]) => path)).not.toContain(
      "/field-groups/seo/used-by"
    );
  });

  it("says the users are not there while their read is pending, and after it fails", async () => {
    // Every read held until the test fails them all: the fixture uses a second field group too.
    const pending: ((reason: Error) => void)[] = [];
    const fail = (reason: Error) => pending.forEach(reject => reject(reason));
    get.mockImplementation(
      () =>
        new Promise((_, reject) => {
          pending.push(reject);
        })
    );
    const { result, client } = render();

    expect(result.current.describeFieldGroup?.("seo")).toEqual({
      uses: null,
      complete: false,
    });
    await waitFor(() => expect(get).toHaveBeenCalled());
    fail(new Error("the read failed"));
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .getAll()
          .every(query => query.state.status === "error")
      ).toBe(true)
    );
    expect(result.current.describeFieldGroup?.("seo")).toEqual({
      uses: null,
      complete: false,
    });
  });

  it("describes no field group the entity does not use", () => {
    get.mockResolvedValue({ items: [], meta: { total: 0, complete: true } });
    const { result } = render();
    expect(result.current.describeFieldGroup?.("unused")).toBeUndefined();
  });

  it("gives a field group's own row its own field, and the field placing the field group", () => {
    get.mockResolvedValue({ items: [], meta: { total: 0, complete: true } });
    const { result } = render();
    expect(result.current.fieldOfRow?.("f-seo/meta_title")?.name).toBe(
      "meta_title"
    );
    expect(
      result.current.fieldGroupFieldHolding?.("f-seo/meta_title")?.name
    ).toBe("seo");
  });
});
