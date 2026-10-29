/**
 * A setting drawn by its own editor in the settings sheet: the component its
 * widget names in `editor`, handed the setting's value, a change callback and
 * the card's other settings, in place of the setting's own field; a change it
 * makes is saved with the rest on Done. An editor the site did not register
 * says so in its place.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnyWidgetSetting } from "nextly/config";
import type { SettingEditorProps } from "nextly/widget-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerComponent,
  unregisterComponent,
} from "@admin/lib/plugins/component-registry";

import { WidgetSettingsSheet } from "../WidgetSettingsSheet";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ widgetSources: [] }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));

const EDITOR = "@acme/goals/admin#GoalEditor";

/** Shows what it was handed, and doubles the goal on a click. */
function GoalEditor({
  label,
  value,
  onChange,
  settings,
}: SettingEditorProps<number>) {
  return (
    <div>
      <p>
        {label}: {value} for {String(settings.title)}
      </p>
      <button type="button" onClick={() => onChange((value ?? 0) * 2)}>
        Double
      </button>
    </div>
  );
}

const declared: AnyWidgetSetting[] = [
  { name: "title", type: "text", label: "Title", defaultValue: "" },
  {
    name: "goal",
    type: "number",
    label: "Goal",
    defaultValue: 10,
    editor: { component: EDITOR },
  },
];

function open(config: Record<string, unknown>) {
  const onSave = vi.fn();
  render(
    <WidgetSettingsSheet
      open
      onOpenChange={() => {}}
      title="Goal"
      settings={declared}
      config={config}
      onDone={onSave}
    />
  );
  return onSave;
}

beforeEach(() => {
  registerComponent(EDITOR, GoalEditor as never);
});
afterEach(() => {
  unregisterComponent(EDITOR);
});

describe("a setting with its own editor", () => {
  it("is drawn by it, with its value and the other settings, and its change is saved", async () => {
    const onSave = open({ title: "Q4", goal: 25 });

    // The editor in place of the setting's own number field.
    expect(screen.getByText("Goal: 25 for Q4")).toBeTruthy();
    expect(screen.queryByRole("spinbutton", { name: /Goal/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Double" }));
    expect(screen.getByText("Goal: 50 for Q4")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls.at(-1)?.[0]).toMatchObject({ goal: 50 });
  });

  it("says it cannot be changed here when its editor was never registered", () => {
    unregisterComponent(EDITOR);
    open({ title: "Q4", goal: 25 });
    expect(
      screen.getByText(
        "Goal can't be changed here: its editor isn't available."
      )
    ).toBeTruthy();
  });
});
