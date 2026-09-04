/** PostgreSQL routine metadata cache and conservative overload matching. */
import type { SQLExecutor } from './executor.js';
export interface RoutineInfo {
    oid: string;
    name: string;
    schema: string;
    returnsSet: boolean;
    returnsVoid: boolean;
    resultType: string;
    argNames: string[];
    argTypes: string[];
    requiredArgNames: string[];
    hasUnnamedArgs: boolean;
}
export declare class RoutineCache {
    private sql;
    private ttl;
    private cache;
    constructor(sql: SQLExecutor, ttl?: number);
    get(schema: string, name: string): Promise<RoutineInfo[]>;
    clear(): void;
}
export interface RoutineMatch {
    routine?: RoutineInfo;
    ambiguous: boolean;
    candidates: RoutineInfo[];
}
export declare function matchRoutineByNamedArgs(routines: RoutineInfo[], argNames: Iterable<string>): RoutineMatch;
export declare function routineSignature(routine: RoutineInfo): string;
//# sourceMappingURL=routines.d.ts.map