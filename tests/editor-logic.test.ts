/**
 * Unit tests for the editor's pure logic (no layout / selection needed):
 *   - computeOutdent       — Shift+Tab outdent offset math
 *   - computeJsonFoldRegions — brace-matching for JSON folding
 *   - file-type detection  — looksLikePython / looksLikeJson / isJsonByPathOrTitle
 *   - JSON auto-format     — tryPrettyPrintJson / maybePrettyPrintJson
 *   - string utilities     — sanitizeFilename / truncateMiddle / escapeRegex
 */
import { loadApp, AppModule } from './helpers/app-harness';

let app: AppModule;
beforeAll(() => {
  app = loadApp();
});

describe('computeOutdent', () => {
  it('removes two leading spaces from a single line and shifts the caret', () => {
    const r = app.computeOutdent('  hello', 4, 4);
    expect(r).toEqual({ value: 'hello', start: 2, end: 2 });
  });

  it('removes a single leading tab (counts as one indent level)', () => {
    const r = app.computeOutdent('\thello', 3, 3);
    expect(r).toEqual({ value: 'hello', start: 2, end: 2 });
  });

  it('removes only the available space when there is just one', () => {
    const r = app.computeOutdent(' hello', 3, 3);
    expect(r).toEqual({ value: 'hello', start: 2, end: 2 });
  });

  it('returns null when there is no leading whitespace to strip', () => {
    expect(app.computeOutdent('hello', 2, 2)).toBeNull();
  });

  it('outdents every line a multi-line selection touches', () => {
    const r = app.computeOutdent('  a\n  b\n  c', 0, 11);
    expect(r).toEqual({ value: 'a\nb\nc', start: 0, end: 5 });
  });

  it('does not outdent a trailing line when the selection ends at its start', () => {
    // selection covers "  a\n" only (end is right after the newline)
    const r = app.computeOutdent('  a\n  b', 0, 4);
    expect(r).toEqual({ value: 'a\n  b', start: 0, end: 2 });
  });
});

describe('computeJsonFoldRegions', () => {
  it('finds no region for a one-line object', () => {
    expect(app.computeJsonFoldRegions('{"a":1,"b":2}')).toEqual([]);
  });

  it('finds a region for a multi-line object', () => {
    expect(app.computeJsonFoldRegions('{\n  "a": 1\n}')).toEqual([
      { startLine: 1, endLine: 3, openChar: '{' },
    ]);
  });

  it('does not fold an empty {} spanning only adjacent lines', () => {
    expect(app.computeJsonFoldRegions('{\n}')).toEqual([]);
  });

  it('finds nested regions (inner closes before outer)', () => {
    const regions = app.computeJsonFoldRegions('{\n  "a": {\n    "b": 1\n  }\n}');
    expect(regions).toEqual(
      expect.arrayContaining([
        { startLine: 2, endLine: 4, openChar: '{' },
        { startLine: 1, endLine: 5, openChar: '{' },
      ]),
    );
    expect(regions).toHaveLength(2);
  });

  it('ignores braces inside string values', () => {
    expect(app.computeJsonFoldRegions('{\n  "a": "}{}{"\n}')).toEqual([
      { startLine: 1, endLine: 3, openChar: '{' },
    ]);
  });

  it('ignores braces inside JSONC line comments', () => {
    expect(app.computeJsonFoldRegions('{\n  // } not a brace\n  "a": 1\n}')).toEqual([
      { startLine: 1, endLine: 4, openChar: '{' },
    ]);
  });

  it('detects array regions', () => {
    expect(app.computeJsonFoldRegions('[\n  1,\n  2\n]')).toEqual([
      { startLine: 1, endLine: 4, openChar: '[' },
    ]);
  });
});

describe('looksLikePython', () => {
  it.each([
    ['def foo():', true],
    ['class Bar:', true],
    ['import os', true],
    ['from sys import argv', true],
    ['#!/usr/bin/env python3', true],
    ['just some prose', false],
    ['x = 1', false],
    ['', false],
  ])('looksLikePython(%j) === %s', (input, expected) => {
    expect(app.looksLikePython(input as string)).toBe(expected);
  });
});

