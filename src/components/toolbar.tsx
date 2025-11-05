import { ViewMode, Settings, WidthMode } from '../types';
import { Settings as SettingsPanel } from './settings';

interface ToolbarProps {
    dc: any;
    // View mode
    viewMode: ViewMode;
    showViewDropdown: boolean;
    onToggleViewDropdown: () => void;
    onSetViewCard: () => void;
    onSetViewMasonry: () => void;
    onSetViewList: () => void;

    // Sort
    sortMethod: string;
    isShuffled: boolean;
    showSortDropdown: boolean;
    onToggleSortDropdown: () => void;
    onSetSortNameAsc: () => void;
    onSetSortNameDesc: () => void;
    onSetSortMtimeDesc: () => void;
    onSetSortMtimeAsc: () => void;
    onSetSortCtimeDesc: () => void;
    onSetSortCtimeAsc: () => void;

    // Search
    searchQuery: string;
    onSearchChange: (query: string) => void;
    onSearchFocus: () => void;
    onClearSearch: () => void;

    // Shuffle
    settings: Settings;
    onShuffle: () => void;
    onOpenRandom: (event: MouseEvent) => void;

    // Query editor
    showQueryEditor: boolean;
    draftQuery: string;
    onToggleCode: () => void;
    onDraftQueryChange: (query: string) => void;
    onApplyQuery: () => void;
    onClearQuery: () => void;

    // Result count & limit
    totalCount: number;
    displayedCount: number;
    resultLimit: string;
    showLimitDropdown: boolean;
    onToggleLimitDropdown: () => void;
    onResultLimitChange: (limit: string) => void;
    onResetLimit: () => void;
    copyMenuItem: any;

    // Create note
    onCreateNote: (event: MouseEvent) => void;

    // Toolbar controls
    isPinned: boolean;
    widthMode: WidthMode;
    queryHeight: number;
    onTogglePin: () => void;
    onToggleWidth: () => void;
    onToggleSettings: () => void;

    // Settings panel
    showSettings: boolean;
    onSettingsChange: (settings: Partial<Settings>) => void;
}

