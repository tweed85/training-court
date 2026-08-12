import { getAllDeckbuilderCards } from '@/lib/server/ptcg-card-catalog';
import { buildCardIndex } from '@/lib/server/ai/battle-log-analysis/card-index';
import { normalizeCardName } from '@/lib/server/ptcg-card-name';

/** One board render needs far fewer than this; the cap just bounds abuse. */
const MAX_NAMES = 500;

export const dynamic = 'force-dynamic';

export interface LookupCard {
  name: string;
  imageUrl?: string;
  hp?: number;
}

/**
 * Resolve a batch of card names to an image and max HP.
 *
 * The catalog is server-only but the battle log carousel is a client
 * component, so it posts every distinct name in one request rather than
 * issuing one lookup per card.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { names?: unknown };
    const names = body?.names;

    if (!Array.isArray(names) || names.length === 0 || names.length > MAX_NAMES) {
      return Response.json({ message: 'Provide 1..500 card names.', code: 400 }, { status: 400 });
    }

    const index = buildCardIndex(await getAllDeckbuilderCards());
    const cards: Record<string, LookupCard> = {};

    for (const raw of names) {
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const match = index.get(normalizeCardName(raw));
      if (!match) continue;

      const hp = Number(match.metadata.hp);
      cards[raw] = {
        name: match.name,
        imageUrl: match.imageUrlHiRes ?? match.imageUrl,
        ...(Number.isFinite(hp) && hp > 0 ? { hp } : {}),
      };
    }

    return Response.json({ cards, code: 200 }, { status: 200 });
  } catch (error) {
    console.error('Failed to look up cards:', error);
    return Response.json({ message: 'Failed to look up cards', code: 500 }, { status: 500 });
  }
}
