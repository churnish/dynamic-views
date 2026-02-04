import {
  getMinMasonryColumns,
  getMinGridColumns,
  showTimestampIcon,
  getTagStyle,
  getCardSpacing,
  shouldShowRecentTimeOnly,
  shouldShowOlderDateOnly,
  getListSeparator,
  getEmptyValueMarker,
  shouldHideMissingProperties,
  getHideEmptyMode,
  getUrlIcon,
  clearStyleSettingsCache,
  shouldUseBackdropLuminance,
} from "../../src/utils/style-settings";

describe("style-settings", () => {
  let mockGetComputedStyle: jest.SpyInstance;
  let mockClassList: Set<string>;

  beforeEach(() => {
    // Clear CSS variable cache to ensure fresh reads in each test
    clearStyleSettingsCache();

    // Mock getComputedStyle
    mockGetComputedStyle = jest
      .spyOn(window, "getComputedStyle")
      .mockReturnValue({
        getPropertyValue: (name: string) => "",
      } as CSSStyleDeclaration);

    // Mock body classList
    mockClassList = new Set<string>();
    Object.defineProperty(document.body, "classList", {
      value: {
        contains: (className: string) => mockClassList.has(className),
        add: (className: string) => mockClassList.add(className),
        remove: (className: string) => mockClassList.delete(className),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    mockGetComputedStyle.mockRestore();
    mockClassList.clear();
  });

  describe("getMinMasonryColumns", () => {
    it("should return default value of 2", () => {
      expect(getMinMasonryColumns()).toBe(2);
    });

    it("should return custom value from CSS variable", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-min-masonry-columns" ? "3" : "",
      } as CSSStyleDeclaration);

      expect(getMinMasonryColumns()).toBe(3);
    });

    it("should parse value with px unit", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-min-masonry-columns" ? "4px" : "",
      } as CSSStyleDeclaration);

      expect(getMinMasonryColumns()).toBe(4);
    });

    it("should return default for invalid value", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-min-masonry-columns" ? "invalid" : "",
      } as CSSStyleDeclaration);

      expect(getMinMasonryColumns()).toBe(2);
    });

    it("should handle whitespace in CSS variable", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-min-masonry-columns" ? "  5  " : "",
      } as CSSStyleDeclaration);

      expect(getMinMasonryColumns()).toBe(5);
    });
  });

  describe("getMinGridColumns", () => {
    it("should return default value of 1", () => {
      expect(getMinGridColumns()).toBe(1);
    });

    it("should return custom value from CSS variable", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-min-grid-columns" ? "2" : "",
      } as CSSStyleDeclaration);

      expect(getMinGridColumns()).toBe(2);
    });

    it("should handle decimal values", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-min-grid-columns" ? "1.5" : "",
      } as CSSStyleDeclaration);

      expect(getMinGridColumns()).toBe(1.5);
    });
  });

  describe("showTimestampIcon", () => {
    it("should return true by default", () => {
      expect(showTimestampIcon()).toBe(true);
    });

    it("should return false when hide class is present", () => {
      mockClassList.add("dynamic-views-timestamp-icon-hide");
      expect(showTimestampIcon()).toBe(false);
    });

    it("should return true when hide class is removed", () => {
      mockClassList.add("dynamic-views-timestamp-icon-hide");
      mockClassList.delete("dynamic-views-timestamp-icon-hide");
      expect(showTimestampIcon()).toBe(true);
    });
  });

  describe("getTagStyle", () => {
    it('should return "plain" by default', () => {
      expect(getTagStyle()).toBe("plain");
    });

    it('should return "minimal" when minimal class is present', () => {
      mockClassList.add("dynamic-views-tag-style-minimal");
      expect(getTagStyle()).toBe("minimal");
    });

    it('should return "theme" when theme class is present', () => {
      mockClassList.add("dynamic-views-tag-style-theme");
      expect(getTagStyle()).toBe("theme");
    });

    it("should prefer minimal over theme when both are present", () => {
      mockClassList.add("dynamic-views-tag-style-minimal");
      mockClassList.add("dynamic-views-tag-style-theme");
      expect(getTagStyle()).toBe("minimal");
    });

    it("should return plain when both classes are removed", () => {
      mockClassList.add("dynamic-views-tag-style-minimal");
      mockClassList.delete("dynamic-views-tag-style-minimal");
      expect(getTagStyle()).toBe("plain");
    });
  });

  describe("getCardSpacing", () => {
    it("should return default value of 8 on desktop", () => {
      expect(getCardSpacing()).toBe(8);
    });

    it("should return default value of 6 on mobile", () => {
      mockClassList.add("is-mobile");
      expect(getCardSpacing()).toBe(6);
    });

    it("should return custom desktop value from CSS variable", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-card-spacing-desktop" ? "16" : "",
      } as CSSStyleDeclaration);

      expect(getCardSpacing()).toBe(16);
    });

    it("should return custom mobile value from CSS variable", () => {
      mockClassList.add("is-mobile");
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-card-spacing-mobile" ? "10px" : "",
      } as CSSStyleDeclaration);

      expect(getCardSpacing()).toBe(10);
    });

    it("should handle zero value", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-card-spacing-desktop" ? "0" : "",
      } as CSSStyleDeclaration);

      expect(getCardSpacing()).toBe(0);
    });

    it("should return Obsidian spacing for embeds (not in bases leaf)", () => {
      // Create a mock container element that's NOT inside a bases workspace leaf
      const mockContainer = document.createElement("div");
      mockContainer.closest = jest.fn().mockReturnValue(null);

      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) => (name === "--size-4-2" ? "8" : ""),
      } as CSSStyleDeclaration);

      expect(getCardSpacing(mockContainer)).toBe(8);
    });

    it("should return custom spacing when inside bases leaf", () => {
      // Create a mock container element that IS inside a bases workspace leaf
      const mockContainer = document.createElement("div");
      const mockBasesLeaf = document.createElement("div");
      mockContainer.closest = jest.fn().mockReturnValue(mockBasesLeaf);

      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-card-spacing-desktop" ? "12" : "",
      } as CSSStyleDeclaration);

      expect(getCardSpacing(mockContainer)).toBe(12);
    });
  });

  describe("shouldShowRecentTimeOnly", () => {
    it("should return true by default (time only is default behavior)", () => {
      expect(shouldShowRecentTimeOnly()).toBe(true);
    });

    it("should return false when full timestamp class is present", () => {
      mockClassList.add("dynamic-views-timestamp-recent-full");
      expect(shouldShowRecentTimeOnly()).toBe(false);
    });
  });

  describe("shouldShowOlderDateOnly", () => {
    it("should return true by default (date only is default behavior)", () => {
      expect(shouldShowOlderDateOnly()).toBe(true);
    });

    it("should return false when full timestamp class is present", () => {
      mockClassList.add("dynamic-views-timestamp-past-full");
      expect(shouldShowOlderDateOnly()).toBe(false);
    });
  });

  describe("getListSeparator", () => {
    it('should return default ", " (comma space)', () => {
      expect(getListSeparator()).toBe(", ");
    });

    it("should return custom value from CSS variable", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-list-separator" ? '" | "' : "",
      } as CSSStyleDeclaration);

      expect(getListSeparator()).toBe(" | ");
    });

    it("should strip double quotes", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-list-separator" ? '" • "' : "",
      } as CSSStyleDeclaration);

      expect(getListSeparator()).toBe(" • ");
    });

    it("should strip single quotes", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-list-separator" ? "' / '" : "",
      } as CSSStyleDeclaration);

      expect(getListSeparator()).toBe(" / ");
    });

    it("should return default when value is only whitespace (trimmed to empty)", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-list-separator" ? "   " : "",
      } as CSSStyleDeclaration);

      // Whitespace-only is trimmed to empty, so falls back to default
      expect(getListSeparator()).toBe(", ");
    });

    it("should not strip quotes if only one side matches", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-list-separator" ? '"hello' : "",
      } as CSSStyleDeclaration);

      expect(getListSeparator()).toBe('"hello');
    });

    it("should handle empty string after quote stripping", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-list-separator" ? '""' : "",
      } as CSSStyleDeclaration);

      expect(getListSeparator()).toBe(", "); // Falls back to default
    });
  });

  describe("getEmptyValueMarker", () => {
    it('should return default "—" (em dash)', () => {
      expect(getEmptyValueMarker()).toBe("—");
    });

    it("should return custom value from CSS variable", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-empty-value-marker" ? "N/A" : "",
      } as CSSStyleDeclaration);

      expect(getEmptyValueMarker()).toBe("N/A");
    });

    it("should strip double quotes", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-empty-value-marker" ? '"..."' : "",
      } as CSSStyleDeclaration);

      expect(getEmptyValueMarker()).toBe("...");
    });

    it("should strip single quotes", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-empty-value-marker" ? "'—'" : "",
      } as CSSStyleDeclaration);

      expect(getEmptyValueMarker()).toBe("—");
    });

    it("should handle empty string after quote stripping", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-empty-value-marker" ? '""' : "",
      } as CSSStyleDeclaration);

      expect(getEmptyValueMarker()).toBe("—"); // Falls back to default
    });

    it("should preserve special characters", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-empty-value-marker" ? "∅" : "",
      } as CSSStyleDeclaration);

      expect(getEmptyValueMarker()).toBe("∅");
    });
  });

  describe("shouldHideMissingProperties", () => {
    it("should return false by default", () => {
      expect(shouldHideMissingProperties()).toBe(false);
    });

    it("should return true when class is present", () => {
      mockClassList.add("dynamic-views-hide-missing-properties");
      expect(shouldHideMissingProperties()).toBe(true);
    });
  });

  describe("getHideEmptyMode", () => {
    it("should return labels-hidden by default", () => {
      expect(getHideEmptyMode()).toBe("labels-hidden");
    });

    it("should return show when show class is present", () => {
      mockClassList.add("dynamic-views-empty-properties-show");
      expect(getHideEmptyMode()).toBe("show");
    });

    it("should return all when all class is present", () => {
      mockClassList.add("dynamic-views-empty-properties-hide");
      expect(getHideEmptyMode()).toBe("all");
    });
  });

  describe("getUrlIcon", () => {
    it("should return default icon", () => {
      expect(getUrlIcon()).toBe("arrow-up-right");
    });

    it("should return custom value from CSS variable", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-url-icon" ? "external-link" : "",
      } as CSSStyleDeclaration);

      expect(getUrlIcon()).toBe("external-link");
    });

    it("should strip double quotes from value", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-url-icon" ? '"link"' : "",
      } as CSSStyleDeclaration);

      expect(getUrlIcon()).toBe("link");
    });

    it('should strip lowercase "lucide-" prefix', () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-url-icon" ? "lucide-donut" : "",
      } as CSSStyleDeclaration);

      expect(getUrlIcon()).toBe("donut");
    });

    it('should strip mixed-case "Lucide-" prefix', () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-url-icon" ? "Lucide-globe" : "",
      } as CSSStyleDeclaration);

      expect(getUrlIcon()).toBe("globe");
    });

    it('should strip uppercase "LUCIDE-" prefix', () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-url-icon" ? "LUCIDE-arrow-up" : "",
      } as CSSStyleDeclaration);

      expect(getUrlIcon()).toBe("arrow-up");
    });

    it("should handle quoted value with lucide- prefix", () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === "--dynamic-views-url-icon" ? '"lucide-star"' : "",
      } as CSSStyleDeclaration);

      expect(getUrlIcon()).toBe("star");
    });
  });

  describe("shouldUseBackdropLuminance", () => {
    // Helper to set overlay opacity CSS variable
    const setOverlayOpacity = (darkOpacity: number, lightOpacity: number) => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) => {
          if (name === "--dynamic-views-backdrop-overlay-dark")
            return String(darkOpacity);
          if (name === "--dynamic-views-backdrop-overlay-light")
            return String(lightOpacity);
          return "";
        },
      } as CSSStyleDeclaration);
    };

    describe("when adaptive text is disabled", () => {
      beforeEach(() => {
        mockClassList.add("dynamic-views-backdrop-no-adaptive-text");
      });

      it("should return false regardless of tint disabled", () => {
        mockClassList.add("dynamic-views-backdrop-theme-disable");
        expect(shouldUseBackdropLuminance()).toBe(false);
      });

      it("should return false regardless of overlay transparency", () => {
        setOverlayOpacity(0, 0);
        expect(shouldUseBackdropLuminance()).toBe(false);
      });
    });

    describe("when adaptive text is enabled (default)", () => {
      describe("with tint disabled", () => {
        it("should return true", () => {
          mockClassList.add("dynamic-views-backdrop-theme-disable");
          expect(shouldUseBackdropLuminance()).toBe(true);
        });
      });

      describe("with dark tint mode", () => {
        beforeEach(() => {
          mockClassList.add("dynamic-views-backdrop-theme-dark");
        });

        it("should return true when dark overlay is transparent (0)", () => {
          setOverlayOpacity(0, 70);
          expect(shouldUseBackdropLuminance()).toBe(true);
        });

        it("should return false when dark overlay is opaque", () => {
          setOverlayOpacity(70, 0);
          expect(shouldUseBackdropLuminance()).toBe(false);
        });
      });

      describe("with light tint mode", () => {
        beforeEach(() => {
          mockClassList.add("dynamic-views-backdrop-theme-light");
        });

        it("should return true when light overlay is transparent (0)", () => {
          setOverlayOpacity(70, 0);
          expect(shouldUseBackdropLuminance()).toBe(true);
        });

        it("should return false when light overlay is opaque", () => {
          setOverlayOpacity(0, 70);
          expect(shouldUseBackdropLuminance()).toBe(false);
        });
      });

      describe('with "match" mode (no tint class, default behavior)', () => {
        it("should check dark overlay when theme-dark", () => {
          mockClassList.add("theme-dark");
          setOverlayOpacity(0, 70);
          expect(shouldUseBackdropLuminance()).toBe(true);
        });

        it("should return false when dark theme with opaque dark overlay", () => {
          mockClassList.add("theme-dark");
          setOverlayOpacity(70, 0);
          expect(shouldUseBackdropLuminance()).toBe(false);
        });

        it("should check light overlay when theme-light", () => {
          // No theme-dark class = light theme
          setOverlayOpacity(70, 0);
          expect(shouldUseBackdropLuminance()).toBe(true);
        });

        it("should return false when light theme with opaque light overlay", () => {
          setOverlayOpacity(0, 70);
          expect(shouldUseBackdropLuminance()).toBe(false);
        });
      });

      describe("edge cases", () => {
        it("should use default opacity (70) when CSS variable not set", () => {
          // No CSS variables set, defaults to 70 (opaque)
          expect(shouldUseBackdropLuminance()).toBe(false);
        });

        it("should handle non-zero low opacity as opaque", () => {
          setOverlayOpacity(1, 1);
          expect(shouldUseBackdropLuminance()).toBe(false);
        });
      });
    });
  });
});
