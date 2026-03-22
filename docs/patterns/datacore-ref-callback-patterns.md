---
title: Datacore ref callback patterns
description: Patterns and gotchas for attaching event listeners in card-renderer.tsx Preact ref callbacks.
author: 🤖 Generated with Claude Code
updated: 2026-03-15
---
# Datacore ref callback patterns

## The re-render problem

In [card-renderer.tsx](../../src/shared/card-renderer.tsx), the Preact ref callback runs on every re-render. Datacore triggers 7+ re-renders per card during initialization. Each render creates a new `scrollController = new AbortController()` and calls `cleanupCardScrollListeners(card.path)`, which aborts the previous signal. Any event listeners attached with `scrollController.signal` are destroyed on the next render.

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
- **Key stability**: cards are keyed by `card.path` (via the `key` prop in `card-renderer.tsx`), so Preact reuses the same DOM element for the same path

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

## Pattern: `__dragBound` expando guard + dataset freshness

For native event listeners that must NOT be re-bound on re-render (e.g., drag handlers where Preact JSX props interfere with Chromium's drag lifecycle — see [`drag-handlers.md`](../architecture/drag-handlers.md)), use a boolean expando as a one-time bind guard. Store mutable data on `el.dataset.*` and read it in the handler, so the closure-captured value serves only as fallback.

```ts
ref={(el: HTMLElement | null) => {
  if (!el) return;
  // Refresh dataset BEFORE guard — runs on every re-render
  el.dataset.dvMyValue = currentValue;
  if ((el as HTMLElement & { __dragBound?: true }).__dragBound) return;
  (el as HTMLElement & { __dragBound?: true }).__dragBound = true;
  el.addEventListener('dragstart', (e) => {
    const val = el.dataset.dvMyValue ?? currentValue; // dataset wins, closure fallback
    e.dataTransfer?.setData('text/plain', val);
  });
}}
```

Properties:

- **One-time bind**: expando prevents duplicate `addEventListener` calls across re-renders
- **Fresh data**: dataset is updated every re-render, so the handler always reads current values
- **No cleanup needed**: listener dies with the element (no `AbortController` required)
- **Closure fallback**: `?? currentValue` covers the theoretical case where dataset is unset

This pattern is used for URL button drag (`dataset.dvUrlValue`) and external link drag (`dataset.dvLinkCaption`, `dataset.dvLinkUrl`). It differs from the WeakMap pattern above — WeakMap is for stateful features that need abort/re-setup; `__dragBound` is for fire-and-forget listeners that only need fresh data.

## Current usages

- `cardHoverIntentActive` — card-level hover intent: gates cursor, link hover effects, and keyboard nav (simple on/off)
- `__dragBound` — URL button and external link drag handlers (dataset freshness, no re-bind)
- `__cardDragBound` — card-level drag handler when `openFileAction === 'card'` (one-time bind, no dataset freshness needed)
