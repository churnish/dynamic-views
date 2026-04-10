/** Per-card cleanup handle for individual card teardown (virtual scrolling) */
export interface CardHandle {
  el: HTMLElement;
  cleanup: () => void;
}

/** Normalized card data structure (framework-agnostic) */
export interface CardData {
  path: string;
  name: string;
  title: string;
  tags: string[]; // tags in YAML + note body (file.tags property)
  yamlTags: string[]; // YAML tags only (tags property)
  ctime: number; // milliseconds
  mtime: number; // milliseconds
  folderPath: string;
  textPreview?: string;
  subtitle?: string;
  imageUrl?: string | string[];
  urlValue?: string | null;
  hasValidUrl?: boolean;
  properties: Array<{ name: string; value: unknown }>;
}
