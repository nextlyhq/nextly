"use client";

/**
 * The trail the top bar draws in its left slot: where the page on screen sits,
 * and the way back from it.
 *
 * The page that knows where it sits is the one that says so, for as long as it
 * is mounted, and the top bar draws whatever was said last. That is the same
 * mount-scoped shape chrome suppression uses: a route list in the top bar would
 * be a second answer to "which document is open", and it could not follow a
 * title as it is typed.
 *
 * @module components/layout/header/HeaderTrail
 */

import type { JSX, ReactNode } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
} from "react";

import { ChevronLeft } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { cn } from "@admin/lib/utils";

import { useMountRegistry } from "../lib/mount-registry";

/** One step of the trail above the page on screen: a link to its page. */
export interface HeaderTrailStep {
  label: string;
  href: string;
}

/**
 * Where the page on screen sits, outermost step first.
 *
 * The LAST step is the list the page belongs to. On a narrow bar it is the only
 * step drawn, as the way back, so it is the one link to that list at every
 * width rather than a second back link beside it.
 */
export interface HeaderTrailValue {
  steps: readonly HeaderTrailStep[];
  /** What the page on screen is called. Drawn last, and not a link. */
  current: string;
}

interface HeaderTrailContextValue {
  trail: HeaderTrailValue | null;
  register: (trail: HeaderTrailValue) => () => void;
}

/**
 * Defaults to no trail and registrations that do nothing, so an editor rendered
 * outside the dashboard (a test, a modal host) calls the hook harmlessly.
 */
const HeaderTrailContext = createContext<HeaderTrailContextValue>({
  trail: null,
  register: () => () => {},
});

/**
 * Holds the trails mounted pages have registered. Above both the top bar and
 * the page, because the page that registers is the bar's sibling, and state has
 * to be lifted past both to be written by one and read by the other.
 */
export function HeaderTrailProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const { entries, register } = useMountRegistry<HeaderTrailValue>();
  // The most recent registration wins: a page that opens over another (an
  // editor routed from a list that also set one) is the one on screen.
  const trail = entries.at(-1) ?? null;
  const value = useMemo(() => ({ trail, register }), [trail, register]);
  return (
    <HeaderTrailContext.Provider value={value}>
      {children}
    </HeaderTrailContext.Provider>
  );
}

/**
 * A layout effect on the client, so the trail is in the bar on the first paint
 * rather than one frame after it; a passive one where there is no DOM.
 */
const useRegistrationEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Show this trail in the top bar for as long as the caller is mounted.
 *
 * Keyed by its content, so a caller building a fresh object each render does
 * not re-register on every render, and one whose title changed does.
 */
export function useHeaderTrail(trail: HeaderTrailValue): void {
  const { register } = useContext(HeaderTrailContext);
  const key = JSON.stringify(trail);
  useRegistrationEffect(() => {
    return register(JSON.parse(key) as HeaderTrailValue);
  }, [key, register]);
}

/**
 * Widths at which the bar keeps only the way back. Measured on the bar itself
 * (`@container/topbar`, declared by the top bar), so a sidebar narrowing it
 * counts as much as a narrow window. 37.5rem is 600px.
 */
const NARROW_HIDDEN = "@max-[37.5rem]/topbar:hidden";
const NARROW_SHOWN = "hidden @max-[37.5rem]/topbar:inline";

/**
 * The registered trail, or nothing where no page registered one.
 *
 * On a narrow bar the outer steps, the separators and the current page step
 * aside and a chevron appears before the list's step, so the same link reads
 * as "< Blog posts".
 */
export function HeaderTrail(): JSX.Element | null {
  const { trail } = useContext(HeaderTrailContext);
  if (trail === null) return null;
  const last = trail.steps.length - 1;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
        {trail.steps.map((step, index) => {
          const isList = index === last;
          return (
            <li
              key={`${index}:${step.href}`}
              className={cn(
                "flex items-center gap-1.5",
                // The list's step may shrink and truncate: below 600px it is
                // the trail's only item, and a collection's label has no
                // length limit, so held whole it would run into the controls
                // on the right. The outer steps are short and keep their size.
                isList ? "min-w-0" : "shrink-0",
                !isList && NARROW_HIDDEN
              )}
            >
              <Link
                href={step.href}
                className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap underline-offset-2 transition-colors hover:text-foreground hover:underline"
                // The whole label for a pointer, where it is cut short.
                {...(isList ? { title: step.label } : {})}
              >
                {isList ? (
                  <ChevronLeft
                    className={cn("h-3.5 w-3.5 shrink-0", NARROW_SHOWN)}
                    aria-hidden="true"
                  />
                ) : null}
                <span className="truncate">{step.label}</span>
              </Link>
              {/* The muted token at full strength: faded, it falls below the
                  contrast the admin holds every text colour to. */}
              <span
                aria-hidden="true"
                className={cn(
                  "shrink-0 text-muted-foreground",
                  isList && NARROW_HIDDEN
                )}
              >
                /
              </span>
            </li>
          );
        })}
        <li className={cn("min-w-0", NARROW_HIDDEN)}>
          <span
            aria-current="page"
            className="block truncate font-medium text-foreground"
          >
            {trail.current}
          </span>
        </li>
      </ol>
    </nav>
  );
}
