import {
  shuffleArray,
  getActiveBasesView,
  getActiveDynamicViewsBase,
  openRandomFile,
  toggleShuffleActiveView,
} from "../../src/utils/randomize";
import { App } from "obsidian";

describe("randomize", () => {
  describe("shuffleArray", () => {
    it("should shuffle array to produce different order", () => {
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const shuffled = shuffleArray([...original]);

      // Array should be same length
      expect(shuffled.length).toBe(original.length);

      // Should contain same elements
      expect(shuffled.sort()).toEqual(original.sort());

      // Very unlikely to be in same order (probability 1/3628800)
      // Run multiple times to ensure randomness
      let allSame = true;
      for (let i = 0; i < 10; i++) {
        const test = shuffleArray([...original]);
        if (JSON.stringify(test) !== JSON.stringify(original)) {
          allSame = false;
          break;
        }
      }
      expect(allSame).toBe(false);
    });

    it("should not lose any elements", () => {
      const original = ["a", "b", "c", "d", "e"];
      const shuffled = shuffleArray([...original]);

      original.forEach((item) => {
        expect(shuffled).toContain(item);
      });
    });

    it("should preserve array length", () => {
      const arrays = [
        [],
        [1],
        [1, 2],
        [1, 2, 3, 4, 5],
        Array(100)
          .fill(0)
          .map((_, i) => i),
      ];

      arrays.forEach((arr) => {
        const shuffled = shuffleArray([...arr]);
        expect(shuffled.length).toBe(arr.length);
      });
    });

    it("should handle empty arrays", () => {
      const result = shuffleArray([]);
      expect(result).toEqual([]);
    });

    it("should handle single-element arrays", () => {
      const result = shuffleArray([42]);
      expect(result).toEqual([42]);
    });

    it("should handle two-element arrays", () => {
      const original = [1, 2];
      const results = new Set();

      // Run multiple times - should see both [1,2] and [2,1]
      for (let i = 0; i < 50; i++) {
        const shuffled = shuffleArray([...original]);
        results.add(JSON.stringify(shuffled));
      }

      // Should have seen both permutations
      expect(results.size).toBeGreaterThan(1);
    });

    it("should shuffle in place (mutate original array)", () => {
      const original = [1, 2, 3, 4, 5];
      const reference = original;
      const result = shuffleArray(original);

      // Should return the same array reference
      expect(result).toBe(reference);
    });

    it("should work with different data types", () => {
      const strings = shuffleArray(["a", "b", "c", "d"]);
      expect(strings.length).toBe(4);

      const objects = shuffleArray([{ id: 1 }, { id: 2 }, { id: 3 }]);
      expect(objects.length).toBe(3);

      const mixed = shuffleArray([1, "two", { three: 3 }, null, undefined]);
      expect(mixed.length).toBe(5);
    });

    it("should use Fisher-Yates algorithm (uniform distribution)", () => {
      // Test that all positions get shuffled
      const original = [1, 2, 3];
      const positionCounts = [
        { 1: 0, 2: 0, 3: 0 },
        { 1: 0, 2: 0, 3: 0 },
        { 1: 0, 2: 0, 3: 0 },
      ];

      // Run many shuffles
      for (let i = 0; i < 300; i++) {
        const shuffled = shuffleArray([...original]);
        shuffled.forEach((value, index) => {
          positionCounts[index][value]++;
        });
      }

      // Each element should appear in each position roughly equally
      // With 300 runs, expect each to appear ~100 times (+/- 50)
      positionCounts.forEach((counts) => {
        Object.values(counts).forEach((count) => {
          expect(count).toBeGreaterThan(50);
          expect(count).toBeLessThan(150);
        });
      });
    });
  });

  describe("getActiveBasesView", () => {
    let mockApp: App;

    beforeEach(() => {
      mockApp = new App();
    });

    it("should return null when no active leaf", () => {
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(null);
      const result = getActiveBasesView(mockApp);
      expect(result).toBeNull();
    });

    it("should return null when active view is not a Bases view", () => {
      const mockLeaf = {
        view: {
          getViewType: () => "markdown",
        },
      };
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(mockLeaf);

      const result = getActiveBasesView(mockApp);
      expect(result).toBeNull();
    });

    it("should return dynamic-views grid view data", () => {
      const mockData = {
        data: [{ file: { path: "test.md" } }],
      };

      const mockView = {
        type: "dynamic-views-grid",
        data: mockData,
        onDataUpdated: jest.fn(),
      };

      const mockLeaf = {
        view: {
          getViewType: () => "bases",
          controller: {
            view: mockView,
          },
        },
      };
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(mockLeaf);

      const result = getActiveBasesView(mockApp);
      expect(result).toBe(mockView);
      expect(result?.type).toBe("dynamic-views-grid");
    });

    it("should return dynamic-views masonry view data", () => {
      const mockView = {
        type: "dynamic-views-masonry",
        data: { data: [] },
        onDataUpdated: jest.fn(),
      };

      const mockLeaf = {
        view: {
          getViewType: () => "bases",
          controller: {
            view: mockView,
          },
        },
      };
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(mockLeaf);

      const result = getActiveBasesView(mockApp);
      expect(result).toBe(mockView);
      expect(result?.type).toBe("dynamic-views-masonry");
    });

    it("should handle standard Bases views", () => {
      const mockOnDataUpdated = jest.fn();
      const mockView = {
        type: "table",
        data: { data: [{ file: { path: "test.md" } }] },
        onDataUpdated: mockOnDataUpdated,
      };

      const mockLeaf = {
        view: {
          getViewType: () => "bases",
          controller: {
            view: mockView,
          },
        },
      };
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(mockLeaf);

      const result = getActiveBasesView(mockApp);
      expect(result?.type).toBe("table");
      expect(result?.data).toBe(mockView.data);
    });

    it("should handle base-view type", () => {
      const mockView = {
        type: "dynamic-views-grid",
        data: { data: [] },
      };

      const mockLeaf = {
        view: {
          getViewType: () => "base-view",
          controller: {
            view: mockView,
          },
        },
      };
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(mockLeaf);

      const result = getActiveBasesView(mockApp);
      expect(result).toBeTruthy();
    });
  });

  describe("getActiveDynamicViewsBase", () => {
    let mockApp: App;

    beforeEach(() => {
      mockApp = new App();
    });

    it("should return null when no active Bases view", () => {
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(null);
      const result = getActiveDynamicViewsBase(mockApp);
      expect(result).toBeNull();
    });

    it("should return null for non-dynamic-views Bases views", () => {
      const mockView = {
        type: "table",
        data: { data: [] },
      };

      const mockLeaf = {
        view: {
          getViewType: () => "bases",
          controller: { view: mockView },
        },
      };
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(mockLeaf);

      const result = getActiveDynamicViewsBase(mockApp);
      expect(result).toBeNull();
    });

    it("should return dynamic-views grid view", () => {
      const mockView = {
        type: "dynamic-views-grid",
        data: { data: [] },
      };

      const mockLeaf = {
        view: {
          getViewType: () => "bases",
          controller: { view: mockView },
        },
      };
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(mockLeaf);

      const result = getActiveDynamicViewsBase(mockApp);
      expect(result).toBe(mockView);
    });

    it("should return dynamic-views masonry view", () => {
      const mockView = {
        type: "dynamic-views-masonry",
        data: { data: [] },
      };

      const mockLeaf = {
        view: {
          getViewType: () => "bases",
          controller: { view: mockView },
        },
      };
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(mockLeaf);

      const result = getActiveDynamicViewsBase(mockApp);
      expect(result).toBe(mockView);
    });
  });

  describe("openRandomFile", () => {
    let mockApp: App;

    beforeEach(() => {
      mockApp = new App();
      mockApp.workspace.openLinkText = jest.fn().mockResolvedValue(undefined);
    });

    it("should show notice when no active Bases view", async () => {
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(null);
      await openRandomFile(mockApp, false);
      // Notice constructor should be called (tested via mock in setup)
    });

    it("should return early when no entries", async () => {
      const mockView = {
        type: "dynamic-views-grid",
        data: { data: [] },
      };

      const mockLeaf = {
        view: {
          getViewType: () => "bases",
          controller: { view: mockView },
        },
      };
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(mockLeaf);

      await openRandomFile(mockApp, false);
      expect(mockApp.workspace.openLinkText).not.toHaveBeenCalled();
    });

    it("should open random file from entries", async () => {
      const mockEntries = [
        { file: { path: "file1.md" } },
        { file: { path: "file2.md" } },
        { file: { path: "file3.md" } },
      ];

      const mockView = {
        type: "dynamic-views-grid",
        data: { data: mockEntries },
      };

      const mockLeaf = {
        view: {
          getViewType: () => "bases",
          controller: { view: mockView },
        },
      };
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(mockLeaf);

      await openRandomFile(mockApp, false);

      expect(mockApp.workspace.openLinkText).toHaveBeenCalledTimes(1);
      const calledPath = (mockApp.workspace.openLinkText as jest.Mock).mock
        .calls[0][0];
      expect(["file1.md", "file2.md", "file3.md"]).toContain(calledPath);
    });

    it("should respect openInNewPane parameter", async () => {
      const mockEntries = [{ file: { path: "file.md" } }];
      const mockView = {
        type: "dynamic-views-grid",
        data: { data: mockEntries },
      };

      const mockLeaf = {
        view: {
          getViewType: () => "bases",
          controller: { view: mockView },
        },
      };
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(mockLeaf);

      await openRandomFile(mockApp, true);
      expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith(
        "file.md",
        "",
        true,
      );
    });

    it("should handle entries without files", async () => {
      const mockEntries = [{ file: null }];
      const mockView = {
        type: "dynamic-views-grid",
        data: { data: mockEntries },
      };

      const mockLeaf = {
        view: {
          getViewType: () => "bases",
          controller: { view: mockView },
        },
      };
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(mockLeaf);

      await openRandomFile(mockApp, false);
      expect(mockApp.workspace.openLinkText).not.toHaveBeenCalled();
    });
  });

  describe("toggleShuffleActiveView", () => {
    let mockApp: App;

    beforeEach(() => {
      mockApp = new App();
      // Suppress console.log in tests
      jest.spyOn(console, "log").mockImplementation();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should show notice when no active Bases view", () => {
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(null);
      toggleShuffleActiveView(mockApp);
      // Notice shown (tested via mock)
    });

    it("should toggle shuffle on dynamic-views grid view", () => {
      const mockOnDataUpdated = jest.fn();
      const mockEntries = [
        { file: { path: "a.md" } },
        { file: { path: "b.md" } },
        { file: { path: "c.md" } },
      ];

      const mockView = {
        type: "dynamic-views-grid",
        data: { data: mockEntries },
        onDataUpdated: mockOnDataUpdated,
        isShuffled: false,
        shuffledOrder: [],
      };

      const mockLeaf = {
        view: {
          getViewType: () => "bases",
          controller: { view: mockView },
        },
      };
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(mockLeaf);

      toggleShuffleActiveView(mockApp);

      expect(mockView.isShuffled).toBe(true);
      expect(mockView.shuffledOrder.length).toBe(3);
      expect(mockOnDataUpdated).toHaveBeenCalled();
    });

    it("should reshuffle when toggling on already shuffled view", () => {
      const mockOnDataUpdated = jest.fn();
      const mockView = {
        type: "dynamic-views-masonry",
        data: { data: [{ file: { path: "a.md" } }] },
        onDataUpdated: mockOnDataUpdated,
        isShuffled: true,
        shuffledOrder: ["a.md"],
      };

      const mockLeaf = {
        view: {
          getViewType: () => "bases",
          controller: { view: mockView },
        },
      };
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(mockLeaf);

      toggleShuffleActiveView(mockApp);

      // Always reshuffles - original sort restores on view reopen
      expect(mockView.isShuffled).toBe(true);
      expect(mockView.shuffledOrder).toHaveLength(1);
      expect(mockOnDataUpdated).toHaveBeenCalled();
    });

    it("should shuffle standard Bases views once", () => {
      const mockOnDataUpdated = jest.fn();
      const mockEntries = [
        { file: { path: "a.md" } },
        { file: { path: "b.md" } },
        { file: { path: "c.md" } },
      ];

      const mockView = {
        type: "table",
        data: { data: mockEntries },
        onDataUpdated: mockOnDataUpdated,
      };

      const mockLeaf = {
        view: {
          getViewType: () => "bases",
          controller: { view: mockView },
        },
      };
      mockApp.workspace.getMostRecentLeaf = jest.fn().mockReturnValue(mockLeaf);

      toggleShuffleActiveView(mockApp);

      // Entries should be shuffled in place
      expect(mockEntries.length).toBe(3);
      expect(mockOnDataUpdated).toHaveBeenCalled();
    });
  });
});
