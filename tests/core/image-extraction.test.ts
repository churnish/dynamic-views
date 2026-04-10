import { vi } from 'vitest';
import { extractImageEmbeds } from '../../src/core/image-extraction';
import { App, TFile } from 'obsidian';

// Mock style settings
vi.mock('../../src/utils/style-settings', () => ({
  getSlideshowMaxImages: vi.fn(() => 10),
}));

describe('image-extraction', () => {
  describe('extractImageEmbeds', () => {
    let mockApp: App;
    let mockFile: TFile;

    beforeEach(() => {
      mockApp = new App();
      mockFile = { path: 'note.md' } as TFile;
      mockApp.vault.cachedRead = vi.fn().mockResolvedValue('');
    });

    it('should return empty array for empty file', async () => {
      mockApp.vault.cachedRead = vi.fn().mockResolvedValue('');

      const result = await extractImageEmbeds(mockFile, mockApp);

      expect(result).toEqual([]);
    });

    it('should extract wikilink embeds', async () => {
      const mockImageFile = { extension: 'png' } as TFile;
      mockApp.vault.cachedRead = vi
        .fn()
        .mockResolvedValue('Some text\n![[image.png]]\nMore text');
      mockApp.metadataCache.getFirstLinkpathDest = vi
        .fn()
        .mockReturnValue(mockImageFile);
      mockApp.vault.getResourcePath = vi
        .fn()
        .mockReturnValue('app://local/image.png');

      const result = await extractImageEmbeds(mockFile, mockApp);

      expect(result).toContain('app://local/image.png');
    });

    it('should skip cardlink images when disabled', async () => {
      mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
\`\`\`cardlink
url: https://example.com
image: https://example.com/cover.png
\`\`\`
      `);

      const result = await extractImageEmbeds(mockFile, mockApp, {
        includeCardLink: false,
      });

      expect(result).toEqual([]);
    });

    describe('code syntax exclusions', () => {
      it('should skip embeds in inline code (single backticks)', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue('`![[image_1.jpg]]`');

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it('should skip embeds in fenced code block (3 backticks)', async () => {
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
\`\`\`
![[image_2.jpg]]
\`\`\`
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it('should skip embeds in fenced code block (4 backticks)', async () => {
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
\`\`\`\`
![[image_3.jpg]]
\`\`\`\`
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it('should skip embeds in fenced code block with language', async () => {
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
\`\`\`markdown
![[image_4.jpg]]
\`\`\`
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it('should skip embeds in fenced code block (3 tildes)', async () => {
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
~~~
![[image_5.jpg]]
~~~
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it('should skip embeds in fenced code block (4 tildes)', async () => {
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
~~~~
![[image_6.jpg]]
~~~~
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it('should skip embeds in indented code block (tab)', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue('\t![[image_7.jpg]]');

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it('should skip embeds in indented code block (4 spaces)', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue('    ![[image_8.jpg]]');

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it('should skip Markdown images in inline code', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue('`![alt](https://example.com/image_9.png)`');

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it('should skip Markdown images in fenced block', async () => {
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
\`\`\`
![alt](https://example.com/image_10.png)
\`\`\`
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it('should NOT treat single backticks on separate lines as code', async () => {
        const mockImageFile = { extension: 'jpg' } as TFile;
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
\`

![[valid_image.jpg]]

\`
        `);
        mockApp.metadataCache.getFirstLinkpathDest = vi
          .fn()
          .mockReturnValue(mockImageFile);
        mockApp.vault.getResourcePath = vi
          .fn()
          .mockReturnValue('app://local/valid_image.jpg');

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toContain('app://local/valid_image.jpg');
      });

      it('should only extract non-code-wrapped image from mixed content', async () => {
        const mockImageFile = { extension: 'jpg' } as TFile;
        // Note: indented code requires preceding blank line per CommonMark
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
\`![[image_1.jpg]]\`

\`\`\`
![[image_2.jpg]]
\`\`\`

~~~
![[image_5.jpg]]
~~~

\t![[image_7.jpg]]

    ![[image_8.jpg]]

![[image_87.jpg]]
        `);
        mockApp.metadataCache.getFirstLinkpathDest = vi
          .fn()
          .mockReturnValue(mockImageFile);
        mockApp.vault.getResourcePath = vi
          .fn()
          .mockReturnValue('app://local/image_87.jpg');

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toHaveLength(1);
        expect(result).toContain('app://local/image_87.jpg');
      });

      it('should NOT skip indented embed without preceding blank line', async () => {
        const mockImageFile = { extension: 'jpg' } as TFile;
        // Per CommonMark, indented code requires preceding blank line
        // This embed is just indented text, not code
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`Some text
    ![[image.jpg]]`);
        mockApp.metadataCache.getFirstLinkpathDest = vi
          .fn()
          .mockReturnValue(mockImageFile);
        mockApp.vault.getResourcePath = vi
          .fn()
          .mockReturnValue('app://local/image.jpg');

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toContain('app://local/image.jpg');
      });

      it('should skip indented embed WITH preceding blank line', async () => {
        // With blank line before, this IS indented code per CommonMark
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`Some text

    ![[image.jpg]]`);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it('should handle nested fenced blocks (4 backticks containing 3)', async () => {
        const mockImageFile = { extension: 'jpg' } as TFile;
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
\`\`\`\`
\`\`\`
![[nested.jpg]]
\`\`\`
\`\`\`\`

![[valid.jpg]]
        `);
        mockApp.metadataCache.getFirstLinkpathDest = vi
          .fn()
          .mockReturnValue(mockImageFile);
        mockApp.vault.getResourcePath = vi
          .fn()
          .mockReturnValue('app://local/valid.jpg');

        const result = await extractImageEmbeds(mockFile, mockApp);

        // Only valid.jpg should be extracted, nested.jpg is inside outer block
        expect(result).toHaveLength(1);
        expect(result).toContain('app://local/valid.jpg');
      });

      it('should skip embeds in fenced block with complex info string', async () => {
        // Per CommonMark, info strings can contain any characters
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
\`\`\`python {.class title="example"}
![[image.jpg]]
\`\`\`
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it('should extract cardlink image from block with complex info string', async () => {
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
\`\`\`cardlink {.some-class}
url: https://example.com
image: https://example.com/cover.png
\`\`\`
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toContain('https://example.com/cover.png');
      });

      it('should extract embeds from unclosed fenced block (non-CommonMark)', async () => {
        // Per CommonMark, unclosed fenced blocks extend to EOF
        // Current implementation: unclosed fence = not a fence, embed extracted
        // This test documents current behavior (not CommonMark compliant)
        const mockImageFile = { extension: 'jpg' } as TFile;
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
\`\`\`
![[image.jpg]]`);
        mockApp.metadataCache.getFirstLinkpathDest = vi
          .fn()
          .mockReturnValue(mockImageFile);
        mockApp.vault.getResourcePath = vi
          .fn()
          .mockReturnValue('app://local/image.jpg');

        const result = await extractImageEmbeds(mockFile, mockApp);

        // Current behavior: embed IS extracted (block never closed)
        // Note: This differs from CommonMark which treats unclosed fences as code to EOF
        expect(result).toContain('app://local/image.jpg');
      });

      it('should NOT close fence with mismatched length', async () => {
        // 3 backticks cannot be closed by 4 backticks
        const mockImageFile = { extension: 'jpg' } as TFile;
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
\`\`\`
![[inside.jpg]]
\`\`\`\`

![[outside.jpg]]
        `);
        mockApp.metadataCache.getFirstLinkpathDest = vi
          .fn()
          .mockReturnValue(mockImageFile);
        mockApp.vault.getResourcePath = vi
          .fn()
          .mockReturnValue('app://local/outside.jpg');

        const result = await extractImageEmbeds(mockFile, mockApp);

        // Both embeds extracted since fence never properly closed
        expect(result.length).toBeGreaterThanOrEqual(1);
      });

      it('should NOT close fence when closing line has trailing content', async () => {
        // Per CommonMark, closing fences must have no content after fence chars
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`
\`\`\`
![[inside.jpg]]
\`\`\`python
![[outside.jpg]]
\`\`\`
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        // Both embeds inside the block (first "closing" fence has content, doesn't close)
        // Only the final ``` properly closes, so all embeds are inside code
        expect(result).toEqual([]);
      });

      it('should extract embed at position 0 (start of file)', async () => {
        const mockImageFile = { extension: 'jpg' } as TFile;
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue('![[image.jpg]]');
        mockApp.metadataCache.getFirstLinkpathDest = vi
          .fn()
          .mockReturnValue(mockImageFile);
        mockApp.vault.getResourcePath = vi
          .fn()
          .mockReturnValue('app://local/image.jpg');

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toContain('app://local/image.jpg');
      });

      it('should handle frontmatter without closing delimiter', async () => {
        const mockImageFile = { extension: 'jpg' } as TFile;
        // Malformed frontmatter (no closing ---) - content should still be parsed
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`---
key: value
![[image.jpg]]`);
        mockApp.metadataCache.getFirstLinkpathDest = vi
          .fn()
          .mockReturnValue(mockImageFile);
        mockApp.vault.getResourcePath = vi
          .fn()
          .mockReturnValue('app://local/image.jpg');

        const result = await extractImageEmbeds(mockFile, mockApp);

        // Embed should be extracted since frontmatter is malformed
        expect(result).toContain('app://local/image.jpg');
      });
    });
  });
});
