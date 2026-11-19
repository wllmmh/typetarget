# 0023. Line breaks in TypeTarget's own boxes, at 80 characters
- Status: Accepted
- Date: 2026-11-19

## Context

Transcribed text goes in joined by spaces, so a long meeting or lecture saved from the
new-file box is a single line of hundreds of kilobytes. Many text editors can't open that, or
become unusable on it.

## Decision

Text typed into the new-file box and the editor tab's box is broken into lines as it goes in
(`content/wrap-lines.ts`). A space becomes a line break when the next word would take the line
past 80 characters, or when the line is at least 60 characters and the word before ends a
sentence. Words are never split. The column is read from the box's text before the insertion
boundary, so it counts text carried over from another box and the user's own typing.

A page's own text boxes get no line breaks. A line break can be dropped by a single-line
field, or act like Enter in a chat box and send the message.

80 is the width plain text is conventionally read at. Any limit fixes the editor problem; this
one is chosen for reading.

## Consequences

- Saved transcripts open in any editor and read as short lines that mostly end at a sentence.
- The box shows the breaks too, so it may wrap shorter than its width.
- The limit counts UTF-16 code units, so a line of CJK text (which has no spaces except between
  finals, and is drawn twice as wide) can run long and break only between finals.