export function Toolbar({
    dc,
    viewMode,
    showViewDropdown,
    onToggleViewDropdown,
    onSetViewCard,
    onSetViewMasonry,
    onSetViewList,
    sortMethod,
    isShuffled,
    showSortDropdown,
    onToggleSortDropdown,
    onSetSortNameAsc,
    onSetSortNameDesc,
    onSetSortMtimeDesc,
    onSetSortMtimeAsc,
    onSetSortCtimeDesc,
    onSetSortCtimeAsc,
    searchQuery,
    onSearchChange,
    onSearchFocus,
    onClearSearch,
    settings,
    onShuffle,
    onOpenRandom,
    showQueryEditor,
    draftQuery,
    onToggleCode,
    onDraftQueryChange,
    onApplyQuery,
    onClearQuery,
    totalCount,
    displayedCount,
    resultLimit,
    showLimitDropdown,
    onToggleLimitDropdown,
    onResultLimitChange,
    onResetLimit,
    copyMenuItem,
    onCreateNote,
    isPinned,
    widthMode,
    queryHeight,
    onTogglePin,
    onToggleWidth,
    onToggleSettings,
    showSettings,
    onSettingsChange,
}: ToolbarProps) {
    return (
        <>
        <div className="bottom-controls">
            {/* View Controls */}
            <div className="view-controls-wrapper">
                <div className="view-dropdown-wrapper">
                    <button
                        className="view-dropdown-btn"
                        onClick={onToggleViewDropdown}
                        title="Switch view"
                        tabIndex={0}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            {viewMode === "list" ? (
                                <>
                                    <line x1="8" y1="6" x2="21" y2="6"/>
                                    <line x1="8" y1="12" x2="21" y2="12"/>
                                    <line x1="8" y1="18" x2="21" y2="18"/>
                                    <line x1="3" y1="6" x2="3.01" y2="6"/>
                                    <line x1="3" y1="12" x2="3.01" y2="12"/>
                                    <line x1="3" y1="18" x2="3.01" y2="18"/>
                                </>
                            ) : viewMode === "card" ? (
                                <>
                                    <rect width="18" height="7" x="3" y="3" rx="1"/>
                                    <rect width="18" height="7" x="3" y="14" rx="1"/>
                                </>
                            ) : (
                                <>
                                    <rect width="18" height="18" x="3" y="3" rx="2"/>
                                    <path d="M3 15h12"/>
                                    <path d="M15 3v18"/>
                                </>
                            )}
                        </svg>
                        <svg className="chevron" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m6 9 6 6 6-6"/>
                        </svg>
                    </button>
                    {showViewDropdown ? (
                        <div className="view-dropdown-menu">
                            <div className="view-option" onClick={onSetViewCard} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSetViewCard(); }}} tabIndex={0} role="menuitem">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect width="18" height="7" x="3" y="3" rx="1"/>
                                    <rect width="18" height="7" x="3" y="14" rx="1"/>
                                </svg>
                                <span>Grid</span>
                            </div>
                            <div className="view-option" onClick={onSetViewMasonry} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSetViewMasonry(); }}} tabIndex={0} role="menuitem">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect width="18" height="18" x="3" y="3" rx="2"/>
                                    <path d="M3 15h12"/>
                                    <path d="M15 3v18"/>
                                </svg>
                                <span>Masonry</span>
                            </div>
                            <div className="view-option" onClick={onSetViewList} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSetViewList(); }}} tabIndex={0} role="menuitem">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="8" y1="6" x2="21" y2="6"/>
                                    <line x1="8" y1="12" x2="21" y2="12"/>
                                    <line x1="8" y1="18" x2="21" y2="18"/>
                                    <line x1="3" y1="6" x2="3.01" y2="6"/>
                                    <line x1="3" y1="12" x2="3.01" y2="12"/>
                                    <line x1="3" y1="18" x2="3.01" y2="18"/>
                                </svg>
                                <span>List</span>
                            </div>
                        </div>
                    ) : null}
                </div>

                {/* Sort Dropdown */}
                <div className="sort-dropdown-wrapper">
                    <button
                        className="sort-dropdown-btn"
                        onClick={onToggleSortDropdown}
                        title="Change sort order"
                        tabIndex={0}
                    >
                        {isShuffled ? (
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="m3 8 4-4 4 4"/>
                                <path d="M7 4v16"/>
                                <path d="M11 12h4"/>
                                <path d="M11 16h7"/>
                                <path d="M11 20h10"/>
                            </svg>
                        ) : (
                            <>
                                {sortMethod === "name-asc" ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M20 8h-5"/><path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"/><path d="M15 14h5l-5 6h5"/>
                                    </svg>
                                ) : sortMethod === "name-desc" ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="M15 4h5l-5 6h5"/><path d="M15 20v-3.5a2.5 2.5 0 0 1 5 0V20"/><path d="M20 20h-5"/>
                                    </svg>
                                ) : sortMethod === "mtime-desc" ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12.338 21.994A10 10 0 1 1 21.925 13.227"/><path d="M12 6v6l2 1"/><path d="m14 18 4-4 4 4"/><path d="M18 14v8"/>
                                    </svg>
                                ) : sortMethod === "mtime-asc" ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M13.228 21.925A10 10 0 1 1 21.994 12.338"/><path d="M12 6v6l1.562.781"/><path d="m14 18 4 4 4-4"/><path d="M18 22v-8"/>
                                    </svg>
                                ) : sortMethod === "ctime-desc" ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M12 14 8 18"/><path d="M12 14 16 18"/>
                                    </svg>
                                ) : sortMethod === "ctime-asc" ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M12 18 8 14"/><path d="M12 18 16 14"/>
                                    </svg>
                                ) : null}
                            </>
                        )}
                        <svg className="chevron" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m6 9 6 6 6-6"/>
                        </svg>
                    </button>
                    {showSortDropdown ? (
                        <div className="sort-dropdown-menu">
                            <div className="sort-option" onClick={onSetSortNameAsc} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSetSortNameAsc(); }}} tabIndex={0} role="menuitem">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M20 8h-5"/><path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"/><path d="M15 14h5l-5 6h5"/>
                                </svg>
                                <span>File name (A to Z)</span>
                            </div>
                            <div className="sort-option" onClick={onSetSortNameDesc} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSetSortNameDesc(); }}} tabIndex={0} role="menuitem">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="M15 4h5l-5 6h5"/><path d="M15 20v-3.5a2.5 2.5 0 0 1 5 0V20"/><path d="M20 20h-5"/>
                                </svg>
                                <span>File name (Z to A)</span>
                            </div>
                            <div className="sort-option" onClick={onSetSortMtimeDesc} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSetSortMtimeDesc(); }}} tabIndex={0} role="menuitem">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12.338 21.994A10 10 0 1 1 21.925 13.227"/><path d="M12 6v6l2 1"/><path d="m14 18 4-4 4 4"/><path d="M18 14v8"/>
                                </svg>
                                <span>Modified time (new to old)</span>
                            </div>
                            <div className="sort-option" onClick={onSetSortMtimeAsc} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSetSortMtimeAsc(); }}} tabIndex={0} role="menuitem">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M13.228 21.925A10 10 0 1 1 21.994 12.338"/><path d="M12 6v6l1.562.781"/><path d="m14 18 4 4 4-4"/><path d="M18 22v-8"/>
                                </svg>
                                <span>Modified time (old to new)</span>
                            </div>
                            <div className="sort-option" onClick={onSetSortCtimeDesc} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSetSortCtimeDesc(); }}} tabIndex={0} role="menuitem">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M12 14 8 18"/><path d="M12 14 16 18"/>
                                </svg>
                                <span>Created time (new to old)</span>
                            </div>
                            <div className="sort-option" onClick={onSetSortCtimeAsc} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSetSortCtimeAsc(); }}} tabIndex={0} role="menuitem">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M12 18 8 14"/><path d="M12 18 16 14"/>
                                </svg>
                                <span>Created time (old to new)</span>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>

            {/* Search Controls */}
            <div className="search-controls">
                <div className="search-input-container">
                    <svg
                        className="search-input-loupe-icon"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <circle cx="11" cy="11" r="8"/>
                        <path d="m21 21-4.35-4.35"/>
                    </svg>
                    <input
                        type="text"
                        placeholder="Filter..."
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        onFocus={onSearchFocus}
                        className="search-input desktop-search"
                    />
                    {searchQuery ? (
                        <svg
                            className="search-input-clear-button"
                            aria-label="Clear search"
                            onClick={onClearSearch}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onClearSearch();
                                }
                            }}
                            tabIndex={0}
                            role="button"
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 16 16"
                        >
                            <circle cx="8" cy="8" r="7" fill="currentColor"/>
                            <line x1="5" y1="5" x2="11" y2="11" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                            <line x1="11" y1="5" x2="5" y2="11" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                    ) : null}
                </div>
            </div>

            {/* Results Count Wrapper */}
            <div
                className={`results-count-wrapper${showLimitDropdown ? ' active' : ''}`}
                onClick={onToggleLimitDropdown}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onToggleLimitDropdown();
                    }
                }}
                tabIndex={0}
                role="button"
                aria-expanded={showLimitDropdown}
            >
                <span className={`results-count${(() => {
                    const limit = parseInt(resultLimit);
                    return limit > 0 && totalCount > limit ? ' limited' : '';
                })()}`}>
                    {(() => {
                        const limit = parseInt(resultLimit);
                        if (limit > 0 && totalCount > limit) {
                            return `${limit.toLocaleString()} result${limit === 1 ? '' : 's'}`;
                        }
                        return `${totalCount.toLocaleString()} result${totalCount === 1 ? '' : 's'}`;
                    })()}
                </span>
                <svg
                    className="results-count-chevron"
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <polyline points="6 9 12 15 18 9"/>
                </svg>
                {showLimitDropdown ? (
                    <div className="limit-dropdown-menu" onClick={(e) => e.stopPropagation()}>
                        <div className="limit-dropdown-label" onClick={(e) => e.stopPropagation()}>Limit number of results</div>
                        <input
                            type="text"
                            inputMode="numeric"
                            className="limit-dropdown-input"
                            placeholder="e.g., 10"
                            value={resultLimit}
                            onKeyDown={(e) => {
                                // Allow: backspace, delete, tab, escape, enter, arrows
                                if ([8, 9, 13, 27, 37, 38, 39, 40, 46].includes(e.keyCode)) {
                                    return;
                                }
                                // Allow: Ctrl/Cmd+A, Ctrl/Cmd+C, Ctrl/Cmd+V, Ctrl/Cmd+X
                                if ((e.ctrlKey || e.metaKey) && [65, 67, 86, 88].includes(e.keyCode)) {
                                    return;
                                }
                                // Block: non-digit keys, or digit 0 if it would be first character
                                if (e.key < '0' || e.key > '9' || (e.key === '0' && resultLimit === '')) {
                                    e.preventDefault();
                                }
                            }}
                            onChange={(e) => {
                                const val = e.target.value;
                                // Only allow positive integers (no leading zeros, no whitespace, no special chars)
                                if (val === '' || /^[1-9]\d*$/.test(val)) {
                                    onResultLimitChange(val);
                                }
                            }}
                            onClick={(e) => e.stopPropagation()}
                        />
                        {resultLimit.trim() && parseInt(resultLimit) > 0 ? (
                            <div
                                className="limit-reset-button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onResetLimit();
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onResetLimit();
                                    }
                                }}
                                tabIndex={0}
                                role="menuitem"
                            >
                                <div className="limit-reset-button-icon">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                                        <path d="M3 3v5h5"></path>
                                    </svg>
                                </div>
                                <div className="limit-reset-button-text">Show all ({totalCount.toLocaleString()})</div>
                            </div>
                        ) : null}
                        {copyMenuItem}
                    </div>
                ) : null}
            </div>

            {/* Create Note Button */}
            <button
                className="create-note-button"
                tabIndex={0}
                onClick={(e) => onCreateNote(e as any)}
                aria-label="Create new note"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
            </button>

            {/* Meta Controls (Shuffle, Open Random, Query Editor, Pin, Settings, Width) */}
            <div className="meta-controls">
                <button
                    className="shuffle-btn"
                    onClick={onShuffle}
                    title="Shuffle"
                    tabIndex={0}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/>
                        <path d="m18 2 4 4-4 4"/>
                        <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/>
                        <path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/>
                        <path d="m18 14 4 4-4 4"/>
                    </svg>
                </button>
                <button
                    className="open-random-btn"
                    onClick={(e) => onOpenRandom(e as any)}
                    title="Open random file (Ctrl/Cmd+Click for new tab)"
                    tabIndex={0}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3Z"></path>
                        <path d="M17 16C17 16.5523 16.5523 17 16 17C15.4477 17 15 16.5523 15 16C15 15.4477 15.4477 15 16 15C16.5523 15 17 15.4477 17 16Z"></path>
                        <path d="M13 12C13 12.5523 12.5523 13 12 13C11.4477 13 11 12.5523 11 12C11 11.4477 11.4477 11 12 11C12.5523 11 13 11.4477 13 12Z"></path>
                        <path d="M9 8C9 8.55228 8.55228 9 8 9C7.44772 9 7 8.55228 7 8C7 7.44772 7.44772 7 8 7C8.55228 7 9 7.44772 9 8Z"></path>
                    </svg>
                </button>
                <div className="query-dropdown-wrapper">
                    <button
                        className="query-toggle-btn"
                        onClick={onToggleCode}
                        title={showQueryEditor ? "Hide query" : "Edit query"}
                        tabIndex={0}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-code-xml-icon lucide-code-xml">
                            <path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>
                        </svg>
                    </button>
                    {showQueryEditor ? (
                        <div className="query-dropdown-menu">
                            <textarea
                                value={draftQuery}
                                onChange={(e) => {
                                    onDraftQueryChange(e.target.value);
                                    e.target.style.height = 'auto';
                                    e.target.style.height = e.target.scrollHeight + 'px';
                                }}
                                className="query-input"
                                placeholder="#tag&#10;path(&quot;path/to/folder&quot;)&#10;key = &quot;value&quot;"
                                ref={(el) => {
                                    if (el) {
                                        el.style.height = 'auto';
                                        el.style.height = el.scrollHeight + 'px';
                                    }
                                }}
                            />
                            <div className="query-footer">
                                <div className="query-tip">
                                    <a href="https://deepwiki.com/blacksmithgu/datacore/4.1-query-language" target="_blank" rel="noopener noreferrer">Datacore Query Language reference</a>
                                </div>
                                <button
                                    className="query-btn query-apply-btn"
                                    tabIndex={0}
                                    onClick={onApplyQuery}
                                >
                                    Apply
                                </button>
                                <button
                                    className="query-btn query-clear-btn"
                                    tabIndex={0}
                                    onClick={onClearQuery}
                                >
                                    Clear
                                </button>
                            </div>
                        </div>
                    ) : null}
                </div>

                {/* Pin Button - Only show if queryHeight is 0 (unlimited) */}
                {queryHeight === 0 ? (
                    <button
                        className="pin-btn"
                        onClick={onTogglePin}
                        title={isPinned ? "Unpin toolbar" : "Pin toolbar"}
                        tabIndex={0}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            {isPinned ? (
                                <>
                                    <path d="M12 17v5"/>
                                    <path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89"/>
                                    <path d="m2 2 20 20"/>
                                    <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"/>
                                </>
                            ) : (
                                <>
                                    <line x1="12" y1="17" x2="12" y2="22"/>
                                    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
                                </>
                            )}
                        </svg>
                    </button>
                ) : null}

                {/* Settings Button */}
                <div className="settings-dropdown-wrapper">
                    <button
                        className="settings-btn"
                        onClick={onToggleSettings}
                        title="Settings"
                        tabIndex={0}
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </button>
                    {showSettings ? (
                        <SettingsPanel
                            dc={dc}
                            settings={settings}
                            onSettingsChange={onSettingsChange}
                        />
                    ) : null}
                </div>

                {/* Width Toggle Button */}
                <button
                    className="width-toggle-btn"
                    onClick={onToggleWidth}
                    title={widthMode === 'max' ? 'Shrink width' : 'Expand width'}
                    tabIndex={0}
                >
                    {widthMode === 'max' ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M8 3v3a2 2 0 0 1-2 2H3"/>
                            <path d="M21 8h-3a2 2 0 0 1-2-2V3"/>
                            <path d="M3 16h3a2 2 0 0 1 2 2v3"/>
                            <path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
                            <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
                            <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
                            <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
                        </svg>
                    )}
                </button>
            </div>
        </div>

        {/* Compact Layout - Search + Results + Create Note (shown only at narrow widths) */}
        <div className="search-controls-compact">
            <div className="search-input-container">
                <svg
                    className="search-input-loupe-icon"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <circle cx="11" cy="11" r="8"/>
                    <path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                    type="text"
                    placeholder="Filter..."
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    onFocus={onSearchFocus}
                    className="search-input desktop-search"
                />
                {searchQuery ? (
                    <svg
                        className="search-input-clear-button"
                        aria-label="Clear search"
                        onClick={onClearSearch}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onClearSearch();
                            }
                        }}
                        tabIndex={0}
                        role="button"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 16 16"
                    >
                        <circle cx="8" cy="8" r="7" fill="currentColor"/>
                        <line x1="5" y1="5" x2="11" y2="11" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                        <line x1="11" y1="5" x2="5" y2="11" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                ) : null}
            </div>
            <div className="compact-bottom-row">
                {/* Results Count Wrapper (Compact) */}
                <div
                    className={`results-count-wrapper-compact${showLimitDropdown ? ' active' : ''}`}
                    onClick={onToggleLimitDropdown}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onToggleLimitDropdown();
                        }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-expanded={showLimitDropdown}
                >
                    <span className={`results-count${(() => {
                        const limit = parseInt(resultLimit);
                        return limit > 0 && totalCount > limit ? ' limited' : '';
                    })()}`}>
                        {(() => {
                            const limit = parseInt(resultLimit);
                            if (limit > 0 && totalCount > limit) {
                                return `${limit.toLocaleString()} result${limit === 1 ? '' : 's'}`;
                            }
                            return `${totalCount.toLocaleString()} result${totalCount === 1 ? '' : 's'}`;
                        })()}
                    </span>
                    <svg
                        className="results-count-chevron"
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                    {showLimitDropdown ? (
                        <div className="limit-dropdown-menu" onClick={(e) => e.stopPropagation()}>
                            <div className="limit-dropdown-label" onClick={(e) => e.stopPropagation()}>Limit number of results</div>
                            <input
                                type="text"
                                inputMode="numeric"
                                className="limit-dropdown-input"
                                placeholder="e.g., 10"
                                value={resultLimit}
                                onKeyDown={(e) => {
                                    // Allow: backspace, delete, tab, escape, enter, arrows
                                    if ([8, 9, 13, 27, 37, 38, 39, 40, 46].includes(e.keyCode)) {
                                        return;
                                    }
                                    // Allow: Ctrl/Cmd+A, Ctrl/Cmd+C, Ctrl/Cmd+V, Ctrl/Cmd+X
                                    if ((e.ctrlKey || e.metaKey) && [65, 67, 86, 88].includes(e.keyCode)) {
                                        return;
                                    }
                                    // Block: non-digit keys, or digit 0 if it would be first character
                                    if (e.key < '0' || e.key > '9' || (e.key === '0' && resultLimit === '')) {
                                        e.preventDefault();
                                    }
                                }}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    // Only allow positive integers (no leading zeros, no whitespace, no special chars)
                                    if (val === '' || /^[1-9]\d*$/.test(val)) {
                                        onResultLimitChange(val);
                                    }
                                }}
                                onClick={(e) => e.stopPropagation()}
                            />
                            {resultLimit.trim() && parseInt(resultLimit) > 0 ? (
                                <div
                                    className="limit-reset-button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onResetLimit();
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            onResetLimit();
                                        }
                                    }}
                                    tabIndex={0}
                                    role="menuitem"
                                >
                                    <div className="limit-reset-button-icon">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                                            <path d="M3 3v5h5"></path>
                                        </svg>
                                    </div>
                                    <div className="limit-reset-button-text">Show all ({totalCount.toLocaleString()})</div>
                                </div>
                            ) : null}
                            {copyMenuItem}
                        </div>
                    ) : null}
                </div>
                {/* Create Note Button (Compact) */}
                <button
                    className="create-note-button-compact"
                    tabIndex={0}
                    onClick={(e) => onCreateNote(e as any)}
                    aria-label="Create new note"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                </button>
            </div>
        </div>
        </>
    );
}
