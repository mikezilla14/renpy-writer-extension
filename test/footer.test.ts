import { describe, expect, it } from 'vitest';
import { applyFooter, buildFooter, FOOTER_BEGIN, FOOTER_END, hasFooter } from '../src/core/footer';
import { parseRpy } from '../src/core/parser';

const SCRIPT = `define e = Character("Eileen")
default trust = 0

label start:
    e "Hello there! How are you?"
    "Narration line."
    $ trust += bonus_points(2)
    $ mood = "happy"
    if trust > 3 and route_flag:
        jump good_end
    menu:
        "Stay":
            return
        "Leave" if mood == "happy":
            return

label good_end:
    return
`;

describe('buildFooter', () => {
  const model = parseRpy('script.rpy', SCRIPT);
  const footer = buildFooter(model, [model], { date: '2026-07-06' });

  it('is wrapped in the sentinel lines', () => {
    const lines = footer.split('\n');
    expect(lines[0]).toBe(FOOTER_BEGIN);
    expect(lines[lines.length - 1]).toBe(FOOTER_END);
    expect(lines.every((l) => l.startsWith('#'))).toBe(true);
  });

  it('summarizes labels, menus, choices, and words', () => {
    expect(footer).toContain('Labels: 2 | Menus: 1 (2 choices)');
    expect(footer).toContain('Total words: 7');
  });

  it('lists words per character with display names and avg sentence length', () => {
    expect(footer).toMatch(/e \(Eileen\): 5 words \| avg sentence 2\.5/);
    expect(footer).toMatch(/narrator: 2 words/);
  });

  it('splits callables from variables', () => {
    expect(footer).toMatch(/# Classes\/functions called:\n#   Character, bonus_points/);
    // mood/trust assigned, route_flag read in a condition, mood in choice condition
    expect(footer).toMatch(/# Variables referenced:\n#   mood, route_flag, trust/);
  });

  it('honors the sections option', () => {
    const only = buildFooter(model, [model], { date: '2026-07-06', sections: ['summary'] });
    expect(only).toContain('Labels: 2');
    expect(only).not.toContain('Words per character');
    expect(only).not.toContain('Variables referenced');
  });
});

describe('applyFooter', () => {
  const model = parseRpy('script.rpy', SCRIPT);
  const footer = buildFooter(model, [model], { date: '2026-07-06' });

  it('appends after one blank line and ends with a newline', () => {
    const out = applyFooter(SCRIPT, footer);
    expect(out.endsWith(FOOTER_END + '\n')).toBe(true);
    expect(out).toContain('return\n\n' + FOOTER_BEGIN);
    expect(hasFooter(out)).toBe(true);
  });

  it('is idempotent: re-applying replaces the block instead of duplicating', () => {
    const once = applyFooter(SCRIPT, footer);
    const twice = applyFooter(once, footer);
    expect(twice).toBe(once);
    expect(twice.match(/renpy-analytics:begin/g)).toHaveLength(1);
  });

  it('replaces an outdated footer in place', () => {
    const old = applyFooter(SCRIPT, buildFooter(model, [model], { date: '2025-01-01' }));
    const updated = applyFooter(old, footer);
    expect(updated).not.toContain('2025-01-01');
    expect(updated).toContain('2026-07-06');
    expect(updated.match(/renpy-analytics:begin/g)).toHaveLength(1);
  });

  it('preserves CRLF line endings', () => {
    const crlf = SCRIPT.replace(/\n/g, '\r\n');
    const out = applyFooter(crlf, footer);
    expect(out).toContain('\r\n' + FOOTER_BEGIN.replace(/\n/g, ''));
    expect(out.split('\r\n').length).toBeGreaterThan(out.split('\n').length / 2);
    // no bare-LF footer lines
    expect(out).not.toMatch(/[^\r]\n#/);
  });

  it('does not count the footer itself when regenerating', () => {
    const withFooter = applyFooter(SCRIPT, footer);
    const remodel = parseRpy('script.rpy', withFooter);
    const refooter = buildFooter(remodel, [remodel], { date: '2026-07-06' });
    expect(refooter).toBe(footer);
  });
});
