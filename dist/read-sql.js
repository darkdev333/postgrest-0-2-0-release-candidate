import { isToOneRelationship } from './relationships.js';
const OPERATORS = {
    eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'LIKE', ilike: 'ILIKE',
    cs: '@>', cd: '<@', ov: '&&', sl: '<<', sr: '>>', nxl: '&<', nxr: '&>', adj: '-|-',
};
const FTS = {
    fts: 'to_tsquery', plfts: 'plainto_tsquery', phfts: 'phraseto_tsquery', wfts: 'websearch_to_tsquery',
};
function quoteIdent(value) { return `"${value.replace(/"/g, '""')}"`; }
function quoteLiteral(value) { return `'${value.replace(/'/g, "''")}'`; }
function qualifiedTable(schema, table) { return schema ? `${quoteIdent(schema)}.${quoteIdent(table)}` : quoteIdent(table); }
function nextAlias(state, prefix) { const alias = `pgrst_${prefix}_${state.nextAlias}`; state.nextAlias += 1; return alias; }
function addParam(state, value) { state.params.push(value); return '$' + state.nextParam++; }
function joinPredicates(embed, parentAlias, childAlias, junctionAlias) {
    const rel = embed.relationship;
    if (rel.cardinality === 'many-to-many') {
        if (!rel.junction || !junctionAlias)
            throw new Error('Invalid many-to-many relationship: missing junction metadata');
        return rel.junction.sourceColumns.map(pair => `${quoteIdent(parentAlias)}.${quoteIdent(pair.source)} = ${quoteIdent(junctionAlias)}.${quoteIdent(pair.target)}`);
    }
    return rel.columnPairs.map(pair => `${quoteIdent(parentAlias)}.${quoteIdent(pair.source)} = ${quoteIdent(childAlias)}.${quoteIdent(pair.target)}`);
}
function compileFields(plan, tableAlias) {
    if (plan.fields.length === 0)
        return [`${quoteIdent(tableAlias)}.*`];
    const fields = [];
    for (const field of plan.fields) {
        if (field.name === '*') {
            fields.push(`${quoteIdent(tableAlias)}.*`);
            continue;
        }
        const base = `${quoteIdent(tableAlias)}.${quoteIdent(field.name)}`;
        fields.push(field.alias ? `${base} AS ${quoteIdent(field.alias)}` : base);
    }
    return fields;
}
function projectedColumns(plan) {
    const columns = [];
    for (const field of plan.fields) {
        if (field.name === '*')
            throw new Error('Spread embeds with * require schema-backed field expansion');
        const outputName = field.alias ?? field.name;
        columns.push({ sourceName: outputName, outputName });
    }
    for (const embed of plan.embeds) {
        if (embed.spread)
            columns.push(...projectedColumns(embed.plan));
        else
            columns.push({ sourceName: embed.outputName, outputName: embed.outputName });
    }
    return columns;
}
function compileSpreadProjection(plan, lateralAlias) {
    return projectedColumns(plan).map(column => `${quoteIdent(lateralAlias)}.${quoteIdent(column.sourceName)} AS ${quoteIdent(column.outputName)}`);
}
function compileFieldExpression(alias, column) {
    const parts = column.split(/(->>|->)/);
    const base = parts.shift()?.trim() ?? column;
    let sql = `${quoteIdent(alias)}.${quoteIdent(base)}`;
    for (let i = 0; i < parts.length; i += 2) {
        const operator = parts[i];
        const operand = parts[i + 1]?.trim();
        if (!operator || !operand)
            continue;
        if (/^-?\d+$/.test(operand))
            sql += `${operator}${operand}`;
        else
            sql += `${operator}${quoteLiteral(operand)}`;
    }
    return sql;
}
function compileFilter(filter, tableAlias, state) {
    const { column, operator, value, negate } = filter;
    if (operator === 'or' || operator === 'and') {
        const parts = value.map(item => compileFilter(item, tableAlias, state));
        const combined = `(${parts.join(operator === 'or' ? ' OR ' : ' AND ')})`;
        return negate ? `NOT (${combined})` : combined;
    }
    const field = compileFieldExpression(tableAlias, column);
    let condition;
    if (operator === 'is') {
        if (value === null)
            condition = `${field} IS NULL`;
        else if (value === true)
            condition = `${field} IS TRUE`;
        else if (value === false)
            condition = `${field} IS FALSE`;
        else
            condition = `${field} IS ${addParam(state, value)}`;
    }
    else if (operator === 'in') {
        const values = value;
        condition = values.length === 0 ? 'FALSE' : `${field} IN (${values.map(item => addParam(state, item)).join(', ')})`;
    }
    else if (operator === 'like' || operator === 'ilike') {
        const pattern = typeof value === 'string' ? value.replace(/\*/g, '%') : value;
        condition = `${field} ${OPERATORS[operator]} ${addParam(state, pattern)}`;
    }
    else if (FTS[operator])
        condition = `${field} @@ ${FTS[operator]}(${addParam(state, value)})`;
    else
        condition = `${field} ${OPERATORS[operator] ?? '='} ${addParam(state, value)}`;
    return negate ? `NOT (${condition})` : condition;
}
function compileOrderField(alias, column) { return compileFieldExpression(alias, column); }
function compileOrder(order, tableAlias, relatedAliases = new Map()) {
    if (!order?.length)
        return '';
    return order.map(item => {
        const relation = 'relation' in item ? item.relation : undefined;
        const alias = relation ? relatedAliases.get(relation) : tableAlias;
        if (!alias)
            throw new Error(`Missing lateral alias for related order '${relation}'`);
        let clause = `${compileOrderField(alias, item.column)} ${item.direction.toUpperCase()}`;
        if (item.nullsFirst !== undefined)
            clause += item.nullsFirst ? ' NULLS FIRST' : ' NULLS LAST';
        return clause;
    }).join(', ');
}
function compileRange(plan) { const parts = []; if (plan.limit !== undefined)
    parts.push(`LIMIT ${plan.limit}`); if (plan.offset !== undefined && plan.offset > 0)
    parts.push(`OFFSET ${plan.offset}`); return parts.join(' '); }
