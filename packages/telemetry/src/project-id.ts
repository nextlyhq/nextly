import { createHash } from "crypto";

// One-way hash of the cwd + per-machine salt, truncated to 12 hex chars.
// Lets us count distinct projects without knowing their paths. The salt
// never leaves the machine (it is stored in ~/.config/nextly/config.json
// alongside anonymousId).
export function hashProjectId(cwd: string, salt: string): string {
  return createHash("sha256")
    .update(`${salt}:${cwd}`)
    .digest("hex")
    .slice(0, 12);
}
