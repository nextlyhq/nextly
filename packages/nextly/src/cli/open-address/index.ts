/**
 * The one way the command line opens or follows a web address a site hands
 * it: a sign-in page, an approval page, a file link.
 *
 * An address is accepted only when it is `https` on the site's own origin or
 * on its sign-in issuer. Anything else is refused before anything happens: a
 * foreign origin, `http`, `file:` and other schemes, a user name before the
 * host (`https://site@evil/`, which a person reads as the site), and any
 * whitespace, control character, quote or shell metacharacter. A site that
 * was taken over, or a response tampered with on the way, can then make the
 * command line open nothing but the site itself.
 *
 * The browser is started with the address as one argument and no shell, so
 * no character in it can become a command.
 *
 * @module cli/open-address
 */
import { spawn as nodeSpawn } from "node:child_process";

/** The origins a site's addresses may be on. */
export interface TrustedOrigins {
  /** The site's own address, as the person gave it or saved it. */
  site: string;
  /** The site's sign-in issuer, when it signs people in elsewhere. */
  issuer?: string;
}

/**
 * Characters never part of an address the command line opens, besides
 * whitespace and control characters: quotes, a backslash and the shell's
 * metacharacters. A well-formed address carries them percent-encoded, if
 * at all.
 */
const REFUSED_CHARACTERS = new Set([..."\"'`\\<>|;&$(){}^"]);

/** Whether the string holds a character no address the site sends holds. */
function holdsRefusedCharacter(address: string): boolean {
  for (const character of address) {
    const code = character.codePointAt(0) ?? 0;
    // Control characters and space and below, DEL, any other whitespace.
    if (code <= 0x20 || code === 0x7f || /\s/.test(character)) return true;
    if (REFUSED_CHARACTERS.has(character)) return true;
  }
  return false;
}

/** The `https` origin of an address, or null when it has none. */
function httpsOrigin(address: string): string | null {
  try {
    const url = new URL(address);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The address to open, or null when the command line must not open it.
 *
 * Checked on the string as given, before the URL parser tidies it: the
 * parser drops surrounding whitespace and turns a backslash into a slash,
 * and a string it had to tidy is not one the site meant to send.
 */
export function addressToOpen(
  address: string,
  trusted: TrustedOrigins
): URL | null {
  if (address === "" || holdsRefusedCharacter(address)) return null;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  // A user name or password before the host is how an address is made to
  // look like the site while it leads elsewhere.
  if (url.username !== "" || url.password !== "") return null;
  const allowed = [trusted.site, trusted.issuer]
    .filter((origin): origin is string => origin !== undefined)
    .map(httpsOrigin)
    .filter((origin): origin is string => origin !== null);
  return allowed.includes(url.origin) ? url : null;
}

/** The narrow view of `child_process.spawn` the opener uses. */
type Spawn = (
  command: string,
  args: string[],
  options: { shell: false; stdio: "ignore"; detached: true }
) => { unref(): void; on(event: "error", listener: () => void): unknown };

/**
 * The command that opens an address in the person's browser on each
 * system, taking it as one argument. On Windows, `rundll32` with the URL
 * handler rather than `cmd /c start`, which would hand the address to a
 * shell.
 */
function browserCommand(
  platform: string,
  href: string
): { command: string; args: string[] } | null {
  switch (platform) {
    case "darwin":
      return { command: "open", args: [href] };
    case "win32":
      return {
        command: "rundll32",
        args: ["url.dll,FileProtocolHandler", href],
      };
    case "linux":
    case "freebsd":
    case "openbsd":
      return { command: "xdg-open", args: [href] };
    default:
      return null;
  }
}

/**
 * Open an accepted address in the person's browser. False when this system
 * has no way to, so the caller offers another (phone sign-in, a link to
 * copy). The browser runs on its own; nothing waits for it.
 */
export function openInBrowser(
  address: URL,
  deps: { platform?: string; spawn?: Spawn } = {}
): boolean {
  const opener = browserCommand(
    deps.platform ?? process.platform,
    address.href
  );
  if (!opener) return false;
  const spawn = deps.spawn ?? nodeSpawn;
  try {
    const child = spawn(opener.command, opener.args, {
      shell: false,
      stdio: "ignore",
      detached: true,
    });
    // A browser that fails to start after this point must not crash the
    // command; the person still has the link the command printed.
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
