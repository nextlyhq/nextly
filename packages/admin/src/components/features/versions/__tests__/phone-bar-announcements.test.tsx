/**
 * On a phone, history's changes are moved through from the bar at the bottom, where the wider
 * bar's Next and Previous are hidden. Its moves are said aloud as the wider bar's are: where the
 * person landed and what is there.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { VersionPhoneBar } from "../viewed-version-host";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [] }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));

function PhoneBar({ labels }: { labels: string[] }) {
  const [position, setPosition] = useState(0);
  return (
    <VersionPhoneBar
      actions={{ returnToCurrent: vi.fn() } as never}
      state={{
        kind: "ready",
        changed: labels.length,
        total: labels.length,
        incomplete: false,
        whenNone: "none" as never,
      }}
      changed={labels.length}
      position={position}
      currentLabel={labels[position]}
      onMove={delta =>
        setPosition(
          current => (current + delta + labels.length) % labels.length
        )
      }
    />
  );
}

describe("the phone bar", () => {
  it("says nothing until a move, then where the person is and what is there", async () => {
    render(<PhoneBar labels={["Title", "Views", "SEO › Meta title"]} />);
    expect(screen.getByRole("status")).toHaveTextContent("");

    await userEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Change 2 of 3: Views"
    );
  });
});
