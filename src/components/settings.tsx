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

            {/* Metadata Display (Left) */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>Metadata display (left)</label>
                    <div className="setting-desc">Set what metadata to show on the left side.</div>
                </div>
                <select
                    value={settings.metadataDisplayLeft}
                    onChange={(e) => {
                        const newValue = e.target.value as 'none' | 'timestamp' | 'tags' | 'path';
                        // Check if this creates a duplicate
                        const isDuplicate = newValue !== 'none' && newValue === settings.metadataDisplayRight;
                        onSettingsChange({
                            metadataDisplayLeft: newValue,
                            // If duplicate, right was first (it wins), left loses
                            metadataDisplayWinner: isDuplicate ? 'right' : null
                        });
                    }}
                    className="dropdown"
                >
                    <option value="timestamp">Timestamp</option>
                    <option value="path">File path</option>
                    <option value="tags">File tags</option>
                    <option value="none">None</option>
                </select>
            </div>

            {/* Metadata Display (Right) */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>Metadata display (right)</label>
                    <div className="setting-desc">Set what metadata to show on the right side.</div>
                </div>
                <select
                    value={settings.metadataDisplayRight}
                    onChange={(e) => {
                        const newValue = e.target.value as 'none' | 'timestamp' | 'tags' | 'path';
                        // Check if this creates a duplicate
                        const isDuplicate = newValue !== 'none' && newValue === settings.metadataDisplayLeft;
                        onSettingsChange({
                            metadataDisplayRight: newValue,
                            // If duplicate, left was first (it wins), right loses
                            metadataDisplayWinner: isDuplicate ? 'left' : null
                        });
                    }}
                    className="dropdown"
                >
                    <option value="timestamp">Timestamp</option>
                    <option value="path">File path</option>
                    <option value="tags">File tags</option>
                    <option value="none">None</option>
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
                    placeholder="Comma-separated if multiple"
                    className="setting-text-input"
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

            {/* Text Preview Property (conditional) */}
            {settings.showTextPreview && (
                <div className="setting-item setting-item-text">
                    <div className="setting-item-info">
                        <label>Text preview property</label>
                        <div className="setting-desc">Set property to show as text preview. Will use first few lines in note if unavailable.</div>
                    </div>
                    <input
                        type="text"
                        value={settings.descriptionProperty}
                        onChange={(e) => onSettingsChange({ descriptionProperty: e.target.value })}
                        placeholder="Comma-separated if multiple"
                        className="setting-text-input"
                    />
                </div>
            )}

            {/* Fall back to note content Toggle */}
            {settings.showTextPreview && (
                <div className="setting-item setting-item-toggle">
                    <div className="setting-item-info">
                        <label>Use note content if text preview property unavailable</label>
                        <div className="setting-desc">Fall back to note content when text preview property is not set or empty.</div>
                    </div>
                    <div
                        className={`checkbox-container ${settings.fallbackToContent ? 'is-enabled' : ''}`}
                        onClick={() => onSettingsChange({ fallbackToContent: !settings.fallbackToContent })}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSettingsChange({ fallbackToContent: !settings.fallbackToContent });
                            }
                        }}
                        tabIndex={0}
                        role="checkbox"
                        aria-checked={settings.fallbackToContent}
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
                        placeholder="Comma-separated if multiple"
                        className="setting-text-input"
                    />
                </div>
            )}

            {/* Fall back to image embeds Toggle */}
            {settings.showThumbnails && (
                <div className="setting-item setting-item-toggle">
                    <div className="setting-item-info">
                        <label>Use in-note images if image property unavailable</label>
                        <div className="setting-desc">Fall back to image embeds from note content when image property is not set or empty.</div>
                    </div>
                    <div
                        className={`checkbox-container ${settings.fallbackToEmbeds ? 'is-enabled' : ''}`}
                        onClick={() => onSettingsChange({ fallbackToEmbeds: !settings.fallbackToEmbeds })}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSettingsChange({ fallbackToEmbeds: !settings.fallbackToEmbeds });
                            }
                        }}
                        tabIndex={0}
                        role="checkbox"
                        aria-checked={settings.fallbackToEmbeds}
                    />
                </div>
            )}

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

            {/* View Height */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>View height</label>
                    <div className="setting-desc">Set maximum height of results area in pixels. Set to 0 for unlimited.</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        className="clickable-icon"
                        aria-label="Restore default"
                        onClick={() => onSettingsChange({ queryHeight: 0 })}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-rotate-ccw">
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                            <path d="M3 3v5h5"/>
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
        </div>
    );
}
