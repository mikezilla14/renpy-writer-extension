import { describe, expect, it } from 'vitest';
import { convertProse, extractSpeakers, slug } from '../src/core/prose';

const MAP = new Map([
  ['eve', 'e'],
  ['adam', 'a'],
  ['e', 'e'],
  ['a', 'a'],
]);

const opts = (over: Partial<Parameters<typeof convertProse>[1]> = {}) => ({
  characterMap: MAP,
  ...over,
});

describe('slug', () => {
  it('makes label-safe identifiers', () => {
    expect(slug('SCENE_INTERIOR')).toBe('scene_interior');
    expect(slug('INT. ANCIENT RUINS - NIGHT')).toBe('int_ancient_ruins_night');
    expect(slug('2nd Try')).toBe('l2nd_try');
  });
});

describe('extractSpeakers', () => {
  it('finds screenplay cues and chat names, normalizing V.O. suffixes', () => {
    const text = 'EVE (V.O.)\nHello.\n\nMargaret: Hi there.\n\nEVE\nAgain.';
    expect(extractSpeakers(text)).toEqual(['EVE', 'Margaret']);
  });
});

describe('convertProse', () => {
  it('converts screenplay cue blocks, joining wrapped lines', () => {
    const { rpy } = convertProse('EVE\nWe should not be here.\nNot tonight.', opts());
    expect(rpy).toBe('e "We should not be here. Not tonight."');
  });

  it('converts chat format and narration paragraphs', () => {
    const { rpy } = convertProse(
      'Adam: Look at this.\n\nThe wind howls through\nthe cracked masonry.',
      opts()
    );
    expect(rpy).toBe('a "Look at this."\n\n"The wind howls through the cracked masonry."');
  });

  it('emits parentheticals as comments inside cue blocks', () => {
    const { rpy } = convertProse('EVE\n(whispering)\nGet down.', opts());
    expect(rpy).toBe('# (whispering)\ne "Get down."');
  });

  it('converts fflow menus with prompt, choices, bodies, and jumps', () => {
    const src = [
      '? What do you do?',
      '',
      '+ [Force Door] Kick the door open.',
      '    ~ hp -= 5',
      '    -> #INTERIOR',
      '',
      '+ [Use Key] Unlock it carefully. -> #INTERIOR',
    ].join('\n');
    const { rpy } = convertProse(src, opts());
    expect(rpy).toBe(
      [
        'menu:',
        '    "What do you do?"',
        '    "Force Door":',
        '        "Kick the door open."',
        '        $ hp -= 5',
        '        jump interior',
        '    "Use Key":',
        '        "Unlock it carefully."',
        '        jump interior',
      ].join('\n')
    );
  });

  it('converts headings, scene headings, assets, and standalone jumps', () => {
    const src = [
      '# BAR_FIGHT',
      '! BG: mall_ruins_dark',
      '! SHOW: eve, angry, left',
      '! MUSIC: tension_theme, loop',
      '! SFX: glass_shatter',
      'The door slams shut -> #GAME_OVER',
    ].join('\n');
    const { rpy } = convertProse(src, opts());
    expect(rpy).toBe(
      [
        'label bar_fight:',
        'scene mall_ruins_dark',
        'show eve angry at left',
        'play music "tension_theme"',
        'play sound "glass_shatter"',
        '"The door slams shut"',
        'jump game_over',
      ].join('\n')
    );
  });

  it('labels scene headings with the original text as a comment', () => {
    const { rpy } = convertProse('INT. ANCIENT RUINS - NIGHT', opts());
    expect(rpy).toBe('label int_ancient_ruins_night:  # INT. ANCIENT RUINS - NIGHT');
  });

  it('slugs unknown speakers and prepends TODO defines', () => {
    const { rpy, unknown } = convertProse('MARGARET\nWho goes there?', opts());
    expect(unknown).toEqual(['MARGARET']);
    expect(rpy).toContain('#     define margaret = Character("MARGARET")');
    expect(rpy).toContain('margaret "Who goes there?"');
  });

  it('keeps designated speakers as ad-hoc strings', () => {
    const { rpy } = convertProse(
      'Stranger: Halt!',
      opts({ stringSpeakers: new Set(['stranger']) })
    );
    expect(rpy).toBe('"Stranger" "Halt!"');
  });

  it('escapes quotes in dialogue and choice text', () => {
    const { rpy } = convertProse('EVE\nShe said "run".', opts());
    expect(rpy).toBe('e "She said \\"run\\"."');
  });
});
