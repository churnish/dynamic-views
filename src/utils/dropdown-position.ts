/**
 * Close dropdown when clicking outside
 */
export function setupClickOutside(
  containerElement: HTMLElement,
  onClickOutside: () => void
): () => void {
  const handleClick = (event: MouseEvent) => {
    if (!containerElement.contains(event.target as Node)) {
      onClickOutside();
    }
  };

  const doc = containerElement.ownerDocument;

  // Use setTimeout to avoid closing immediately when opening
  setTimeout(() => {
    doc.addEventListener('click', handleClick);
  }, 0);

  // Return cleanup function
  return () => {
    doc.removeEventListener('click', handleClick);
  };
}
