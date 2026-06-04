import { describe, expect, it } from "vitest";

import { getColumnDescriptor } from "../field-column-descriptor";

describe("getColumnDescriptor — toggle", () => {
  it("maps a toggle field to a boolean column (Postgres)", () => {
    const desc = getColumnDescriptor(
      { name: "is_active", type: "toggle" } as never,
      "postgresql"
    );
    expect(desc?.dialectType).toBe("bool");
  });
});
