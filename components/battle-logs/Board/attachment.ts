/**
 * Classify a card attached to a Pokemon from its name alone.
 *
 * The card catalog reports `category: 'Unknown'` for every card — the upstream
 * dataset carries no supertype — so the name is the only signal available. That
 * is sound here specifically: the log line was `X attached <card> to <pokemon>`,
 * and only energy and Pokemon Tools can ever be attached, so the classification
 * is a two-way split rather than an open-ended guess.
 */

export type EnergyType =
  | 'grass'
  | 'fire'
  | 'water'
  | 'lightning'
  | 'psychic'
  | 'fighting'
  | 'darkness'
  | 'metal'
  | 'fairy'
  | 'dragon'
  | 'colorless';

export interface ClassifiedAttachment {
  /** The card name exactly as the log wrote it. Shown on hover. */
  name: string;
  kind: 'energy' | 'tool';
  /** Present only for basic energy, whose type is recoverable from the name. */
  energyType?: EnergyType;
}

const ENERGY_TYPES: EnergyType[] = [
  'grass',
  'fire',
  'water',
  'lightning',
  'psychic',
  'fighting',
  'darkness',
  'metal',
  'fairy',
  'dragon',
  'colorless',
];

const TYPE_ALTERNATION = ENERGY_TYPES.join('|');

/** "Basic Fire Energy", and the shorter "Fire Energy" some clients emit. */
const BASIC_ENERGY = new RegExp(`^(?:basic\\s+)?(${TYPE_ALTERNATION})\\s+energy$`, 'i');

/** Anything else ending in "Energy" is a special energy, e.g. "Team Rocket's Energy". */
const ANY_ENERGY = /\benergy$/i;

export function classifyAttachment(name: string): ClassifiedAttachment {
  const trimmed = name.trim();

  const basic = trimmed.match(BASIC_ENERGY);
  if (basic) {
    return { name: trimmed, kind: 'energy', energyType: basic[1].toLowerCase() as EnergyType };
  }

  if (ANY_ENERGY.test(trimmed)) {
    // Special energy: still energy, but it has no single type to show.
    return { name: trimmed, kind: 'energy' };
  }

  return { name: trimmed, kind: 'tool' };
}

/**
 * Standard Pokemon TCG energy shorthand — the same letters players already read
 * on a decklist, so the chips need no legend. Fire is R, Fairy is Y, Dragon is N.
 */
export const ENERGY_ABBREVIATION: Record<EnergyType, string> = {
  grass: 'G',
  fire: 'R',
  water: 'W',
  lightning: 'L',
  psychic: 'P',
  fighting: 'F',
  darkness: 'D',
  metal: 'M',
  fairy: 'Y',
  dragon: 'N',
  colorless: 'C',
};

/**
 * Foreground is chosen per type rather than globally white: Lightning, Metal,
 * Dragon and Colorless are light enough that white text falls under the
 * contrast floor.
 */
export const ENERGY_STYLE: Record<EnergyType, string> = {
  grass: 'bg-green-600 text-white',
  fire: 'bg-red-600 text-white',
  water: 'bg-sky-500 text-white',
  lightning: 'bg-yellow-400 text-yellow-950',
  psychic: 'bg-purple-600 text-white',
  fighting: 'bg-orange-700 text-white',
  darkness: 'bg-slate-800 text-white',
  metal: 'bg-slate-400 text-slate-950',
  fairy: 'bg-pink-500 text-white',
  dragon: 'bg-amber-500 text-amber-950',
  colorless: 'bg-neutral-200 text-neutral-900',
};

/** Special energy has no type colour; it keeps the energy circle shape. */
export const SPECIAL_ENERGY_STYLE = 'bg-indigo-500 text-white';
export const SPECIAL_ENERGY_ABBREVIATION = 'S';
