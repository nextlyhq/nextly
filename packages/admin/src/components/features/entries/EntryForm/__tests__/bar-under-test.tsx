/**
 * The document bar as its tests have always rendered it: given the document's
 * handlers and state as props.
 *
 * The bar draws the actions its editor decided (`DocumentActionsHost`),
 * which also draws the confirmations. This puts the two back together exactly
 * as an editor does, so the bar's tests keep their assertions unchanged and
 * still say what an author sees and what each control runs.
 */
import type { ReactElement } from "react";

import { DocumentActionsHost } from "../DocumentActionsContext";
import { DocumentBar, type DocumentBarProps } from "../DocumentBar";
import type { DocumentActionBindingsInput } from "../useDocumentActionBindings";

export type BarUnderTestProps = DocumentBarProps & DocumentActionBindingsInput;

export function BarUnderTest(props: BarUnderTestProps): ReactElement {
  return (
    <DocumentActionsHost input={props}>
      <DocumentBar {...props} />
    </DocumentActionsHost>
  );
}
