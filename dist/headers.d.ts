export interface PreferHeader {
    return?: 'representation' | 'minimal' | 'headers-only';
    count?: 'exact' | 'planned' | 'estimated' | 'none';
    resolution?: 'merge-duplicates' | 'ignore-duplicates';
    missing?: 'default' | 'null';
    tx?: 'commit' | 'rollback';
    handling?: 'strict' | 'lenient';
    maxAffected?: number;
    invalid?: string[];
}
export interface ResponseHeaderOptions {
    totalCount?: number;
    offset?: number;
    limit?: number;
    rowCount?: number;
    contentType?: string;
    headersOnly?: boolean;
}
export interface ResponseExecutionMetadata {
    insertedCount?: number;
}
export interface CORSOptions {
    origin?: string;
    allowedOrigins?: string[];
    originPattern?: RegExp;
    requestOrigin?: string;
    credentials?: boolean;
    methods?: string[];
    allowHeaders?: string[];
    exposeHeaders?: string[];
    maxAge?: number;
}
export declare function parsePreferHeader(header: string | null | undefined): PreferHeader;
export type PreferenceOperation = 'read' | 'insert' | 'update' | 'delete' | 'rpc';
export declare function appliedPreferences(prefer: PreferHeader, operation: PreferenceOperation, options?: {
    hasConflictTarget?: boolean;
}): PreferHeader;
/** Alias used by the router; mirrors upstream Response.responsePreferences terminology. */
export declare const responsePreferences: typeof appliedPreferences;
export declare function buildContentRange({ offset, rowCount, totalCount }: ResponseHeaderOptions): string;
export declare function setResponseHeaders(headers: Headers, options: ResponseHeaderOptions, prefer?: PreferHeader): void;
export declare function parseRangeHeader(header: string | null | undefined): {
    offset: number;
    limit: number;
} | null;
export declare function buildLocationHeader(basePath: string, table: string, pk: Record<string, unknown>): string;
export declare function buildHeadersOnlyResponse(headers: Headers, options: ResponseHeaderOptions & {
    location?: string;
    affectedCount?: number;
}): void;
export declare function getResponseStatus(method: string, _rowCount: number, prefer?: PreferHeader, execution?: ResponseExecutionMetadata): number;
export declare function setCORSHeaders(headers: Headers, options?: CORSOptions): void;
//# sourceMappingURL=headers.d.ts.map