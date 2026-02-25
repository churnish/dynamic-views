import {
  hasPageSelector,
  ensurePageSelector,
  findQueryInBlock,
  updateQueryInBlock,
  QueryMatch,
} from "../../src/datacore/query-sync";

describe("query-sync", () => {
  describe("hasPageSelector", () => {
    it("should return true for query with @page", () => {
      expect(hasPageSelector("@page")).toBe(true);
      expect(hasPageSelector('@page and title = "Test"')).toBe(true);
      expect(hasPageSelector("  @page  ")).toBe(true);
    });

    it("should be case-insensitive", () => {
      expect(hasPageSelector("@PAGE")).toBe(true);
      expect(hasPageSelector("@Page")).toBe(true);
      expect(hasPageSelector("@pAgE")).toBe(true);
    });

    it("should match @page as word boundary", () => {
      expect(hasPageSelector("@page")).toBe(true);
      expect(hasPageSelector("@page and foo")).toBe(true);
    });

    it("should return false for query without @page", () => {
      expect(hasPageSelector('title = "Test"')).toBe(false);
      expect(hasPageSelector("tags = #note")).toBe(false);
      expect(hasPageSelector("")).toBe(false);
    });

    it("should handle queries with @page in middle", () => {
      expect(hasPageSelector("foo and @page and bar")).toBe(true);
    });

    it("should handle whitespace around @page", () => {
      expect(hasPageSelector("  @page  ")).toBe(true);
      expect(hasPageSelector("\n@page\n")).toBe(true);
      expect(hasPageSelector("\t@page\t")).toBe(true);
    });

    it("should not match @page as part of longer word", () => {
      // Word boundary after @page, so @pagesize should not match
      expect(hasPageSelector("@pagesize")).toBe(false);
      expect(hasPageSelector("@pagefoo")).toBe(false);
    });
  });

  describe("ensurePageSelector", () => {
    it("should not modify query that already has @page", () => {
      const query = '@page and title = "Test"';
      expect(ensurePageSelector(query)).toBe(query);
    });

    it("should wrap query without @page", () => {
      const query = 'title = "Test"';
      expect(ensurePageSelector(query)).toBe('@page and (title = "Test")');
    });

    it("should handle empty query", () => {
      expect(ensurePageSelector("")).toBe("");
      expect(ensurePageSelector("  ")).toBe("");
    });

    it("should trim query before checking", () => {
      const query = '  title = "Test"  ';
      expect(ensurePageSelector(query)).toBe('@page and (title = "Test")');
    });

    it("should preserve @page at start", () => {
      const query = "@page";
      expect(ensurePageSelector(query)).toBe("@page");
    });

    it("should handle @page in middle of query", () => {
      const query = "foo and @page and bar";
      expect(ensurePageSelector(query)).toBe(query);
    });

    it("should be case-insensitive for @page detection", () => {
      const query = '@PAGE and title = "Test"';
      expect(ensurePageSelector(query)).toBe(query);
    });

    it("should handle complex queries", () => {
      const query = 'title = "Test" and tags = #note';
      expect(ensurePageSelector(query)).toBe(
        '@page and (title = "Test" and tags = #note)',
      );
    });

    it("should handle queries with parentheses", () => {
      const query = '(title = "Test" or title = "Demo")';
      expect(ensurePageSelector(query)).toBe(
        '@page and ((title = "Test" or title = "Demo"))',
      );
    });

    it("should handle multiline queries", () => {
      const query = `title = "Test"
and tags = #note`;
      expect(ensurePageSelector(query)).toBe(`@page and (title = "Test"
and tags = #note)`);
    });

    it("should not double-wrap if @page is already present", () => {
      const query = '@page and (title = "Test")';
      expect(ensurePageSelector(query)).toBe(query);
    });
  });

  describe("findQueryInBlock", () => {
    it("should find query between markers", () => {
      const content = `Some text
// –––– DQL QUERY START ––––
title = "Test"
// ––––– DQL QUERY END –––––
More text`;

      const result = findQueryInBlock(content);

      expect(result).not.toBeNull();
      expect(result!.query).toBe('title = "Test"');
    });

    it("should return null when no markers found", () => {
      const content = "Just some regular text";
      expect(findQueryInBlock(content)).toBeNull();
    });

    it("should handle multiline queries", () => {
      const content = `// –––– DQL QUERY START ––––
title = "Test" and
tags = #note and
date > 2024-01-01
// ––––– DQL QUERY END –––––`;

      const result = findQueryInBlock(content);

      expect(result).not.toBeNull();
      expect(result!.query).toBe(`title = "Test" and
tags = #note and
date > 2024-01-01`);
    });

    it("should trim whitespace from query", () => {
      const content = `// –––– DQL QUERY START ––––
  title = "Test"
// ––––– DQL QUERY END –––––`;

      const result = findQueryInBlock(content);

      expect(result).not.toBeNull();
      expect(result!.query).toBe('title = "Test"');
    });

    it("should return start and end indices", () => {
      const content = `prefix
// –––– DQL QUERY START ––––
query
// ––––– DQL QUERY END –––––
suffix`;

      const result = findQueryInBlock(content);

      expect(result).not.toBeNull();
      expect(result!.startIndex).toBeGreaterThan(0);
      expect(result!.endIndex).toBeGreaterThan(result!.startIndex);
      expect(content.substring(result!.startIndex, result!.endIndex)).toBe(
        result!.fullMatch,
      );
    });

    it("should return fullMatch", () => {
      const content = `// –––– DQL QUERY START ––––
title = "Test"
// ––––– DQL QUERY END –––––`;

      const result = findQueryInBlock(content);

      expect(result).not.toBeNull();
      expect(result!.fullMatch).toContain("DQL QUERY START");
      expect(result!.fullMatch).toContain("DQL QUERY END");
      expect(result!.fullMatch).toContain('title = "Test"');
    });

    it("should handle markers with varying spacing", () => {
      const content = `//  ––––  DQL QUERY START  ––––
query content
  //  –––––  DQL QUERY END  –––––`;

      const result = findQueryInBlock(content);

      expect(result).not.toBeNull();
      expect(result!.query).toBe("query content");
    });

    it("should handle empty query between markers", () => {
      const content = `// –––– DQL QUERY START ––––

// ––––– DQL QUERY END –––––`;

      const result = findQueryInBlock(content);

      expect(result).not.toBeNull();
      expect(result!.query).toBe("");
    });

    it("should handle only START marker", () => {
      const content = `// –––– DQL QUERY START ––––
query without end`;

      expect(findQueryInBlock(content)).toBeNull();
    });

    it("should handle only END marker", () => {
      const content = `query without start
// ––––– DQL QUERY END –––––`;

      expect(findQueryInBlock(content)).toBeNull();
    });

    it("should handle markers in reverse order", () => {
      const content = `// ––––– DQL QUERY END –––––
query
// –––– DQL QUERY START ––––`;

      expect(findQueryInBlock(content)).toBeNull();
    });

    it("should find first occurrence when multiple markers exist", () => {
      const content = `// –––– DQL QUERY START ––––
first query
// ––––– DQL QUERY END –––––
// –––– DQL QUERY START ––––
second query
// ––––– DQL QUERY END –––––`;

      const result = findQueryInBlock(content);

      expect(result).not.toBeNull();
      expect(result!.query).toBe("first query");
    });

    it("should handle query with special characters", () => {
      const content = `// –––– DQL QUERY START ––––
title =~ /regex.*pattern/ and description != null
// ––––– DQL QUERY END –––––`;

      const result = findQueryInBlock(content);

      expect(result).not.toBeNull();
      expect(result!.query).toBe(
        "title =~ /regex.*pattern/ and description != null",
      );
    });

    it("should handle queries with code comments", () => {
      const content = `// –––– DQL QUERY START ––––
// This is a comment in the query
title = "Test"
// ––––– DQL QUERY END –––––`;

      const result = findQueryInBlock(content);

      expect(result).not.toBeNull();
      expect(result!.query).toContain("This is a comment");
    });
  });

  describe("updateQueryInBlock", () => {
    it("should update query between markers", () => {
      const content = `prefix
// –––– DQL QUERY START ––––
old query
// ––––– DQL QUERY END –––––
suffix`;

      const result = updateQueryInBlock(content, "new query");

      expect(result).toContain("new query");
      expect(result).not.toContain("old query");
      expect(result).toContain("prefix");
      expect(result).toContain("suffix");
    });

    it("should preserve surrounding content", () => {
      const content = `line 1
line 2
// –––– DQL QUERY START ––––
old
// ––––– DQL QUERY END –––––
line 3
line 4`;

      const result = updateQueryInBlock(content, "new");

      expect(result).toContain("line 1");
      expect(result).toContain("line 2");
      expect(result).toContain("line 3");
      expect(result).toContain("line 4");
      expect(result).toContain("new");
    });

    it("should handle multiline new query", () => {
      const content = `// –––– DQL QUERY START ––––
old
// ––––– DQL QUERY END –––––`;

      const newQuery = `line 1
line 2
line 3`;

      const result = updateQueryInBlock(content, newQuery);

      expect(result).toContain("line 1");
      expect(result).toContain("line 2");
      expect(result).toContain("line 3");
      expect(result).not.toContain("old");
    });

    it("should return original content when markers not found", () => {
      const content = "content without markers";
      const result = updateQueryInBlock(content, "new query");

      expect(result).toBe(content);
    });

    it("should handle empty new query", () => {
      const content = `// –––– DQL QUERY START ––––
old query
// ––––– DQL QUERY END –––––`;

      const result = updateQueryInBlock(content, "");

      expect(result).toContain("DQL QUERY START");
      expect(result).toContain("DQL QUERY END");
      expect(result).not.toContain("old query");
    });

    it("should maintain marker format", () => {
      const content = `// –––– DQL QUERY START ––––
old
// ––––– DQL QUERY END –––––`;

      const result = updateQueryInBlock(content, "new");

      expect(result).toMatch(/\/\/ –––– DQL QUERY START ––––/);
      expect(result).toMatch(/\/\/ ––––– DQL QUERY END –––––/);
    });

    it("should update only first occurrence", () => {
      const content = `// –––– DQL QUERY START ––––
first
// ––––– DQL QUERY END –––––
// –––– DQL QUERY START ––––
second
// ––––– DQL QUERY END –––––`;

      const result = updateQueryInBlock(content, "updated");

      const firstIndex = result.indexOf("updated");
      const secondIndex = result.indexOf("second");

      expect(firstIndex).toBeGreaterThan(-1);
      expect(secondIndex).toBeGreaterThan(-1);
      expect(result).not.toContain("first");
    });

    it("should handle query with special characters", () => {
      const content = `// –––– DQL QUERY START ––––
old
// ––––– DQL QUERY END –––––`;

      const newQuery = "title =~ /regex.*/ and (foo or bar)";
      const result = updateQueryInBlock(content, newQuery);

      expect(result).toContain("title =~ /regex.*/ and (foo or bar)");
    });

    it("should preserve indentation of markers", () => {
      const content = `// –––– DQL QUERY START ––––
old query
// ––––– DQL QUERY END –––––`;

      const result = updateQueryInBlock(content, "new query");

      // Check that the structure is preserved (newlines, markers)
      expect(result.split("\n").length).toBeGreaterThanOrEqual(3);
    });

    it("should handle query with Unicode characters", () => {
      const content = `// –––– DQL QUERY START ––––
old
// ––––– DQL QUERY END –––––`;

      const newQuery = 'title = "测试 🎉"';
      const result = updateQueryInBlock(content, newQuery);

      expect(result).toContain('title = "测试 🎉"');
    });
  });

  describe("QueryMatch type", () => {
    it("should have correct structure", () => {
      const content = `// –––– DQL QUERY START ––––
test query
// ––––– DQL QUERY END –––––`;

      const match = findQueryInBlock(content);

      expect(match).not.toBeNull();
      expect(match).toHaveProperty("query");
      expect(match).toHaveProperty("fullMatch");
      expect(match).toHaveProperty("startIndex");
      expect(match).toHaveProperty("endIndex");

      expect(typeof match!.query).toBe("string");
      expect(typeof match!.fullMatch).toBe("string");
      expect(typeof match!.startIndex).toBe("number");
      expect(typeof match!.endIndex).toBe("number");
    });
  });

  describe("integration tests", () => {
    it("should work with ensurePageSelector and updateQueryInBlock", () => {
      const content = `// –––– DQL QUERY START ––––
title = "Test"
// ––––– DQL QUERY END –––––`;

      const match = findQueryInBlock(content);
      const wrappedQuery = ensurePageSelector(match!.query);
      const updated = updateQueryInBlock(content, wrappedQuery);

      expect(updated).toContain('@page and (title = "Test")');
    });

    it("should preserve query with @page selector", () => {
      const content = `// –––– DQL QUERY START ––––
@page and title = "Test"
// ––––– DQL QUERY END –––––`;

      const match = findQueryInBlock(content);
      const ensured = ensurePageSelector(match!.query);

      expect(ensured).toBe('@page and title = "Test"');
    });
  });
});
