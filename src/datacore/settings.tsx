import {
  Settings as SettingsType,
  ViewMode,
  DefaultViewSettings,
} from "../types";
import type { DatacoreAPI } from "./types";
import type { TFile } from "obsidian";
import type DynamicViewsPlugin from "../../main";

interface SettingsProps {
  dc: DatacoreAPI;
  settings: SettingsType;
  onSettingsChange: (settings: Partial<SettingsType>) => void;
  menuRef?: { current: HTMLDivElement | null };
  plugin: DynamicViewsPlugin;
  currentFile: TFile | null;
  viewMode: ViewMode;
}

// Property set configuration
interface PropertySetConfig {
  key: string;
  label: string;
  firstProp: keyof SettingsType;
  secondProp: keyof SettingsType;
  firstLabel: string;
  secondLabel: string;
  sideBySide: keyof SettingsType;
  above: keyof SettingsType;
}

const PROPERTY_SETS: PropertySetConfig[] = [
  {
    key: "propertySet1",
    label: "Property set 1",
    firstProp: "propertyDisplay1",
    secondProp: "propertyDisplay2",
    firstLabel: "Property 1",
    secondLabel: "Property 2",
    sideBySide: "propertySet1SideBySide",
    above: "propertySet1Above",
  },
  {
    key: "propertySet2",
    label: "Property set 2",
    firstProp: "propertyDisplay3",
    secondProp: "propertyDisplay4",
    firstLabel: "Property 3",
    secondLabel: "Property 4",
    sideBySide: "propertySet2SideBySide",
    above: "propertySet2Above",
  },
  {
    key: "propertySet3",
    label: "Property set 3",
    firstProp: "propertyDisplay5",
    secondProp: "propertyDisplay6",
    firstLabel: "Property 5",
    secondLabel: "Property 6",
    sideBySide: "propertySet3SideBySide",
    above: "propertySet3Above",
  },
  {
    key: "propertySet4",
    label: "Property set 4",
    firstProp: "propertyDisplay7",
    secondProp: "propertyDisplay8",
    firstLabel: "Property 7",
    secondLabel: "Property 8",
    sideBySide: "propertySet4SideBySide",
    above: "propertySet4Above",
  },
  {
    key: "propertySet5",
    label: "Property set 5",
    firstProp: "propertyDisplay9",
    secondProp: "propertyDisplay10",
    firstLabel: "Property 9",
    secondLabel: "Property 10",
    sideBySide: "propertySet5SideBySide",
    above: "propertySet5Above",
  },
  {
    key: "propertySet6",
    label: "Property set 6",
    firstProp: "propertyDisplay11",
    secondProp: "propertyDisplay12",
    firstLabel: "Property 11",
    secondLabel: "Property 12",
    sideBySide: "propertySet6SideBySide",
    above: "propertySet6Above",
  },
  {
    key: "propertySet7",
    label: "Property set 7",
    firstProp: "propertyDisplay13",
    secondProp: "propertyDisplay14",
    firstLabel: "Property 13",
    secondLabel: "Property 14",
    sideBySide: "propertySet7SideBySide",
    above: "propertySet7Above",
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
    propertySet1: false,
    propertySet2: false,
    propertySet3: false,
    propertySet4: false,
    propertySet5: false,
    propertySet6: false,
    propertySet7: false,
    more: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev: Record<string, boolean>) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // Datacore settings are per-file (shared across all view modes)
  // Always use "grid" template (settings shared across card/masonry/list modes)
  const templateType = "grid";

  // Template toggle state - check if snapshot exists
  const [isTemplate, setIsTemplate] = dc.useState(
    plugin.persistenceManager.getTemplateSnapshot(templateType) !== null,
  );

  const handleToggleTemplate = (enabled: boolean) => {
    console.log(
      `[datacore-settings] handleToggleTemplate called: enabled=${enabled}`,
    );
    if (enabled) {
      // Extract current settings
      const settingsSnapshot: Partial<DefaultViewSettings> = {
        titleProperty: settings.titleProperty,
        textPreviewProperty: settings.textPreviewProperty,
        imageProperty: settings.imageProperty,
        urlProperty: settings.urlProperty,
        subtitleProperty: settings.subtitleProperty,
        propertyDisplay1: settings.propertyDisplay1,
        propertyDisplay2: settings.propertyDisplay2,
        propertyDisplay3: settings.propertyDisplay3,
        propertyDisplay4: settings.propertyDisplay4,
        propertyDisplay5: settings.propertyDisplay5,
        propertyDisplay6: settings.propertyDisplay6,
        propertyDisplay7: settings.propertyDisplay7,
        propertyDisplay8: settings.propertyDisplay8,
        propertyDisplay9: settings.propertyDisplay9,
        propertyDisplay10: settings.propertyDisplay10,
        propertyDisplay11: settings.propertyDisplay11,
        propertyDisplay12: settings.propertyDisplay12,
        propertyDisplay13: settings.propertyDisplay13,
        propertyDisplay14: settings.propertyDisplay14,
        propertySet1SideBySide: settings.propertySet1SideBySide,
        propertySet2SideBySide: settings.propertySet2SideBySide,
        propertySet3SideBySide: settings.propertySet3SideBySide,
        propertySet4SideBySide: settings.propertySet4SideBySide,
        propertySet5SideBySide: settings.propertySet5SideBySide,
        propertySet6SideBySide: settings.propertySet6SideBySide,
        propertySet7SideBySide: settings.propertySet7SideBySide,
        propertySet1Above: settings.propertySet1Above,
        propertySet2Above: settings.propertySet2Above,
        propertySet3Above: settings.propertySet3Above,
        propertySet4Above: settings.propertySet4Above,
        propertySet5Above: settings.propertySet5Above,
        propertySet6Above: settings.propertySet6Above,
        propertySet7Above: settings.propertySet7Above,
        propertyLabels: settings.propertyLabels,
        fallbackToContent: settings.fallbackToContent,
        fallbackToEmbeds: settings.fallbackToEmbeds,
        imageFormat: settings.imageFormat,
        imageFit: settings.imageFit,
        imageAspectRatio: settings.imageAspectRatio,
        queryHeight: settings.queryHeight,
        listMarker: settings.listMarker,
        cardSize: settings.cardSize,
        cssclasses: settings.cssclasses,
      };

      // Wrap in TemplateSnapshot with timestamp
      const timestamp = Date.now();
      console.log(
        `[datacore-settings] Saving template snapshot with timestamp: ${timestamp}`,
      );
      void plugin.persistenceManager.setTemplateSnapshot(templateType, {
        settings: settingsSnapshot,
        setAt: timestamp,
      });
    } else {
      // Clear template
      console.log(`[datacore-settings] Clearing template snapshot`);
      void plugin.persistenceManager.setTemplateSnapshot(templateType, null);
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

  // Render a property set section
  const renderPropertySet = (group: PropertySetConfig): JSX.Element => (
    <div className="settings-section" key={group.key}>
      {renderSectionHeader(group.key, group.label)}
      <div
        className={`settings-section-content ${expandedSections[group.key] ? "" : "collapsed"}`}
      >
        {renderTextInput(
          group.firstLabel,
          group.firstProp,
          "Enter property name",
        )}
        {renderTextInput(
          group.secondLabel,
          group.secondProp,
          "Enter property name",
        )}
        {renderToggle("Show side-by-side", group.sideBySide)}
        {renderToggle("Show above text preview", group.above)}
      </div>
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
          {renderTextInput(
            "URL property",
            "urlProperty",
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
          <div className="setting-item setting-item-dropdown">
            <div className="setting-item-info">
              <label>Format</label>
            </div>
            <select
              value={(() => {
                if (settings.imageFormat === "none") return "none";
                if (settings.imageFormat === "poster") return "poster";
                if (settings.imageFormat === "backdrop") return "backdrop";
                const imageFormatParts = settings.imageFormat.split("-");
                return imageFormatParts[0] as "thumbnail" | "cover";
              })()}
              onChange={(e: unknown) => {
                const evt = e as Event & { target: HTMLSelectElement };
                const newFormat = evt.target.value;
                if (
                  newFormat === "none" ||
                  newFormat === "poster" ||
                  newFormat === "backdrop"
                ) {
                  onSettingsChange({
                    imageFormat: newFormat as typeof settings.imageFormat,
                  });
                } else {
                  const currentPosition =
                    settings.imageFormat === "none" ||
                    settings.imageFormat === "poster" ||
                    settings.imageFormat === "backdrop"
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
              <option value="poster">Poster</option>
              <option value="backdrop">Backdrop</option>
            </select>
          </div>
          {settings.imageFormat !== "none" &&
            settings.imageFormat !== "poster" &&
            settings.imageFormat !== "backdrop" && (
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
            )}
          {settings.imageFormat !== "none" &&
            settings.imageFormat !== "poster" &&
            settings.imageFormat !== "backdrop" && (
              <>
                <div className="setting-item setting-item-dropdown">
                  <div className="setting-item-info">
                    <label>Fit</label>
                  </div>
                  <select
                    value={settings.imageFit}
                    onChange={(e: unknown) => {
                      const evt = e as Event & { target: HTMLSelectElement };
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
        </div>
      </div>

      {/* Property Sets 1-7 */}
      {PROPERTY_SETS.map(renderPropertySet)}

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

      {/* Datacore-specific settings */}
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
    </div>
  );
}
