"use client";

/**
 * Interim, throwaway theme picker for the founder to eyeball all 12 theme
 * lab variants against the real admin shell. It only swaps the `data-theme`
 * attribute the generated stylesheet is scoped to; layout/density switching
 * and tweakcn presets belong to the full harness that replaces this.
 */
import { useEffect, useState } from "react";

import { EXPECTED_CONTRAST_FAILURES, NEXTLY_THEMES } from "./themes";

const STORAGE_KEY = "nextly-theme-lab";
const DEFAULT_THEME_ID = "mono";
const KNOWN_THEME_IDS = new Set(NEXTLY_THEMES.map(theme => theme.id));

/** Shape persisted to localStorage under STORAGE_KEY. */
interface StoredSelection {
  theme: string;
}

function isStoredSelection(value: unknown): value is StoredSelection {
  return (
    typeof value === "object" &&
    value !== null &&
    "theme" in value &&
    typeof value.theme === "string"
  );
}

/**
 * Reads the persisted theme id, falling back to mono whenever the value is
 * missing, unparsable, or no longer a theme this build knows about. Landing
 * the admin with an unrecognized data-theme value would render it with none
 * of the required tokens set at all, which is worse than picking wrong.
 */
function readStoredThemeId(): string {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME_ID;
    const parsed: unknown = JSON.parse(raw);
    if (isStoredSelection(parsed) && KNOWN_THEME_IDS.has(parsed.theme)) {
      return parsed.theme;
    }
    return DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

function applyThemeId(themeId: string): void {
  const admin = document.querySelector(".nextly-admin");
  if (admin instanceof HTMLElement) {
    admin.setAttribute("data-theme", themeId);
  }
}

export function InterimThemeSwitcher() {
  // Start from the default on the server render and correct to the stored
  // value on mount, since localStorage only exists in the browser.
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME_ID);

  useEffect(() => {
    const stored = readStoredThemeId();
    setThemeId(stored);
    applyThemeId(stored);
  }, []);

  useEffect(() => {
    applyThemeId(themeId);

    // The admin shell remounts its root element between route navigations,
    // which drops the data-theme attribute this switcher just set (a plain
    // effect keyed on themeId only fires again if themeId itself changes).
    // A MutationObserver on document.body catches the remount as soon as the
    // new `.nextly-admin` node appears and reapplies the attribute, without
    // polling.
    const observer = new MutationObserver(() => {
      const admin = document.querySelector(".nextly-admin");
      if (
        admin instanceof HTMLElement &&
        admin.getAttribute("data-theme") !== themeId
      ) {
        admin.setAttribute("data-theme", themeId);
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });

    return () => observer.disconnect();
  }, [themeId]);

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    setThemeId(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: next }));
  }

  const failureCount = EXPECTED_CONTRAST_FAILURES[themeId] ?? 0;
  const badgeLabel =
    failureCount === 0 ? "WCAG AA: pass" : `WCAG AA: ${failureCount} failing`;

  return (
    <div
      // Inline, hardcoded colors are a deliberate exception to the project's
      // token-driven styling rule: this panel's whole job is to stay legible
      // while it swaps the tokens everything else on the page reads from, so
      // it cannot be styled from those same tokens without risking becoming
      // unreadable (or invisible) under the very theme it just applied.
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 2147483647,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 8,
        background: "#111",
        color: "#eee",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 12,
        boxShadow: "0 2px 12px rgba(0, 0, 0, 0.4)",
      }}
    >
      <span style={{ opacity: 0.7 }}>Theme lab</span>
      <select
        value={themeId}
        onChange={handleChange}
        style={{
          background: "#222",
          color: "#eee",
          border: "1px solid #444",
          borderRadius: 4,
          padding: "4px 6px",
          fontSize: 12,
        }}
      >
        {NEXTLY_THEMES.map(theme => (
          <option key={theme.id} value={theme.id}>
            {theme.label}
          </option>
        ))}
      </select>
      <span
        style={{
          padding: "2px 6px",
          borderRadius: 4,
          background: failureCount === 0 ? "#1e3a1e" : "#3a2e1e",
          color: failureCount === 0 ? "#8fdf8f" : "#e0b866",
        }}
      >
        {badgeLabel}
      </span>
    </div>
  );
}
