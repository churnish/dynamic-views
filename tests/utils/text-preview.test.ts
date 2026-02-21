import {
  sanitizeForPreview,
  loadFilePreview,
} from "../../src/utils/text-preview";
import { App, TFile } from "obsidian";

describe("preview", () => {
  describe("sanitizeForPreview", () => {
    it("should remove frontmatter", () => {
      const input = `---
title: Test
tags: test
---
Content here`;
      const result = sanitizeForPreview(input);
      expect(result).toBe("Content here");
    });

    it("should remove frontmatter with CRLF line endings", () => {
      const input = "---\r\ntitle: Test\r\ntags: test\r\n---\r\nContent here";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Content here");
    });

    it("should handle mixed LF and CRLF in frontmatter", () => {
      // Some frontmatter lines have CRLF, others LF
      const input = "---\r\ntitle: Test\ntags: test\r\n---\nContent here";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Content here");
    });

    it("should handle CRLF in content after frontmatter", () => {
      const input =
        "---\r\ntitle: Test\r\n---\r\nFirst line\r\nSecond line\r\nThird line";
      const result = sanitizeForPreview(input);
      expect(result).toBe("First line Second line Third line");
    });

    it("should handle CRLF in headings", () => {
      const input = "# Heading\r\n\r\nContent here\r\nMore content";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Content here More content");
    });

    it("should handle CRLF in bullet lists", () => {
      const input = "- Item 1\r\n- Item 2\r\n- Item 3";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Item 1 Item 2 Item 3");
    });

    it("should handle CRLF in code blocks", () => {
      const input = "Text\r\n```\r\ncode\r\n```\r\nMore text";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Text More text");
    });

    it("should handle CRLF in blockquotes", () => {
      const input = "> Quote line 1\r\n> Quote line 2\r\n\r\nNormal text";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Quote line 1 Quote line 2 Normal text");
    });

    it("should strip inline code", () => {
      const input = "This has `inline code` in it";
      const result = sanitizeForPreview(input);
      expect(result).toBe("This has inline code in it");
    });

    it("should strip bold asterisks", () => {
      const input = "This is **bold text** here";
      const result = sanitizeForPreview(input);
      expect(result).toBe("This is bold text here");
    });

    it("should strip bold underscores", () => {
      const input = "This is __bold text__ here";
      const result = sanitizeForPreview(input);
      expect(result).toBe("This is bold text here");
    });

    it("should strip italic asterisks", () => {
      const input = "This is *italic text* here";
      const result = sanitizeForPreview(input);
      expect(result).toBe("This is italic text here");
    });

    it("should strip italic underscores", () => {
      const input = "This is _italic text_ here";
      const result = sanitizeForPreview(input);
      expect(result).toBe("This is italic text here");
    });

    it("should strip bold+italic combinations", () => {
      const input = "This is ***bold italic*** and ___also bold italic___";
      const result = sanitizeForPreview(input);
      expect(result).toBe("This is bold italic and also bold italic");
    });

    it("should strip strikethrough", () => {
      const input = "This has ~~strikethrough~~ text";
      const result = sanitizeForPreview(input);
      expect(result).toBe("This has strikethrough text");
    });

    it("should strip highlight", () => {
      const input = "This has ==highlighted== text";
      const result = sanitizeForPreview(input);
      expect(result).toBe("This has highlighted text");
    });

    it("should strip markdown links", () => {
      const input = "Visit [Google](https://google.com) for search";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Visit Google for search");
    });

    it("should keep wikilink text", () => {
      const input = "See [[Other Page]] for details";
      const result = sanitizeForPreview(input);
      expect(result).toBe("See Other Page for details");
    });

    it("should keep wikilink alias", () => {
      const input = "See [[Internal Link|Display Text]] here";
      const result = sanitizeForPreview(input);
      expect(result).toBe("See Display Text here");
    });

    it("should strip embedded wikilinks", () => {
      const input = "Image: ![[image.png]] shown";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Image: shown");
    });

    it("should strip embedded wikilinks with alias", () => {
      const input = "Image: ![[image.png|caption]] shown";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Image: shown");
    });

    it("should keep wikilink text with heading reference", () => {
      const input = "See [[Note#Heading]] for details";
      const result = sanitizeForPreview(input);
      expect(result).toBe("See Note#Heading for details");
    });

    it("should keep wikilink alias with heading reference", () => {
      const input = "See [[Note#Heading|Display]] for details";
      const result = sanitizeForPreview(input);
      expect(result).toBe("See Display for details");
    });

    it("should strip markdown images", () => {
      const input = "Image: ![alt text](https://example.org/img.png) shown";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Image: shown");
    });

    it("should strip markdown images without alt text", () => {
      const input = "Image: ![](https://example.org/img.png) shown";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Image: shown");
    });

    it("should strip empty markdown links", () => {
      const input = "Link: [](https://example.org) here";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Link: here");
    });

    it("should handle empty URL in links", () => {
      const input = "Link: [text]() here";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Link: text here");
    });

    it("should handle empty URL in images", () => {
      const input = "Image: ![alt]() here";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Image: here");
    });

    it("should strip tags", () => {
      const input = "This has #tag and #another-tag in it";
      const result = sanitizeForPreview(input);
      expect(result).toBe("This has and in it");
    });

    it("should strip heading lines completely", () => {
      const input = `# Heading 1
Content here
## Heading 2
More content`;
      const result = sanitizeForPreview(input);
      expect(result).toBe("Content here More content");
    });

    it("should strip bare heading syntax", () => {
      expect(sanitizeForPreview("#")).toBe("");
      expect(sanitizeForPreview("## ")).toBe("");
      expect(sanitizeForPreview("#\nContent here")).toBe("Content here");
    });

    it("should strip bullet list markers", () => {
      const input = `- Item 1
* Item 2
+ Item 3`;
      const result = sanitizeForPreview(input);
      expect(result).toBe("Item 1 Item 2 Item 3");
    });

    it("should strip task list markers", () => {
      const input = `- [ ] Unchecked task
- [x] Checked task
- [X] Also checked`;
      const result = sanitizeForPreview(input);
      expect(result).toBe("Unchecked task Checked task Also checked");
    });

    it("should strip numbered list task markers", () => {
      const input = `1. [x] Task one
2) [ ] Task two`;
      const result = sanitizeForPreview(input);
      expect(result).toBe("1. Task one 2) Task two");
    });

    it("should strip non-standard task checkboxes", () => {
      const input = `- [-] Cancelled
- [/] In progress
- [>] Deferred
- [!] Important`;
      const result = sanitizeForPreview(input);
      expect(result).toBe("Cancelled In progress Deferred Important");
    });

    it("should strip non-standard numbered task checkboxes", () => {
      const input = "1. [-] Numbered cancelled";
      const result = sanitizeForPreview(input);
      expect(result).toBe("1. Numbered cancelled");
    });

    it("should strip bare task checkboxes without list markers", () => {
      const input = `[ ] Bare unchecked
[x] Bare checked
[X] Bare checked uppercase`;
      const result = sanitizeForPreview(input);
      expect(result).toBe("Bare unchecked Bare checked Bare checked uppercase");
    });

    it("should strip bare non-standard checkboxes", () => {
      const input = "[-] Cancelled";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Cancelled");
    });

    it("should treat [x](url) as link, not checkbox", () => {
      const input = "Click [x](https://example.org) here";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Click x here");
    });

    it("should not strip #text without space as heading", () => {
      const input = "#notheading some text";
      const result = sanitizeForPreview(input);
      // No space after # — not a heading (entire line NOT removed).
      // #notheading IS stripped as a tag, but "some text" is preserved.
      expect(result).toBe("some text");
    });

    it("should strip blockquote markers in list items", () => {
      const input = `- >smile
- > hello
- [ ] >hi
- [-] >cancelled quote`;
      const result = sanitizeForPreview(input);
      expect(result).toBe("smile hello hi cancelled quote");
    });

    it("should strip blockquote markers with varied indentation in lists", () => {
      const input = `-   >indented
-     > more indented
- [ ]   >checkbox indented`;
      const result = sanitizeForPreview(input);
      expect(result).toBe("indented more indented checkbox indented");
    });

    it("should strip horizontal rules", () => {
      const input = `Text before
---
Text after`;
      const result = sanitizeForPreview(input);
      expect(result).toBe("Text before Text after");
    });

    it("should strip tables", () => {
      const input = `Before table
| Col1 | Col2 |
| ---- | ---- |
| A | B |
After table`;
      const result = sanitizeForPreview(input);
      expect(result).toBe("Before table After table");
    });

    it("should strip footnote markers", () => {
      const input = "Text with footnote[^1] here";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Text with footnote here");
    });

    it("should strip inline footnotes", () => {
      const input = "Text with inline^[footnote content] here";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Text with inline here");
    });

    it("should strip footnote definitions", () => {
      const input = `Content
[^1]: Footnote definition
More content`;
      const result = sanitizeForPreview(input);
      // May contain colon from definition, just ensure footnote marker removed
      expect(result).toContain("Content");
      expect(result).toContain("More content");
      expect(result).not.toContain("[^1]");
    });

    it("should strip HTML tags but preserve content", () => {
      const input = "Text with <b>bold</b> and <em>italic</em> tags";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Text with bold and italic tags");
    });

    it("should strip standalone HTML tags", () => {
      const input = "Text with <br> and <hr> tags";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Text with and tags");
    });

    it("should handle code blocks with backticks", () => {
      const input = `Before code
\`\`\`
const x = 1;
\`\`\`
After code`;
      const result = sanitizeForPreview(input);
      expect(result).toBe("Before code After code");
    });

    it("should handle code blocks with tildes", () => {
      const input = `Before code
~~~
const x = 1;
~~~
After code`;
      const result = sanitizeForPreview(input);
      expect(result).toBe("Before code After code");
    });

    it("should handle callouts", () => {
      const input = `> [!NOTE]
> Callout content
> More content

Regular text`;
      const result = sanitizeForPreview(input);
      expect(result).toBe("Callout content More content Regular text");
    });

    it("should handle nested callouts", () => {
      const input = `> [!NOTE] Title
> Contents
>
> > [!DANGER] Title
> > Contents
> >
> > > [!TLDR] Title
> > > Contents`;
      const result = sanitizeForPreview(input);
      expect(result).toBe("Contents Contents Contents");
    });

    it("should handle double-nested blockquotes", () => {
      const input = "> > deeply nested";
      const result = sanitizeForPreview(input);
      expect(result).toBe("deeply nested");
    });

    it("should handle blockquotes", () => {
      const input = `> Quote line 1
> Quote line 2

Regular text`;
      const result = sanitizeForPreview(input);
      expect(result).toBe("Quote line 1 Quote line 2 Regular text");
    });

    it("should preserve escaped characters", () => {
      const input = "This has \\*escaped\\* characters";
      const result = sanitizeForPreview(input);
      expect(result).toBe("This has *escaped* characters");
    });

    it("should remove block IDs", () => {
      const input = "Text with block ID ^block-123 here";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Text with block ID here");
    });

    it("should normalize multiple spaces", () => {
      const input = "Text    with    multiple     spaces";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Text with multiple spaces");
    });

    it("should preserve multiple periods as-is", () => {
      const input = "Text with... ellipsis";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Text with... ellipsis");
    });

    it("should truncate to 1000 characters", () => {
      const input = "a".repeat(1200);
      const result = sanitizeForPreview(input);
      expect(result.length).toBe(1001); // 1000 + ellipsis
      expect(result.endsWith("…")).toBe(true);
    });

    it("should trim trailing whitespace before ellipsis when truncating", () => {
      // Create input where char 1000 lands right after a space
      // "word " repeated = 5 chars each, 200 times = 1000 chars ending with space
      const input = "word ".repeat(200) + "extra";
      const result = sanitizeForPreview(input);
      // Should be "word word...word…" not "word word...word …"
      expect(result).not.toMatch(/\s…$/);
      expect(result.endsWith("…")).toBe(true);
    });

    it("should not add ellipsis for content under 1000 chars", () => {
      const input = "Short content";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Short content");
      expect(result.endsWith("…")).toBe(false);
    });

    it("should omit first line when omitFirstLine is always", () => {
      const input = `First line
Second line
Third line`;
      const result = sanitizeForPreview(input, "always");
      expect(result).toBe("Second line Third line");
    });

    it("should omit first line when it matches filename (ifMatchesTitle)", () => {
      const input = `My File
Content here`;
      const result = sanitizeForPreview(input, "ifMatchesTitle", "My File");
      expect(result).toBe("Content here");
    });

    it("should omit first line when it matches title value (ifMatchesTitle)", () => {
      const input = `Page Title
Content here`;
      const result = sanitizeForPreview(
        input,
        "ifMatchesTitle",
        undefined,
        "Page Title",
      );
      expect(result).toBe("Content here");
    });

    it("should not omit first line when it does not match (ifMatchesTitle)", () => {
      const input = `Different Title
Content here`;
      const result = sanitizeForPreview(
        input,
        "ifMatchesTitle",
        "Another Title",
      );
      expect(result).toBe("Different Title Content here");
    });

    it("should never omit first line when omitFirstLine is never", () => {
      const input = `My File
Content here`;
      const result = sanitizeForPreview(input, "never", "My File");
      expect(result).toBe("My File Content here");
    });

    it("should omit first line with CRLF when it matches filename (ifMatchesTitle)", () => {
      const input = "My File\r\nContent here";
      const result = sanitizeForPreview(input, "ifMatchesTitle", "My File");
      expect(result).toBe("Content here");
    });

    it("should handle empty content", () => {
      expect(sanitizeForPreview("")).toBe("");
      expect(sanitizeForPreview("   ")).toBe("");
    });

    it("should handle complex mixed markdown", () => {
      const input = `---
title: Test
---

# Heading

This is **bold** and *italic* text with a [[link]] and \`code\`.

- [ ] Task item
- Regular bullet

> [!NOTE]
> Callout content

\`\`\`js
const x = 1;
\`\`\`

More text with #tag and ==highlight==.`;

      const result = sanitizeForPreview(input);
      expect(result).not.toContain("**");
      expect(result).not.toContain("*");
      expect(result).not.toContain("[[");
      expect(result).not.toContain("`");
      expect(result).not.toContain("#tag");
      expect(result).not.toContain("==");
      expect(result).not.toContain("const x = 1");
    });

    it("should handle nested markdown syntax", () => {
      const input = "**This has *nested* formatting**";
      const result = sanitizeForPreview(input);
      expect(result).toBe("This has nested formatting");
    });

    it("should handle code blocks with different fence lengths", () => {
      const input = `Text
\`\`\`\`
Code with triple backticks inside \`\`\`
\`\`\`\`
After`;
      const result = sanitizeForPreview(input);
      expect(result).toBe("Text After");
    });

    it("should handle malformed/unclosed markdown links", () => {
      const input = "Text with [unclosed link and more text";
      const result = sanitizeForPreview(input);
      expect(result).toBe("Text with [unclosed link and more text");
    });

    it("should handle block IDs in prose", () => {
      // Block IDs attached to text (x^123) are NOT stripped to avoid breaking math notation
      const input1 = "The value is x^123 or y^abc-def";
      const result1 = sanitizeForPreview(input1);
      expect(result1).toBe("The value is x^123 or y^abc-def");

      // Block IDs with space before are stripped
      const input2 = "Some text ^block-id here";
      const result2 = sanitizeForPreview(input2);
      expect(result2).toBe("Some text here");
    });

    it("should handle deeply nested markdown syntax", () => {
      const input = "***___~~==deeply nested==~~___***";
      const result = sanitizeForPreview(input);
      expect(result).toBe("deeply nested");
    });

    it("should truncate emoji strings correctly at character boundary", () => {
      // 1001 emojis (each is 2 code units due to surrogate pairs)
      const input = "😀".repeat(1001);
      const result = sanitizeForPreview(input);
      // Should be exactly 1000 emojis + ellipsis
      expect([...result].length).toBe(1001); // 1000 chars + ellipsis
      expect(result.endsWith("…")).toBe(true);
      // Verify no broken surrogate pairs (would show as replacement chars)
      expect(result).not.toContain("\uFFFD");
    });
  });

  describe("loadFilePreview", () => {
    let mockApp: App;
    let mockFile: TFile;

    beforeEach(() => {
      mockApp = new App();
      mockFile = new TFile();
      mockFile.path = "test.md";
      mockFile.basename = "test";
    });

    it("should return property value if valid string", async () => {
      const result = await loadFilePreview(
        mockFile,
        mockApp,
        "Property description",
        { fallbackToContent: true, omitFirstLine: "never" },
      );

      expect(result).toBe("Property description");
    });

    it("should return property value if valid number", async () => {
      const result = await loadFilePreview(mockFile, mockApp, 42, {
        fallbackToContent: true,
        omitFirstLine: "never",
      });

      expect(result).toBe("42");
    });

    it("should trim property value whitespace", async () => {
      const result = await loadFilePreview(
        mockFile,
        mockApp,
        "  Property value  ",
        { fallbackToContent: true, omitFirstLine: "never" },
      );

      expect(result).toBe("Property value");
    });

    it("should fallback to content when property is null and fallback enabled", async () => {
      mockApp.vault.cachedRead = jest.fn().mockResolvedValue("File content");

      const result = await loadFilePreview(mockFile, mockApp, null, {
        fallbackToContent: true,
        omitFirstLine: "never",
      });

      expect(result).toBe("File content");
      expect(mockApp.vault.cachedRead).toHaveBeenCalledWith(mockFile);
    });

    it("should fallback to content when property is undefined", async () => {
      mockApp.vault.cachedRead = jest.fn().mockResolvedValue("File content");

      const result = await loadFilePreview(mockFile, mockApp, undefined, {
        fallbackToContent: true,
        omitFirstLine: "never",
      });

      expect(result).toBe("File content");
    });

    it("should fallback to content when property is empty string", async () => {
      mockApp.vault.cachedRead = jest.fn().mockResolvedValue("File content");

      const result = await loadFilePreview(mockFile, mockApp, "", {
        fallbackToContent: true,
        omitFirstLine: "never",
      });

      expect(result).toBe("File content");
    });

    it("should fallback to content when property is whitespace only", async () => {
      mockApp.vault.cachedRead = jest.fn().mockResolvedValue("File content");

      const result = await loadFilePreview(mockFile, mockApp, "   ", {
        fallbackToContent: true,
        omitFirstLine: "never",
      });

      expect(result).toBe("File content");
    });

    it("should return empty string when no property and fallback disabled", async () => {
      const result = await loadFilePreview(mockFile, mockApp, null, {
        fallbackToContent: false,
        omitFirstLine: "never",
      });

      expect(result).toBe("");
    });

    it("should pass omitFirstLine always to sanitizeForPreview", async () => {
      mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`First line
Second line`);

      const result = await loadFilePreview(mockFile, mockApp, null, {
        fallbackToContent: true,
        omitFirstLine: "always",
      });

      expect(result).toBe("Second line");
    });

    it("should pass fileName to sanitizeForPreview (ifMatchesTitle)", async () => {
      mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`My File
Content`);

      const result = await loadFilePreview(
        mockFile,
        mockApp,
        null,
        { fallbackToContent: true, omitFirstLine: "ifMatchesTitle" },
        "My File",
      );

      expect(result).toBe("Content");
    });

    it("should pass titleValue to sanitizeForPreview (ifMatchesTitle)", async () => {
      mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`Title Here
Content`);

      const result = await loadFilePreview(
        mockFile,
        mockApp,
        null,
        { fallbackToContent: true, omitFirstLine: "ifMatchesTitle" },
        undefined,
        "Title Here",
      );

      expect(result).toBe("Content");
    });

    it("should sanitize markdown when falling back to content", async () => {
      mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`---
title: Test
---

# Heading

**Bold** and *italic* text`);

      const result = await loadFilePreview(mockFile, mockApp, null, {
        fallbackToContent: true,
        omitFirstLine: "never",
      });

      expect(result).not.toContain("**");
      expect(result).not.toContain("*");
      expect(result).not.toContain("#");
      expect(result).toContain("Bold");
      expect(result).toContain("italic");
    });

    it("should handle read errors gracefully", async () => {
      mockApp.vault.cachedRead = jest
        .fn()
        .mockRejectedValue(new Error("Read failed"));

      await expect(
        loadFilePreview(mockFile, mockApp, null, {
          fallbackToContent: true,
          omitFirstLine: "never",
        }),
      ).rejects.toThrow("Read failed");
    });

    it("should prefer property value over content even when fallback enabled", async () => {
      mockApp.vault.cachedRead = jest.fn().mockResolvedValue("File content");

      const result = await loadFilePreview(
        mockFile,
        mockApp,
        "Property value",
        { fallbackToContent: true, omitFirstLine: "never" },
      );

      expect(result).toBe("Property value");
      expect(mockApp.vault.cachedRead).not.toHaveBeenCalled();
    });

    it("should handle number 0 as valid property value", async () => {
      const result = await loadFilePreview(mockFile, mockApp, 0, {
        fallbackToContent: true,
        omitFirstLine: "never",
      });

      expect(result).toBe("0");
    });
  });
});
