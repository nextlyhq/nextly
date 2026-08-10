/**
 * Terminal-style progress list rendered while the seed is in flight.
 *
 * The seed runs server-side and we don't have streaming progress yet,
 * so the list animates on a fixed schedule that roughly matches the
 * usual seed duration (10–15s for media + content). A future PR can
 * replace this with real Server-Sent Events once the seed function
 * emits per-phase events.
 */

const PHASES = [
  "Uploading media",
  "Seeding roles",
  "Creating users",
  "Creating categories",
  "Creating tags",
  "Creating posts",
  "Updating singles",
  "Seeding newsletter form",
];

export function ProgressList() {
  return (
    <ul className="font-mono text-xs text-muted-foreground space-y-1.5 max-w-xl">
      {PHASES.map((phase, i) => (
        <li
          key={phase}
          // Stagger each line a fixed delay so the list feels alive
          // even though we're not streaming real progress yet.
          style={{
            animationDelay: `${i * 250}ms`,
            // Namespaced, because the build renames this sheet's keyframes so
            // they cannot collide with the host document's. An inline style
            // never passes through that rename, so the unprefixed name here
            // matched no definition and the rows stayed at opacity 0.
            animation: "nx-fade-in 600ms ease-out forwards",
            opacity: 0,
          }}
        >
          {/* Muted foreground so this small arrow marker glyph meets contrast; a faint foreground alpha did not. */}
          <span aria-hidden="true" className="mr-2 text-muted-foreground">
            ▸
          </span>
          {phase}
        </li>
      ))}
    </ul>
  );
}
