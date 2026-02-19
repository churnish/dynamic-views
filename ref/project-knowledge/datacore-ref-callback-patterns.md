---
title: Datacore ref callback patterns
description: Patterns and gotchas for attaching event listeners in card-renderer.tsx Preact ref callbacks.
author: 🤖 Generated with Claude Code
last updated: 2026-02-19
---

# Datacore ref callback patterns

## The re-render problem

In `card-renderer.tsx`, the Preact ref callback runs on every re-render. Datacore triggers 7+ re-renders per card during initialization. Each render creates a new `scrollController = new AbortController()` and calls `cleanupCardScrollListeners(card.path)`, which aborts the previous signal. Any event listeners attached with `scrollController.signal` are destroyed on the next render.

## The cross-container collision

`cardScrollAbortControllers` is a module-level `Map<string, AbortController>` keyed by `card.path`. When the same file appears in multiple `.dynamic-views` containers (e.g., two views showing the same note), the second container's cleanup aborts the first container's signal, and vice versa.

The Bases backend doesn't have either problem because it uses a stable imperative `AbortSignal` that's only aborted on view teardown.

## Pattern: element-scoped WeakMap

For state that must survive re-renders and avoid path collisions, use a module-level `WeakMap<HTMLElement, ...>` keyed by the DOM element:

```ts
const myFeatureState = new WeakMap<HTMLElement, AbortController>();

// In the ref callback:
const existing = myFeatureState.get(cardEl);
if (!existing || existing.signal.aborted) {
  existing?.abort();
  const controller = new AbortController();
  myFeatureState.set(cardEl, controller);
  // Attach listeners with controller.signal
}
```

Properties:

- **Survives re-renders**: idempotent — skips setup if already active
- **No path collisions**: keyed by DOM element, not `card.path`
- **No cleanup needed**: WeakMap entries are GC'd with the element
- **Key stability**: cards are keyed by `card.path` (line ~1530), so Preact reuses the same DOM element for the same path

If the feature has modes that can change at runtime (e.g., Style Settings toggles), store the mode alongside the controller to detect changes:

```ts
const myFeatureState = new WeakMap<
  HTMLElement,
  { controller: AbortController; mode: string }
>();

// In the ref callback — also re-attaches when mode changes:
const existing = myFeatureState.get(cardEl);
if (
  !existing ||
  existing.controller.signal.aborted ||
  existing.mode !== currentMode
) {
  existing?.controller.abort();
  // ... setup with new controller and mode
}
```

## Current usages

- `cardHoverIntentState` — cover hover zoom (tracks `zoomMode` for Style Settings changes)
- `imageViewerHoverIntentState` — image viewer cursor hover intent (simple on/off)
