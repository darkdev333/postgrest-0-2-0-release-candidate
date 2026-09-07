import type { ForeignKeyInfo, TableSchema } from './schema.js';
export type RelationshipCardinality = 'many-to-one' | 'one-to-many' | 'one-to-one' | 'many-to-many';
export interface RelationshipColumnPair {
    source: string;
    target: string;
}
export interface ManyToManyJunction {
    schema?: string;
    table: string;
    sourceConstraint: string;
    targetConstraint: string;
    sourceColumns: RelationshipColumnPair[];
    targetColumns: RelationshipColumnPair[];
}
export interface ComputedRelationshipInfo {
    functionName: string;
    functionSchema?: string;
}
export interface RelationshipInfo {
    sourceSchema?: string;
    sourceTable: string;
    targetSchema?: string;
    targetTable: string;
    constraintName: string;
    cardinality: RelationshipCardinality;
    columnPairs: RelationshipColumnPair[];
    self: boolean;
    sourceIsView?: boolean;
    targetIsView?: boolean;
    junction?: ManyToManyJunction;
    computed?: ComputedRelationshipInfo;
}
/** Build a PostgREST-oriented relationship graph without silently resolving ambiguity. */
export declare function buildRelationships(tables: Map<string, TableSchema>): RelationshipInfo[];
export declare function isToOneRelationship(relationship: RelationshipInfo): boolean;
/**
 * Match PostgREST relationship selectors/hints using upstream `findRel` semantics.
 *
 * For ordinary relationships, an unhinted selector may be the target table, the
 * constraint name, or (for a single-column FK) the FK column on the origin.
 * The deprecated constraint/FK-column-as-target forms are not available when
 * the foreign relation is a view, matching upstream `not relFTableIsView`.
 * Once `!hint` is present, the selector itself must name the target relation and
 * the hint may name the constraint, either single FK column, or an M2M junction.
 *
 * Self relationships are intentionally asymmetric, matching upstream: the
 * to-one side is selected by its FK column (`parent(...)`), while the inverse
 * to-many side is selected by the table name and disambiguated with the FK
 * column (`children:table!parent(...)`). Upstream still marks self O2O/M2M
 * disambiguation as TODO, so we do not invent behavior for those cases here.
 */
export declare function findRelationshipCandidates(relationships: RelationshipInfo[], sourceTable: string, targetSelector: string, hint?: string): RelationshipInfo[];
export declare function foreignKeyRowsToPairs(rows: ForeignKeyInfo[]): RelationshipColumnPair[];
//# sourceMappingURL=relationships.d.ts.map