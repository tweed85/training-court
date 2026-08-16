import {
  ENERGY_ABBREVIATION,
  ENERGY_STYLE,
  classifyAttachment,
} from '../../components/battle-logs/Board/attachment';

describe('classifyAttachment', () => {
  // Every one of these appears verbatim in a real captured battle log.
  it('reads the type off a basic energy', () => {
    expect(classifyAttachment('Basic Fire Energy')).toEqual({
      name: 'Basic Fire Energy',
      kind: 'energy',
      energyType: 'fire',
    });
    expect(classifyAttachment('Basic Grass Energy').energyType).toBe('grass');
    expect(classifyAttachment('Basic Psychic Energy').energyType).toBe('psychic');
  });

  it('treats a non-basic energy as energy with no type', () => {
    expect(classifyAttachment("Team Rocket's Energy")).toEqual({
      name: "Team Rocket's Energy",
      kind: 'energy',
    });
  });

  it('classifies tools', () => {
    expect(classifyAttachment('Brave Bangle').kind).toBe('tool');
    expect(classifyAttachment('Sparkling Crystal').kind).toBe('tool');
  });

  it('accepts the shorter energy naming some clients emit', () => {
    expect(classifyAttachment('Water Energy').energyType).toBe('water');
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(classifyAttachment('  basic LIGHTNING energy ')).toEqual({
      name: 'basic LIGHTNING energy',
      kind: 'energy',
      energyType: 'lightning',
    });
  });

  // "Energy Switch" is a Trainer and can never be attached, but the suffix rule
  // must not fire on a name that merely starts with the word.
  it('does not treat a leading "Energy" as an energy card', () => {
    expect(classifyAttachment('Energy Switch').kind).toBe('tool');
  });

  it('covers every energy type with an abbreviation and a style', () => {
    const types = Object.keys(ENERGY_ABBREVIATION) as (keyof typeof ENERGY_ABBREVIATION)[];
    expect(types).toHaveLength(11);
    for (const type of types) {
      expect(ENERGY_ABBREVIATION[type]).toHaveLength(1);
      expect(ENERGY_STYLE[type]).toContain('bg-');
      expect(ENERGY_STYLE[type]).toContain('text-');
      expect(classifyAttachment(`Basic ${type} Energy`).energyType).toBe(type);
    }
  });
});
