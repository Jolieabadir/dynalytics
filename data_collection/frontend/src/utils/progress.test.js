/** The three counts in the "Path to Done" strip. */
import { describe, it, expect } from 'vitest';
import { progressCounts } from './progress';

const labeled = (id, extra = {}) => ({
  id,
  approach: 'static',
  size: 'medium',
  ...extra,
});

describe('progressCounts', () => {
  it('is all zeros with no moves', () => {
    expect(progressCounts([], [], null)).toEqual({ defined: 0, labeled: 0, tagged: 0 });
  });

  it('counts defined moves', () => {
    const moves = [labeled(1), labeled(2), labeled(3)];
    expect(progressCounts(moves).defined).toBe(3);
  });

  it('counts a move as defined but not labeled when its lenses are missing', () => {
    // A move whose environment/outcome POST failed after the move was created.
    const moves = [labeled(1), { id: 2 }];
    const out = progressCounts(moves);
    expect(out.defined).toBe(2);
    expect(out.labeled).toBe(1);
  });

  it('uses the server tag_count when it is present', () => {
    const moves = [labeled(1, { tag_count: 2 }), labeled(2, { tag_count: 0 })];
    expect(progressCounts(moves).tagged).toBe(1);
  });

  it('counts the open move from the tags in the store', () => {
    const moves = [labeled(1), labeled(2)];
    const frameTags = [{ id: 10, frame_number: 5 }];
    expect(progressCounts(moves, frameTags, { id: 2 }).tagged).toBe(1);
  });

  it('does not count the open move when it has no tags yet', () => {
    const moves = [labeled(1), labeled(2)];
    expect(progressCounts(moves, [], { id: 2 }).tagged).toBe(0);
  });

  it('prefers tag_count over the open-move fallback', () => {
    const moves = [labeled(1, { tag_count: 0 })];
    expect(progressCounts(moves, [{ id: 9 }], { id: 1 }).tagged).toBe(0);
  });

  it('survives nulls in the list', () => {
    expect(progressCounts([labeled(1), null, undefined]).defined).toBe(1);
  });

  it('defaults every argument', () => {
    expect(progressCounts()).toEqual({ defined: 0, labeled: 0, tagged: 0 });
  });
});
