export type ReadJoinType = 'left' | 'inner';
export interface SelectFieldNode {
    kind: 'field';
    name: string;
    alias?: string;
}
export interface SelectEmbedNode {
    kind: 'embed';
    relation: string;
    alias?: string;
    hint?: string;
    joinType?: ReadJoinType;
    spread?: boolean;
    children: SelectNode[];
}
export type SelectNode = SelectFieldNode | SelectEmbedNode;
/** Parse the PostgREST `select` grammar into a nested read AST. */
export declare function parsePostgRESTSelect(select: string): SelectNode[];
//# sourceMappingURL=select.d.ts.map