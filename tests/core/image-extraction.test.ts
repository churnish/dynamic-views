import { vi } from 'vitest';
import { extractImageEmbeds } from '../../src/core/image-extraction';
import { clearYouTubeThumbnailCache } from '../../src/core/youtube-preview';
import { App, TFile } from 'obsidian';

/** The subset of the mock `Image` from `tests/setup.ts` these tests drive. */
interface MockImage {
  src: string;
  naturalWidth: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

const mockImages = (): MockImage[] => (global as any).__imageInstances;

/**
 * Wait until a probe has requested `videoId` at `quality`, then return it.
 *
 * Probes run concurrently, so instances land in the global array interleaved and
 * cannot be addressed by creation index the way the sequential
 * `youtube-preview` tests do — match on `src` instead.
 */
async function waitForProbe(
  videoId: string,
  quality: string
): Promise<MockImage> {
  const url = `https://i.ytimg.com/vi_webp/${videoId}/${quality}.webp`;
  for (let tick = 0; tick < 50; tick++) {
    const img = mockImages().find((candidate) => candidate.src === url);
    if (img) return img;
    await Promise.resolve();
  }
  throw new Error(`No probe requested ${url}`);
}

async function succeedProbe(videoId: string, quality = 'maxresdefault') {
  (await waitForProbe(videoId, quality)).onload?.();
}

async function failProbe(videoId: string, quality: string) {
  (await waitForProbe(videoId, quality)).onerror?.();
}

describe('image-extraction', () => {
  describe('extractImageEmbeds', () => {
    let mockApp: App;
    let mockFile: TFile;

    beforeEach(() => {
      mockApp = new App();
      mockFile = { path: 'note.md' } as TFile;
      mockApp.vault.cachedRead = vi.fn().mockResolvedValue('');
      // Resolved thumbnails persist for the life of the module, so fixtures
      // reusing a video ID would otherwise inherit a previous test's answer
      clearYouTubeThumbnailCache();
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

    // Obsidian hides comment contents in Reading view, so embeds inside them
    // are not note images (#379). Verified against Obsidian's own renderer.
    describe('comment exclusions', () => {
      beforeEach(() => {
        mockApp.metadataCache.getFirstLinkpathDest = vi
          .fn()
          .mockReturnValue({ extension: 'jpg' });
        mockApp.vault.getResourcePath = vi
          .fn()
          .mockReturnValue('app://local/image.jpg');
      });

      it('should skip embeds in a block Obsidian comment', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue('Text\n%%\n![[image.jpg]]\n%%\nMore');

        expect(await extractImageEmbeds(mockFile, mockApp)).toEqual([]);
      });

      it('should skip embeds in an inline Obsidian comment', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue('Text %%![[image.jpg]]%% more');

        expect(await extractImageEmbeds(mockFile, mockApp)).toEqual([]);
      });

      it('should skip embeds in an HTML comment', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue('Text\n<!-- ![[image.jpg]] -->\nMore');

        expect(await extractImageEmbeds(mockFile, mockApp)).toEqual([]);
      });

      it('should skip Markdown images in an HTML comment', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue('<!-- ![alt](https://example.org/a.png) -->');

        expect(await extractImageEmbeds(mockFile, mockApp)).toEqual([]);
      });

      it('should skip embeds after an unclosed Obsidian comment', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue('Text\n%%\n![[image.jpg]]\nno closing delimiter');

        expect(await extractImageEmbeds(mockFile, mockApp)).toEqual([]);
      });

      it('should skip embeds after an unclosed HTML comment', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue(
            'Text\n<!--\n![[image.jpg]]\nno closing delimiter'
          );

        expect(await extractImageEmbeds(mockFile, mockApp)).toEqual([]);
      });

      it('should still extract embeds outside a comment', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue('%%hidden%%\n![[image.jpg]]');

        expect(await extractImageEmbeds(mockFile, mockApp)).toContain(
          'app://local/image.jpg'
        );
      });

      it('should not treat a comment delimiter inside code as a comment', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue('`%%`\n![[image.jpg]]');

        expect(await extractImageEmbeds(mockFile, mockApp)).toContain(
          'app://local/image.jpg'
        );
      });

