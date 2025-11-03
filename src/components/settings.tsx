import { Settings as SettingsType } from '../types';

interface SettingsProps {
    dc: any;
    settings: SettingsType;
    localizeSettings: boolean;
    onSettingsChange: (settings: Partial<SettingsType>) => void;
    onLocalizeSettingsChange: (value: boolean) => void;
}

export function Settings({
    dc,
    settings,
    localizeSettings,
    onSettingsChange,
    onLocalizeSettingsChange,
}: SettingsProps) {
    return (
        <div className="settings-dropdown-menu">
            {/* Localize Settings Toggle */}
            <div className="setting-item setting-item-toggle">
                <div className="setting-item-info">
                    <label>Store settings in this query</label>
                    <div className="setting-desc">Apply the settings below to this query only rather than to all queries on this device.</div>
                </div>
                <div
                    className={`checkbox-container ${localizeSettings ? 'is-enabled' : ''}`}
                    onClick={() => onLocalizeSettingsChange(!localizeSettings)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onLocalizeSettingsChange(!localizeSettings);
                        }
                    }}
                    tabIndex={0}
                    role="checkbox"
                    aria-checked={localizeSettings}
                />
            </div>

            {/* Show Text Preview Toggle */}
            <div className="setting-item setting-item-toggle">
                <div className="setting-item-info">
                    <label>Show text preview</label>
                    <div className="setting-desc">Display note excerpts.</div>
                </div>
                <div
                    className={`checkbox-container ${settings.showTextPreview ? 'is-enabled' : ''}`}
                    onClick={() => onSettingsChange({ showTextPreview: !settings.showTextPreview })}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSettingsChange({ showTextPreview: !settings.showTextPreview });
                        }
                    }}
                    tabIndex={0}
                    role="checkbox"
                    aria-checked={settings.showTextPreview}
                />
            </div>

            {/* Omit First Line Toggle (conditional) */}
            {settings.showTextPreview && (
                <div className="setting-item setting-item-toggle">
                    <div className="setting-item-info">
                        <label>Omit first line in preview</label>
                        <div className="setting-desc">Always skip first line in text previews (in addition to automatic omission when first line matches title/filename).</div>
                    </div>
                    <div
                        className={`checkbox-container ${settings.alwaysOmitFirstLine ? 'is-enabled' : ''}`}
                        onClick={() => onSettingsChange({ alwaysOmitFirstLine: !settings.alwaysOmitFirstLine })}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSettingsChange({ alwaysOmitFirstLine: !settings.alwaysOmitFirstLine });
                            }
                        }}
                        tabIndex={0}
                        role="checkbox"
                        aria-checked={settings.alwaysOmitFirstLine}
                    />
                </div>
            )}

            {/* Show Thumbnails Toggle */}
            <div className="setting-item setting-item-toggle">
                <div className="setting-item-info">
                    <label>Show thumbnails</label>
                    <div className="setting-desc">Display first image embed in note (wikilink or markdown format), or first value of image property.</div>
                </div>
                <div
                    className={`checkbox-container ${settings.showThumbnails ? 'is-enabled' : ''}`}
                    onClick={() => onSettingsChange({ showThumbnails: !settings.showThumbnails })}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSettingsChange({ showThumbnails: !settings.showThumbnails });
                        }
                    }}
                    tabIndex={0}
                    role="checkbox"
                    aria-checked={settings.showThumbnails}
                />
            </div>

            {/* Show Timestamp Toggle */}
            <div className="setting-item setting-item-toggle">
                <div className="setting-item-info">
                    <label>Show timestamp</label>
                    <div className="setting-desc">Display file modification or creation timestamp in cards.</div>
                </div>
                <div
                    className={`checkbox-container ${settings.showTimestamp ? 'is-enabled' : ''}`}
                    onClick={() => onSettingsChange({ showTimestamp: !settings.showTimestamp })}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSettingsChange({ showTimestamp: !settings.showTimestamp });
                        }
                    }}
                    tabIndex={0}
                    role="checkbox"
                    aria-checked={settings.showTimestamp}
                />
            </div>

            {/* Show Timestamp Icon Toggle (conditional) */}
            {settings.showTimestamp && (
                <div className="setting-item setting-item-toggle">
                    <div className="setting-item-info">
                        <label>Show timestamp icon</label>
                        <div className="setting-desc">Show icon to differentiate between <i>modified</i> and <i>created</i> timestamps.</div>
                    </div>
                    <div
                        className={`checkbox-container ${settings.showTimestampIcon ? 'is-enabled' : ''}`}
                        onClick={() => onSettingsChange({ showTimestampIcon: !settings.showTimestampIcon })}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSettingsChange({ showTimestampIcon: !settings.showTimestampIcon });
                            }
                        }}
                        tabIndex={0}
                        role="checkbox"
                        aria-checked={settings.showTimestampIcon}
                    />
                </div>
            )}

            {/* Add Card Background Toggle */}
            <div className="setting-item setting-item-toggle">
                <div className="setting-item-info">
                    <label>Tint card background</label>
                    <div className="setting-desc">Darken card background slightly.</div>
                </div>
                <div
                    className={`checkbox-container ${settings.addCardBackground ? 'is-enabled' : ''}`}
                    onClick={() => onSettingsChange({ addCardBackground: !settings.addCardBackground })}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSettingsChange({ addCardBackground: !settings.addCardBackground });
                        }
                    }}
                    tabIndex={0}
                    role="checkbox"
                    aria-checked={settings.addCardBackground}
                />
            </div>

            {/* Thumbnail Cache Size */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>Thumbnail cache size</label>
                    <div className="setting-desc">Set how many thumbnails to keep in memory. Larger cache shows fewer placeholders but uses more memory.</div>
                </div>
                <select
                    value={settings.thumbnailCacheSize}
                    onChange={(e) => onSettingsChange({ thumbnailCacheSize: e.target.value })}
                    className="dropdown"
                >
                    <option value="minimal">Minimal</option>
                    <option value="small">Small</option>
                    <option value="balanced">Balanced</option>
                    <option value="large">Large</option>
                    <option value="unlimited">Unlimited</option>
                </select>
            </div>

            {/* File Metadata Display */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>File metadata display</label>
                    <div className="setting-desc">Set what metadata to show.</div>
                </div>
                <select
                    value={settings.cardBottomDisplay}
                    onChange={(e) => onSettingsChange({ cardBottomDisplay: e.target.value })}
                    className="dropdown"
                >
                    <option value="tags">File tags</option>
                    <option value="path">File path</option>
                    <option value="none">Nothing</option>
                </select>
            </div>

            {/* List Marker */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>List marker</label>
                    <div className="setting-desc">Set marker style for list view.</div>
                </div>
                <select
                    value={settings.listMarker}
                    onChange={(e) => onSettingsChange({ listMarker: e.target.value })}
                    className="dropdown"
                >
                    <option value="bullet">Bullet</option>
                    <option value="number">Number</option>
                    <option value="none">None</option>
                </select>
            </div>

            {/* Smallest Number of Masonry Columns */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>Smallest number of masonry columns</label>
                    <div className="setting-desc">Set minimum number of columns in masonry layout on narrow screens.</div>
                </div>
                <select
                    value={settings.minMasonryColumns}
                    onChange={(e) => onSettingsChange({ minMasonryColumns: parseInt(e.target.value) })}
                    className="dropdown"
                >
                    <option value="1">One</option>
                    <option value="2">Two</option>
                </select>
            </div>

            {/* Randomize Action */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>Randomize action</label>
                    <div className="setting-desc">Choose what the Randomize button does.</div>
                </div>
                <select
                    value={settings.randomizeAction}
                    onChange={(e) => onSettingsChange({ randomizeAction: e.target.value })}
                    className="dropdown"
                >
                    <option value="shuffle">Shuffle order</option>
                    <option value="open">Open random file</option>
                </select>
            </div>

            {/* View Height */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>View height</label>
                    <div className="setting-desc">Set maximum height of results area in pixels. Set to 0 for unlimited.</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        className="clickable-icon"
                        aria-label="Reset to default (0)"
                        onClick={() => onSettingsChange({ queryHeight: 0 })}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1 4 1 10 7 10"/>
                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                        </svg>
                    </button>
                    <input
                        type="number"
                        min="0"
                        placeholder="500"
                        value={settings.queryHeight}
                        onChange={(e) => {
                            const val = parseInt(e.target.value);
                            if (!isNaN(val) && val >= 0) {
                                onSettingsChange({ queryHeight: val });
                            }
                        }}
                        style={{ width: '80px' }}
                    />
                </div>
            </div>

            {/* Open File Action */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>Open file action</label>
                    <div className="setting-desc">Set whether pressing on card or title should open file, or only when pressing on title.</div>
                </div>
                <select
                    value={settings.openFileAction}
                    onChange={(e) => onSettingsChange({ openFileAction: e.target.value })}
                    className="dropdown"
                >
                    <option value="card">Card or title</option>
                    <option value="title">Title only</option>
                </select>
            </div>

            {/* Title Property */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>Title property</label>
                    <div className="setting-desc">Set property to show as file title. Will use filename if unavailable.</div>
                </div>
                <input
                    type="text"
                    value={settings.titleProperty}
                    onChange={(e) => onSettingsChange({ titleProperty: e.target.value })}
                    placeholder="title"
                    className="setting-text-input"
                />
            </div>

            {/* Description Property (conditional) */}
            {settings.showTextPreview && (
                <div className="setting-item setting-item-text">
                    <div className="setting-item-info">
                        <label>Description property</label>
                        <div className="setting-desc">Set property to show as text preview. Will use first few lines in note if unavailable.</div>
                    </div>
                    <input
                        type="text"
                        value={settings.descriptionProperty}
                        onChange={(e) => onSettingsChange({ descriptionProperty: e.target.value })}
                        placeholder="description"
                        className="setting-text-input"
                    />
                </div>
            )}

            {/* Image Property (conditional) */}
            {settings.showThumbnails && (
                <div className="setting-item setting-item-text">
                    <div className="setting-item-info">
                        <label>Image property</label>
                        <div className="setting-desc">Set property to show as thumbnail. Will use first image embed in note if unavailable. Supports: .avif, .bmp, .gif, .jpeg, .jpg, .png, .svg, .webp</div>
                    </div>
                    <input
                        type="text"
                        value={settings.imageProperty}
                        onChange={(e) => onSettingsChange({ imageProperty: e.target.value })}
                        placeholder="cover"
                        className="setting-text-input"
                    />
                </div>
            )}
        </div>
    );
}
