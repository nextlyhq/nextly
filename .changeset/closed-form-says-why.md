---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

A closed form now shows the message its author wrote.

The forms collection has always offered a "Closed Form Message" box, and the Status field has always promised that closed forms display a message instead of accepting submissions. Nothing read it: every form that was not published was refused with one fixed sentence, and the public route hid closed forms as completely as forms that had never existed.

A form that has been public now explains itself at its own address, and a submission to it returns the author's message. A draft is unchanged — it has never been public, so its address answers exactly as an unused one does and nothing about it confirms it exists. The public listing is unchanged too and still shows published forms only, so a closed form can be explained to someone holding its link without letting anyone discover form slugs by probing.

Authors can write that message. The custom Edit view replaces the generic collection editor and rendered no control for the field, so until now the only value anyone could get was the schema default. A "Message for visitors" box now appears in the form's metadata card the moment its status is set to Closed — at the point the decision is made, which is when an author knows what it should say.

"Closed" now has to mean the form was once live. It is accepted on creation and on a straight draft-to-closed edit, so on its own it did not establish that a form had ever been public — and the by-slug endpoint served those, handing the fields and configuration of an unreleased form to anyone who guessed its slug. Forms record when they first go live, and only a form that did answers with its message. One created closed, or never published, answers exactly as an unused address does. Forms already live when this ships are unaffected: the stamp qualifies "closed", and nothing else.

All four public paths give the same answer. The by-slug endpoint, the submit endpoint, the Direct API and the plugin's own handler each decided this separately and disagreed — one filtered closed forms out and returned 404, one returned a fixed sentence, one returned the author's message — so what a visitor was told depended on which entry point their client happened to use. They now read one shared answer, and `closedMessage` is declared on the exported `FormDocument` type rather than reached through a cast.

A form that was already live keeps working. Forms published before this shipped carry no record of when they went live, so the write that closes one is the only chance to make it — and that write says only `closed`, with the proof sitting on the stored side. Either side of the transition now counts. The stamp is also never inherited: duplicating an entry copies every field, and a copy of a closed form would otherwise arrive already qualifying as previously public at a slug nobody has seen.

A submission to a closed form is answered as a state conflict carrying the author's message, rather than a validation failure whose canonical message reads "Validation failed." with the explanation nested inside it — which a client reading the documented error shape would receive and never show.

A form nobody may know about answers with one sentence, whichever path is asked. The plugin's submission handler told a draft or a never-released form that it was "not currently accepting submissions" while telling a nonexistent slug "Form not found" — so the two remained distinguishable by probing, through the one path that had not been unified.

A closed form answers with its message and nothing else. It was answering with the whole row — fields, settings, notifications — on the strength of a stamp that says the FORM was once public. That is not the same as saying THIS address was: a closed form can be given a new slug afterwards, and fields and settings can be added while it stays closed. A published form still returns its whole document, because a client cannot render one without it; a closed form renders a sentence, so the row was disclosure the feature never needed.

The sentence a hidden form is answered with is one sentence. All four paths had been given one reading of WHICH forms answer as absent while each still formatted the answer itself, so a draft was "Form not found" through the Direct API and "Not found." over REST — and which a visitor saw still depended on their client. `NextlyError.notFound` takes a domain message now, the way `conflict` already did, and every path takes the text from one place.
