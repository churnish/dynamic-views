# Comprehensive Code Audit Report

Generated: 2025-12-30

## Scope

Changes made in this session:

- Checkbox property support (interactive, indeterminate state)
- Date/datetime property display fix
- Memory leak prevention (signal guards, observer cleanup)
- Slideshow/image handling improvements

---

## Critical Issues

### 1. Datacore checkbox detection missing "note." prefix strip

**File:** `src/shared/data-transform.ts`
**Lines:** 983-987 vs 766-775
**Confidence:** 95%

Bases strips "note." prefix before checking `getAllPropertyInfos()`, but Datacore does not:

```typescript
// Bases (correct) - line 766-768
const fmProp = propertyName.startsWith("note.")
  ? propertyName.slice(5)
  : propertyName;

// Datacore (bug) - line 983-984
const propInfo = (app.metadataCache as any).getAllPropertyInfos?.()?.[
  propertyName // <- Should be fmProp
];
```

**Impact:** Checkbox properties with "note." prefix won't be detected as checkboxes in Datacore views.

**Fix:**

```typescript
const fmProp = propertyName.startsWith("note.")
  ? propertyName.slice(5)
  : propertyName;
const propInfo = (app.metadataCache as any).getAllPropertyInfos?.()?.[fmProp];
```

---

### 2. Date validation missing in early detection

**File:** `src/utils/property.ts`
**Lines:** 157-165
**Confidence:** 95%

Early date detection checks for `{date, time}` structure but doesn't validate `date` is actually a Date:

```typescript
if (
  value &&
  typeof value === "object" &&
  "date" in value &&
  "time" in value // Missing: value.date instanceof Date
) {
  return value;
}
```

**Impact:** Malformed date values `{date: "string", time: true}` pass validation but fail later in `extractTimestamp()`.

**Fix:**

```typescript
if (
  value &&
  typeof value === "object" &&
  "date" in value &&
  value.date instanceof Date &&
  !isNaN(value.date.getTime()) &&
  "time" in value
) {
  return value;
}
```

---

### 3. Dual ResizeObserver cleanup creates redundancy

**File:** `src/bases/shared-renderer.ts`
**Lines:** 1034-1066, 1206-1247
**Confidence:** 100%

ResizeObservers use both array-based AND signal-based cleanup:

```typescript
resizeObserver.observe(cardEl);
this.propertyObservers.push(resizeObserver); // Array cleanup

signal.addEventListener("abort", () => resizeObserver.disconnect(), {
  once: true, // Signal cleanup
});
```

**Impact:** Redundant cleanup attempts, inconsistent pattern across codebase.

**Fix:** Use one pattern consistently. Recommend removing signal listener since array cleanup already exists:

```typescript
resizeObserver.observe(cardEl);
this.propertyObservers.push(resizeObserver);
// Remove signal.addEventListener for disconnect
```

---

### 4. IMAGE_EXTENSION_REGEX fragile jpeg handling

**File:** `src/utils/image.ts`
**Lines:** 34-39
**Confidence:** 95%

Regex construction assumes "jpeg" appears before "jpg" in array:

```typescript
const IMAGE_EXTENSION_REGEX = new RegExp(
  `\\.(${VALID_IMAGE_EXTENSIONS.filter((e) => e !== "jpeg")
    .join("|")
    .replace("jpg", "jpe?g")})$`,
  "i",
);
```

**Impact:** If array order changes (e.g., alphabetical sort), regex breaks.

**Fix:**

```typescript
const IMAGE_EXTENSION_REGEX = new RegExp(
  `\\.(${VALID_IMAGE_EXTENSIONS.filter((e) => e !== "jpeg" && e !== "jpg")
    .concat(["jpe?g"])
    .join("|")})$`,
  "i",
);
```

---

### 5. slideshow failedUrls doesn't invalidate blob cache

**File:** `src/shared/slideshow.ts`
**Lines:** 259-261
**Confidence:** 92%

When image fails, original URL is added to `failedUrls` but blob cache entry remains:

