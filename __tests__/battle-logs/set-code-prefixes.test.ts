import {
  parseBattleLog,
  stripCardSetCodes,
} from '../../components/battle-logs/utils/battle-log.utils';
import { deriveBoardStates } from '../../components/battle-logs/utils/board-state';

/**
 * Newer PTCG Live exports stamp each card with its set and collector number:
 * "(me2-5_247) Dreepy". The catalog is keyed on the bare name, so leaving the
 * stamp on means every card image lookup misses and the board renders the code
 * as if it were part of the name.
 *
 * Set codes are lowercase; parenthesised text inside a real card name is not.
 */
describe('stripCardSetCodes', () => {
  it('removes the stamp and keeps the name', () => {
    expect(stripCardSetCodes('(me2-5_247) Dreepy')).toBe('Dreepy');
    expect(stripCardSetCodes('(mee_7) Basic Darkness Energy')).toBe('Basic Darkness Energy');
    expect(stripCardSetCodes('(sv8-5_37_mph) Dusknoir')).toBe('Dusknoir');
    expect(stripCardSetCodes('(me4_1_ph) Weedle')).toBe('Weedle');
  });

  it('removes every stamp on an itemised line', () => {
    expect(
      stripCardSetCodes("   • (me2-5_256) Boss's Orders, (me1_169) Lillie's Determination")
    ).toBe("   • Boss's Orders, Lillie's Determination");
  });

  it('keeps the rest of the sentence intact', () => {
    expect(stripCardSetCodes('pandapanada played (me2-5_247) Dreepy to the Active Spot.')).toBe(
      'pandapanada played Dreepy to the Active Spot.'
    );
  });

  it('leaves parenthesised text that belongs to a card name', () => {
    // Every one of these appears in a shipped fixture.
    for (const line of [
      'Colress (G-Cis) was played.',
      'ash attached a (Pokémon Tool) to Pikipek.',
      'Profesor (Prof. Antiqua) drew a card.',
      'misty played (Profesor Oak).',
    ]) {
      expect(stripCardSetCodes(line)).toBe(line);
    }
  });

  it('leaves a lone lowercase word that is not a set code', () => {
    // A stamp is always followed by the name it stamps.
    expect(stripCardSetCodes('ash used Attack (yes).')).toBe('ash used Attack (yes).');
  });
});

describe('a stamped log derives clean card names', () => {
  const stamped = [
    'Setup',
    'Lonker2012 chose tails for the opening coin flip.',
    'pandapanada won the coin toss.',
    'pandapanada decided to go first.',
    'Lonker2012 drew 7 cards for the opening hand.',
    '- 7 drawn cards.',
    'pandapanada drew 7 cards for the opening hand.',
    '- 7 drawn cards.',
    "   • (me2-5_256) Boss's Orders, (me1_169) Lillie's Determination, (mee_7) Basic Darkness Energy, (me2-5_248) Drakloak, (sv5_144) Buddy-Buddy Poffin, (me2-5_247) Dreepy, (me1_173) Night Stretcher",
    'Lonker2012 played (me4_1_ph) Weedle to the Active Spot.',
    'pandapanada played (me2-5_247) Dreepy to the Active Spot.',
    '',
    "pandapanada's Turn",
    'pandapanada drew (me2-5_264) Ultra Ball.',
    'pandapanada played (me2-5_248) Drakloak to the Bench.',
    'pandapanada ended their turn.',
    'Opponent conceded. pandapanada wins.',
  ].join('\n');

  it('names the active, bench and hand without the stamp', () => {
    const parsed = parseBattleLog(stamped, 'l', '2026-01-01', null, null, 'pandapanada', 'TEF-PBL');
    const boards = deriveBoardStates(parsed);
    // Setup places the two Active Pokemon; the bench play and draw land on the
    // turn after it, so assert against the final board.
    const board = boards[boards.length - 1];

    expect(board['pandapanada'].active?.name).toBe('Dreepy');
    expect(board['Lonker2012'].active?.name).toBe('Weedle');
    expect(board['pandapanada'].bench.map((p) => p.name)).toEqual(['Drakloak']);
    expect(board['pandapanada'].hand.known).toEqual(
      expect.arrayContaining(["Boss's Orders", 'Ultra Ball'])
    );
    expect(JSON.stringify(board)).not.toMatch(/me2-5|me4_1|_ph/);
  });
});
