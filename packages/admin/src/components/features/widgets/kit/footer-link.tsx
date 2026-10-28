/**
 * `Widget.FooterLink`: a link a widget's own view draws in its card's footer, where core's own
 * cards draw theirs ("View all" on a list), never under its body.
 *
 * Through the frame's one footer slot (`CardFooterContent`), so it takes the place of the
 * widget's own link while it is drawn and the footer holds one link, and in the footer link's own
 * style (`CARD_FOOTER_LINK_CLASS`), so it reads as every other card's. Outside a frame (a preview,
 * a test drawing a body alone) it is drawn where it stands.
 *
 * @module components/features/widgets/kit/footer-link
 */

import type { JSX } from "react";

import { Link } from "@admin/components/ui/link";

import {
  CARD_FOOTER_LINK_CLASS,
  CardFooterContent,
} from "../frame/footer-slot";

/** Draws one link, `label` to `href`, in the card's footer. */
export function WidgetFooterLink({
  href,
  label,
}: {
  /** Where the link leads. */
  href: string;
  /** What the link says, such as "View all orders". */
  label: string;
}): JSX.Element {
  return (
    <CardFooterContent>
      <Link href={href} className={CARD_FOOTER_LINK_CLASS}>
        {label}
      </Link>
    </CardFooterContent>
  );
}
