'use client';

import Image from 'next/image';
import { useGT } from 'gt-react';
import type { BoardState, PokemonInPlay } from '../utils/board-state.types';
import type { LookupCard } from '@/app/api/ptcg/cards/lookup/route';

interface BoardStateViewProps {
  board: BoardState;
  cards: Record<string, LookupCard>;
}

const CARD_WIDTH = 64;
const CARD_HEIGHT = 89;

function CardSlot({
  pokemon,
  card,
  large,
}: {
  pokemon: PokemonInPlay;
  card?: LookupCard;
  large?: boolean;
}) {
  const gt = useGT();
  const width = large ? CARD_WIDTH * 1.4 : CARD_WIDTH;
  const height = large ? CARD_HEIGHT * 1.4 : CARD_HEIGHT;

  if (pokemon.unknown) {
    return (
      <div
        data-testid="board-unknown-card"
        className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40"
        style={{ width, height }}
        title={gt('Card not named in the log', { $id: 'battleLogs.board.unknownCard' })}
      />
    );
  }

  const maxHp = card?.hp;
  const remaining = maxHp === undefined ? undefined : Math.max(0, maxHp - pokemon.damage);
  const ratio = maxHp && remaining !== undefined ? remaining / maxHp : 1;

  return (
    <div className="flex flex-col items-center gap-1" style={{ width }}>
      {card?.imageUrl ? (
        <Image src={card.imageUrl} alt={pokemon.name} width={width} height={height} className="rounded-md" />
      ) : (
        <div
          className="flex items-center justify-center rounded-md border bg-muted p-1 text-center text-[10px] leading-tight"
          style={{ width, height }}
        >
          {pokemon.name}
        </div>
      )}

      {remaining !== undefined && maxHp !== undefined && (
        <>
          <div className="h-1 w-full overflow-hidden rounded bg-muted">
            <div
              className={ratio > 0.5 ? 'h-full bg-emerald-500' : ratio > 0.2 ? 'h-full bg-amber-500' : 'h-full bg-red-500'}
              style={{ width: `${ratio * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">{`${remaining}/${maxHp}`}</span>
        </>
      )}

      {pokemon.attachments.length > 0 && (
        <span className="text-[10px] text-muted-foreground">
          {gt('Attached', { $id: 'battleLogs.board.attached' })}: {pokemon.attachments.length}
        </span>
      )}
    </div>
  );
}

/** One player's active Pokemon plus their bench. */
function PlayerRow({
  name,
  active,
  bench,
  cards,
}: {
  name: string;
  active: PokemonInPlay | null;
  bench: PokemonInPlay[];
  cards: Record<string, LookupCard>;
}) {
  const gt = useGT();

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold">{name}</span>
      <div className="flex flex-wrap items-end gap-2">
        {active ? (
          <CardSlot pokemon={active} card={cards[active.name]} large />
        ) : (
          <span className="text-[10px] text-muted-foreground">
            {gt('No active Pokemon', { $id: 'battleLogs.board.noActive' })}
          </span>
        )}
        {bench.map((pokemon, index) => (
          <CardSlot key={`${pokemon.name}-${index}`} pokemon={pokemon} card={cards[pokemon.name]} />
        ))}
      </div>
    </div>
  );
}

export function BoardStateView({ board, cards }: BoardStateViewProps) {
  const gt = useGT();

  return (
    <div className="flex flex-col gap-3 py-2" data-testid="board-state">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {gt('Board', { $id: 'battleLogs.board.title' })}
      </span>
      {Object.entries(board).map(([playerName, playerBoard]) => (
        <PlayerRow
          key={playerName}
          name={playerName}
          active={playerBoard.active}
          bench={playerBoard.bench}
          cards={cards}
        />
      ))}
    </div>
  );
}
