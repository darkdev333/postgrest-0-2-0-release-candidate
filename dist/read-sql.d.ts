import type { ReadPlan } from './read-plan.js';
export interface BuiltReadSQL {
    sql: string;
    params: unknown[];
}
export declare function buildReadSQL(plan: ReadPlan, schema?: string): BuiltReadSQL;
export declare function buildReadCountSQL(plan: ReadPlan, schema?: string): BuiltReadSQL;
//# sourceMappingURL=read-sql.d.ts.map