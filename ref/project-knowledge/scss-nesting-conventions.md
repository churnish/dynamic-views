---
title: SCSS nesting conventions
description: >-
  Rules for nesting selectors in SCSS partials — what to nest under
  .dynamic-views { } and what to leave flat.
author: 🤖 Generated with Claude Code
last updated: 2026-02-14
---

# SCSS nesting conventions

## Nest under `.dynamic-views { }`

- **Descendant selectors**: `.dynamic-views .child { }` → `.dynamic-views { .child { } }`.
- **Multi-class selectors**: `.dynamic-views.modifier { }` → `.dynamic-views { &.modifier { } }` — `&` is required (no space).
- **`@media` blocks**: Nest inside `.dynamic-views { }` when all rules within share that parent.

## Leave flat (do NOT nest)

- **Body class toggles**: `body.dynamic-views-* .dynamic-views .child { }` — the body class is external context. If these contain `.dynamic-views` descendants, nest only the inner part.
- **Theme selectors**: `.theme-light .dynamic-views`, `.theme-dark .dynamic-views`.
- **Mobile selectors**: `.is-mobile .dynamic-views`, `.is-phone .dynamic-views`.
- **`@keyframes`**: Always flat — they don't produce scoped selectors.
- **`@container`**: Always flat — container query blocks are their own scope.
- **Non-`.dynamic-views` selectors**: e.g., `.bases-view[data-view-type=...]`.

## Comments

Place comments **outside** `.dynamic-views { }` blocks. Comments inside nested blocks cause Sass `--style=expanded` to generate empty wrapper blocks (e.g., `.dynamic-views { /* comment */ }`), inflating the compiled output.

## Comma-separated selectors

When a rule combines `.dynamic-views` and non-`.dynamic-views` prefixes (e.g., `.dynamic-views .foo, .bases-view .foo`), splitting them is acceptable — nest the `.dynamic-views` part, leave the other flat. This creates one extra declaration block per split but is functionally equivalent.