describe('looksLikeJson', () => {
  it.each([
    ['{"a":1}', true],
    ['  {"x": true}  ', true],
    ['[{"a":1}]', true],
    ['[1,2,3]', false], // array of primitives has no "key": signature
    ['{}', false],
    ['hello', false],
    ['', false],
  ])('looksLikeJson(%j) === %s', (input, expected) => {
    expect(app.looksLikeJson(input as string)).toBe(expected);
  });
});

describe('isJsonByPathOrTitle', () => {
  it.each([
    ['data.json', true],
    ['config.jsonc', true],
    ['map.geojson', true],
    ['x.json5', true],
    ['notes.txt', false],
    [undefined, false],
  ])('isJsonByPathOrTitle(%j) === %s', (input, expected) => {
    expect(app.isJsonByPathOrTitle(input as string | undefined)).toBe(expected);
  });

  it('returns true if any of several names is JSON', () => {
    expect(app.isJsonByPathOrTitle(undefined, 'a.txt', 'b.json')).toBe(true);
  });
});

describe('tryPrettyPrintJson', () => {
  it('pretty-prints compact JSON with 2-space indentation', () => {
    expect(app.tryPrettyPrintJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('returns null for invalid JSON', () => {
    expect(app.tryPrettyPrintJson('{not valid')).toBeNull();
  });
});

describe('maybePrettyPrintJson', () => {
  it('expands a compacted single-line .json file', () => {
    const out = app.maybePrettyPrintJson('data.json', '{"a":1,"b":2}');
    expect(out).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it('detects JSON by content even without a .json name', () => {
    const out = app.maybePrettyPrintJson(undefined, '{"a":1}');
    expect(out).toBe('{\n  "a": 1\n}');
  });

  it('leaves already-pretty JSON untouched', () => {
    const pretty = '{\n  "a": 1\n}';
    expect(app.maybePrettyPrintJson('data.json', pretty)).toBe(pretty);
  });

  it('returns the original content when JSON is invalid (never loses data)', () => {
    const broken = '{"a": 1, oops}';
    expect(app.maybePrettyPrintJson('data.json', broken)).toBe(broken);
  });

  it('leaves non-JSON content untouched', () => {
    expect(app.maybePrettyPrintJson('notes.txt', 'plain text')).toBe('plain text');
  });

  it('returns empty content unchanged', () => {
    expect(app.maybePrettyPrintJson('data.json', '')).toBe('');
  });
});

describe('sanitizeFilename', () => {
  it('replaces characters illegal in filenames with underscores', () => {
    expect(app.sanitizeFilename('my<file>:name?.txt')).toBe('my_file__name_.txt');
  });

  it('trims surrounding whitespace', () => {
    expect(app.sanitizeFilename('  report  ')).toBe('report');
  });

  it('caps the length at 200 characters', () => {
    expect(app.sanitizeFilename('a'.repeat(500))).toHaveLength(200);
  });

  it('leaves a clean name unchanged', () => {
    expect(app.sanitizeFilename('notes.txt')).toBe('notes.txt');
  });
});

describe('truncateMiddle', () => {
  it('leaves strings within the limit unchanged', () => {
    expect(app.truncateMiddle('short', 10)).toBe('short');
    expect(app.truncateMiddle('12345', 5)).toBe('12345');
  });

  it('keeps head and tail, replacing the middle with an ellipsis', () => {
    expect(app.truncateMiddle('1234567890', 5)).toBe('12…90');
  });
});

describe('escapeRegex', () => {
  it('escapes regex metacharacters', () => {
    expect(app.escapeRegex('a.b*c')).toBe('a\\.b\\*c');
    expect(app.escapeRegex('(x)')).toBe('\\(x\\)');
  });

  it('leaves plain text unchanged', () => {
    expect(app.escapeRegex('plain')).toBe('plain');
  });
});
