# Hide "Invert Position for Property" When Single Property

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Hide the "Invert position for property" setting when only one property is configured for display, but preserve any existing value so it reappears when more properties are added.

**Architecture:** Conditional rendering based on property count. In Bases, the `shouldHide` callback checks `config.getOrder().length`. In Datacore React UI, conditional JSX rendering checks `settings.propertyLabels` state. Values are never cleared—only visibility changes.

**Tech Stack:** TypeScript, React (Datacore), Obsidian Bases config schema

---

### Task 1: Update Bases Schema — Add Property Count Check

**Files:**

- Modify: `src/shared/settings-schema.ts:269-280`

**Step 1: Locate the `invertPropertyPosition` setting definition**

Currently at lines 269-280:

```typescript
{
  type: "text",
  displayName: "Invert position for property",
  key: "invertPropertyPosition",
  placeholder: "Comma-separated if multiple",
  default: d.invertPropertyPosition,
  shouldHide: (config: BasesConfig) =>
    config.getOrder().length === 0 ||
    (!(config.get("textPreviewProperty") ?? d.textPreviewProperty) &&
      (config.get("fallbackToContent") ?? d.fallbackToContent) ===
        false),
}
```

**Step 2: Add the single-property condition**

Change `config.getOrder().length === 0` to `config.getOrder().length <= 1`:

```typescript
{
  type: "text",
  displayName: "Invert position for property",
  key: "invertPropertyPosition",
  placeholder: "Comma-separated if multiple",
  default: d.invertPropertyPosition,
  shouldHide: (config: BasesConfig) =>
    config.getOrder().length <= 1 ||
    (!(config.get("textPreviewProperty") ?? d.textPreviewProperty) &&
      (config.get("fallbackToContent") ?? d.fallbackToContent) ===
        false),
}
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add src/shared/settings-schema.ts
git commit -m "Hide 'Invert position for property' in Bases when ≤1 property"
```

---

### Task 2: Update Datacore Settings — Add Conditional Rendering

**Files:**

- Modify: `src/datacore/settings.tsx:445-479`

**Step 1: Understand current Properties section structure**

Currently the Properties section (lines 445-479) contains:

1. Property labels dropdown (always visible)
2. URL property text input (always visible)

The setting we need to add conditional rendering for is `invertPropertyPosition`, but it's **not currently in the Datacore settings UI**. Looking at the Bases schema, this setting exists there but was never added to Datacore.

**Step 2: Verify Datacore doesn't have this setting**

Confirmed: The `invertPropertyPosition` text input is NOT in `settings.tsx`. The Properties section only has:

- Property labels dropdown
- URL property text input

Since Datacore doesn't have the "Invert position for property" setting at all, there's nothing to hide conditionally.

**Step 3: No changes needed for Datacore**

The task description mentions "bases/datacore" but the setting only exists in Bases. Datacore's settings.tsx doesn't include `invertPropertyPosition`.

**Step 4: Mark task complete**

No code changes required for Datacore.

---

### Task 3: Manual Verification

**Step 1: Open a Bases view with 0-1 properties configured**

1. Open Obsidian with the dev vault
2. Navigate to a `.base` file with Dynamic Views grid/masonry view
3. Open the view settings menu
4. Expand the "Properties" section
5. Ensure 0 or 1 property is in the displayed order

**Step 2: Verify setting is hidden**

Expected: "Invert position for property" text input should NOT be visible

**Step 3: Add a second property to the display order**

1. Add another property to the view's display columns

**Step 4: Verify setting reappears**

Expected: "Invert position for property" text input should now be visible

**Step 5: Set a value, then reduce back to 1 property**

1. Enter a value like "status" in the "Invert position for property" field
2. Remove a property so only 1 remains in display order
3. Verify the setting disappears
4. Add the property back
5. Verify the setting reappears WITH the previously entered value "status"

Expected: Value is preserved through visibility changes

---

## Summary

This is a one-line change in `settings-schema.ts`:

- Change `config.getOrder().length === 0` to `config.getOrder().length <= 1`

The Datacore React settings don't include this setting, so no changes needed there. The value preservation happens automatically because `shouldHide` only controls visibility—it doesn't clear the underlying config value.
