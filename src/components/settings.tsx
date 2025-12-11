import { Settings as SettingsType } from "../types";
import type { DatacoreAPI } from "../types/datacore";
import type { App } from "obsidian";

interface SettingsProps {
  dc: DatacoreAPI;
  app: App;
  settings: SettingsType;
  onSettingsChange: (settings: Partial<SettingsType>) => void;
  menuRef?: { current: HTMLDivElement | null };
}

// Property group configuration
interface PropertyGroupConfig {
  key: string;
  label: string;
  firstProp: keyof SettingsType;
  secondProp: keyof SettingsType;
  sideBySide: keyof SettingsType;
  position: keyof SettingsType;
}

const PROPERTY_GROUPS: PropertyGroupConfig[] = [
  {
    key: "propertyGroup1",
    label: "Property group 1",
    firstProp: "propertyDisplay1",
    secondProp: "propertyDisplay2",
    sideBySide: "propertyGroup1SideBySide",
    position: "propertyGroup1Position",
  },
  {
    key: "propertyGroup2",
    label: "Property group 2",
    firstProp: "propertyDisplay3",
    secondProp: "propertyDisplay4",
    sideBySide: "propertyGroup2SideBySide",
    position: "propertyGroup2Position",
  },
  {
    key: "propertyGroup3",
    label: "Property group 3",
    firstProp: "propertyDisplay5",
    secondProp: "propertyDisplay6",
    sideBySide: "propertyGroup3SideBySide",
    position: "propertyGroup3Position",
  },
  {
    key: "propertyGroup4",
    label: "Property group 4",
    firstProp: "propertyDisplay7",
    secondProp: "propertyDisplay8",
    sideBySide: "propertyGroup4SideBySide",
    position: "propertyGroup4Position",
  },
  {
    key: "propertyGroup5",
    label: "Property group 5",
    firstProp: "propertyDisplay9",
    secondProp: "propertyDisplay10",
    sideBySide: "propertyGroup5SideBySide",
    position: "propertyGroup5Position",
  },
  {
    key: "propertyGroup6",
    label: "Property group 6",
    firstProp: "propertyDisplay11",
    secondProp: "propertyDisplay12",
    sideBySide: "propertyGroup6SideBySide",
    position: "propertyGroup6Position",
  },
  {
    key: "propertyGroup7",
    label: "Property group 7",
    firstProp: "propertyDisplay13",
    secondProp: "propertyDisplay14",
    sideBySide: "propertyGroup7SideBySide",
    position: "propertyGroup7Position",
  },
];

// Keyboard handler for Enter/Space activation
const handleKeyboardActivate = (action: () => void) => (e: unknown) => {
  const evt = e as KeyboardEvent;
  if (evt.key === "Enter" || evt.key === " ") {
    evt.preventDefault();
    action();
  }
};

