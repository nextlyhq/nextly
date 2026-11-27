/**
 * Whether the command palette is open, and whether the admin has mounted its
 * own, held outside React so the rail's Search button, the phone drawer and
 * the palette itself read one answer wherever each is rendered.
 *
 * A host app may still mount the exported `<CommandPalette />` beside the
 * admin, as apps did before the admin mounted its own. Two palettes would
 * both answer ⌘K and draw two dialogs, so while the admin's is mounted the
 * host's draws nothing: `adminPaletteMounted` is what it reads.
 *
 * @module components/shared/command-palette/palette-store
 */

type Listener = () => void;

let open = false;
let adminMounts = 0;
/**
 * What had focus when the palette opened, given focus back when it closes.
 * The dialog is opened by this state rather than by a trigger of its own, so
 * the dialog has no trigger to return focus to and would leave it on the page.
 */
let returnFocusTo: HTMLElement | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribePalette(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isPaletteOpen(): boolean {
  return open;
}

export function setPaletteOpen(next: boolean): void {
  if (open === next) return;
  if (next && typeof document !== "undefined") {
    const focused = document.activeElement;
    returnFocusTo = focused instanceof HTMLElement ? focused : null;
  }
  open = next;
  emit();
}

/**
 * The element to give focus back to as the palette closes, once: still on
 * the page, else none, and the dialog's own default then applies.
 */
export function takeReturnFocus(): HTMLElement | null {
  const element = returnFocusTo;
  returnFocusTo = null;
  return element?.isConnected ? element : null;
}

/** Opens the palette, from anywhere: the rail's Search button, the drawer's. */
export function openCommandPalette(): void {
  setPaletteOpen(true);
}

export function adminPaletteMounted(): boolean {
  return adminMounts > 0;
}

/**
 * Records that the admin's own palette is mounted, until the returned
 * function is called. Counted rather than flagged, so a remount that mounts
 * the new one before unmounting the old never leaves the count at zero.
 */
export function registerAdminPalette(): () => void {
  adminMounts += 1;
  emit();
  return () => {
    adminMounts -= 1;
    // A palette left open by an unmounted host would reopen on the next mount.
    if (adminMounts === 0) open = false;
    emit();
  };
}
