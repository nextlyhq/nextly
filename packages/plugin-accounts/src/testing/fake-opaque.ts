import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { OpaqueSecrets } from "../core/ports";

import { FakeCoreMisuse } from "./fake-transactions";

/** Core's opaque secrets, which are small enough to be the real thing. */
export class FakeOpaqueSecrets implements OpaqueSecrets {
  create(options: { bytes?: number } = {}): { secret: string; hash: string } {
    const bytes = options.bytes ?? 32;
    if (bytes < 32)
      throw new FakeCoreMisuse(
        `an opaque secret of ${bytes} bytes is under 32`
      );
    const secret = randomBytes(bytes).toString("base64url");

    return { secret, hash: this.hash(secret) };
  }

  hash(secret: string): string {
    return createHash("sha256").update(secret).digest("hex");
  }

  equal(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);

    return left.length === right.length && timingSafeEqual(left, right);
  }
}