export function Settings({
  dc,
  app,
  settings,
  onSettingsChange,
  menuRef,
}: SettingsProps): JSX.Element {
  // Section expansion state - all collapsed by default
  const [expandedSections, setExpandedSections] = dc.useState<
    Record<string, boolean>
  >({
    title: false,
    textPreview: false,
    image: false,
    properties: false,
    propertyGroup1: false,
    propertyGroup2: false,
    propertyGroup3: false,
    propertyGroup4: false,
    propertyGroup5: false,
    propertyGroup6: false,
    propertyGroup7: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev: Record<string, boolean>) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // Chevron SVG for section headers

  const chevronSvg: JSX.Element = (
    <svg
      className="chevron"
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
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );

  // Helper to render a collapsible section header
  const renderSectionHeader = (
    sectionKey: string,
    label: string,
  ): JSX.Element => (
    <div
      className={`settings-section-header ${expandedSections[sectionKey] ? "" : "collapsed"}`}
      onClick={() => toggleSection(sectionKey)}
      onKeyDown={handleKeyboardActivate(() => toggleSection(sectionKey))}
      tabIndex={0}
      role="button"
      aria-expanded={expandedSections[sectionKey]}
    >
      {chevronSvg}
      <span>{label}</span>
    </div>
  );

  // Helper to render a toggle (checkbox) setting
  const renderToggle = (
    label: string,
    settingKey: keyof SettingsType,
  ): JSX.Element => (
    <div className="setting-item setting-item-toggle">
      <div className="setting-item-info">
        <label>{label}</label>
      </div>
      <div
        className={`checkbox-container ${settings[settingKey] ? "is-enabled" : ""}`}
        onClick={() =>
          onSettingsChange({ [settingKey]: !settings[settingKey] })
        }
        onKeyDown={handleKeyboardActivate(() =>
          onSettingsChange({ [settingKey]: !settings[settingKey] }),
        )}
        tabIndex={0}
        role="checkbox"
        aria-checked={settings[settingKey] as boolean}
      />
    </div>
  );

  // Helper to render a text input setting
  const renderTextInput = (
    label: string,
    settingKey: keyof SettingsType,
    placeholder?: string,
  ): JSX.Element => (
    <div className="setting-item setting-item-text">
      <div className="setting-item-info">
        <label>{label}</label>
      </div>
      <input
        type="text"
        value={settings[settingKey] as string}
        onChange={(e: unknown) => {
          const evt = e as Event & { target: HTMLInputElement };
          onSettingsChange({ [settingKey]: evt.target.value });
        }}
        placeholder={placeholder}
        className="setting-text-input"
      />
    </div>
  );

  // Render a property group section
  const renderPropertyGroup = (group: PropertyGroupConfig): JSX.Element => (
    <div className="settings-section" key={group.key}>
      {renderSectionHeader(group.key, group.label)}
      <div
        className={`settings-section-content ${expandedSections[group.key] ? "" : "collapsed"}`}
      >
        {renderTextInput(
          "First property",
          group.firstProp,
          "Enter property name",
        )}
        {renderTextInput(
          "Second property",
          group.secondProp,
          "Enter property name",
        )}
        {renderToggle("Show side-by-side", group.sideBySide)}
        <div className="setting-item setting-item-dropdown">
          <div className="setting-item-info">
            <label>Position</label>
          </div>
          <select
            value={settings[group.position] as string}
            onChange={(e: unknown) => {
              const evt = e as Event & { target: HTMLSelectElement };
              onSettingsChange({
                [group.position]: evt.target.value as "top" | "bottom",
              });
            }}
            className="dropdown"
          >
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
          </select>
        </div>
      </div>
    </div>
  );

  return (
    <div ref={menuRef} className="settings-dropdown-menu">
      {/* Card Size Slider - standalone */}
      <div className="setting-item">
        <div className="setting-item-info">
          <label>Card size</label>
          <div className="setting-desc">Minimum width of cards in pixels</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
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

      {/* Title Section */}
      <div className="settings-section">
        {renderSectionHeader("title", "Title")}
        <div
          className={`settings-section-content ${expandedSections.title ? "" : "collapsed"}`}
        >
          {renderToggle("Show title", "showTitle")}
          {renderTextInput(
            "Title property",
            "titleProperty",
            "Comma-separated if multiple",
          )}
        </div>
      </div>

      {/* Text Preview Section */}
      <div className="settings-section">
        {renderSectionHeader("textPreview", "Text preview")}
        <div
          className={`settings-section-content ${expandedSections.textPreview ? "" : "collapsed"}`}
        >
          {renderToggle("Show text preview", "showTextPreview")}
          {renderTextInput(
            "Text preview property",
            "textPreviewProperty",
            "Comma-separated if multiple",
          )}
          {renderToggle(
            "Use note content if property missing or empty",
            "fallbackToContent",
          )}
        </div>
      </div>

      {/* Image Section */}
      <div className="settings-section">
        {renderSectionHeader("image", "Image")}
        <div
          className={`settings-section-content ${expandedSections.image ? "" : "collapsed"}`}
        >
          <div className="setting-item setting-item-dropdown">
            <div className="setting-item-info">
              <label>Format</label>
            </div>
            <select
              value={(() => {
                const imageFormatParts = settings.imageFormat.split("-");
                return settings.imageFormat === "none"
                  ? "none"
                  : (imageFormatParts[0] as "thumbnail" | "cover");
              })()}
              onChange={(e: unknown) => {
                const evt = e as Event & { target: HTMLSelectElement };
                const newFormat = evt.target.value;
                if (newFormat === "none") {
                  onSettingsChange({ imageFormat: "none" });
                } else {
                  const currentPosition =
                    settings.imageFormat === "none"
                      ? "right"
                      : settings.imageFormat.split("-")[1] || "right";
                  onSettingsChange({
                    imageFormat:
                      `${newFormat}-${currentPosition}` as typeof settings.imageFormat,
                  });
                }
              }}
              className="dropdown"
            >
              <option value="thumbnail">Thumbnail</option>
              <option value="cover">Cover</option>
              <option value="none">None</option>
            </select>
          </div>
          <div className="setting-item setting-item-dropdown">
            <div className="setting-item-info">
              <label>Position</label>
            </div>
            <select
              value={(() => {
                const position = settings.imageFormat.split("-")[1] as
                  | "left"
                  | "right"
                  | "top"
                  | "bottom"
                  | undefined;
                return position || "right";
              })()}
              onChange={(e: unknown) => {
                const evt = e as Event & { target: HTMLSelectElement };
                const currentFormat = settings.imageFormat.split("-")[0] as
                  | "thumbnail"
                  | "cover";
                onSettingsChange({
                  imageFormat:
                    `${currentFormat}-${evt.target.value}` as typeof settings.imageFormat,
                });
              }}
              className="dropdown"
            >
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
            </select>
          </div>
          {renderTextInput(
            "Image property",
            "imageProperty",
            "Comma-separated if multiple",
          )}
          <div className="setting-item setting-item-dropdown">
            <div className="setting-item-info">
              <label>Show image embeds</label>
            </div>
            <select
              value={settings.fallbackToEmbeds}
              onChange={(e: unknown) => {
                const evt = e as Event & { target: HTMLSelectElement };
                onSettingsChange({
                  fallbackToEmbeds: evt.target.value as
                    | "always"
                    | "if-empty"
                    | "never",
                });
              }}
              className="dropdown"
            >
              <option value="always">Always</option>
              <option value="if-empty">If property missing or empty</option>
              <option value="never">Never</option>
            </select>
          </div>
          <div className="setting-item setting-item-dropdown">
            <div className="setting-item-info">
              <label>Fit</label>
            </div>
            <select
              value={settings.coverFitMode}
              onChange={(e: unknown) => {
                const evt = e as Event & { target: HTMLSelectElement };
                onSettingsChange({
                  coverFitMode: evt.target.value as "crop" | "contain",
                });
              }}
              className="dropdown"
            >
              <option value="crop">Crop</option>
              <option value="contain">Contain</option>
            </select>
          </div>
          <div className="setting-item">
            <div className="setting-item-info">
              <label>Ratio</label>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="range"
                min="0.25"
                max="2.5"
                step="0.05"
                value={settings.imageAspectRatio}
                onChange={(e: unknown) => {
                  const evt = e as Event & { target: HTMLInputElement };
                  onSettingsChange({
                    imageAspectRatio: parseFloat(evt.target.value),
                  });
                }}
                style={{ flex: 1 }}
              />
              <span style={{ minWidth: "40px" }}>
                {settings.imageAspectRatio.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Properties Section */}
      <div className="settings-section">
        {renderSectionHeader("properties", "Properties")}
        <div
          className={`settings-section-content ${expandedSections.properties ? "" : "collapsed"}`}
        >
          {renderTextInput(
            "Subtitle property",
            "subtitleProperty",
            "Comma-separated if multiple",
          )}
          {renderTextInput(
            "URL property",
            "urlProperty",
            "Comma-separated if multiple",
          )}
          <div className="setting-item setting-item-dropdown">
            <div className="setting-item-info">
              <label>Property labels</label>
            </div>
            <select
              value={settings.propertyLabels}
              onChange={(e: unknown) => {
                const evt = e as Event & { target: HTMLSelectElement };
                onSettingsChange({
                  propertyLabels: evt.target.value as
                    | "hide"
                    | "inline"
                    | "above",
                });
              }}
              className="dropdown"
            >
              <option value="inline">Inline</option>
              <option value="above">On top</option>
              <option value="hide">Hide</option>
            </select>
          </div>
        </div>
      </div>

      {/* Property Groups 1-7 */}
      {PROPERTY_GROUPS.map(renderPropertyGroup)}

      {/* Datacore-specific settings */}
      <div className="setting-item setting-item-dropdown">
        <div className="setting-item-info">
          <label>List marker</label>
          <div className="setting-desc">Marker style for list view</div>
        </div>
        <select
          value={settings.listMarker}
          onChange={(e: unknown) => {
            const evt = e as Event & { target: HTMLSelectElement };
            onSettingsChange({
              listMarker: evt.target.value as "bullet" | "number" | "none",
            });
          }}
          className="dropdown"
        >
          <option value="bullet">Bullet</option>
          <option value="number">Number</option>
          <option value="none">None</option>
        </select>
      </div>

      <div className="setting-item setting-item-text">
        <div className="setting-item-info">
          <label>View height</label>
          <div className="setting-desc">
            Maximum height of results area in pixels (0 for unlimited)
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            className="clickable-icon"
            aria-label="Restore default"
            onClick={() => onSettingsChange({ queryHeight: 0 })}
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
              className="lucide lucide-rotate-ccw"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
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
            style={{ width: "80px" }}
          />
        </div>
      </div>
    </div>
  );
}
