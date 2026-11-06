/**
 * "Resume setup": offered from what `GET /api/dashboard/setup` answers, asked
 * only for a super-admin, and pressed, the `PUT` that un-dismisses the card
 * and the reads asked again after it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestQueryClient,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@admin/__tests__/utils";

// The route, as the hook reaches it.
const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get, put },
}));
const access = vi.hoisted(() => ({ isSuperAdmin: true }));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => access,
}));

import { useSetupResume } from "../setup/useSetupResume";

import { ResumeSetupLink } from "./ResumeSetupLink";

/** The header's use of the two: the control, drawn while resumable. */
function Offer() {
  const resume = useSetupResume();
  return resume.resumable ? <ResumeSetupLink resume={resume} /> : null;
}

const answer = (resumable: boolean) => ({
  collapsed: false,
  dismissed: resumable,
  skipped: [],
  resumable,
});

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  access.isSuperAdmin = true;
});

describe("Resume setup", () => {
  it("is offered while the route answers resumable", async () => {
    get.mockResolvedValue(answer(true));
    render(<Offer />);
    expect(
      await screen.findByRole("button", { name: "Resume setup" })
    ).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/dashboard/setup");
  });

  it("is not offered when the route answers not resumable", async () => {
    get.mockResolvedValue(answer(false));
    render(<Offer />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Resume setup" })).toBeNull();
  });

  it("asks nothing for a reader who is not a super-admin, whom the route refuses", () => {
    access.isSuperAdmin = false;
    get.mockResolvedValue(answer(true));
    render(<Offer />);
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Resume setup" })).toBeNull();
  });

  it("un-dismisses the card when pressed, then asks again for the layout and for itself", async () => {
    get.mockResolvedValueOnce(answer(true)).mockResolvedValue(answer(false));
    put.mockResolvedValue({ message: "Saved.", item: answer(false) });
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    render(<Offer />, { queryClient });

    fireEvent.click(
      await screen.findByRole("button", { name: "Resume setup" })
    );

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/dashboard/setup", { dismissed: false })
    );
    // The layout read draws the card again; this read then says it is back.
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["dashboard", "layout"],
      })
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["dashboard", "setup"],
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Resume setup" })).toBeNull()
    );
  });

  it("stays offered and says so when the write fails", async () => {
    get.mockResolvedValue(answer(true));
    put.mockRejectedValue(new Error("network"));
    render(<Offer />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Resume setup" })
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "could not resume, try again"
    );
    expect(
      screen.getByRole("button", { name: "Resume setup" })
    ).not.toBeDisabled();
  });
});
