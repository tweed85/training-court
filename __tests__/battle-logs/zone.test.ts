import {
  addKnown,
  addUnknown,
  clearZone,
  cloneZone,
  emptyZone,
  forgetKnown,
  removeKnown,
  removeUnknown,
  unknownCount,
} from '../../components/battle-logs/utils/zone';

describe('zone arithmetic', () => {
  it('starts empty', () => {
    expect(emptyZone()).toEqual({ known: [], size: 0 });
  });

  it('adding a known card grows both known and size', () => {
    const z = emptyZone();
    addKnown(z, 'Iono');
    expect(z).toEqual({ known: ['Iono'], size: 1 });
    expect(unknownCount(z)).toBe(0);
  });

  it('adding unknown cards grows only size', () => {
    const z = emptyZone();
    addUnknown(z, 3);
    expect(z.known).toEqual([]);
    expect(z.size).toBe(3);
    expect(unknownCount(z)).toBe(3);
  });

  it('mixes known and unknown', () => {
    const z = emptyZone();
    addKnown(z, 'Iono');
    addUnknown(z, 2);
    expect(unknownCount(z)).toBe(2);
    expect(z.size).toBe(3);
  });

  it('removing a known card removes one copy and shrinks size', () => {
    const z = emptyZone();
    addKnown(z, 'Iono');
    addKnown(z, 'Iono');
    removeKnown(z, 'Iono');
    expect(z).toEqual({ known: ['Iono'], size: 1 });
  });

  it('removing a card that was never known still shrinks size', () => {
    const z = emptyZone();
    addUnknown(z, 2);
    removeKnown(z, "Boss's Orders");
    expect(z).toEqual({ known: [], size: 1 });
  });

  it('forgetting a card drops the name and leaves the count alone', () => {
    const z = emptyZone();
    addKnown(z, 'Iono');
    addKnown(z, 'Artazon');
    forgetKnown(z, 'Artazon');
    expect(z).toEqual({ known: ['Iono'], size: 2 });
    expect(unknownCount(z)).toBe(1);
  });

  it('forgetting drops only the first copy', () => {
    const z = emptyZone();
    addKnown(z, 'Artazon');
    addKnown(z, 'Artazon');
    forgetKnown(z, 'Artazon');
    expect(z).toEqual({ known: ['Artazon'], size: 2 });
  });

  it('forgetting a card that was never known changes nothing', () => {
    const z = emptyZone();
    addKnown(z, 'Iono');
    addUnknown(z, 2);
    forgetKnown(z, 'Artazon');
    expect(z).toEqual({ known: ['Iono'], size: 3 });
  });

  it('never lets size go negative', () => {
    const z = emptyZone();
    removeUnknown(z, 5);
    expect(z.size).toBe(0);
    removeKnown(z, 'Iono');
    expect(z.size).toBe(0);
  });

  // Prefer turning a known card into an unknown over deleting a wrong identity.
  it('clamps known down to size when unknown cards are removed', () => {
    const z = emptyZone();
    addKnown(z, 'Iono');
    addKnown(z, 'Arven');
    addKnown(z, 'Penny');
    removeUnknown(z, 2);
    expect(z.size).toBe(1);
    expect(z.known).toEqual(['Penny']);
  });

  it('clearing empties the zone entirely', () => {
    const z = emptyZone();
    addKnown(z, 'Iono');
    addUnknown(z, 4);
    clearZone(z);
    expect(z).toEqual({ known: [], size: 0 });
  });

  it('cloning is deep, so later mutation cannot leak backwards', () => {
    const z = emptyZone();
    addKnown(z, 'Iono');
    const snapshot = cloneZone(z);
    addKnown(z, 'Arven');
    expect(snapshot).toEqual({ known: ['Iono'], size: 1 });
  });

  it('ignores a negative unknown count rather than going negative', () => {
    const z = emptyZone();
    addUnknown(z, 3);
    addUnknown(z, -10);
    expect(z.size).toBe(0);
    expect(z.known).toEqual([]);
  });

  it('keeps known within size when a negative count shrinks the zone', () => {
    const z = emptyZone();
    addKnown(z, 'Iono');
    addKnown(z, 'Arven');
    addUnknown(z, -1);
    expect(z.size).toBe(1);
    expect(z.known).toEqual(['Arven']);
  });
});
