/**
 * The header as its tests have always rendered it: given the document's
 * handlers and state as props.
 *
 * The header now draws the actions its editor decided (`DocumentActionsHost`),
 * which also draws the confirmations. This puts the two back together exactly
 * as an editor does, so the header's tests keep their assertions unchanged and
 * still say what an author sees and what each control runs.
 */
import type { ReactElement } from "react";

import { DocumentActionsHost } from "../DocumentActionsContext";
import {
  EntrySystemHeader,
  type EntrySystemHeaderProps,
} from "../EntrySystemHeader";
import type { DocumentActionBindingsInput } from "../useDocumentActionBindings";

export type HeaderUnderTestProps = EntrySystemHeaderProps &
  DocumentActionBindingsInput;

export function HeaderUnderTest(props: HeaderUnderTestProps): ReactElement {
  return (
    <DocumentActionsHost input={props}>
      <EntrySystemHeader {...props} />
    </DocumentActionsHost>
  );
}
