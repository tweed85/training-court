/**
 * A hidden-information card zone: a hand or a discard pile.
 *
 * `size` is authoritative and comes from the log's explicit counts. `known` is
 * best-effort and comes from lines that name a card. The difference is how many
 * cards we know are there but cannot name.
 *
 * Splitting the two is the safety mechanism for the whole feature. Unlike the
 * board, the log never asserts "the hand is now these cards", so identity
 * tracking cannot resync once it drifts. Keeping the count separate means drift
 * shows up as an extra face-down card rather than a confidently wrong one.
 */
export interface Zone {
  known: string[];
  size: number;
}

export const emptyZone = (): Zone => ({ known: [], size: 0 });

export const cloneZone = (zone: Zone): Zone => ({
  known: [...zone.known],
  size: zone.size,
});

export const unknownCount = (zone: Zone): number => Math.max(0, zone.size - zone.known.length);

/** `known` may never claim more cards than the zone actually holds. */
const clamp = (zone: Zone): void => {
  if (zone.size < 0) zone.size = 0;
  while (zone.known.length > zone.size) zone.known.shift();
};

export function addKnown(zone: Zone, name: string): void {
  zone.known.push(name);
  zone.size += 1;
  clamp(zone);
}

export function addUnknown(zone: Zone, count: number): void {
  zone.size += count;
  clamp(zone);
}

/**
 * Remove a specific card. If it was never known — the log named a card we had
 * not seen enter the zone — the count still drops, because the count is the
 * part we trust.
 */
export function removeKnown(zone: Zone, name: string): void {
  const index = zone.known.indexOf(name);
  if (index !== -1) zone.known.splice(index, 1);
  zone.size -= 1;
  clamp(zone);
}

export function removeUnknown(zone: Zone, count: number): void {
  zone.size -= count;
  clamp(zone);
}

export function clearZone(zone: Zone): void {
  zone.known = [];
  zone.size = 0;
}
