import type { RelationshipInfo, RelationshipColumnPair } from './relationships.js';
export type ViewKeyDependencyType = 'p' | 'f' | 'f_ref';
export interface ViewColumnDependency {
    tableColumn: string;
    viewColumns: string[];
}
export interface ViewKeyDependency {
    tableSchema?: string;
    tableName: string;
    viewSchema?: string;
    viewName: string;
    constraintName: string;
    type: ViewKeyDependencyType;
    columns: ViewColumnDependency[];
}
export declare function qualifiedRelationKey(schema: string | undefined, table: string): string;
/** Expand one base-key -> many view-column mapping like upstream `traverse snd`. */
export declare function expandViewColumnDependencies(columns: ViewColumnDependency[]): RelationshipColumnPair[][];
/** Port of upstream SchemaCache.addViewM2OAndO2ORels for direct M2O/O2O relationships. */
export declare function deriveViewRelationships(directRelationships: RelationshipInfo[], dependencies: ViewKeyDependency[]): RelationshipInfo[];
/** Upstream addViewPrimaryKeys chooses the first view reference per PK column. */
export declare function viewPrimaryKeys(dependencies: ViewKeyDependency[]): Map<string, string[]>;
//# sourceMappingURL=view-relationships.d.ts.map