import { Settings as SettingsType } from '../types';
import type { DatacoreAPI } from '../types/datacore';
import type { App } from 'obsidian';
import { getAllVaultProperties } from '../utils/property';

interface SettingsProps {
    dc: DatacoreAPI;
    app: App;
    settings: SettingsType;
    onSettingsChange: (settings: Partial<SettingsType>) => void;
    menuRef?: { current: HTMLDivElement | null };
}

export function Settings({
    dc,
    app,
    settings,
    onSettingsChange,
    menuRef,
}: SettingsProps): JSX.Element {
    // Get all vault properties for dropdowns
    const allProperties = getAllVaultProperties(app);

    return (
        <div ref={menuRef} className="settings-dropdown-menu">
            {/* 1. Card Size Slider */}
            <div className="setting-item">
                <div className="setting-item-info">
                    <label>Card size</label>
                    <div className="setting-desc">Minimum width of cards in pixels</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                        type="range"
                        min="50"
                        max="800"
                        step="10"
                        value={settings.cardSize}
                        aria-label={String(settings.cardSize)}
                        onChange={(e: unknown) => {
                            const evt = e as Event & { target: HTMLInputElement };
                            onSettingsChange({ cardSize: parseInt(evt.target.value) });
                        }}
                        style={{ flex: 1 }}
                    />
                </div>
            </div>

            {/* 2. Show Title Toggle */}
            <div className="setting-item setting-item-toggle">
                <div className="setting-item-info">
                    <label>Show title</label>
                    <div className="setting-desc">Display note title on cards</div>
                </div>
                <div
                    className={`checkbox-container ${settings.showTitle ? 'is-enabled' : ''}`}
                    onClick={() => onSettingsChange({ showTitle: !settings.showTitle })}
                    onKeyDown={(e: unknown) => {
                        const evt = e as KeyboardEvent;
                        if (evt.key === 'Enter' || evt.key === ' ') {
                            evt.preventDefault();
                            onSettingsChange({ showTitle: !settings.showTitle });
                        }
                    }}
                    tabIndex={0}
                    role="checkbox"
                    aria-checked={settings.showTitle}
                />
            </div>

            {/* 3. Title Property */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>Title property</label>
                    <div className="setting-desc">Property to show as card title</div>
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

            {/* 4. Show Text Preview Toggle */}
            <div className="setting-item setting-item-toggle">
                <div className="setting-item-info">
                    <label>Show text preview</label>
                    <div className="setting-desc">Display note excerpts</div>
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

            {/* 5. Text Preview Property */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>Text preview property</label>
                    <div className="setting-desc">Property to show as text preview</div>
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

            {/* 6. Use Note Content if Text Preview Property Missing or Empty */}
            <div className="setting-item setting-item-toggle">
                <div className="setting-item-info">
                    <label>Use note content if text preview property missing or empty</label>
                    <div className="setting-desc">Fall back to note content when text preview property is not set or empty</div>
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

            {/* 7. Card Image Dropdown */}
            <div className="setting-item setting-item-dropdown">
                <div className="setting-item-info">
                    <label>Image format</label>
                    <div className="setting-desc">Display first image embed in note (wikilink or markdown format), or first value of image property</div>
                </div>
                <select
                    value={(() => {
                        const imageFormatParts = settings.imageFormat.split('-');
                        return settings.imageFormat === 'none' ? 'none' : imageFormatParts[0] as 'thumbnail' | 'cover';
                    })()}
                    onChange={(e: unknown) => {
                        const evt = e as Event & { target: HTMLSelectElement };
                        const newFormat = evt.target.value;
                        if (newFormat === 'none') {
                            onSettingsChange({ imageFormat: 'none' });
                        } else {
                            const currentPosition = settings.imageFormat === 'none' ? 'right' : (settings.imageFormat.split('-')[1] || 'right');
                            onSettingsChange({ imageFormat: `${newFormat}-${currentPosition}` as typeof settings.imageFormat });
                        }
                    }}
                    className="dropdown"
                >
                    <option value="thumbnail">Thumbnail</option>
                    <option value="cover">Cover</option>
                    <option value="none">None</option>
                </select>
            </div>

            {/* 8. Image Position Dropdown */}
            <div className="setting-item setting-item-dropdown">
                <div className="setting-item-info">
                    <label>Image position</label>
                    <div className="setting-desc">Position of the image within the card</div>
                </div>
                <select
                    value={(() => {
                        const position = settings.imageFormat.split('-')[1] as 'left' | 'right' | 'top' | 'bottom' | undefined;
                        return position || 'right';
                    })()}
                    onChange={(e: unknown) => {
                        const evt = e as Event & { target: HTMLSelectElement };
                        const currentFormat = settings.imageFormat.split('-')[0] as 'thumbnail' | 'cover';
                        onSettingsChange({ imageFormat: `${currentFormat}-${evt.target.value}` as typeof settings.imageFormat });
                    }}
                    className="dropdown"
                >
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                    <option value="top">Top</option>
                    <option value="bottom">Bottom</option>
                </select>
            </div>

            {/* 9. Image Property */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>Image property</label>
                    <div className="setting-desc">Property to show as image</div>
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

            {/* 10. Show Image Embeds Dropdown */}
            <div className="setting-item setting-item-dropdown">
                <div className="setting-item-info">
                    <label>Show image embeds</label>
                    <div className="setting-desc">Control when in-note image embeds are shown alongside image property values</div>
                </div>
                <select
                    value={settings.fallbackToEmbeds}
                    onChange={(e: unknown) => {
                        const evt = e as Event & { target: HTMLSelectElement };
                        onSettingsChange({ fallbackToEmbeds: evt.target.value as 'always' | 'if-empty' | 'never' });
                    }}
                    className="dropdown"
                >
                    <option value="always">Always</option>
                    <option value="if-empty">If property missing or empty</option>
                    <option value="never">Never</option>
                </select>
            </div>

            {/* 11. Image Fit Dropdown */}
            <div className="setting-item setting-item-dropdown">
                <div className="setting-item-info">
                    <label>Image fit</label>
                    <div className="setting-desc">How cover images are displayed (crop fills container, contain shows full image)</div>
                </div>
                <select
                    value={settings.coverFitMode}
                    onChange={(e: unknown) => {
                        const evt = e as Event & { target: HTMLSelectElement };
                        onSettingsChange({ coverFitMode: evt.target.value as 'crop' | 'contain' });
                    }}
                    className="dropdown"
                >
                    <option value="crop">Crop</option>
                    <option value="contain">Contain</option>
                </select>
            </div>

            {/* 12. Image Ratio Slider */}
            <div className="setting-item">
                <div className="setting-item-info">
                    <label>Image ratio</label>
                    <div className="setting-desc">Aspect ratio of images</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                        type="range"
                        min="0.25"
                        max="2.5"
                        step="0.05"
                        value={settings.imageAspectRatio}
                        onChange={(e: unknown) => {
                            const evt = e as Event & { target: HTMLInputElement };
                            onSettingsChange({ imageAspectRatio: parseFloat(evt.target.value) });
                        }}
                        style={{ flex: 1 }}
                    />
                    <span style={{ minWidth: '40px' }}>{settings.imageAspectRatio.toFixed(2)}</span>
                </div>
            </div>

            {/* 13. First Property */}
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

            {/* 14. Second Property */}
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

            {/* 15. Pair First and Second Properties */}
            <div className="setting-item setting-item-toggle">
                <div className="setting-item-info">
                    <label>Pair first and second properties</label>
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

            {/* 16. Third Property */}
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

            {/* 17. Fourth Property */}
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

            {/* 18. Pair Third and Fourth Properties */}
            <div className="setting-item setting-item-toggle">
                <div className="setting-item-info">
                    <label>Pair third and fourth properties</label>
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

            {/* 19. Show Property Labels */}
            <div className="setting-item setting-item-dropdown">
                <div className="setting-item-info">
                    <label>Show property labels</label>
                    <div className="setting-desc">Display labels for property values</div>
                </div>
                <select
                    value={settings.propertyLabels}
                    onChange={(e: unknown) => {
                        const evt = e as Event & { target: HTMLSelectElement };
                        onSettingsChange({ propertyLabels: evt.target.value as 'hide' | 'inline' | 'above' });
                    }}
                    className="dropdown"
                >
                    <option value="inline">Inline</option>
                    <option value="above">On top</option>
                    <option value="hide">Hide</option>
                </select>
            </div>

            {/* 20. List Marker */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>List marker</label>
                    <div className="setting-desc">Marker style for list view</div>
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

            {/* 21. View Height */}
            <div className="setting-item setting-item-text">
                <div className="setting-item-info">
                    <label>View height</label>
                    <div className="setting-desc">Maximum height of results area in pixels (0 for unlimited)</div>
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
