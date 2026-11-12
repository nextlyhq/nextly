// @vitest-environment jsdom
/**
 * The sidebar's menu stays kept on the device when the schema version moves
 * while the page is open. The move discards what was kept under the old
 * version, and a change to a field alone leaves the menu as drawn exactly as
 * it was, so nothing about the menu itself says to keep it again: the
 * relabelling has to.
 *
 * The twin case, a menu that is not drawn yet, keeps nothing either way, so
 * the menu seen after the move is the one written again, not one left over.
 */
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  confirmLabels,
  noteRememberedSchemaVersion,
  recallMenu,
  resetDeviceMemoryForTests,
} from "@admin/lib/device-memory/device-memory";
import type { ApiCollection } from "@admin/types/entities";

import { KeepSidebarMenu } from "../lib/remembered-menu";
import type { MainMenuItem } from "../sidebar-types";

const POSTS = { name: "posts", label: "Posts" } as ApiCollection;

vi.mock("@admin/hooks/useSidebarContentLists", () => ({
  useSidebarCollectionList: () => ({
    data: { items: [POSTS] },
    items: [POSTS],
  }),
  useSidebarSingleList: () => ({ hasArrived: false, items: [] }),
}));

const RAIL: MainMenuItem[] = [
  { id: "dashboard", label: "Dashboard", icon: () => null, href: "/admin" },
];

function keep(settled: boolean) {
  return (
    <KeepSidebarMenu
      settled={settled}
      items={RAIL}
      hrefOf={item => item.href}
      standalonePlugins={[]}
      parts={{ collections: true, singles: false }}
    />
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetDeviceMemoryForTests();
  confirmLabels({ user: "u1", schemaVersion: "3", permissionVersion: "p" });
});

describe("the kept menu when the schema version moves", () => {
  it("is kept again under the new version", () => {
    render(keep(true));
    expect(recallMenu()?.collections).toEqual([
      { slug: "posts", label: "Posts" },
    ]);

    act(() => noteRememberedSchemaVersion("4"));

    expect(recallMenu()?.collections).toEqual([
      { slug: "posts", label: "Posts" },
    ]);
  });

  it("is not kept while the rail has not settled", () => {
    render(keep(false));
    act(() => noteRememberedSchemaVersion("4"));
    expect(recallMenu()).toBeUndefined();
  });
});
