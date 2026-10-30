/**
 * DateInput in a zone west of UTC: a day, a month or a time of day is saved in
 * UTC and shown in UTC, so it reopens as it was saved. Read in local time, a
 * day saved as UTC midnight showed the day before in Los Angeles, and the next
 * edit saved that earlier day.
 */
import type { DateFieldConfig } from "nextly/config";
import { useForm, FormProvider } from "react-hook-form";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fireEvent, render } from "@admin/__tests__/utils";

import { DateInput } from "../DateInput";

const zone = process.env.TZ;
beforeAll(() => {
  // Node reads TZ when a date is formatted, so this applies to the tests below.
  process.env.TZ = "America/Los_Angeles";
});
afterAll(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

let saved: unknown;

function Harness({
  appearance,
  value,
}: {
  appearance?: NonNullable<DateFieldConfig["admin"]>["date"] extends infer D
    ? D extends { pickerAppearance?: infer A }
      ? A
      : never
    : never;
  value: string | null;
}) {
  const methods = useForm({ defaultValues: { when: value } });
  saved = methods.watch("when");
  const field: DateFieldConfig = {
    type: "date",
    name: "when",
    ...(appearance === undefined
      ? {}
      : { admin: { date: { pickerAppearance: appearance } } }),
  };
  return (
    <FormProvider {...methods}>
      <DateInput name="when" field={field} control={methods.control} />
    </FormProvider>
  );
}

function input(container: HTMLElement): HTMLInputElement {
  const found = container.querySelector("input");
  if (found === null) throw new Error("no input drawn");
  return found;
}

describe("DateInput west of UTC", () => {
  it("runs in a zone behind UTC", () => {
    // The control: without it, a test run in UTC would pass for the wrong reason.
    expect(new Date("2025-01-01T00:00:00.000Z").getDate()).toBe(31);
  });

  it("shows a saved day as that day, and saves a picked day as that day", () => {
    const { container, rerender } = render(
      <Harness value="2025-01-01T00:00:00.000Z" />
    );
    expect(input(container).value).toBe("2025-01-01");

    fireEvent.change(input(container), { target: { value: "2025-03-15" } });
    expect(saved).toBe("2025-03-15T00:00:00.000Z");
    rerender(<Harness value="2025-03-15T00:00:00.000Z" />);
    expect(input(container).value).toBe("2025-03-15");
  });

  it("shows a month and a time of day as they were saved", () => {
    const month = render(
      <Harness appearance="monthOnly" value="2025-01-01T00:00:00.000Z" />
    );
    expect(input(month.container).value).toBe("2025-01");
    const time = render(
      <Harness appearance="timeOnly" value="1970-01-01T09:30:00.000Z" />
    );
    expect(input(time.container).value).toBe("09:30");
  });

  it("still shows a date and time in the reader's own zone", () => {
    const { container } = render(
      <Harness appearance="dayAndTime" value="2025-01-01T20:00:00.000Z" />
    );
    // 20:00 UTC is noon in Los Angeles in January.
    expect(input(container).value).toBe("2025-01-01T12:00");
  });
});
