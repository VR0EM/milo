---
name: explain
description: Explain how a part of Milo works, why it was built that way, and where to change it, without changing any code. Use when she asks how something works, why it behaves a certain way, where something lives, or what a change would involve before deciding.
argument-hint: what you want to understand
---

# Explain a part of Milo

The question: $ARGUMENTS

Change nothing. Read, then explain.

1. Find the code involved (start from the map in `CLAUDE.md` and `docs/ARCHITECTURE.md`)
   and read it, from the screen down to the data.
2. Search `docs/DECISIONS.md` for the history of this area: the why is usually there.
3. Answer in her language, in this order:
   - **In short**: two or three sentences.
   - **How it works**: the path through the code, with clickable `file:line` references.
   - **Why it is this way**: the decisions behind it, if any.
   - **To change it**: which files, roughly how big the change is, and any risk
     (data, Windows, other screens that depend on it).
4. If the question was really a wish ("could it ...?"), end by offering to build it with
   `/feature`.
