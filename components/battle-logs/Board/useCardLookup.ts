'use client';

import useSWR from 'swr';
import type { LookupCard } from '@/app/api/ptcg/cards/lookup/route';

const EMPTY: Record<string, LookupCard> = {};

/**
 * Resolve every distinct card name in a log to an image and max HP in one
 * request. Keyed on the sorted name list so the same log reuses the cache.
 */
export function useCardLookup(names: string[]): Record<string, LookupCard> {
  const distinct = Array.from(new Set(names.filter(Boolean))).sort();
  const key = distinct.length ? ['card-lookup', distinct.join('|')] : null;

  const { data } = useSWR(key, async () => {
    const response = await fetch('/api/ptcg/cards/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: distinct }),
    });
    if (!response.ok) return EMPTY;
    const body = (await response.json()) as { cards?: Record<string, LookupCard> };
    return body.cards ?? EMPTY;
  });

  return data ?? EMPTY;
}
