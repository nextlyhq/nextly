/**
 * One recovery point, one age.
 *
 * The recovery offer and the save indicator both say how long ago the same
 * recovery point was stored. What this pins is that they say it in the same
 * words: two formatters already disagreed, one saying "moments ago" where the
 * other said "just now", and weeks against days for an older point.
 */
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { AutosaveRecoveryBanner } from "../AutosaveRecoveryBanner";
import { saveIndicatorView } from "../SaveStateIndicator";

const ages = [
  ["a few seconds", 20 * 1000],
  ["ten days", 10 * 24 * 60 * 60 * 1000],
] as const;

describe("a recovery point's age", () => {
  it.each(ages)(
    "reads the same in the offer and the indicator, %s on",
    (_label, ago) => {
      const savedAt = new Date(Date.now() - ago);
      render(
        <AutosaveRecoveryBanner
          savedAt={savedAt}
          onRestore={() => {}}
          onDismiss={() => {}}
        />
      );
      const indicator = saveIndicatorView(
        { kind: "unsaved" },
        { enabled: true, storedAt: savedAt, pendingOfferAt: null }
      );
      // The indicator's line names the age after "stored".
      const detail =
        indicator !== null && "detail" in indicator ? indicator.detail : null;
      const age = /stored (.+?)\./.exec(detail ?? "")?.[1];

      expect(age).toBeDefined();
      expect(screen.getByRole("status").textContent).toContain(age);
    }
  );
});
