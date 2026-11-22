import { describe, it, expect } from "vitest";

import { eventChangedFields } from "../record-mutation-event";

// The event names a field by its content: the component rows the schema
// declares are compared without their own stamps, while a JSON value keeps
// every key it holds, one called `updated_at` included.
describe("eventChangedFields", () => {
  const fields = [
    { name: "metadata", type: "json" },
    {
      name: "profile",
      type: "component",
      fields: [{ name: "heading", type: "text" }],
    },
  ];

  it("names a JSON field whose updated_at key changed", () => {
    expect(
      eventChangedFields({
        previous: {
          metadata: { updated_at: "a" },
          profile: { id: "p1", heading: "A" },
        },
        data: {
          metadata: { updated_at: "b" },
          profile: { id: "p1", heading: "A" },
        },
        fields,
      })
    ).toEqual(["metadata"]);
  });

  it("does not name a component row that was only stamped anew", () => {
    expect(
      eventChangedFields({
        previous: {
          metadata: { a: 1 },
          profile: { id: "p1", heading: "A", updated_at: "t1" },
        },
        data: {
          metadata: { a: 1 },
          profile: { id: "p1", heading: "A", updated_at: "t2" },
        },
        fields,
      })
    ).toEqual([]);
  });
});
