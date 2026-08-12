'use client';

import Image from 'next/image';
import { useGT } from 'gt-react';
import type { BoardState, PokemonInPlay } from '../utils/board-state.types';
import type { LookupCard } from '@/app/api/ptcg/cards/lookup/route';

interface BoardStateViewProps {
  board: BoardState;
  cards: Record<string, LookupCard>;
}

/**
 * Intrinsic size handed to next/image. The rendered size comes from the
 * responsive width classes below; this pair only fixes the aspect ratio and
 * asks for art sharp enough for the largest breakpoint.
 */
const INTRINSIC_WIDTH = 292;
const INTRINSIC_HEIGHT = 408;

/** A real card is 63x88mm. Matching it keeps placeholders the same shape as art. */
const CARD_SHAPE = 'aspect-[63/88] rounded-md';

/**
 * Cards grew on desktop because that is where there is room to read them; at
 * 64px the art was decorative rather than legible.
 */
const SLOT_WIDTH = {
  active: 'w-24 lg:w-32 xl:w-36',
  bench: 'w-16 lg:w-20 xl:w-24',
} as const;

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
  const width = large ? SLOT_WIDTH.active : SLOT_WIDTH.bench;

  if (pokemon.unknown) {
    return (
      <div
        data-testid="board-unknown-card"
        className={`${width} ${CARD_SHAPE} border border-dashed border-muted-foreground/40 bg-muted/40`}
        title={gt('Card not named in the log', { $id: 'battleLogs.board.unknownCard' })}
      />
    );
  }

  const maxHp = card?.hp;
  const remaining = maxHp === undefined ? undefined : Math.max(0, maxHp - pokemon.damage);
  const ratio = maxHp && remaining !== undefined ? remaining / maxHp : 1;

  return (
    <div className={`${width} flex flex-col items-center gap-1`}>
      {card?.imageUrl ? (
        <Image
          src={card.imageUrl}
          alt={pokemon.name}
          width={INTRINSIC_WIDTH}
          height={INTRINSIC_HEIGHT}
          sizes="(min-width: 1280px) 144px, (min-width: 1024px) 128px, 96px"
          className={`h-auto w-full ${CARD_SHAPE} object-cover`}
        />
      ) : (
        <div
          className={`w-full ${CARD_SHAPE} flex items-center justify-center border bg-muted p-1 text-center text-[10px] leading-tight`}
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
          <span className="text-[10px] text-muted-foreground lg:text-xs">{`${remaining}/${maxHp}`}</span>
        </>
      )}

      {pokemon.attachments.length > 0 && (
        <span className="text-[10px] text-muted-foreground lg:text-xs">
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
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold lg:text-sm">{name}</span>
      {/* Active sits apart from the bench so the split is structural, not just
          a size difference that disappears when the art is busy. */}
      <div className="flex flex-wrap items-end gap-4 lg:gap-6">
        {active ? (
          <CardSlot pokemon={active} card={cards[active.name]} large />
        ) : (
          <span className="text-xs text-muted-foreground">
            {gt('No active Pokemon', { $id: 'battleLogs.board.noActive' })}
          </span>
        )}
        {bench.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 lg:gap-3">
            {bench.map((pokemon, index) => (
              <CardSlot key={`${pokemon.name}-${index}`} pokemon={pokemon} card={cards[pokemon.name]} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function BoardStateView({ board, cards }: BoardStateViewProps) {
  const gt = useGT();

  return (
    <div className="flex flex-col gap-3 py-2 lg:gap-6 lg:py-4" data-testid="board-state">
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
