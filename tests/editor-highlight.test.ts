/**
 * Unit tests for syntax highlighting + HTML helpers. These use the DOM
 * (escapeHtml builds an element), hence the jsdom environment.
 *   - escapeHtml / highlightText
 *   - tokenizePython / tokenizeJson / tokenizeJsonLine / tokenizeMarkdown
 */
import { loadApp, AppModule } from './helpers/app-harness';

let app: AppModule;
beforeAll(() => {
  app = loadApp();
});

describe('escapeHtml', () => {
  it('escapes angle brackets and ampersands', () => {
    expect(app.escapeHtml('<div> & </div>')).toBe('&lt;div&gt; &amp; &lt;/div&gt;');
  });

  it('does not escape quotes or apostrophes (text content, not attributes)', () => {
    expect(app.escapeHtml(`"it's"`)).toBe(`"it's"`);
  });

  it('leaves plain text unchanged', () => {
    expect(app.escapeHtml('plain text')).toBe('plain text');
  });
});

describe('highlightText', () => {
  it('wraps a match in a search-highlight span', () => {
    expect(app.highlightText('hello world', 'world')).toBe(
      'hello <span class="search-highlight">world</span>',
    );
  });

  it('matches case-insensitively', () => {
    expect(app.highlightText('Hello World', 'world')).toBe(
      'Hello <span class="search-highlight">World</span>',
    );
  });

  it('returns escaped text when the query is empty', () => {
    expect(app.highlightText('<a>', '')).toBe('&lt;a&gt;');
  });
});

describe('tokenizePython', () => {
  it('tags keywords and function-call names', () => {
    const html = app.tokenizePython('def foo():');
    expect(html).toContain('<span class="tok-keyword">def</span>');
    expect(html).toContain('<span class="tok-function">foo</span>');
  });

  it('tags comments', () => {
    expect(app.tokenizePython('# a comment')).toContain(
      '<span class="tok-comment"># a comment</span>',
    );
  });

  it('tags string literals', () => {
    expect(app.tokenizePython('"hello"')).toContain('<span class="tok-string">"hello"</span>');
  });

  it('tags triple-quoted strings', () => {
    expect(app.tokenizePython('"""doc"""')).toContain(
      '<span class="tok-string">"""doc"""</span>',
    );
  });

  it('tags numbers', () => {
    expect(app.tokenizePython('42')).toContain('<span class="tok-number">42</span>');
  });

  it('tags builtins (before treating them as function calls)', () => {
    expect(app.tokenizePython('print')).toContain('<span class="tok-builtin">print</span>');
  });

  it('tags self/cls specially', () => {
    expect(app.tokenizePython('self')).toContain('<span class="tok-self">self</span>');
  });

  it('tags capitalised identifiers as class names', () => {
    expect(app.tokenizePython('MyClass')).toContain('<span class="tok-class">MyClass</span>');
  });

  it('tags decorators at line start', () => {
    expect(app.tokenizePython('@decorator')).toContain(
      '<span class="tok-decorator">@decorator</span>',
    );
  });

  it('escapes special characters inside plain text', () => {
    expect(app.tokenizePython('a < b')).toContain('&lt;');
  });
});

describe('tokenizeJsonLine', () => {
  const fresh = () => ({ inBlockComment: false });

  it('distinguishes keys from string values', () => {
    const { html } = app.tokenizeJsonLine('"key": "value"', fresh());
    expect(html).toContain('<span class="tok-json-key">"key"</span>');
    expect(html).toContain('<span class="tok-json-string">"value"</span>');
    expect(html).toContain('<span class="tok-json-punct">:</span>');
  });

  it('tags numbers, booleans and null', () => {
    expect(app.tokenizeJsonLine('42', fresh()).html).toContain(
      '<span class="tok-json-number">42</span>',
    );
    expect(app.tokenizeJsonLine('true', fresh()).html).toContain(
      '<span class="tok-json-bool">true</span>',
    );
    expect(app.tokenizeJsonLine('null', fresh()).html).toContain(
      '<span class="tok-json-null">null</span>',
    );
  });

  it('tags JSONC line comments', () => {
    expect(app.tokenizeJsonLine('// note', fresh()).html).toContain(
      '<span class="tok-json-comment">// note</span>',
    );
  });

  it('carries an unterminated block comment to the next line', () => {
    const first = app.tokenizeJsonLine('/* open', fresh());
    expect(first.state.inBlockComment).toBe(true);

    const second = app.tokenizeJsonLine('still comment */ "k":', first.state);
    expect(second.state.inBlockComment).toBe(false);
    expect(second.html).toContain('tok-json-comment');
  });
});