```typescript
failedUrls.add(newUrl); // Adds original URL
// But externalBlobCache still has the blob URL
```

**Impact:** Cached blobs that fail to load won't be invalidated. `getCachedBlobUrl()` bypasses `failedUrls` check.

**Fix:**

```typescript
failedUrls.add(newUrl);
if (effectiveUrl !== newUrl) {
  URL.revokeObjectURL(effectiveUrl);
  externalBlobCache.delete(newUrl);
}
```

---

## Important Issues

### 6. Code duplication: checkbox detection logic

**Files:** `src/shared/data-transform.ts`
**Lines:** 764-776, 981-989
**Confidence:** 85%

Identical checkbox detection appears in both Bases and Datacore resolvers.

**Fix:** Extract to shared helper:

```typescript
function isCheckboxProperty(app: App, propertyName: string): boolean {
  const fmProp = propertyName.startsWith("note.")
    ? propertyName.slice(5)
    : propertyName;
  const propInfo = (app.metadataCache as any).getAllPropertyInfos?.()?.[fmProp];
  return propInfo?.widget === "checkbox";
}
```

---

### 7. Code duplication: property name prefix stripping

**Files:** `data-transform.ts`, `card-renderer.tsx`, `shared-renderer.ts`
**Confidence:** 90%

Same `propertyName.startsWith("note.") ? propertyName.slice(5) : propertyName` pattern repeated 4+ times.

**Fix:** Add to `src/utils/property.ts`:

```typescript
export function stripNotePrefix(propertyName: string): string {
  return propertyName.startsWith("note.")
    ? propertyName.slice(5)
    : propertyName;
}
```

---

### 8. Redundant abort guards in event listeners

**File:** `src/bases/shared-renderer.ts`
**Lines:** 1079, 1106, 1113, 1473, 1477, 1553
**Confidence:** 85%

Guards like `if (signal.aborted) return` inside callbacks are redundant when `{ signal }` is passed:

```typescript
img.addEventListener(
  "load",
  () => {
    if (signal.aborted) return; // Redundant - listener auto-removed on abort
    // ...
  },
  { signal },
);
```

**Note:** Guards ARE useful if signal aborts DURING callback execution, but current comments suggest misunderstanding.

**Fix:** Either remove guards or clarify comments to explain mid-execution defense.

---

### 9. Unnecessary cachedRect cleanup on abort

**File:** `src/bases/shared-renderer.ts`
**Lines:** 1535-1541
**Confidence:** 80%

Signal listener solely to null out `cachedRect`:

```typescript
signal?.addEventListener(
  "abort",
  () => {
    cachedRect = null;
  },
  { once: true },
);
```

**Impact:** Doesn't prevent memory leak. When listeners are removed, closure is GC'd anyway. DOMRect is small.

**Fix:** Remove or add comment explaining it's purely defensive.

---

### 10. stripWikilinkSyntax doesn't trim before matching

**File:** `src/utils/image.ts`
**Lines:** 56-61
**Confidence:** 85%

Regex requires wikilink to be entire string, fails with surrounding whitespace:

```typescript
const wikilinkMatch = path.match(/^!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
// "  [[image.png]]  " won't match due to ^ and $
```

**Fix:**

```typescript
export function stripWikilinkSyntax(path: string | null | undefined): string {
  if (!path) return "";
  const trimmed = path.trim();
  const wikilinkMatch = trimmed.match(/^!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
  return wikilinkMatch ? wikilinkMatch[1].trim() : path;
}
```

---

### 11. validateBlobUrl potential race

**File:** `src/shared/slideshow.ts`
**Lines:** 28-41
**Confidence:** 90%

Setting `img.src = ""` can trigger error handler:

```typescript
const cleanup = (result: boolean) => {
  img.onload = null;
  img.onerror = null;
  img.src = ""; // May trigger error before handlers nulled
  resolve(result);
};
```

**Fix:** Already nulling handlers before setting src, should be safe. But order matters - verify handlers are null BEFORE src change.

---

### 12. Formatting inconsistency for custom date properties

