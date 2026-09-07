import type { RelationshipInfo } from './relationships.js';
import { type ViewKeyDependency } from './view-relationships.js';
export declare function addInverseRelationships(directRelationships: RelationshipInfo[]): RelationshipInfo[];
export declare function discoverManyToManyRelationships(directRelationships: RelationshipInfo[], primaryKeys: Map<string, string[]>): RelationshipInfo[];
export declare function assembleViewAwareRelationships(baseDirectRelationships: RelationshipInfo[], basePrimaryKeys: Map<string, string[]>, dependencies: ViewKeyDependency[]): RelationshipInfo[];
//# sourceMappingURL=relationship-assembly.d.ts.map