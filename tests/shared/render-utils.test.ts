import {
  formatTimestamp,
  shouldShowTimestampIcon,
  getTimestampIcon,
  isDateValue,
  extractTimestamp,
} from "../../src/shared/render-utils";
import type { Settings } from "../../src/types";

// Mock moment.js
jest.mock("moment", () => {
  const mockMoment = (ts: number) => ({
    format: jest.fn((fmt: string) => `${ts}-${fmt}`),
  });
  return mockMoment;
});

// Mock style-settings module
jest.mock("../../src/utils/style-settings", () => ({
  shouldShowRecentTimeOnly: jest.fn(),
  shouldShowOlderDateOnly: jest.fn(),
  getDatetimeFormat: jest.fn(() => "YYYY-MM-DD HH:mm"),
  getDateFormat: jest.fn(() => "YYYY-MM-DD"),
  getTimeFormat: jest.fn(() => "HH:mm"),
  showTimestampIcon: jest.fn(),
}));

describe("render-utils", () => {
  let mockStyleSettings: {
    shouldShowRecentTimeOnly: jest.Mock;
    shouldShowOlderDateOnly: jest.Mock;
    getDatetimeFormat: jest.Mock;
    getDateFormat: jest.Mock;
    getTimeFormat: jest.Mock;
    showTimestampIcon: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mockStyleSettings = require("../../src/utils/style-settings");
    mockStyleSettings.shouldShowRecentTimeOnly.mockReturnValue(true);
    mockStyleSettings.shouldShowOlderDateOnly.mockReturnValue(true);
  });

  describe("formatTimestamp", () => {
    it("should format date-only timestamps using date format", () => {
      const result = formatTimestamp(1000000, true, false);
      expect(result).toBe("1000000-YYYY-MM-DD");
    });

    it("should format recent styled timestamps as time only when setting enabled", () => {
      const now = Date.now();
      const recentTimestamp = now - 1000; // 1 second ago

      const result = formatTimestamp(recentTimestamp, false, true);
      expect(result).toBe(`${recentTimestamp}-HH:mm`);
      expect(mockStyleSettings.getTimeFormat).toHaveBeenCalled();
    });

    it("should format older styled timestamps as date only when setting enabled", () => {
      const now = Date.now();
      const oldTimestamp = now - 86400000 * 2; // 2 days ago

      const result = formatTimestamp(oldTimestamp, false, true);
      expect(result).toBe(`${oldTimestamp}-YYYY-MM-DD`);
      expect(mockStyleSettings.getDateFormat).toHaveBeenCalled();
    });

    it("should treat yesterday at 11pm as older (not today), not recent", () => {
      // Even if yesterday 11pm is only 13 hours ago at 10am today,
      // it should be "older" because it's not today's calendar date
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(23, 0, 0, 0); // 11pm yesterday

      const result = formatTimestamp(yesterday.getTime(), false, true);
      expect(result).toBe(`${yesterday.getTime()}-YYYY-MM-DD`);
      expect(mockStyleSettings.getDateFormat).toHaveBeenCalled();
    });

    it("should treat earlier today as recent (same calendar date)", () => {
      // A timestamp from earlier today should be "recent" (same calendar date)
      const now = new Date();
      const earlierToday = new Date(now);
      earlierToday.setHours(
        Math.max(0, now.getHours() - 1),
        now.getMinutes(),
        0,
        0,
      ); // 1 hour ago, same day

      const result = formatTimestamp(earlierToday.getTime(), false, true);
      expect(result).toBe(`${earlierToday.getTime()}-HH:mm`);
      expect(mockStyleSettings.getTimeFormat).toHaveBeenCalled();
    });

    it("should format styled timestamps as full datetime when settings disabled", () => {
      mockStyleSettings.shouldShowRecentTimeOnly.mockReturnValue(false);
      mockStyleSettings.shouldShowOlderDateOnly.mockReturnValue(false);

      const now = Date.now();
      const recentTimestamp = now - 1000;

      const result = formatTimestamp(recentTimestamp, false, true);
      expect(result).toBe(`${recentTimestamp}-YYYY-MM-DD HH:mm`);
    });

    it("should format non-styled timestamps as full datetime", () => {
      const result = formatTimestamp(1000000, false, false);
      expect(result).toBe("1000000-YYYY-MM-DD HH:mm");
    });

    it("should handle zero timestamp", () => {
      const result = formatTimestamp(0, false, false);
      expect(result).toBe("0-YYYY-MM-DD HH:mm");
    });

    it("should handle NaN timestamp gracefully", () => {
      const result = formatTimestamp(NaN, false, true);
      // NaN comparisons fail (isToday = false), treated as "older" → date only
      expect(result).toBe("NaN-YYYY-MM-DD");
    });

    it("should treat future timestamp on same calendar day as today", () => {
      const now = new Date();
      const laterToday = new Date(now);
      laterToday.setHours(23, 59, 59, 999);

      const result = formatTimestamp(laterToday.getTime(), false, true);
      expect(result).toBe(`${laterToday.getTime()}-HH:mm`);
    });

    it("should show full datetime for future day timestamps", () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(12, 0, 0, 0);

      const result = formatTimestamp(tomorrow.getTime(), false, true);
      expect(result).toBe(`${tomorrow.getTime()}-YYYY-MM-DD HH:mm`);
    });

    it("should show full datetime for older timestamps when shouldShowOlderDateOnly is false", () => {
      mockStyleSettings.shouldShowRecentTimeOnly.mockReturnValue(true);
      mockStyleSettings.shouldShowOlderDateOnly.mockReturnValue(false);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const result = formatTimestamp(yesterday.getTime(), false, true);
      expect(result).toBe(`${yesterday.getTime()}-YYYY-MM-DD HH:mm`);
    });

    it("should show full datetime for today when shouldShowRecentTimeOnly is false", () => {
      mockStyleSettings.shouldShowRecentTimeOnly.mockReturnValue(false);
      mockStyleSettings.shouldShowOlderDateOnly.mockReturnValue(true);

      const now = Date.now();
      const result = formatTimestamp(now - 1000, false, true);
      expect(result).toBe(`${now - 1000}-YYYY-MM-DD HH:mm`);
    });
  });

  describe("shouldShowTimestampIcon", () => {
    it("should return true when style-settings returns true", () => {
      mockStyleSettings.showTimestampIcon.mockReturnValue(true);
      expect(shouldShowTimestampIcon()).toBe(true);
    });

    it("should return false when style-settings returns false", () => {
      mockStyleSettings.showTimestampIcon.mockReturnValue(false);
      expect(shouldShowTimestampIcon()).toBe(false);
    });
  });

  describe("getTimestampIcon", () => {
    const baseSettings = {
      createdTimeProperty: "",
    } as Settings;

    it('should return "calendar" for file.ctime', () => {
      expect(getTimestampIcon("file.ctime", baseSettings)).toBe("calendar");
    });

    it('should return "calendar" for "created time"', () => {
      expect(getTimestampIcon("created time", baseSettings)).toBe("calendar");
    });

    it('should return "calendar" for custom createdTimeProperty', () => {
      const settings = {
        ...baseSettings,
        createdTimeProperty: "date_created",
      } as Settings;
      expect(getTimestampIcon("date_created", settings)).toBe("calendar");
    });

    it('should return "clock" for other properties', () => {
      expect(getTimestampIcon("file.mtime", baseSettings)).toBe("clock");
      expect(getTimestampIcon("modified time", baseSettings)).toBe("clock");
      expect(getTimestampIcon("updated", baseSettings)).toBe("clock");
    });
  });

  describe("isDateValue", () => {
    it("should return true for valid DateValue with time:true", () => {
      const value = { date: new Date(), time: true };
      expect(isDateValue(value)).toBe(true);
    });

    it("should return true for valid DateValue with time:false", () => {
      const value = { date: new Date(), time: false };
      expect(isDateValue(value)).toBe(true);
    });

    it("should return false for object missing time property", () => {
      const value = { date: new Date() };
      expect(isDateValue(value)).toBe(false);
    });

    it("should return false for null/undefined/primitives", () => {
      expect(isDateValue(null)).toBe(false);
      expect(isDateValue(undefined)).toBe(false);
      expect(isDateValue("2024-01-01")).toBe(false);
      expect(isDateValue(1704067200000)).toBe(false);
      expect(isDateValue({})).toBe(false);
    });

    it("should return false for invalid Date objects", () => {
      const invalidDate = new Date(NaN);
      const value = { date: invalidDate, time: true };
      expect(isDateValue(value)).toBe(false);
    });
  });

  describe("extractTimestamp", () => {
    it("should extract timestamp from valid DateValue with time:true", () => {
      const date = new Date("2024-01-01T12:00:00Z");
      const value = { date, time: true };

      const result = extractTimestamp(value);

      expect(result).toEqual({
        timestamp: date.getTime(),
        isDateOnly: false,
      });
    });

    it("should extract timestamp from valid DateValue with time:false", () => {
      const date = new Date("2024-01-01");
      const value = { date, time: false };

      const result = extractTimestamp(value);

      expect(result).toEqual({
        timestamp: date.getTime(),
        isDateOnly: true,
      });
    });

    it("should return null for invalid values", () => {
      expect(extractTimestamp(null)).toBeNull();
      expect(extractTimestamp(undefined)).toBeNull();
      expect(extractTimestamp("2024-01-01")).toBeNull();
      expect(extractTimestamp({ date: new Date() })).toBeNull();
    });
  });
});
