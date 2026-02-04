import {
  ResolvedSettings,
  ViewMode,
  ViewDefaults,
  DatacoreDefaults,
} from "../types";
import type { DatacoreAPI } from "./types";
import type { TFile } from "obsidian";
import type DynamicViews from "../../main";

interface SettingsProps {
  dc: DatacoreAPI;
  settings: ResolvedSettings;
  onSettingsChange: (settings: Partial<ResolvedSettings>) => void;
  menuRef?: { current: HTMLDivElement | null };
  plugin: DynamicViews;
  currentFile: TFile | null;
  viewMode: ViewMode;
}

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
  settings,
  onSettingsChange,
  menuRef,
  plugin,
  currentFile,
  viewMode,
}: SettingsProps): JSX.Element {
  // Section expansion state - all collapsed by default
  const [expandedSections, setExpandedSections] = dc.useState<
    Record<string, boolean>
  >({
    title: false,
    textPreview: false,
    image: false,
    properties: false,
    more: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev: Record<string, boolean>) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // Datacore has one template shared across all view modes (card/masonry/list)
  const templateType = "datacore" as const;

  // Template toggle state - check if template exists
  const [isTemplate, setIsTemplate] = dc.useState(
    plugin.persistenceManager.getSettingsTemplate(templateType) != null,
  );

  const handleToggleTemplate = (enabled: boolean) => {
    if (enabled) {
      // Extract current settings
      const templateSettings: Partial<ViewDefaults & DatacoreDefaults> = {
        titleProperty: settings.titleProperty,
        textPreviewProperty: settings.textPreviewProperty,
        imageProperty: settings.imageProperty,
        urlProperty: settings.urlProperty,
        subtitleProperty: settings.subtitleProperty,
        propertyLabels: settings.propertyLabels,
        fallbackToContent: settings.fallbackToContent,
        fallbackToEmbeds: settings.fallbackToEmbeds,
        imageFormat: settings.imageFormat,
        imagePosition: settings.imagePosition,
        imageFit: settings.imageFit,
        imageRatio: settings.imageRatio,
        queryHeight: settings.queryHeight,
        listMarker: settings.listMarker,
        cardSize: settings.cardSize,
        cssclasses: settings.cssclasses,
        minimumColumns: settings.minimumColumns,
        textPreviewLines: settings.textPreviewLines,
        ambientBackground: settings.ambientBackground,
      };

      const timestamp = Date.now();
      void plugin.persistenceManager.setSettingsTemplate(templateType, {
        settings: templateSettings,
        setAt: timestamp,
      });
    } else {
      // Clear template
      void plugin.persistenceManager.setSettingsTemplate(templateType, null);
    }
    setIsTemplate(enabled);
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
    settingKey: keyof ResolvedSettings,
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
    settingKey: keyof ResolvedSettings,
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

  return (
    <div ref={menuRef} className="settings-dropdown-menu">
      {/* Card Size Slider - standalone */}
      <div className="setting-item">
        <div className="setting-item-info">
          <label>Card size</label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="range"
            min="50"
            max="800"
            step="10"
            value={settings.cardSize}
            onChange={(e: unknown) => {
              const evt = e as Event & { target: HTMLInputElement };
              onSettingsChange({ cardSize: parseInt(evt.target.value) });
            }}
            style={{ flex: 1 }}
          />
          <span className="slider-value">{settings.cardSize}</span>
        </div>
      </div>

      {/* Header Section */}
      <div className="settings-section">
        {renderSectionHeader("title", "Header")}
        <div
          className={`settings-section-content ${expandedSections.title ? "" : "collapsed"}`}
        >
          {renderTextInput(
            "Title property",
            "titleProperty",
            "Comma-separated if multiple",
          )}
          {renderTextInput(
            "Subtitle property",
            "subtitleProperty",
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
          {renderTextInput(
            "Text preview property",
            "textPreviewProperty",
            "Comma-separated if multiple",
          )}
          {renderToggle(
            "Use note content if property missing or empty",
            "fallbackToContent",
          )}
          {(settings.textPreviewProperty || settings.fallbackToContent) && (
            <div className="setting-item">
              <div className="setting-item-info">
                <label>Lines</label>
              </div>
              <div
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={settings.textPreviewLines}
                  onChange={(e: unknown) => {
                    const evt = e as Event & { target: HTMLInputElement };
                    onSettingsChange({
                      textPreviewLines: parseInt(evt.target.value),
                    });
                  }}
                  style={{ flex: 1 }}
                />
                <span className="slider-value">
                  {settings.textPreviewLines}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Image Section */}
      <div className="settings-section">
        {renderSectionHeader("image", "Image")}
        <div
          className={`settings-section-content ${expandedSections.image ? "" : "collapsed"}`}
        >
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
                    | "if-unavailable"
                    | "never",
                });
              }}
              className="dropdown"
            >
              <option value="always">Always</option>
              <option value="if-unavailable">
                If no available property images
              </option>
              <option value="never">Never</option>
            </select>
          </div>
          {!(
            !settings.imageProperty && settings.fallbackToEmbeds === "never"
          ) && (
            <>
              <div className="setting-item setting-item-dropdown">
                <div className="setting-item-info">
                  <label>Format</label>
                </div>
                <select
                  value={settings.imageFormat}
                  onChange={(e: unknown) => {
                    const evt = e as Event & { target: HTMLSelectElement };
                    onSettingsChange({
                      imageFormat: evt.target
                        .value as typeof settings.imageFormat,
                    });
                  }}
                  className="dropdown"
                >
                  <option value="thumbnail">Thumbnail</option>
                  <option value="cover">Cover</option>
                  <option value="poster">Poster</option>
                  <option value="backdrop">Backdrop</option>
                </select>
              </div>
              {settings.imageFormat !== "poster" &&
                settings.imageFormat !== "backdrop" && (
                  <div className="setting-item setting-item-dropdown">
                    <div className="setting-item-info">
                      <label>Position</label>
                    </div>
                    <select
                      value={settings.imagePosition}
                      onChange={(e: unknown) => {
                        const evt = e as Event & { target: HTMLSelectElement };
                        onSettingsChange({
                          imagePosition: evt.target
                            .value as typeof settings.imagePosition,
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
                )}
              {settings.imageFormat !== "backdrop" && (
                <div className="setting-item setting-item-dropdown">
                  <div className="setting-item-info">
                    <label>Fit</label>
                  </div>
                  <select
                    value={settings.imageFit}
                    onChange={(e: unknown) => {
                      const evt = e as Event & {
                        target: HTMLSelectElement;
                      };
                      onSettingsChange({
                        imageFit: evt.target.value as "crop" | "contain",
                      });
                    }}
                    className="dropdown"
                  >
                    <option value="crop">Crop</option>
                    <option value="contain">Contain</option>
                  </select>
                </div>
              )}
              {settings.imageFormat !== "backdrop" && (
                <div className="setting-item">
                  <div className="setting-item-info">
                    <label>Ratio</label>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <input
                      type="range"
                      min="0.25"
                      max="2.5"
                      step="0.05"
                      value={settings.imageRatio}
                      onChange={(e: unknown) => {
                        const evt = e as Event & {
                          target: HTMLInputElement;
                        };
                        onSettingsChange({
                          imageRatio: parseFloat(evt.target.value),
                        });
                      }}
                      style={{ flex: 1 }}
                    />
                    <span style={{ minWidth: "40px" }}>
                      {settings.imageRatio.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
              {(settings.imageFormat === "thumbnail" ||
                settings.imageFormat === "cover") && (
                <div className="setting-item setting-item-dropdown">
                  <div className="setting-item-info">
                    <label>Ambient background</label>
                  </div>
                  <select
                    value={settings.ambientBackground}
                    onChange={(e: unknown) => {
                      const evt = e as Event & { target: HTMLSelectElement };
                      onSettingsChange({
                        ambientBackground: evt.target.value as
                          | "subtle"
                          | "dramatic"
                          | "disable",
                      });
                    }}
                    className="dropdown"
                  >
                    <option value="subtle">Subtle</option>
                    <option value="dramatic">Dramatic</option>
                    <option value="disable">Disable</option>
                  </select>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Properties Section */}
      <div className="settings-section">
        {renderSectionHeader("properties", "Properties")}
        <div
          className={`settings-section-content ${expandedSections.properties ? "" : "collapsed"}`}
        >
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
          {renderTextInput(
            "URL property",
            "urlProperty",
            "Comma-separated if multiple",
          )}
        </div>
      </div>

      {/* Other Section */}
      <div className="settings-section">
        {renderSectionHeader("more", "Other")}
        <div
          className={`settings-section-content ${expandedSections.more ? "" : "collapsed"}`}
        >
          {renderTextInput(
            "cssclasses",
            "cssclasses",
            "Comma-separated if multiple",
          )}
          <div className="setting-item setting-item-dropdown">
            <div className="setting-item-info">
              <label>Minimum columns</label>
            </div>
            <select
              value={settings.minimumColumns}
              onChange={(e: unknown) => {
                const evt = e as Event & { target: HTMLSelectElement };
                onSettingsChange({
                  minimumColumns: parseInt(evt.target.value) as 1 | 2,
                });
              }}
              className="dropdown"
            >
              <option value={1}>One</option>
              <option value={2}>Two</option>
            </select>
          </div>
          <div className="setting-item setting-item-dropdown">
            <div className="setting-item-info">
              <label>List marker</label>
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
          <div className="setting-item setting-item-toggle">
            <div className="setting-item-info">
              <label>Use these settings for new views</label>
            </div>
            <div
              className={`checkbox-container ${isTemplate ? "is-enabled" : ""}`}
              onClick={() => handleToggleTemplate(!isTemplate)}
              tabIndex={0}
              role="checkbox"
              aria-checked={isTemplate}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
