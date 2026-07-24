import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  AttemptOutcomeBadge,
  DeliveryStatusBadge,
  describeResource,
  formatDeliveryTimestamp,
  formatLatency,
  formatStatusCode,
} from "./deliveryStatus";

describe("DeliveryStatusBadge", () => {
  it("renders the human label for each known status", () => {
    const { rerender } = render(<DeliveryStatusBadge status="delivered" />);
    expect(screen.getByText("Delivered")).toBeInTheDocument();
    rerender(<DeliveryStatusBadge status="retrying" />);
    expect(screen.getByText("Retrying")).toBeInTheDocument();
    rerender(<DeliveryStatusBadge status="failed" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("falls back to the raw value for an unknown status", () => {
    // @ts-expect-error deliberately exercising an out-of-set value
    render(<DeliveryStatusBadge status="quarantined" />);
    expect(screen.getByText("quarantined")).toBeInTheDocument();
  });
});

describe("AttemptOutcomeBadge", () => {
  it("shows the raw outcome text", () => {
    render(<AttemptOutcomeBadge outcome="abandoned" />);
    expect(screen.getByText("abandoned")).toBeInTheDocument();
  });
});

describe("formatting helpers", () => {
  it("renders a placeholder for a null timestamp and echoes an unparseable one", () => {
    expect(formatDeliveryTimestamp(null)).toBe("-");
    expect(formatDeliveryTimestamp("not-a-date")).toBe("not-a-date");
  });

  it("formats status codes and latency, with placeholders for absent values", () => {
    expect(formatStatusCode(200)).toBe("200");
    expect(formatStatusCode(null)).toBe("-");
    expect(formatLatency(42)).toBe("42ms");
    expect(formatLatency(null)).toBe("-");
    expect(formatLatency(undefined)).toBe("-");
  });

  it("describes a resource with collection, id, and locale", () => {
    expect(
      describeResource({
        kind: "entry",
        collection: "posts",
        id: "abc",
        locale: "fr",
      })
    ).toBe("posts · abc (fr)");
    expect(
      describeResource({
        kind: "media",
        collection: null,
        id: null,
        locale: null,
      })
    ).toBe("media");
  });
});
