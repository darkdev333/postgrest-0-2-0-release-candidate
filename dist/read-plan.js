import { findRelationshipCandidates } from './relationships.js';
export class RelationshipResolutionError extends Error {
    code;
    sourceTable;
    targetTable;
    hint;
    candidates;
    constructor(code, sourceTable, targetTable, candidates, hint) {
        const message = code === 'PGRST201'
            ? `Could not embed because more than one relationship was found for '${sourceTable}' and '${targetTable}'`
            : `Could not find a relationship between '${sourceTable}' and '${targetTable}' in the schema cache`;
        super(message);
        this.name = 'RelationshipResolutionError';
        this.code = code;
        this.sourceTable = sourceTable;
        this.targetTable = targetTable;
        this.candidates = candidates;
        if (hint)
            this.hint = hint;
    }
}
function planEmbed(sourceTable, embed, relationships) {
    const candidates = findRelationshipCandidates(relationships, sourceTable, embed.relation, embed.hint);
    if (candidates.length === 0)
        throw new RelationshipResolutionError('PGRST200', sourceTable, embed.relation, [], embed.hint);
    if (candidates.length > 1)
        throw new RelationshipResolutionError('PGRST201', sourceTable, embed.relation, candidates, embed.hint);
    const relationship = candidates[0];
    return {
        relation: embed.relation,
        outputName: embed.alias ?? embed.relation,
        joinType: embed.joinType ?? 'left',
        spread: embed.spread ?? false,
        relationship,
        plan: buildReadPlan(relationship.targetTable, embed.children, relationships),
    };
}
export function buildReadPlan(table, select, relationships) {
    const fields = [];
    const embeds = [];
    for (const node of select) {
        if (node.kind === 'field')
            fields.push(node);
        else
            embeds.push(planEmbed(table, node, relationships));
    }
    return { table, fields, embeds, filters: [], order: [], embedNullFilters: [], logic: [] };
}
function expandStarFields(fields, columns) {
    const expanded = [];
    for (const field of fields) {
        if (field.name === '*') {
            expanded.push(...columns.map(name => ({ kind: 'field', name })));
        }
        else {
            expanded.push(field);
        }
    }
    return expanded;
}
/**
 * Expand `*` only when the containing relation is spread.
 *
 * Ordinary `relation(*)` remains a row/object projection and can safely stay as `table.*`.
 * Spread needs an explicit output-column list because to-one spread flattens those columns and
 * to-many spread aggregates each column independently. Column discovery stays outside the SQL
 * compiler so the compiler remains a pure ReadPlan -> parameterized SQL step.
 */
export async function expandSpreadStars(plan, resolveColumns, spreadContext = false) {
    const fields = spreadContext && plan.fields.some(field => field.name === '*')
        ? expandStarFields(plan.fields, await resolveColumns(plan.table))
        : [...plan.fields];
    const embeds = await Promise.all(plan.embeds.map(async (embed) => ({
        ...embed,
        plan: await expandSpreadStars(embed.plan, resolveColumns, embed.spread),
    })));
    return {
        ...plan,
        fields,
        embeds,
        filters: [...(plan.filters ?? [])],
        order: [...(plan.order ?? [])],
        embedNullFilters: [...(plan.embedNullFilters ?? [])],
        logic: [...(plan.logic ?? [])],
    };
}
//# sourceMappingURL=read-plan.js.map