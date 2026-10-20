/**
 * A release's page tells its reader how many of its documents they cannot
 * view, and never reads as empty, or smaller, because of them.
 *
 * The server names only the documents the reader may read and counts the
 * rest by collection; the page shows that count beside the contents.
 *
 * @module components/features/releases/__tests__/ReleaseDetail.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render } from "@admin/__tests__/utils";

const { releaseMock, membersMock } = vi.hoisted(() => ({
  releaseMock: vi.fn(),
  membersMock: vi.fn(),
}));

const idle = {
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
  reset: vi.fn(),
};

vi.mock("@admin/hooks/queries/useReleases", () => ({
  useRelease: (...args: unknown[]) => releaseMock(...args),
  useReleaseMembers: (...args: unknown[]) => membersMock(...args),
  useRemoveReleaseMember: () => idle,
  useCancelRelease: () => idle,
  useScheduleRelease: () => idle,
  useReleaseBlockers: () => ({
    data: { items: [], meta: { total: 0, hasNext: false } },
    isPending: false,
    isFetching: false,
    isError: false,
  }),
}));

import { ReleaseDetail } from "../ReleaseDetail";

const RELEASE = {
  id: "r1",
  title: "Autumn launch",
  description: null,
  scheduledAt: null,
  timezone: null,
  state: "draft",
  publishedAt: null,
  can: { removeMember: true },
};

const MEMBER = {
  id: "m1",
  releaseId: "r1",
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId: "e1",
  locale: null,
  action: "publish",
  createdBy: "u1",
  createdAt: "2026-10-20T09:00:00Z",
};

/** The members read, answered as the server does. */
function members(items: unknown[], hidden?: unknown[]) {
  return {
    data: {
      items,
      meta: {
        total: items.length,
        hasNext: false,
        ...(hidden ? { hidden } : {}),
      },
    },
    isPending: false,
    isError: false,
  };
}

const text = () => document.body.textContent ?? "";

beforeEach(() => {
  releaseMock.mockReturnValue({
    data: RELEASE,
    isPending: false,
    isError: false,
  });
});

describe("a release holding documents its reader cannot view", () => {
  it("counts them beside the ones it names", () => {
    membersMock.mockReturnValue(
      members(
        [MEMBER],
        [{ scopeKind: "collection", scopeSlug: "secrets", count: 2 }]
      )
    );
    render(<ReleaseDetail id="r1" />);
    expect(text()).toMatch(/2 documents you can't view · secrets/);
    expect(text()).toMatch(/1 document go live/);
  });

  it("does not read as empty when every document is one they cannot view", () => {
    membersMock.mockReturnValue(
      members([], [{ scopeKind: "collection", scopeSlug: "secrets", count: 3 }])
    );
    render(<ReleaseDetail id="r1" />);
    expect(text()).not.toMatch(/nothing has been added/i);
    expect(text()).not.toMatch(/nothing in it yet/i);
    expect(text()).toMatch(/3 documents you can't view · secrets/);
  });

  it("still reads as empty when it is, which is the control", () => {
    membersMock.mockReturnValue(members([]));
    render(<ReleaseDetail id="r1" />);
    expect(text()).toMatch(/nothing has been added yet/i);
    expect(text()).not.toMatch(/you can't view/);
  });
});