function compileEmbedJoins(plan, state, tableAlias) {
    const selects = [];
    const joins = [];
    const relatedAliases = new Map();
    for (const embed of plan.embeds) {
        const childAlias = nextAlias(state, 'r'), lateralAlias = nextAlias(state, 'e');
        const childQuery = compileNode(embed.plan, state, childAlias, { embed, parentAlias: tableAlias });
        relatedAliases.set(embed.outputName, lateralAlias);
        if (isToOneRelationship(embed.relationship)) {
            if (embed.spread)
                selects.push(...compileSpreadProjection(embed.plan, lateralAlias));
            else
                selects.push(`row_to_json(${quoteIdent(lateralAlias)}.*)::jsonb AS ${quoteIdent(embed.outputName)}`);
            joins.push(`${embed.joinType === 'inner' ? 'INNER' : 'LEFT'} JOIN LATERAL ( ${childQuery} ) AS ${quoteIdent(lateralAlias)} ON TRUE`);
        }
        else {
            const rowAlias = nextAlias(state, 'a');
            if (embed.spread) {
                const columns = projectedColumns(embed.plan);
                const aggregates = columns.map(column => `json_agg(${quoteIdent(rowAlias)}.${quoteIdent(column.sourceName)})::jsonb AS ${quoteIdent(column.outputName)}`);
                if (aggregates.length === 0)
                    throw new Error('Spread embed must project at least one field');
                const aggregateQuery = `SELECT ${aggregates.join(", ")} FROM (${childQuery}) AS ${quoteIdent(rowAlias)}`;
                for (const column of columns)
                    selects.push(`COALESCE(${quoteIdent(lateralAlias)}.${quoteIdent(column.outputName)}, '[]'::jsonb) AS ${quoteIdent(column.outputName)}`);
                const condition = embed.joinType === 'inner' ? `${quoteIdent(lateralAlias)} IS NOT NULL` : 'TRUE';
                joins.push(`${embed.joinType === 'inner' ? 'INNER' : 'LEFT'} JOIN LATERAL ( ${aggregateQuery} ) AS ${quoteIdent(lateralAlias)} ON ${condition}`);
            }
            else {
                const aggregateQuery = `SELECT json_agg(${quoteIdent(rowAlias)})::jsonb AS ${quoteIdent(lateralAlias)} FROM (${childQuery}) AS ${quoteIdent(rowAlias)}`;
                selects.push(`COALESCE(${quoteIdent(lateralAlias)}.${quoteIdent(lateralAlias)}, '[]'::jsonb) AS ${quoteIdent(embed.outputName)}`);
                const condition = embed.joinType === 'inner' ? `${quoteIdent(lateralAlias)} IS NOT NULL` : 'TRUE';
                joins.push(`${embed.joinType === 'inner' ? 'INNER' : 'LEFT'} JOIN LATERAL ( ${aggregateQuery} ) AS ${quoteIdent(lateralAlias)} ON ${condition}`);
            }
        }
    }
    return { selects, joins, relatedAliases };
}
function compileReadLogic(term, tableAlias, state, embedAliases) {
    if (term.kind === 'filter')
        return compileFilter(term.filter, tableAlias, state);
    if (term.kind === 'embed-null') {
        const alias = embedAliases.get(term.resource);
        if (!alias)
            throw new Error(`Missing lateral alias for embed null filter '${term.resource}'`);
        return `${quoteIdent(alias)} IS ${term.negate ? '' : 'NOT '}DISTINCT FROM NULL`;
    }
    const inner = term.terms.map(child => compileReadLogic(child, tableAlias, state, embedAliases)).join(term.operator === 'or' ? ' OR ' : ' AND ');
    const grouped = `(${inner})`;
    return term.negate ? `NOT (${grouped})` : grouped;
}
function appendModifiers(sql, plan, tableAlias, state, extraWhere = [], relatedAliases = new Map(), embedAliases = relatedAliases) {
    const embedWhere = (plan.embedNullFilters ?? []).map(filter => { const alias = embedAliases.get(filter.resource); if (!alias)
        throw new Error(`Missing lateral alias for embed null filter '${filter.resource}'`); return `${quoteIdent(alias)} IS ${filter.negate ? '' : 'NOT '}DISTINCT FROM NULL`; });
    const logicWhere = (plan.logic ?? []).map(term => compileReadLogic(term, tableAlias, state, embedAliases));
    const where = [...extraWhere, ...embedWhere, ...logicWhere, ...(plan.filters ?? []).map(filter => compileFilter(filter, tableAlias, state))];
    if (where.length)
        sql += ` WHERE ${where.join(' AND ')}`;
    const order = compileOrder(plan.order, tableAlias, relatedAliases);
    if (order)
        sql += ` ORDER BY ${order}`;
    const range = compileRange(plan);
    if (range)
        sql += ` ${range}`;
    return sql;
}
function compileNode(plan, state, tableAlias, parentJoin) {
    const selects = compileFields(plan, tableAlias), joins = [], relatedAliases = new Map(), embedAliases = new Map();
    for (const embed of plan.embeds) {
        const childTableAlias = nextAlias(state, 'r'), lateralAlias = nextAlias(state, 'e'), toOne = isToOneRelationship(embed.relationship);
        embedAliases.set(embed.outputName, lateralAlias);
        if (toOne)
            relatedAliases.set(embed.outputName, lateralAlias);
        let childQuery;
        if (embed.relationship.cardinality === 'many-to-many') {
            const junction = embed.relationship.junction;
            if (!junction)
                throw new Error('Invalid many-to-many relationship: missing junction metadata');
            const junctionAlias = nextAlias(state, 'j'), childSelects = compileFields(embed.plan, childTableAlias), nested = compileEmbedJoins(embed.plan, state, childTableAlias);
            childSelects.push(...nested.selects);
            const targetJoin = junction.targetColumns.map(pair => `${quoteIdent(junctionAlias)}.${quoteIdent(pair.source)} = ${quoteIdent(childTableAlias)}.${quoteIdent(pair.target)}`).join(' AND ');
            const sourceWhere = joinPredicates(embed, tableAlias, childTableAlias, junctionAlias);
            let inner = `SELECT ${childSelects.join(', ')} FROM ${qualifiedTable(state.schema, embed.plan.table)} AS ${quoteIdent(childTableAlias)} JOIN ${qualifiedTable(state.schema, junction.table)} AS ${quoteIdent(junctionAlias)} ON ${targetJoin}`;
            if (nested.joins.length)
                inner += ` ${nested.joins.join(' ')}`;
            childQuery = appendModifiers(inner, embed.plan, childTableAlias, state, sourceWhere, nested.relatedAliases, nested.relatedAliases);
        }
        else
            childQuery = compileNode(embed.plan, state, childTableAlias, { embed, parentAlias: tableAlias });
        if (toOne) {
            if (embed.spread)
                selects.push(...compileSpreadProjection(embed.plan, lateralAlias));
            else
                selects.push(`row_to_json(${quoteIdent(lateralAlias)}.*)::jsonb AS ${quoteIdent(embed.outputName)}`);
            joins.push(`${embed.joinType === 'inner' ? 'INNER' : 'LEFT'} JOIN LATERAL ( ${childQuery} ) AS ${quoteIdent(lateralAlias)} ON TRUE`);
        }
        else {
            const aggregateAlias = lateralAlias, rowAlias = nextAlias(state, 'a');
            if (embed.spread) {
                const columns = projectedColumns(embed.plan);
                const aggregates = columns.map(column => `json_agg(${quoteIdent(rowAlias)}.${quoteIdent(column.sourceName)})::jsonb AS ${quoteIdent(column.outputName)}`);
                if (aggregates.length === 0)
                    throw new Error('Spread embed must project at least one field');
                const aggregateQuery = `SELECT ${aggregates.join(", ")} FROM (${childQuery}) AS ${quoteIdent(rowAlias)}`;
                for (const column of columns)
                    selects.push(`COALESCE(${quoteIdent(lateralAlias)}.${quoteIdent(column.outputName)}, '[]'::jsonb) AS ${quoteIdent(column.outputName)}`);
                const condition = embed.joinType === 'inner' ? `${quoteIdent(lateralAlias)} IS NOT NULL` : 'TRUE';
                joins.push(`${embed.joinType === 'inner' ? 'INNER' : 'LEFT'} JOIN LATERAL ( ${aggregateQuery} ) AS ${quoteIdent(lateralAlias)} ON ${condition}`);
            }
            else {
                const aggregateQuery = `SELECT json_agg(${quoteIdent(rowAlias)})::jsonb AS ${quoteIdent(aggregateAlias)} FROM (${childQuery}) AS ${quoteIdent(rowAlias)}`;
                selects.push(`COALESCE(${quoteIdent(lateralAlias)}.${quoteIdent(aggregateAlias)}, '[]'::jsonb) AS ${quoteIdent(embed.outputName)}`);
                const condition = embed.joinType === 'inner' ? `${quoteIdent(lateralAlias)} IS NOT NULL` : 'TRUE';
                joins.push(`${embed.joinType === 'inner' ? 'INNER' : 'LEFT'} JOIN LATERAL ( ${aggregateQuery} ) AS ${quoteIdent(lateralAlias)} ON ${condition}`);
            }
        }
    }
    let sql = `SELECT ${selects.join(', ')} FROM ${qualifiedTable(state.schema, plan.table)} AS ${quoteIdent(tableAlias)}`;
    if (joins.length)
        sql += ` ${joins.join(' ')}`;
    const relationshipWhere = parentJoin ? joinPredicates(parentJoin.embed, parentJoin.parentAlias, tableAlias) : [];
    return appendModifiers(sql, plan, tableAlias, state, relationshipWhere, relatedAliases, embedAliases);
}
function stripRanges(plan) { return { ...plan, order: [], limit: undefined, offset: undefined, embeds: plan.embeds.map(embed => ({ ...embed, plan: stripRanges(embed.plan) })) }; }
export function buildReadSQL(plan, schema) { const state = { nextAlias: 0, nextParam: 1, params: [] }; if (schema)
    state.schema = schema; const rootAlias = nextAlias(state, 'r'); return { sql: compileNode(plan, state, rootAlias), params: state.params }; }
export function buildReadCountSQL(plan, schema) { const built = buildReadSQL(stripRanges(plan), schema); return { sql: `SELECT COUNT(*) AS count FROM (${built.sql}) AS ${quoteIdent('pgrst_count')}`, params: built.params }; }
//# sourceMappingURL=read-sql.js.map