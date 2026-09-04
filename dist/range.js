/** PostgREST row-range parsing and validation helpers. */
const DECIMAL_RADIX = 10;
const RANGE_PATTERN = /^(?:items=)?(\d+)-(\d*)$/;
/** Parse Range using PostgREST's item-range semantics, including open-ended ranges. */
export function parseRangeRequest(header) {
    if (!header)
        return { kind: 'absent' };
    const match = header.trim().match(RANGE_PATTERN);
    if (!match) {
        return {
            kind: 'invalid',
            details: 'The lower boundary must be lower than or equal to the upper boundary in the Range header.',
        };
    }
    const start = parseInt(match[1], DECIMAL_RADIX);
    const endText = match[2] ?? '';
    if (endText === '') {
        return { kind: 'valid', offset: start };
    }
    const end = parseInt(endText, DECIMAL_RADIX);
    if (end < start) {
        return {
            kind: 'invalid',
            details: 'The lower boundary must be lower than or equal to the upper boundary in the Range header.',
        };
    }
    return { kind: 'valid', offset: start, limit: end - start + 1 };
}
/** Detect the negative-limit case that upstream PostgREST reports as PGRST103. */
export function negativeLimitDetails(searchParams) {
    const raw = searchParams.get('limit');
    if (raw === null)
        return null;
    if (/^-\d+$/.test(raw))
        return 'Limit should be greater than or equal to zero.';
    return null;
}
/** Details string used when a known total cannot satisfy a non-zero offset. */
export function offsideOffsetDetails(offset, totalCount) {
    return `An offset of ${offset} was requested, but there are only ${totalCount} rows.`;
}
/** Status for a successful read once an exact/planned count proves the response is partial. */
export function readStatus(offset, rowCount, totalCount) {
    if (totalCount === undefined || rowCount === 0)
        return 200;
    return offset + rowCount < totalCount ? 206 : 200;
}
//# sourceMappingURL=range.js.map