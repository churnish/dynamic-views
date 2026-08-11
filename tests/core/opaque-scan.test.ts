import { vi } from 'vitest';
import { App, TFile } from 'obsidian';
import { scanOpaque } from '../../src/core/opaque-scan';
import { extractImageEmbeds } from '../../src/core/image-extraction';
import { sanitizeForTextPreview } from '../../src/core/text-preview';

// Mock style settings
vi.mock('../../src/utils/style-settings', () => ({
  getSlideshowMaxImages: vi.fn(() => 10),
}));

/** Cut every comment out of `content`, using full code detection. */
function cut(content: string): string {
  return scanOpaque(content).cutComments();
}

describe('opaque-scan', () => {
  describe('cutComments', () => {
    it('should cut a closed Obsidian comment', () => {
      expect(cut('ab %%hide%% cd')).toBe('ab  cd');
    });

    it('should cut a closed HTML comment', () => {
      expect(cut('ab <!--hide--> cd')).toBe('ab  cd');
    });

    it('should treat the earliest opener as the comment', () => {
      // The `%%` sits inside the HTML comment, so it is comment text — the
      // trailing content must survive. Matches Obsidian's renderer.
      expect(cut('A <!-- %% --> tail')).toBe('A  tail');
    });

    it('should let an Obsidian comment span an HTML opener', () => {
      expect(cut('B %% <!-- %% tail')).toBe('B  tail');
    });

    it('should ignore an opener inside inline code', () => {
      expect(cut('Code `%%` here. Tail.')).toBe('Code `%%` here. Tail.');
    });

    it('should ignore an opener inside a fenced block', () => {
      const input = 'a\n```\n%%\n```\nb';
      expect(cut(input)).toBe(input);
    });

    it('should ignore an opener inside indented code', () => {
      const input = 'text\n\n    %% indented\n\ntail';
      expect(cut(input)).toBe(input);
    });

    it('should resume scanning after a skipped in-code opener', () => {
      // The backticked `%%` must not pair with the real comment that follows
      expect(cut('`%%` a %%hidden%% b')).toBe('`%%` a  b');
    });

    it('should leave content without comments alone', () => {
      expect(cut('plain text')).toBe('plain text');
    });

    it('should handle empty content', () => {
      expect(cut('')).toBe('');
    });

    it('should handle degenerate delimiter forms', () => {
      // `%%` opens and closes with the same token, and `<!-->` closes inside the
      // opener's own characters — both are easy to scan into an infinite or
      // runaway range
      expect(cut('%%%%')).toBe('');
      expect(cut('%%a%%b%%c%%')).toBe('b');
      expect(cut('x<!-->y')).toBe('xy');
      expect(cut('x<!--->y')).toBe('xy');
      expect(cut('x<!---->y')).toBe('xy');
    });

    it('should cut every comment in an interleaved fixture', () => {
      // Fenced, indented, and inline code all shielding an opener, with a real
      // comment on either side of them
      const input = [
        'intro %%one%% text',
        '',
        '```',
        '%% fenced literal',
        '```',
        '',
        '    %% indented literal',
        '',
        'tail `%%` and %%two%% end',
      ].join('\n');

      expect(cut(input)).toBe(
        [
          'intro  text',
          '',
          '```',
          '%% fenced literal',
          '```',
          '',
          '    %% indented literal',
          '',
          'tail `%%` and  end',
        ].join('\n')
      );
    });
  });

  describe('cutComments inline vs block form', () => {
    it('should leave an unclosed inline opener as literal text', () => {
      expect(cut('Visible AAA %% rest of this line BBB')).toBe(
        'Visible AAA %% rest of this line BBB'
      );
      expect(cut('x <!-- y')).toBe('x <!-- y');
    });

    it('should leave an unclosed inline opener at the end of content', () => {
      expect(cut('tail %%')).toBe('tail %%');
      expect(cut('tail <!--')).toBe('tail <!--');
    });

    it('should not treat a lone third percent sign as a closer', () => {
      // `%%%` is inline form (the line has a further `%` after the opener) with
      // no closer, so nothing is hidden
      expect(cut('%%%')).toBe('%%%');
    });

    it('should run an unclosed block opener to the end of content', () => {
      expect(cut('a\n%%\nhidden')).toBe('a\n');
      expect(cut('a\n<!--\nhidden')).toBe('a\n');
    });

    it('should close a block opener at a later line', () => {
      expect(cut('%%\nhidden\n%%\nafter')).toBe('\nafter');
    });
  });

  describe('isOpaque', () => {
    it('should cover a fenced block through its terminating newline', () => {
      const input = '```\nx\n```\nafter';
      const scan = scanOpaque(input);
      const afterIndex = input.indexOf('after');
      expect(scan.isOpaque(afterIndex - 1)).toBe(true); // newline closing the fence
      expect(scan.isOpaque(afterIndex)).toBe(false);
    });

    it('should cover an indented block through its terminating newline', () => {
      const input = 'x\n\n    code\n\nafter';
      const scan = scanOpaque(input);
      const codeIndex = input.indexOf('code');
      expect(scan.isOpaque(codeIndex)).toBe(true);
      expect(scan.isOpaque(codeIndex + 'code'.length)).toBe(true); // newline
      expect(scan.isOpaque(input.indexOf('after'))).toBe(false);
    });

    it('should treat an inline code span end as outside', () => {
      const input = 'a `x` b';
      const scan = scanOpaque(input);
      const closingBacktick = input.lastIndexOf('`');
      expect(scan.isOpaque(closingBacktick)).toBe(true);
      expect(scan.isOpaque(closingBacktick + 1)).toBe(false);
    });

    it('should not treat a cardlink block as code', () => {
      const input = '```cardlink\nimage: a.png\n```';
      const scan = scanOpaque(input);
      expect(scan.isOpaque(input.indexOf('image:'))).toBe(false);
    });

    it('should treat a commented position as opaque', () => {
      const input = 'a %%hidden%% b';
      const scan = scanOpaque(input);
      expect(scan.isOpaque(input.indexOf('hidden'))).toBe(true);
      expect(scan.isOpaque(input.indexOf(' b'))).toBe(false);
    });
  });

  describe('cardlinkBlocks', () => {
    it('should expose a cardlink fence with its body', () => {
      const input = 'intro\n\n```cardlink\nimage: a.png\n```\n';
      expect(scanOpaque(input).cardlinkBlocks).toEqual([
        { start: input.indexOf('```cardlink'), content: 'image: a.png\n' },
      ]);
    });

    it('should omit a cardlink fence inside a comment', () => {
      const input = '%%\n```cardlink\nimage: a.png\n```\n%%';
      expect(scanOpaque(input).cardlinkBlocks).toEqual([]);
    });

    it('should return no blocks for a plain fence', () => {
      expect(scanOpaque('```js\nlet a = 1;\n```').cardlinkBlocks).toEqual([]);
    });
  });

  /**
   * Both consumers of the scan read the same ranges, and a change to it can move
   * one without the other. These fixtures assert MUTUAL AGREEMENT — that the
   * extractor and the preview reach the same verdict about a region — not
   * fidelity to how Obsidian renders it. Renderer fidelity is asserted in each
   * consumer's own suite.
   */
  describe('consumer agreement', () => {
    const RESOURCE_PATH = 'app://local/a.png';
    /** One embed for the extractor to report on, one marker for the preview. */
    const REGION = '![[a.png]] MARKER';
    const KEPT = { embedKept: true, markerKept: true };
    const HIDDEN = { embedKept: false, markerKept: false };

    let mockApp: App;
    let mockFile: TFile;

    beforeEach(() => {
      mockApp = new App();
      mockFile = { path: 'note.md' } as TFile;
      mockApp.metadataCache.getFirstLinkpathDest = vi
        .fn()
        .mockReturnValue({ extension: 'png' } as TFile);
      mockApp.vault.getResourcePath = vi.fn().mockReturnValue(RESOURCE_PATH);
    });

    /**
     * What each consumer kept from one fixture.
     *
     * The embed answers for the extractor and the marker word for the preview,
     * because the preview strips embeds and the extractor never sees prose. Both
     * sit in the same region, so a disagreement about whether that region renders
     * shows up as one surviving without the other.
     */
    async function verdicts(content: string) {
      mockApp.vault.cachedRead = vi.fn().mockResolvedValue(content);
      const embeds = await extractImageEmbeds(mockFile, mockApp);
      return {
        embedKept: embeds.includes(RESOURCE_PATH),
        markerKept: sanitizeForTextPreview(content, 'never').includes('MARKER'),
      };
    }

    it('should agree on a closed block comment', async () => {
      expect(await verdicts(`Intro\n%%\n${REGION}\n%%\nTail`)).toEqual(HIDDEN);
    });

    it('should agree on a closed inline comment', async () => {
      expect(await verdicts(`Intro %%${REGION}%% tail`)).toEqual(HIDDEN);
    });

    it('should agree on a closed HTML comment', async () => {
      expect(await verdicts(`Intro <!-- ${REGION} --> tail`)).toEqual(HIDDEN);
    });

    it('should agree on an unclosed block opener', async () => {
      expect(await verdicts(`Intro\n%%\n${REGION}`)).toEqual(HIDDEN);
      expect(await verdicts(`Intro\n<!--\n${REGION}`)).toEqual(HIDDEN);
    });

    it('should agree on an unclosed inline opener', async () => {
      expect(await verdicts(`Intro %% ${REGION}`)).toEqual(KEPT);
      expect(await verdicts(`Intro <!-- ${REGION}`)).toEqual(KEPT);
    });

    it('should agree on an opener inside inline code', async () => {
      expect(await verdicts(`Intro \`%%\` and ${REGION}`)).toEqual(KEPT);
    });

    it('should agree on an opener inside a fenced block', async () => {
      // The region sits after the block on purpose: an embed written inside a
      // fence is dropped by both consumers for reasons that have nothing to do
      // with the comment scan, so that phrasing would pass vacuously
      expect(
        await verdicts(['```', '%%', '```', '', REGION].join('\n'))
      ).toEqual(KEPT);
    });

    it('should agree on an opener inside an indented fenced block', async () => {
      // A fence inside a list item is indented on both sides. `removeCodeBlocks`
      // once required a flush-left closer, so the block stayed open and its body
      // leaked into the preview while the extractor hid it — the one shape where
      // the two consumers disagreed outright
      expect(
        await verdicts(
          ['- item:', '', '    ```js', '    %%', '    ```', '', REGION].join(
            '\n'
          )
        )
      ).toEqual(KEPT);
    });

    it('should agree on an opener inside indented code', async () => {
      // Region after the block for the same reason as the fenced fixture
      expect(
        await verdicts(['Intro', '', '    %% indented', '', REGION].join('\n'))
      ).toEqual(KEPT);
    });

    it('should agree on a closer inside inline code', async () => {
      // Closers are not code-aware, so the comment ends at the backticked `%%`
      expect(await verdicts(`Intro %% hidden \`%%\` ${REGION}`)).toEqual(KEPT);
    });

    it('should agree on a comment holding the other delimiter', async () => {
      expect(await verdicts(`Intro <!-- %% --> ${REGION}`)).toEqual(KEPT);
    });

    it('should agree on a degenerate empty HTML comment', async () => {
      expect(await verdicts(`Intro <!--> ${REGION}`)).toEqual(KEPT);
    });
  });
});
