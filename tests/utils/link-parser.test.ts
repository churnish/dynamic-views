import {
  findLinksInText,
  hasUriScheme,
  type TextSegment,
} from '../../src/utils/link-parser';

// Helper: extract the first link segment from a single-link input
function firstLink(text: string) {
  const segments = findLinksInText(text);
  const seg = segments.find(
    (s): s is Extract<TextSegment, { type: 'link' }> => s.type === 'link'
  );
  if (!seg) throw new Error(`No link segment found in: ${text}`);
  return seg.link;
}

// Same lookup, but returns the whole segment — firstLink unwraps to .link, so it cannot serve assertions on segment-level fields such as `raw`.
function firstLinkSegment(text: string) {
  const segments = findLinksInText(text);
  const seg = segments.find(
    (s): s is Extract<TextSegment, { type: 'link' }> => s.type === 'link'
  );
  if (!seg) throw new Error(`No link segment found in: ${text}`);
  return seg;
}

describe('link-parser', () => {
  // ---------------------------------------------------------------------------
  // hasUriScheme
  // ---------------------------------------------------------------------------
  describe('hasUriScheme', () => {
    it('returns true for https://', () => {
      expect(hasUriScheme('https://example.com')).toBe(true);
    });

    it('returns true for http://', () => {
      expect(hasUriScheme('http://example.com')).toBe(true);
    });

    it('returns true for obsidian://', () => {
      expect(hasUriScheme('obsidian://open?vault=test')).toBe(true);
    });

    it('returns true for ftp://', () => {
      expect(hasUriScheme('ftp://files.example.com')).toBe(true);
    });

    it('returns false for a bare path', () => {
      expect(hasUriScheme('folder/file.md')).toBe(false);
    });

    it('returns false for a wikilink', () => {
      expect(hasUriScheme('[[Note]]')).toBe(false);
    });

    it('returns false for an empty string', () => {
      expect(hasUriScheme('')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(hasUriScheme('HTTPS://example.com')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // findLinksInText — embedded wikilink ![[path]]
  // ---------------------------------------------------------------------------
  describe('findLinksInText — embedded wikilink', () => {
    it('type is internal', () => {
      expect(firstLink('![[image.png]]').type).toBe('internal');
    });

    it('isEmbed is true', () => {
      expect(firstLink('![[image.png]]').isEmbed).toBe(true);
    });

    it('url is the path', () => {
      expect(firstLink('![[image.png]]').url).toBe('image.png');
    });

    it('caption defaults to path when no alias', () => {
      expect(firstLink('![[image.png]]').caption).toBe('image.png');
    });

    it('caption is the alias when alias is present', () => {
      expect(firstLink('![[image.png|My Image]]').caption).toBe('My Image');
    });

    it('url is still the path (not alias) when alias is present', () => {
      expect(firstLink('![[image.png|My Image]]').url).toBe('image.png');
    });

    it('isWebUrl is false', () => {
      expect(firstLink('![[image.png]]').isWebUrl).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // findLinksInText — wikilink [[path]]
  // ---------------------------------------------------------------------------
  describe('findLinksInText — wikilink', () => {
    it('type is internal', () => {
      expect(firstLink('[[Note]]').type).toBe('internal');
    });

    it('isEmbed is false', () => {
      expect(firstLink('[[Note]]').isEmbed).toBe(false);
    });

    it('url is the path', () => {
      expect(firstLink('[[Note]]').url).toBe('Note');
    });

    it('caption defaults to path when no alias', () => {
      expect(firstLink('[[Note]]').caption).toBe('Note');
    });

    it('caption is the alias when alias is present', () => {
      expect(firstLink('[[Note|My Note]]').caption).toBe('My Note');
    });

    it('url is still the path (not alias) when alias is present', () => {
      expect(firstLink('[[Note|My Note]]').url).toBe('Note');
    });

    it('isWebUrl is false', () => {
      expect(firstLink('[[Note]]').isWebUrl).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // findLinksInText — embedded Markdown ![caption](path)
  // ---------------------------------------------------------------------------
  describe('findLinksInText — embedded Markdown link', () => {
    it('isEmbed is true', () => {
      expect(firstLink('![Alt](image.png)').isEmbed).toBe(true);
    });

    it('type is internal when path has no scheme', () => {
      expect(firstLink('![Alt](image.png)').type).toBe('internal');
    });

    it('type is external when path has a URI scheme', () => {
      expect(firstLink('![Alt](https://example.com/img.png)').type).toBe(
        'external'
      );
    });

    it('caption is the alt text', () => {
      expect(firstLink('![Alt Text](image.png)').caption).toBe('Alt Text');
    });

    it('caption falls back to path when alt text is empty', () => {
      expect(firstLink('![](image.png)').caption).toBe('image.png');
    });

    it('url is the decoded path', () => {
      expect(firstLink('![Alt](image.png)').url).toBe('image.png');
    });

    it('isWebUrl is true for https path', () => {
      expect(firstLink('![Alt](https://example.com/img.png)').isWebUrl).toBe(
        true
      );
    });

    it('isWebUrl is false for internal path', () => {
      expect(firstLink('![Alt](image.png)').isWebUrl).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // findLinksInText — Markdown link [caption](url)
  // ---------------------------------------------------------------------------
  describe('findLinksInText — Markdown link', () => {
    it('isEmbed is false', () => {
      expect(firstLink('[Example](https://example.org)').isEmbed).toBe(false);
    });

    it('type is external when URL has a URI scheme', () => {
      expect(firstLink('[Example](https://example.org)').type).toBe('external');
    });

    it('type is internal when URL has no URI scheme', () => {
      expect(firstLink('[Note](folder/note.md)').type).toBe('internal');
    });

    it('caption is the link text', () => {
      expect(firstLink('[Example](https://example.org)').caption).toBe(
        'Example'
      );
    });

    it('caption equals URL when link text is the URL', () => {
      const link = firstLink('[https://example.org](https://example.org)');
      expect(link.caption).toBe('https://example.org');
    });

    it('url is the href', () => {
      expect(firstLink('[Example](https://example.org)').url).toBe(
        'https://example.org'
      );
    });

    it('isWebUrl is true for https URL', () => {
      expect(firstLink('[Example](https://example.org)').isWebUrl).toBe(true);
    });

    it('isWebUrl is true for http URL', () => {
      expect(firstLink('[Example](http://example.org)').isWebUrl).toBe(true);
    });

    it('isWebUrl is false for obsidian:// URL', () => {
      expect(firstLink('[Open](obsidian://open?vault=test)').isWebUrl).toBe(
        false
      );
    });
  });

  // ---------------------------------------------------------------------------
  // findLinksInText — Markdown link with angle brackets [caption](<url>)
  // ---------------------------------------------------------------------------
  describe('findLinksInText — Markdown link with angle brackets', () => {
    it('url has angle brackets stripped', () => {
      expect(firstLink('[Example](<https://example.org>)').url).toBe(
        'https://example.org'
      );
    });

    it('isWebUrl is true', () => {
      expect(firstLink('[Example](<https://example.org>)').isWebUrl).toBe(true);
    });

    it('caption is the link text', () => {
      expect(firstLink('[Example](<https://example.org>)').caption).toBe(
        'Example'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // findLinksInText — angle bracket URL <scheme://...>
  // ---------------------------------------------------------------------------
  describe('findLinksInText — angle bracket URL', () => {
    it('isEmbed is false', () => {
      expect(firstLink('<https://example.org>').isEmbed).toBe(false);
    });

    it('type is external', () => {
      expect(firstLink('<https://example.org>').type).toBe('external');
    });

    it('url is the bare URL without angle brackets', () => {
      expect(firstLink('<https://example.org>').url).toBe(
        'https://example.org'
      );
    });

    it('caption equals url', () => {
      const link = firstLink('<https://example.org>');
      expect(link.caption).toBe(link.url);
    });

    it('isWebUrl is true for https', () => {
      expect(firstLink('<https://example.org>').isWebUrl).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // findLinksInText — plain URL
  // ---------------------------------------------------------------------------
  describe('findLinksInText — plain URL', () => {
    it('isEmbed is false', () => {
      expect(firstLink('https://example.org').isEmbed).toBe(false);
    });

    it('type is external', () => {
      expect(firstLink('https://example.org').type).toBe('external');
    });

    it('url matches the URL', () => {
      expect(firstLink('https://example.org').url).toBe('https://example.org');
    });

    it('caption equals url', () => {
      const link = firstLink('https://example.org');
      expect(link.caption).toBe(link.url);
    });

    it('isWebUrl is true for https://', () => {
      expect(firstLink('https://example.org').isWebUrl).toBe(true);
    });

    it('isWebUrl is true for http://', () => {
      expect(firstLink('http://example.org').isWebUrl).toBe(true);
    });

    it('isWebUrl is false for obsidian://', () => {
      expect(firstLink('obsidian://open?vault=test').isWebUrl).toBe(false);
    });

    it('isWebUrl is false for ftp://', () => {
      expect(firstLink('ftp://files.example.com').isWebUrl).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Trailing punctuation stripping on plain URLs
  // ---------------------------------------------------------------------------
  describe('findLinksInText — trailing punctuation on plain URLs', () => {
    it('strips trailing period', () => {
      expect(firstLink('See https://example.org.').url).toBe(
        'https://example.org'
      );
    });

    it('strips trailing comma', () => {
      expect(firstLink('https://example.org,').url).toBe('https://example.org');
    });

    it('strips trailing semicolon', () => {
      expect(firstLink('https://example.org;').url).toBe('https://example.org');
    });

    it('strips trailing exclamation mark', () => {
      expect(firstLink('https://example.org!').url).toBe('https://example.org');
    });

    it('strips trailing question mark', () => {
      expect(firstLink('https://example.org?').url).toBe('https://example.org');
    });

    it('emits the trailing punctuation as a separate text segment', () => {
      const segments = findLinksInText('https://example.org.');
      const last = segments[segments.length - 1];
      expect(last.type).toBe('text');
      if (last.type === 'text') expect(last.content).toBe('.');
    });

    it('does not strip punctuation that is part of query string', () => {
      // A URL with a query string containing a colon shouldn't be mangled
      expect(firstLink('https://example.org/path?q=a').url).toBe(
        'https://example.org/path?q=a'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // URL-encoded paths
  // ---------------------------------------------------------------------------
  describe('findLinksInText — URL-encoded paths', () => {
    it('decodes %20 in Markdown link href', () => {
      expect(firstLink('[Note](folder%20name/note.md)').url).toBe(
        'folder name/note.md'
      );
    });

    it('decodes %20 in angle-bracket Markdown link href', () => {
      expect(firstLink('[Note](<folder%20name/note.md>)').url).toBe(
        'folder name/note.md'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // isWebUrl across variants
  // ---------------------------------------------------------------------------
  describe('findLinksInText — isWebUrl flag', () => {
    it('is true for https wikilink (not applicable — always false for wikilinks)', () => {
      // Wikilinks are always internal; isWebUrl is always false
      expect(firstLink('[[Note]]').isWebUrl).toBe(false);
    });

    it('is true for embedded Markdown with https path', () => {
      expect(
        firstLink('![img](https://cdn.example.com/img.jpg)').isWebUrl
      ).toBe(true);
    });

    it('is false for embedded Markdown with obsidian:// path', () => {
      expect(firstLink('![img](obsidian://path)').isWebUrl).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Mixed content
  // ---------------------------------------------------------------------------
  describe('findLinksInText — mixed content', () => {
    it('returns a text segment before the link', () => {
      const segments = findLinksInText('hello [[World]] and more');
      expect(segments[0]).toEqual({ type: 'text', content: 'hello ' });
    });

    it('returns the link segment in the middle', () => {
      const segments = findLinksInText('hello [[World]] and more');
      const link = segments.find((s) => s.type === 'link');
      expect(link).toBeDefined();
      if (link && link.type === 'link') {
        expect(link.link.url).toBe('World');
      }
    });

    it('returns a text segment after the link', () => {
      const segments = findLinksInText('hello [[World]] and more');
      const last = segments[segments.length - 1];
      expect(last).toEqual({ type: 'text', content: ' and more' });
    });

    it('returns all three segments for embedded-link-in-text', () => {
      const segments = findLinksInText('prefix ![[img.png]] suffix');
      expect(segments).toHaveLength(3);
    });

    it('handles multiple links in one string', () => {
      const segments = findLinksInText('[[Alpha]] and [[Beta]]');
      const links = segments.filter((s) => s.type === 'link');
      expect(links).toHaveLength(2);
    });

    it('returns the first link url correctly in multi-link string', () => {
      const segments = findLinksInText('[[Alpha]] and [[Beta]]');
      const links = segments.filter((s) => s.type === 'link');
      expect(links[0].link.url).toBe('Alpha');
    });

    it('returns the second link url correctly in multi-link string', () => {
      const segments = findLinksInText('[[Alpha]] and [[Beta]]');
      const links = segments.filter((s) => s.type === 'link');
      expect(links[1].link.url).toBe('Beta');
    });

    it('returns a text segment between two links', () => {
      const segments = findLinksInText('[[Alpha]] and [[Beta]]');
      const text = segments.filter((s) => s.type === 'text');
      expect(text.some((s) => s.type === 'text' && s.content === ' and ')).toBe(
        true
      );
    });

    it('mixes wikilinks and plain URLs', () => {
      const segments = findLinksInText('[[Note]] see https://example.org');
      const links = segments.filter((s) => s.type === 'link');
      expect(links).toHaveLength(2);
    });

    it('first link in mixed wikilink+URL is internal', () => {
      const segments = findLinksInText('[[Note]] see https://example.org');
      const links = segments.filter((s) => s.type === 'link');
      expect(links[0].link.type).toBe('internal');
    });

    it('second link in mixed wikilink+URL is external', () => {
      const segments = findLinksInText('[[Note]] see https://example.org');
      const links = segments.filter((s) => s.type === 'link');
      expect(links[1].link.type).toBe('external');
    });
  });

  // ---------------------------------------------------------------------------
  // Plain text only (no links)
  // ---------------------------------------------------------------------------
  describe('findLinksInText — plain text', () => {
    it('returns a single text segment when no links are present', () => {
      const segments = findLinksInText('just plain text');
      expect(segments).toHaveLength(1);
    });

    it('the single segment has type text', () => {
      const segments = findLinksInText('just plain text');
      expect(segments[0].type).toBe('text');
    });

    it('the single segment preserves the original content', () => {
      const segments = findLinksInText('just plain text');
      if (segments[0].type === 'text') {
        expect(segments[0].content).toBe('just plain text');
      }
    });

    it('returns a single text segment for an empty string', () => {
      const segments = findLinksInText('');
      expect(segments).toHaveLength(1);
      if (segments[0].type === 'text') {
        expect(segments[0].content).toBe('');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // raw field on link segments
  // ---------------------------------------------------------------------------
  describe('findLinksInText — raw field', () => {
    it('raw matches the original wikilink text', () => {
      const link = firstLinkSegment('[[Note]]');
      expect(link.raw).toBe('[[Note]]');
    });

    it('raw matches the original embedded wikilink text', () => {
      const link = firstLinkSegment('![[img.png]]');
      expect(link.raw).toBe('![[img.png]]');
    });

    it('raw matches the original Markdown link text', () => {
      const link = firstLinkSegment('[Example](https://example.org)');
      expect(link.raw).toBe('[Example](https://example.org)');
    });

    it('raw for plain URL is the clean URL without trailing punctuation', () => {
      const link = firstLinkSegment('https://example.org.');
      expect(link.raw).toBe('https://example.org');
    });
  });
});
