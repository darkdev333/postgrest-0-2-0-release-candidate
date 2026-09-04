import { describe, expect, it } from 'vitest';
import { negativeLimitDetails, offsideOffsetDetails, parseRangeRequest, readStatus } from '../range.js';

describe('PostgREST range compatibility', () => {
  it('parses bounded and open-ended item ranges', () => {
    expect(parseRangeRequest('0-24')).toEqual({ kind: 'valid', offset: 0, limit: 25 });
    expect(parseRangeRequest('items=25-49')).toEqual({ kind: 'valid', offset: 25, limit: 25 });
    expect(parseRangeRequest('0-')).toEqual({ kind: 'valid', offset: 0 });
  });

  it('rejects descending ranges with the upstream PGRST103 detail', () => {
    expect(parseRangeRequest('1-0')).toEqual({
      kind: 'invalid',
      details: 'The lower boundary must be lower than or equal to the upper boundary in the Range header.',
    });
  });

  it('detects negative limits', () => {
    expect(negativeLimitDetails(new URLSearchParams('limit=-1'))).toBe('Limit should be greater than or equal to zero.');
    expect(negativeLimitDetails(new URLSearchParams('limit=0'))).toBeNull();
  });

  it('formats known-total offside details', () => {
    expect(offsideOffsetDetails(100, 15)).toBe('An offset of 100 was requested, but there are only 15 rows.');
  });

  it('returns 206 only when a known total proves a non-empty response is partial', () => {
    expect(readStatus(0, 25, 100)).toBe(206);
    expect(readStatus(75, 25, 100)).toBe(200);
    expect(readStatus(0, 25)).toBe(200);
  });
});
