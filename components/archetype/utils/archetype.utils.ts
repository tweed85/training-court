import { getIfLineCouldContainArchetype, Language } from "@/lib/i18n/battle-log";
import { getEnglishPokemon, getPokemonToFind } from "@/lib/i18n/pokemon";
import { countPokemonPlayed, matchArchetype } from "./archetype-match";

const pngMap = {
  'bloodmoon ursaluna': 'ursaluna-bloodmoon',
  'origin forme dialga': 'dialga-origin',
  'origin forme palkia': 'palkia-origin',
  'hisuian zoroark': 'zoroark-hisui'
};

// Pokemon that might not indicate exactly the archetype we can use to infer the archetype
const associatedPokemon = [{
  association: 'charmander',
  deck: 'charizard'
}, {
  association: 'dreepy',
  deck: 'dragapult'
}, {
  association: 'frigibax',
  deck: 'chien-pao'
}, {
  association: 'ralts',
  deck: 'gardevoir'
}, {
  association: 'shuppet',
  deck: 'banette'
}, {
  association: 'applin',
  deck: 'dipplin'
}, {
  association: 'joltik',
  deck: 'joltik'
}, {
  association: 'venonat',
  deck: 'venomoth'
},{
  association: 'impidimp',
  deck: 'grimmsnarl,froslass'
},{
  association: 'raging-bolt',
  deck: 'raging-bolt,ogerpon'
},{
  association: 'tarountula',
  deck: 'spidops,mewtwo'
},{
  association: 'cyndaquil',
  deck: 'typhlosion'
},{
  association: 'flareon',
  deck: 'flareon'
},{
  association: 'gimmeghoul',
  deck: 'gholdengo'
},{
  association: 'toedscool',
  deck: 'toedscruel'
},{
  association: 'zorua',
  deck: 'zoroark'
},{
  association: 'ceruledge',
  deck: 'ceruledge'
},{
  association: 'chansey',
  deck: 'blissey'
},{
  association: 'girafarig',
  deck: 'milotic,girafarig'
},{
  association: 'jellicent',
  deck: 'gardevoir,jellicent'
}]

// TODO: Fix false positive case - I think it's when you knock out opp Pokemon or something...
const isCardsMilled = (log: string[], currentIdx: number, playerName: string) => {
  if (currentIdx < 1) return false;

  return log[currentIdx - 1].includes(`${playerName} moved ${playerName}'s`) && log[currentIdx - 1].includes('cards to the discard pile') && log[currentIdx].includes('•');
}

export const determineArchetype = (log: string[], playerName: string, language: Language): string | undefined => {
  const drawnCardsLines = log.filter((line, idx) => {
    return getIfLineCouldContainArchetype(line, playerName, language);
  });

  // The meta table and the Pokemon vocabulary behind it are English, like the
  // card catalog. Other languages keep the single-Pokemon reading below, which
  // translates through PokemonStrings.
  if (language === 'en') {
    const matched = matchArchetype(countPokemonPlayed(drawnCardsLines));
    if (matched) return matched;
  }

  const pokemonToFind = getPokemonToFind(language);
  let archetype = pokemonToFind.find((targetMon) => drawnCardsLines.some((drawnCards) => drawnCards.toLowerCase().includes(targetMon.toLowerCase())));

  const associatedArchetype = associatedPokemon.find((targetMon) => drawnCardsLines.some((drawnCards) => drawnCards.toLowerCase().includes(targetMon.association.toLowerCase())))?.deck;
  if (associatedArchetype) archetype = associatedArchetype;

  const foundMapTypeIdx = archetype ? Object.keys(pngMap).findIndex(key => (key === archetype?.toLowerCase())) : -1;
  if ((foundMapTypeIdx !== undefined) && (foundMapTypeIdx >= 0)) {
    return Object.entries(pngMap)[foundMapTypeIdx][1]
  };

  return getEnglishPokemon(archetype, language);
}