**File:** `src/shared/data-transform.ts`
**Lines:** 746 vs 724
**Confidence:** 80%

Custom date properties always get full datetime formatting, while file timestamps get abbreviated (styled) formatting:

```typescript
// File timestamps - styled = true
const timestamp = resolveTimestampProperty(propertyName, ctime, mtime, true);

// Custom dates - styled = false (implicit)
return formatTimestamp(timestampData.timestamp, timestampData.isDateOnly);
```

**Impact:** Inconsistent UX between `file.ctime` (abbreviated) and custom date property (full datetime).

**Fix:** Consider passing `styled: true` to custom date formatting for consistency.

---

## Test Coverage Gaps

### Missing Tests

1. **Checkbox marker creation** - `data-transform.ts` boolean → JSON marker
2. **Indeterminate state detection** - `getAllPropertyInfos().widget === "checkbox"`
3. **Date detection in `getFirstBasesPropertyValue`** - `{icon, date, time}` structure
4. **`stripWikilinkSyntax` with fragments** - `[[image.png#heading]]`
5. **`invalidateCacheForFile`** - 0% coverage (image-loader.ts)
6. **`normalizePropertyName`** - 0% coverage (property.ts)
7. **`isValidUri`** - 0% coverage (property.ts)
8. **Empty vs missing property detection** - metadata cache logic
9. **YouTube ID edge cases** - empty paths, missing segments
10. **Windows newlines in frontmatter** - CRLF handling

### Suggested Tests

```typescript
// image.test.ts
describe("stripWikilinkSyntax with fragments", () => {
  it("strips heading fragments", () => {
    expect(stripWikilinkSyntax("[[image.png#heading]]")).toBe("image.png");
  });
  it("strips block references", () => {
    expect(stripWikilinkSyntax("![[photo.jpg#^block-id]]")).toBe("photo.jpg");
  });
  it("handles whitespace", () => {
    expect(stripWikilinkSyntax("  [[image.png]]  ")).toBe("image.png");
  });
});

// data-transform.test.ts
describe("checkbox property handling", () => {
  it("creates checkbox marker for boolean true", () => {
    // Mock Bases entry returning {data: true}
    expect(result).toBe('{"type":"checkbox","checked":true}');
  });
  it("creates indeterminate marker for empty checkbox property", () => {
    // Mock getAllPropertyInfos returning {widget: "checkbox"}
    expect(result).toBe('{"type":"checkbox","indeterminate":true}');
  });
});
```

---

## Code Smell / Refactoring Opportunities

### 1. Cleanup pattern inconsistency

**Current state:**

- ResizeObservers: Both array AND signal cleanup
- Event listeners: Signal only
- Slideshow: Array only

**Recommendation:** Standardize on signal-based cleanup for all or array-based for all.

---

### 2. Large functions

- `renderPropertyValue()` in shared-renderer.ts: 200+ lines
- `Card()` in card-renderer.tsx: 500+ lines

**Recommendation:** Extract checkbox rendering, timestamp rendering, array rendering into separate functions.

---

### 3. Magic strings

Checkbox marker uses JSON string matching:

```typescript
if (stringValue.startsWith('{"type":"checkbox"')) {
```

**Recommendation:** Define constant:

```typescript
const CHECKBOX_MARKER_PREFIX = '{"type":"checkbox"';
```

---

## Summary

| Severity  | Count | Key Issues                                                                              |
| --------- | ----- | --------------------------------------------------------------------------------------- |
| Critical  | 5     | Datacore prefix bug, date validation, dual cleanup, regex fragility, cache invalidation |
| Important | 7     | Code duplication, redundant guards, whitespace handling                                 |
| Test Gaps | 10    | Checkbox, dates, fragments, new functions                                               |

**Priority fixes:**

1. Fix Datacore checkbox prefix stripping (Critical #1)
2. Add date validation (Critical #2)
3. Fix regex fragility (Critical #4)
4. Add cache invalidation on failure (Critical #5)
5. Consolidate cleanup pattern (Critical #3)
