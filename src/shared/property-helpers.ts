/**
 * Shared property type helpers
 * Used by both Bases (shared-renderer.ts) and Datacore (card-renderer.tsx) renderers
 */

/**
 * Check if a property is a tag property (tags or file tags)
 */
export function isTagProperty(propertyName: string | undefined): boolean {
  if (!propertyName) return false;
  return (
    propertyName === "tags" ||
    propertyName === "note.tags" ||
    propertyName === "file.tags" ||
    propertyName === "file tags"
  );
}

/**
 * Check if a property is a file property (intrinsic, cannot be missing)
 */
export function isFileProperty(propertyName: string | undefined): boolean {
  if (!propertyName) return false;
  const normalized = propertyName.toLowerCase();
  return normalized.startsWith("file.") || normalized.startsWith("file ");
}

/**
 * Check if a property is a formula property (computed, cannot be missing)
 */
export function isFormulaProperty(propertyName: string | undefined): boolean {
  if (!propertyName) return false;
  return propertyName.startsWith("formula.");
}

/**
 * Determine if a property field should be collapsed (hidden from layout).
 * Unified logic for both Bases and Datacore renderers.
 *
 * @param value - The resolved property value (string or null if missing)
 * @param propertyName - The property name
 * @param hideMissing - Whether to hide missing (null) properties
 * @param hideEmptyMode - How to handle empty values: "show" | "labels-hidden" | "all"
 * @param propertyLabels - Label display mode: "hide" | "inline" | "above"
 */
export function shouldCollapseField(
  value: string | null,
  propertyName: string,
  hideMissing: boolean,
  hideEmptyMode: "show" | "labels-hidden" | "all",
  propertyLabels: "hide" | "inline" | "above",
): boolean {
  const isTag = isTagProperty(propertyName);
  const isFile = isFileProperty(propertyName);
  const isFormula = isFormulaProperty(propertyName);

  // Empty handling (applies to all property types uniformly)
  const isEmpty = value === "" || (isTag && !value);
  if (isEmpty) {
    if (hideEmptyMode === "all") return true;
    if (hideEmptyMode === "labels-hidden" && propertyLabels === "hide")
      return true;
    return false; // "show" mode - don't collapse empty fields
  }

  // Missing handling (only YAML properties can be "missing")
  if (value === null && !isFile && !isFormula && !isTag) {
    return hideMissing;
  }

  return false;
}
