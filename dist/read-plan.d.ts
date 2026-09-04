import type { Filter, OrderClause } from './parser.js';
import type { RelationshipInfo } from './relationships.js';
import type { ReadJoinType, SelectFieldNode, SelectNode } from './select.js';
export interface RelatedOrderClause {
    relation: string;
    column: string;
    direction: 'asc' | 'desc';
    nullsFirst?: boolean;
}
export type ReadOrderClause = OrderClause | RelatedOrderClause;
export interface EmbedNullFilter {
    resource: string;
    negate: boolean;
}
export type ReadLogicTerm = {
    kind: 'filter';
    filter: Filter;
} | {
    kind: 'embed-null';
    resource: string;
    negate: boolean;
} | {
    kind: 'logic';
    operator: 'and' | 'or';
    negate: boolean;
    terms: ReadLogicTerm[];
};
export interface PlannedEmbed {
    relation: string;
    outputName: string;
    joinType: ReadJoinType;
    spread: boolean;
    relationship: RelationshipInfo;
    plan: ReadPlan;
}
export interface ReadPlan {
    table: string;
    fields: SelectFieldNode[];
    embeds: PlannedEmbed[];
    filters?: Filter[];
    order?: ReadOrderClause[];
    embedNullFilters?: EmbedNullFilter[];
    logic?: ReadLogicTerm[];
    limit?: number;
    offset?: number;
}
export type ReadPlanColumnResolver = (table: string) => Promise<string[]>;
export declare class RelationshipResolutionError extends Error {
    readonly code: 'PGRST200' | 'PGRST201';
    readonly sourceTable: string;
    readonly targetTable: string;
    readonly hint?: string;
    readonly candidates: RelationshipInfo[];
    constructor(code: 'PGRST200' | 'PGRST201', sourceTable: string, targetTable: string, candidates: RelationshipInfo[], hint?: string);
}
export declare function buildReadPlan(table: string, select: SelectNode[], relationships: RelationshipInfo[]): ReadPlan;
/**
 * Expand `*` only when the containing relation is spread.
 *
 * Ordinary `relation(*)` remains a row/object projection and can safely stay as `table.*`.
 * Spread needs an explicit output-column list because to-one spread flattens those columns and
 * to-many spread aggregates each column independently. Column discovery stays outside the SQL
 * compiler so the compiler remains a pure ReadPlan -> parameterized SQL step.
 */
export declare function expandSpreadStars(plan: ReadPlan, resolveColumns: ReadPlanColumnResolver, spreadContext?: boolean): Promise<ReadPlan>;
//# sourceMappingURL=read-plan.d.ts.map