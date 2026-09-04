/** PostgREST-compatible error normalization for PostgreSQL/adapter failures. */
import type { RelationshipInfo } from './relationships.js';
export interface PostgRESTErrorBody {
    code: string;
    message: string;
    details: unknown | null;
    hint: unknown | null;
}
export interface NormalizedPostgRESTError {
    status: number;
    body: PostgRESTErrorBody;
}
export declare function postgresStatus(code: string): number;
export declare function normalizePostgRESTError(error: unknown): NormalizedPostgRESTError;
export declare function singularCardinalityError(rowCount: number): PostgRESTErrorBody;
export declare function requestedRangeNotSatisfiable(details: string): PostgRESTErrorBody;
export declare function invalidPreferences(tokens: string[]): PostgRESTErrorBody;
export declare function maxAffectedViolation(rowCount: number): PostgRESTErrorBody;
export declare function maxAffectedRpcUnsupported(): PostgRESTErrorBody;
export declare function noRpc(schema: string, name: string, argKeys: string[]): PostgRESTErrorBody;
export declare function ambiguousRpc(signatures: string[]): PostgRESTErrorBody;
export declare function notEmbedded(resource: string, hint?: string, details?: unknown): PostgRESTErrorBody;
export declare function relatedOrderNotToOne(parent: string, resource: string): PostgRESTErrorBody;
export declare function noRelationship(schema: string, parent: string, child: string, hint?: unknown): PostgRESTErrorBody;
export declare function ambiguousRelationship(parent: string, child: string, candidates: RelationshipInfo[]): PostgRESTErrorBody;
//# sourceMappingURL=errors.d.ts.map