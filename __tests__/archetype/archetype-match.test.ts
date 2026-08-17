import {
  countPokemonPlayed,
  matchArchetype,
} from '../../components/archetype/utils/archetype-match';
import { determineArchetype } from '../../components/archetype/utils/archetype.utils';

/**
 * Detection used to take the first hit from a hand-ordered Pokemon list, so it
 * could only ever name one Pokemon and returned nothing at all for a deck the
 * list had never heard of. These tests pin the replacement: read every Pokemon
 * the log shows, then let the published meta say which deck that is.
 */
const played = (lines: string[]) => matchArchetype(countPokemonPlayed(lines));

describe('reading Pokemon out of a log', () => {
  it('ignores trainers, energy and stadiums', () => {
    const counts = countPokemonPlayed([
      "ash played Buddy-Buddy Poffin.",
      "ash played Boss's Orders.",
      "ash attached Basic Fire Energy to Dreepy in the Active Spot.",
      "ash played Team Rocket's Factory to the Stadium spot.",
      'ash played Ultra Ball.',
      "ash played Lillie's Determination.",
    ]);
    // Only the Pokemon in that Energy line counts.
    expect(Object.keys(counts).sort()).toEqual(['dragapult']);
  });

  it('resolves a pre-evolution to the Pokemon the deck is named for', () => {
    expect(countPokemonPlayed(['ash played Weedle to the Active Spot.'])).toEqual({ beedrill: 1 });
    expect(countPokemonPlayed(['ash played Dunsparce to the Bench.'])).toEqual({ dudunsparce: 1 });
    expect(countPokemonPlayed(['ash evolved Duskull to Dusclops on the Bench.'])).toEqual({
      dusknoir: 1,
    });
  });

  it('sees through an owner prefix', () => {
    expect(countPokemonPlayed(["misty played Team Rocket's Tarountula to the Bench."])).toEqual({
      spidops: 1,
    });
  });

  it('reads a two-word Pokemon as one name', () => {
    expect(countPokemonPlayed(['ash played Raging Bolt to the Bench.'])).toEqual({
      'raging-bolt': 1,
    });
  });

  it('counts a line once however many times a Pokemon is named', () => {
    expect(
      countPokemonPlayed(["ash's Dreepy used Jet Headbutt on misty's Dreepy."])
    ).toEqual({ dragapult: 1 });
  });
});

describe('naming the deck', () => {
  it('prefers a listed pairing over either half alone', () => {
    expect(
      played([
        'ash played Dreepy to the Active Spot.',
        'ash evolved Drakloak to Dragapult ex.',
        'ash played Duskull to the Bench.',
        'ash evolved Dusclops to Dusknoir on the Bench.',
      ])
    ).toBe('dragapult,dusknoir');
  });

  it('does not let a splashable staple become the deck', () => {
    // Dudunsparce is played more than Beedrill here, which is exactly why
    // ranking on how much a Pokemon is played would name the wrong deck.
    const lines = [
      'misty played Weedle to the Active Spot.',
      'misty evolved Kakuna to Beedrill on the Bench.',
      'misty played Dunsparce to the Bench.',
      'misty evolved Dunsparce to Dudunsparce on the Bench.',
      "misty's Dudunsparce used Run Away Draw.",
      "misty's Dudunsparce used Run Away Draw.",
    ];
    expect(played(lines)).toBe('beedrill');
  });

  it('still names a staple when the meta lists it as half the deck', () => {
    expect(
      played([
        'ash played Abra to the Bench.',
        'ash evolved Kadabra to Alakazam on the Bench.',
        'ash played Dunsparce to the Bench.',
        'ash evolved Dunsparce to Dudunsparce on the Bench.',
      ])
    ).toBe('alakazam,dudunsparce');
  });

  it('combines two listed decks the meta has not paired', () => {
    // "Dragapult Toucannon" is a real deck with no Limitless row of its own.
    expect(
      played([
        'ash played Dreepy to the Active Spot.',
        'ash evolved Drakloak to Dragapult ex.',
        "ash's Dragapult ex used Phantom Dive.",
        'ash played Pikipek to the Bench.',
        'ash evolved Trumbeak to Toucannon on the Bench.',
      ])
    ).toBe('dragapult,toucannon');
  });

  it('orders the pair by how much each is played', () => {
    const dragapultFirst = played([
      'ash played Dreepy to the Active Spot.',
      "ash's Dragapult ex used Phantom Dive.",
      "ash's Dragapult ex used Phantom Dive.",
      'ash played Pikipek to the Bench.',
    ]);
    expect(dragapultFirst).toBe('dragapult,toucannon');

    const toucannonFirst = played([
      'ash played Pikipek to the Bench.',
      "ash's Toucannon used Beak Blast.",
      "ash's Toucannon used Beak Blast.",
      'ash played Dreepy to the Active Spot.',
    ]);
    expect(toucannonFirst).toBe('toucannon,dragapult');
  });

  it('names the two most played Pokemon when the meta lists nothing', () => {
    expect(
      played([
        'ash played Pichu to the Bench.',
        "ash's Pichu used Zap.",
        'ash played Sudowoodo to the Bench.',
      ])
    ).toBe('pichu,sudowoodo');
  });

  it('returns nothing when no Pokemon were seen', () => {
    expect(played(['ash played Ultra Ball.'])).toBeUndefined();
  });
});

describe('determineArchetype integration', () => {
  const lines = [
    'ash played Dreepy to the Active Spot.',
    'ash evolved Drakloak to Dragapult ex.',
    'ash played Duskull to the Bench.',
    'ash evolved Dusclops to Dusknoir on the Bench.',
  ];

  it('names both Pokemon for an English log', () => {
    expect(determineArchetype(lines, 'ash', 'en')).toBe('dragapult,dusknoir');
  });

  it('leaves a non-English log on the existing single-Pokemon reading', () => {
    // The meta table is English, so other languages must not silently return
    // nothing where they used to resolve a name.
    const german = ['ash hat Katapuldra auf der Bank zu Katapuldra entwickelt'];
    expect(determineArchetype(german, 'ash', 'de')).toBe('dragapult');
  });
});
