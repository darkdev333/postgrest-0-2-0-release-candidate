/** Single-execution RPC result shaping for PostgREST-compatible functions. */
import type { ParsedQuery } from './parser.js';
import type { RoutineInfo } from './routines.js';
export interface RpcQueryOptions {
    schema?: string;
    maxLimit?: number;
    defaultLimit?: number;
}
export interface BuiltRpcEnvelope {
    sql: string;
    params: unknown[];
}
export interface RpcEnvelope {
    rows: Record<string, unknown>[];
    count: number;
    affected: number;
}
export interface GetRpcPartition {
    args: Record<string, string>;
    resultParams: URLSearchParams;
    candidateArgNames: string[];
}
export declare function partitionGetRpcParams(params: URLSearchParams, routine?: RoutineInfo): GetRpcPartition;
export declare function buildRpcEnvelopeQuery(functionName: string, args: Record<string, unknown>, query: ParsedQuery, options?: RpcQueryOptions): BuiltRpcEnvelope;
export declare function decodeRpcEnvelope(row: Record<string, unknown> | undefined): RpcEnvelope;
//# sourceMappingURL=rpc.d.ts.map