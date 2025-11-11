import { Settings as SettingsType } from '../types';
import type { DatacoreAPI } from '../types/datacore';
import type { App } from 'obsidian';
import { getAllVaultProperties } from '../utils/property';

interface SettingsProps {
    dc: DatacoreAPI;
    app: App;
    settings: SettingsType;
    onSettingsChange: (settings: Partial<SettingsType>) => void;
}

export function Settings({
    dc,
    app,
    settings,
    onSettingsChange,
}: SettingsProps): JSX.Element {
    // Get all vault properties for dropdowns
    const allProperties = getAllVaultProperties(app);

    return (
        <div className="settings-dropdown-menu">
            {/* Property Field 1 */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>First property</label>
                    <div className="setting-desc">Property to show in first position</div>
                </div>
                <select
                    value={settings.propertyDisplay1}
                    onChange={(e: unknown) => {
                        const evt = e as Event & { target: HTMLSelectElement };
                        onSettingsChange({ propertyDisplay1: evt.target.value });
                    }}
                    className="dropdown"
                >
                    <option value="">None</option>
                    {allProperties.map((prop): JSX.Element => (
                        <option key={prop} value={prop}>{prop}</option>
                    ))}
                </select>
            </div>

            {/* Property Field 2 */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>Second property</label>
                    <div className="setting-desc">Property to show in second position</div>
                </div>
                <select
                    value={settings.propertyDisplay2}
                    onChange={(e: unknown) => {
                        const evt = e as Event & { target: HTMLSelectElement };
                        onSettingsChange({ propertyDisplay2: evt.target.value });
                    }}
                    className="dropdown"
                >
                    <option value="">None</option>
                    {allProperties.map((prop): JSX.Element => (
                        <option key={prop} value={prop}>{prop}</option>
                    ))}
                </select>
            </div>

            {/* Layout Toggle (1 & 2) */}
            <div className="setting-item setting-item-toggle">
                <div className="setting-item-info">
                    <label>Show first and second properties side-by-side</label>
                    <div className="setting-desc">Display first two properties horizontally</div>
                </div>
                <div
                    className={`checkbox-container ${settings.propertyLayout12SideBySide ? 'is-enabled' : ''}`}
                    onClick={() => onSettingsChange({ propertyLayout12SideBySide: !settings.propertyLayout12SideBySide })}
                    onKeyDown={(e: unknown) => {
                        const evt = e as KeyboardEvent;
                        if (evt.key === 'Enter' || evt.key === ' ') {
                            evt.preventDefault();
                            onSettingsChange({ propertyLayout12SideBySide: !settings.propertyLayout12SideBySide });
                        }
                    }}
                    tabIndex={0}
                    role="checkbox"
                    aria-checked={settings.propertyLayout12SideBySide}
                />
            </div>

            {/* Property Field 3 */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>Third property</label>
                    <div className="setting-desc">Property to show in third position</div>
                </div>
                <select
                    value={settings.propertyDisplay3}
                    onChange={(e: unknown) => {
                        const evt = e as Event & { target: HTMLSelectElement };
                        onSettingsChange({ propertyDisplay3: evt.target.value });
                    }}
                    className="dropdown"
                >
                    <option value="">None</option>
                    {allProperties.map((prop): JSX.Element => (
                        <option key={prop} value={prop}>{prop}</option>
                    ))}
                </select>
            </div>

            {/* Property Field 4 */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>Fourth property</label>
                    <div className="setting-desc">Property to show in fourth position</div>
                </div>
                <select
                    value={settings.propertyDisplay4}
                    onChange={(e: unknown) => {
                        const evt = e as Event & { target: HTMLSelectElement };
                        onSettingsChange({ propertyDisplay4: evt.target.value });
                    }}
                    className="dropdown"
                >
                    <option value="">None</option>
                    {allProperties.map((prop): JSX.Element => (
                        <option key={prop} value={prop}>{prop}</option>
                    ))}
                </select>
            </div>

            {/* Layout Toggle (3 & 4) */}
            <div className="setting-item setting-item-toggle">
                <div className="setting-item-info">
                    <label>Show third and fourth properties side-by-side</label>
                    <div className="setting-desc">Display third and fourth properties horizontally</div>
                </div>
                <div
                    className={`checkbox-container ${settings.propertyLayout34SideBySide ? 'is-enabled' : ''}`}
                    onClick={() => onSettingsChange({ propertyLayout34SideBySide: !settings.propertyLayout34SideBySide })}
                    onKeyDown={(e: unknown) => {
                        const evt = e as KeyboardEvent;
                        if (evt.key === 'Enter' || evt.key === ' ') {
                            evt.preventDefault();
                            onSettingsChange({ propertyLayout34SideBySide: !settings.propertyLayout34SideBySide });
                        }
                    }}
                    tabIndex={0}
                    role="checkbox"
                    aria-checked={settings.propertyLayout34SideBySide}
                />
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
                    onChange={(e: unknown) => {
                        const evt = e as Event & { target: HTMLInputElement };
                        onSettingsChange({ titleProperty: evt.target.value });
                    }}
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
                    onKeyDown={(e: unknown) => {
                        const evt = e as KeyboardEvent;
                        if (evt.key === 'Enter' || evt.key === ' ') {
                            evt.preventDefault();
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
                        onChange={(e: unknown) => {
                            const evt = e as Event & { target: HTMLInputElement };
                            onSettingsChange({ descriptionProperty: evt.target.value });
                        }}
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
                        onKeyDown={(e: unknown) => {
                            const evt = e as KeyboardEvent;
                            if (evt.key === 'Enter' || evt.key === ' ') {
                                evt.preventDefault();
                                onSettingsChange({ fallbackToContent: !settings.fallbackToContent });
                            }
                        }}
                        tabIndex={0}
                        role="checkbox"
                        aria-checked={settings.fallbackToContent}
                    />
                </div>
            )}

            {/* Card Image Dropdown */}
            <div className="setting-item setting-item-dropdown">
                <div className="setting-item-info">
                    <label>Card image</label>
                    <div className="setting-desc">Display first image embed in note (wikilink or markdown format), or first value of image property.</div>
                </div>
                <select
                    value={settings.imageFormat}
                    onChange={(e: unknown) => {
                        const evt = e as Event & { target: HTMLSelectElement };
                        onSettingsChange({ imageFormat: evt.target.value as 'none' | 'thumbnail' | 'cover' });
                    }}
                    className="dropdown"
                >
                    <option value="none">No image</option>
                    <option value="thumbnail">Thumbnail</option>
                    <option value="cover">Cover</option>
                </select>
            </div>

            {/* Image Property (conditional) */}
            {settings.imageFormat !== 'none' && (
                <div className="setting-item setting-item-text">
                    <div className="setting-item-info">
                        <label>Image property</label>
                        <div className="setting-desc">Set property to show as thumbnail. Will use first image embed in note if unavailable. Supports: .avif, .bmp, .gif, .jpeg, .jpg, .png, .svg, .webp</div>
                    </div>
                    <input
                        type="text"
                        value={settings.imageProperty}
                        onChange={(e: unknown) => {
                            const evt = e as Event & { target: HTMLInputElement };
                            onSettingsChange({ imageProperty: evt.target.value });
                        }}
                        placeholder="Comma-separated if multiple"
                        className="setting-text-input"
                    />
                </div>
            )}

            {/* Fall back to image embeds Toggle */}
            {settings.imageFormat !== 'none' && (
                <div className="setting-item setting-item-toggle">
                    <div className="setting-item-info">
                        <label>Use in-note images if image property unavailable</label>
                        <div className="setting-desc">Fall back to image embeds from note content when image property is not set or empty.</div>
                    </div>
                    <div
                        className={`checkbox-container ${settings.fallbackToEmbeds ? 'is-enabled' : ''}`}
                        onClick={() => onSettingsChange({ fallbackToEmbeds: !settings.fallbackToEmbeds })}
                        onKeyDown={(e: unknown) => {
                            const evt = e as KeyboardEvent;
                            if (evt.key === 'Enter' || evt.key === ' ') {
                                evt.preventDefault();
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
                    onChange={(e: unknown) => {
                        const evt = e as Event & { target: HTMLSelectElement };
                        onSettingsChange({ listMarker: evt.target.value as 'bullet' | 'number' | 'none' });
                    }}
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
                        onChange={(e: unknown) => {
                            const evt = e as Event & { target: HTMLInputElement };
                            const val = parseInt(evt.target.value);
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
