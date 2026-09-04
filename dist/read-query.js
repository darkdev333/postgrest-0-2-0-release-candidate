import { PostgrestParser } from './parser.js';
import { parseReadLogicFilter } from './read-logic.js';
import { isToOneRelationship } from './relationships.js';
export class ReadQueryPathError extends Error {
    code = 'PGRST108';
    resource;
    hintText;
    detailsText;
    constructor(resource, hintText, detailsText = null) {
        super(`'${resource}' is not an embedded resource in this request`);
        this.name = 'ReadQueryPathError';
        this.resource = resource;
        this.hintText = hintText ?? `Verify that '${resource}' is included in the 'select' query parameter.`;
        this.detailsText = detailsText;
    }
}
export class RelatedOrderError extends Error {
    code = 'PGRST118';
    parent;
    resource;
    constructor(parent, resource) {
        super(`A related order on '${resource}' is not possible`);
        this.name = 'RelatedOrderError';
        this.parent = parent;
        this.resource = resource;
    }
}
function clonePlan(plan) {
    return {
        ...plan,
        fields: [...plan.fields],
        filters: [...(plan.filters ?? [])],
        order: [...(plan.order ?? [])],
        embedNullFilters: [...(plan.embedNullFilters ?? [])],
        logic: [...(plan.logic ?? [])],
        embeds: plan.embeds.map(embed => ({ ...embed, plan: clonePlan(embed.plan) })),
    };
}
function resolvePath(root, path) {
    let current = root;
    for (const segment of path) {
        const byOutput = current.embeds.find(embed => embed.outputName === segment);
        if (byOutput) {
            current = byOutput.plan;
            continue;
        }
        const aliasedTarget = current.embeds.find(embed => embed.relation === segment && embed.outputName !== embed.relation);
        if (aliasedTarget) {
            throw new ReadQueryPathError(segment, `Use '${aliasedTarget.outputName}' instead of '${segment}' to reference this embedded resource.`, 'Target names are not allowed in filters if they have an alias');
        }
        throw new ReadQueryPathError(segment);
    }
    return current;
}
function nonNegativeInteger(value) {
    if (!/^\d+$/.test(value))
        return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
}
function assignFilter(target, filter) {
    if (!filter)
        return;
    (target.filters ??= []).push(filter);
}
function splitOrderTerms(value) {
    const parts = [];
    let current = '';
    let depth = 0;
    for (const char of value) {
        if (char === '(')
            depth += 1;
        else if (char === ')')
            depth -= 1;
        if (char === ',' && depth === 0) {
            if (current.trim())
                parts.push(current.trim());
            current = '';
        }
        else
            current += char;
    }
    if (current.trim())
        parts.push(current.trim());
    return parts;
}
function parseRelatedOrder(term) {
    const match = term.match(/^([^().,]+)\((.+)\)(?:\.(asc|desc))?(?:\.(nullsfirst|nullslast))?$/i);
    if (!match)
        return null;
    const relation = match[1].trim();
    const column = match[2].trim();
    const direction = (match[3]?.toLowerCase() ?? 'asc');
    const result = { relation, column, direction };
    if (match[4])
        result.nullsFirst = match[4].toLowerCase() === 'nullsfirst';
    return result;
}
function parseReadOrder(target, value, parser) {
    const result = [];
    for (const term of splitOrderTerms(value)) {
        const related = parseRelatedOrder(term);
        if (!related) {
            result.push(...parser.parseOrder(term));
            continue;
        }
        const embed = target.embeds.find(candidate => candidate.outputName === related.relation);
        if (!embed)
            throw new ReadQueryPathError(related.relation);
        if (!isToOneRelationship(embed.relationship))
            throw new RelatedOrderError(target.table, related.relation);
        result.push(related);
    }
    return result;
}
function assignOrder(target, value, parser) {
    target.order = parseReadOrder(target, value, parser);
}
function toReadLogicTerm(target, filter) {
    if (filter.operator === 'and' || filter.operator === 'or') {
        return {
            kind: 'logic',
            operator: filter.operator,
            negate: filter.negate === true,
            terms: filter.value.map(child => toReadLogicTerm(target, child)),
        };
    }
    if (filter.operator === 'is' && filter.value === null && target.embeds.some(embed => embed.outputName === filter.column)) {
        return { kind: 'embed-null', resource: filter.column, negate: filter.negate === true };
    }
    return { kind: 'filter', filter };
}
function assignLogic(target, filter) {
    if (!filter)
        return;
    (target.logic ??= []).push(toReadLogicTerm(target, filter));
}
function assignEmbedNullFilter(target, resource, filter) {
    if (!filter || filter.operator !== 'is' || filter.value !== null)
        return false;
    const embed = target.embeds.find(candidate => candidate.outputName === resource);
    if (!embed)
        return false;
    (target.embedNullFilters ??= []).push({ resource, negate: filter.negate === true });
    return true;
}
export function applyReadQueryParams(plan, searchParams, parser = new PostgrestParser()) {
    const result = clonePlan(plan);
    for (const [key, value] of searchParams.entries()) {
        if (key === 'select' || key === 'columns' || key === 'on_conflict')
            continue;
        const parts = key.split('.').filter(Boolean);
        if (parts.length === 0)
            continue;
        const leaf = parts[parts.length - 1];
        if (leaf === 'order') {
            assignOrder(resolvePath(result, parts.slice(0, -1)), value, parser);
            continue;
        }
        if (leaf === 'limit' || leaf === 'offset') {
            const numeric = nonNegativeInteger(value);
            if (numeric !== undefined)
                resolvePath(result, parts.slice(0, -1))[leaf] = numeric;
            continue;
        }
        if (leaf === 'and' || leaf === 'or') {
            const negated = parts.length >= 2 && parts[parts.length - 2] === 'not';
            const path = parts.slice(0, negated ? -2 : -1);
            assignLogic(resolvePath(result, path), parseReadLogicFilter(leaf, value, parser, negated));
            continue;
        }
        const target = resolvePath(result, parts.slice(0, -1));
        const filter = parser.parseFilter(leaf, value);
        if (!assignEmbedNullFilter(target, leaf, filter))
            assignFilter(target, filter);
    }
    return result;
}
//# sourceMappingURL=read-query.js.map