      it('should not treat a delimiter inside a cardlink block as a comment', async () => {
        // Cardlink blocks are exempt from code detection so their image field is
        // parsed — a delimiter in one must still be literal, or it opens a
        // comment that never closes and hides every later image
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`\`\`\`cardlink
url: https://example.com
image: https://example.com/cover.png
description: Save 50%% now
\`\`\`

![[image.jpg]]`);

        expect(await extractImageEmbeds(mockFile, mockApp)).toContain(
          'app://local/image.jpg'
        );
      });

      it('should not treat an HTML delimiter inside a cardlink block as a comment', async () => {
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`\`\`\`cardlink
url: https://example.com
description: a <!-- b
\`\`\`

![[image.jpg]]`);

        expect(await extractImageEmbeds(mockFile, mockApp)).toContain(
          'app://local/image.jpg'
        );
      });

      it('should not treat a delimiter inside a plain fenced block as a comment', async () => {
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`\`\`\`
%%
\`\`\`

![[image.jpg]]`);

        expect(await extractImageEmbeds(mockFile, mockApp)).toContain(
          'app://local/image.jpg'
        );
      });

      it('should skip cardlink blocks inside a comment', async () => {
        mockApp.vault.cachedRead = vi.fn().mockResolvedValue(`%%
\`\`\`cardlink
url: https://example.com
image: https://example.com/cover.png
\`\`\`
%%`);

        expect(await extractImageEmbeds(mockFile, mockApp)).toEqual([]);
      });
    });

    // Probes are pre-started concurrently, bounded by the slideshow image cap,
    // and fall back to a lazy call for embeds the cap did not cover
    describe('YouTube thumbnail resolution', () => {
      const VIDEO_A = 'AAAAAAAAAAA';
      const VIDEO_B = 'BBBBBBBBBBB';
      const thumbnail = (videoId: string, quality = 'maxresdefault') =>
        `https://i.ytimg.com/vi_webp/${videoId}/${quality}.webp`;

      beforeEach(() => {
        vi.useFakeTimers();
        (global as any).__imageInstances = [];
        (global as any).__lastImage = null;
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('should resolve two YouTube embeds in document order', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue(
            `![](https://www.youtube.com/watch?v=${VIDEO_A})\n\n![](https://youtu.be/${VIDEO_B})`
          );

        const promise = extractImageEmbeds(mockFile, mockApp);

        // Settling the second video first proves both probes were in flight at
        // once — resolving one at a time would not have requested B yet — and
        // that the result still follows document order
        await succeedProbe(VIDEO_B);
        await succeedProbe(VIDEO_A);

        expect(await promise).toEqual([thumbnail(VIDEO_A), thumbnail(VIDEO_B)]);
      });

      it('should share one probe between two URL forms of the same video', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue(
            `![](https://youtu.be/${VIDEO_A})\n\n![](https://www.youtube.com/watch?v=${VIDEO_A})`
          );

        const promise = extractImageEmbeds(mockFile, mockApp);
        await succeedProbe(VIDEO_A);
        const result = await promise;

        // Dedup upstream is by path, so both embeds survive it — keying probes
        // by video ID is what stops the same thumbnail being fetched twice
        expect(mockImages()).toHaveLength(1);
        expect(result).toEqual([thumbnail(VIDEO_A), thumbnail(VIDEO_A)]);
      });

      it('should resolve past the pre-start cap lazily', async () => {
        // A YouTube embed that resolves to nothing fills no result slot, so the
        // loop can run further than the cap's worth of pre-started probes.
        // The cap is a compile-time constant, so it is mocked with the
        // non-hoisted form — a file-wide `vi.mock` would drop the sibling tests
        // below the two concurrent probes they need.
        vi.resetModules();
        vi.doMock('../../src/core/constants', async (importOriginal) => ({
          ...(await importOriginal<
            typeof import('../../src/core/constants')
          >()),
          MAX_MULTI_IMAGES: 1,
        }));
        const { extractImageEmbeds } =
          await import('../../src/core/image-extraction');

        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue(
            `![](https://www.youtube.com/watch?v=${VIDEO_A})\n\n![](https://youtu.be/${VIDEO_B})`
          );

        const promise = extractImageEmbeds(mockFile, mockApp);

        await waitForProbe(VIDEO_A, 'maxresdefault');
        expect(mockImages()).toHaveLength(1);

        await failProbe(VIDEO_A, 'maxresdefault');
        await failProbe(VIDEO_A, 'sddefault');
        await failProbe(VIDEO_A, 'hqdefault');
        await failProbe(VIDEO_A, 'mqdefault');
        await succeedProbe(VIDEO_B);

        expect(await promise).toEqual([thumbnail(VIDEO_B)]);

        vi.doUnmock('../../src/core/constants');
      });

      it('should start no probes when YouTube is disabled', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue(`![](https://www.youtube.com/watch?v=${VIDEO_A})`);

        expect(
          await extractImageEmbeds(mockFile, mockApp, { includeYoutube: false })
        ).toEqual([]);
        expect(mockImages()).toEqual([]);
      });

      it('should probe the rung the target width asks for', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue(`![](https://www.youtube.com/watch?v=${VIDEO_A})`);

        // The whole point of threading the width down five signatures: without
        // it the card fetches 1280px for a thumbnail it renders at 128px
        const promise = extractImageEmbeds(mockFile, mockApp, {
          youtubeTargetWidth: 384,
        });
        await succeedProbe(VIDEO_A, 'hqdefault');

        expect(await promise).toEqual([thumbnail(VIDEO_A, 'hqdefault')]);
        expect(mockImages()).toHaveLength(1);
      });

      it('should start no probes for a non-YouTube external image', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue('![](https://example.org/a.png)');

        expect(await extractImageEmbeds(mockFile, mockApp)).toEqual([
          'https://example.org/a.png',
        ]);
        expect(mockImages()).toEqual([]);
      });
    });

    // Obsidian resolves link targets containing square brackets (#200)
    describe('square brackets in file names', () => {
      it('should extract a wikilink embed with brackets in the name', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue('![[Image[1355x762].png]]');
        const getDest = vi.fn().mockReturnValue({ extension: 'png' });
        mockApp.metadataCache.getFirstLinkpathDest = getDest;
        mockApp.vault.getResourcePath = vi
          .fn()
          .mockReturnValue('app://local/bracket.png');

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(getDest).toHaveBeenCalledWith('Image[1355x762].png', 'note.md');
        expect(result).toContain('app://local/bracket.png');
      });

      it('should keep the caption out of a bracketed wikilink path', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue('![[Image[1].png|A caption]]');
        const getDest = vi.fn().mockReturnValue({ extension: 'png' });
        mockApp.metadataCache.getFirstLinkpathDest = getDest;
        mockApp.vault.getResourcePath = vi
          .fn()
          .mockReturnValue('app://local/bracket.png');

        await extractImageEmbeds(mockFile, mockApp);

        expect(getDest).toHaveBeenCalledWith('Image[1].png', 'note.md');
      });

      it('should extract a Markdown image with brackets in the alt text', async () => {
        mockApp.vault.cachedRead = vi
          .fn()
          .mockResolvedValue('![Alt [1355x762]](https://example.org/a.png)');

        expect(await extractImageEmbeds(mockFile, mockApp)).toContain(
          'https://example.org/a.png'
        );
      });
    });
  });
});
