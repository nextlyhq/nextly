/**
 * The verification codes in the head of the site's home page: the tags
 * Google, Bing, Pinterest, Yandex, Baidu and any other service the settings
 * name read to confirm the site is the owner's. The home page is `/` on
 * whichever production address served it, so each address's own home page
 * carries them; a service checks the home page of the address it was given.
 *
 * Core places each tag as `<meta name content>` and escapes both; the codes
 * reaching here have passed the stored value's rule on the way in and on the
 * way out (`settings/verification-stored`), so none can carry markup.
 *
 * @module outputs/verification
 */
import type {
  PageMetadataAnswer,
  PageMetadataInput,
  PageMetadataResolver,
} from "@nextlyhq/plugin-sdk";

import { overAnswer } from "../resolver/provider";

/** Reads the saved tags, by meta name: nothing where none is saved. */
export type ReadVerificationTags = () => Promise<Record<string, string>>;

/** A path with its trailing slashes taken off, so `/` and `//` read alike. */
const bare = (path: string): string => path.replace(/\/+$/, "");

/**
 * Whether the page is the site's home page: by the address its route served
 * it at, or, where the route does not say, by its canonical.
 */
function isHomePage(
  input: PageMetadataInput,
  answer: PageMetadataAnswer
): boolean {
  if (input.path !== undefined) return bare(input.path) === "";
  if (answer.canonical === undefined) return false;
  try {
    return (
      bare(new URL(answer.canonical, "http://home.invalid").pathname) === ""
    );
  } catch {
    return false;
  }
}

/**
 * `resolver` with the saved verification tags added to the home page's
 * answer. Every other page is answered as before, and reads nothing for
 * them. The tags are read inside the cached answer, which the settings'
 * cache tags already expire, so a saved code reaches the page without a
 * redeploy.
 */
export function withVerification(
  resolver: PageMetadataResolver,
  read: ReadVerificationTags
): PageMetadataResolver {
  return overAnswer(resolver, async (answer, input) => {
    if (!isHomePage(input, answer)) return answer;
    const tags = await read();
    return Object.keys(tags).length === 0
      ? answer
      : { ...answer, verification: tags };
  });
}
