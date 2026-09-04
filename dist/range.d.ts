/** PostgREST row-range parsing and validation helpers. */
export type RangeRequest = {
    kind: 'absent';
} | {
    kind: 'valid';
    offset: number;
    limit?: number;
} | {
    kind: 'invalid';
    details: string;
};
/** Parse Range using PostgREST's item-range semantics, including open-ended ranges. */
export declare function parseRangeRequest(header: string | null | undefined): RangeRequest;
/** Detect the negative-limit case that upstream PostgREST reports as PGRST103. */
export declare function negativeLimitDetails(searchParams: URLSearchParams): string | null;
/** Details string used when a known total cannot satisfy a non-zero offset. */
export declare function offsideOffsetDetails(offset: number, totalCount: number): string;
/** Status for a successful read once an exact/planned count proves the response is partial. */
export declare function readStatus(offset: number, rowCount: number, totalCount?: number): 200 | 206;
//# sourceMappingURL=range.d.ts.map