import type { ForeignKeyInfo, TableSchema } from './schema.js';
export type RelationshipCardinality = 'many-to-one' | 'one-to-many' | 'one-to-one' | 'many-to-many';
export interface RelationshipColumnPair {
    source: string;
    target: string;
}
export interface ManyToManyJunction {
    table: string;
    sourceConstraint: string;
    targetConstraint: string;
    sourceColumns: RelationshipColumnPair[];
    targetColumns: RelationshipColumnPair[];
}
export interface RelationshipInfo {
    sourceTable: string;
    targetTable: string;
    constraintName: string;
    cardinality: RelationshipCardinality;
    columnPairs: RelationshipColumnPair[];
    self: boolean;
    junction?: ManyToManyJunction;
}
/** Build a PostgREST-oriented relationship graph without silently resolving ambiguity. */
export declare function buildRelationships(tables: Map<string, TableSchema>): RelationshipInfo[];
export declare function isToOneRelationship(relationship: RelationshipInfo): boolean;
/** Return every matching candidate; ambiguity belongs to the planner/error layer. */
export declare function findRelationshipCandidates(relationships: RelationshipInfo[], sourceTable: string, targetTable: string, hint?: string): RelationshipInfo[];
export declare function foreignKeyRowsToPairs(rows: ForeignKeyInfo[]): RelationshipColumnPair[];
//# sourceMappingURL=relationships.d.ts.map