describe('tokenizeJson', () => {
  it('wraps each source line in a numbered json-line span', () => {
    const html = app.tokenizeJson('{\n  "a": 1\n}');
    expect(html).toContain('class="json-line" data-line="1"');
    expect(html).toContain('class="json-line" data-line="2"');
    expect(html).toContain('class="json-line" data-line="3"');
    expect(html).toContain('<span class="tok-json-key">"a"</span>');
  });

  it('falls back to plain (un-tokenized) text for lines beyond the length limit', () => {
    const longLine = 'a'.repeat(5001);
    const html = app.tokenizeJson(longLine);
    expect(html).toContain('class="json-line" data-line="1"');
    expect(html).not.toContain('tok-json-');
  });
});

describe('tokenizeMarkdown', () => {
  it('tags headings', () => {
    expect(app.tokenizeMarkdown('# Title')).toContain('<span class="tok-md-heading"># Title</span>');
  });

  it('tags bold and italic', () => {
    expect(app.tokenizeMarkdown('**bold**')).toContain('<span class="tok-md-bold">**bold**</span>');
    expect(app.tokenizeMarkdown('*it*')).toContain('<span class="tok-md-italic">*it*</span>');
  });

  it('tags inline code', () => {
    expect(app.tokenizeMarkdown('`code`')).toContain('<span class="tok-md-code">`code`</span>');
  });

  it('tags fenced code blocks as a single token', () => {
    expect(app.tokenizeMarkdown('```js\nconst x = 1;\n```')).toContain('tok-md-codeblock');
  });

  it('tags links and images', () => {
    expect(app.tokenizeMarkdown('[text](http://x)')).toContain('tok-md-link');
    expect(app.tokenizeMarkdown('![alt](http://x)')).toContain('tok-md-image');
  });

  it('tags blockquotes, lists and horizontal rules', () => {
    expect(app.tokenizeMarkdown('> quote')).toContain('tok-md-blockquote');
    expect(app.tokenizeMarkdown('- item')).toContain('tok-md-list');
    expect(app.tokenizeMarkdown('---')).toContain('tok-md-hr');
  });
});

describe('wrapMatchesInElement (find in content)', () => {
  function root(text: string): HTMLElement {
    const el = document.createElement('div');
    el.textContent = text;
    return el;
  }

  it('wraps every occurrence in a find-mark and preserves surrounding text', () => {
    const el = root('ab cd ab');
    const marks = app.wrapMatchesInElement(el, 'ab', false);
    expect(marks).toHaveLength(2);
    expect(el.querySelectorAll('mark.find-mark')).toHaveLength(2);
    expect(el.textContent).toBe('ab cd ab'); // text intact, just re-wrapped
  });

  it('matches case-insensitively by default', () => {
    const el = root('Hello HELLO hello');
    expect(app.wrapMatchesInElement(el, 'hello', false)).toHaveLength(3);
  });

  it('respects the case-sensitive flag', () => {
    const el = root('Hello HELLO hello');
    const marks = app.wrapMatchesInElement(el, 'hello', true);
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('hello');
  });

  it('returns no marks when there is no match', () => {
    const el = root('nothing here');
    expect(app.wrapMatchesInElement(el, 'xyz', false)).toEqual([]);
    expect(el.querySelectorAll('mark.find-mark')).toHaveLength(0);
  });
});
