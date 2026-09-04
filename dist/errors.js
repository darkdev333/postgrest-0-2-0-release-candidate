const MESSAGE_CODE_FALLBACKS = [[/duplicate key/i, '23505'], [/foreign key/i, '23503'], [/null value .* violates not-null constraint/i, '23502'], [/permission denied/i, '42501']];
export function postgresStatus(code) { switch (code) {
    case '23503':
    case '23505': return 409;
    case '23502':
    case '23514': return 400;
    case '42501': return 403;
    case '42P01':
    case '42883': return 404;
    case '53400':
    case '57P01':
    case '57P02':
    case '57P03':
    case '53300': return 503;
    default: return /^(22|23|42)/.test(code) ? 400 : 500;
} }
function inferCode(message) { for (const [pattern, code] of MESSAGE_CODE_FALLBACKS)
    if (pattern.test(message))
        return code; return undefined; }
export function normalizePostgRESTError(error) { const err = error instanceof Error ? error : undefined; const message = err?.message ?? String(error ?? 'Internal server error'); const code = typeof err?.code === 'string' && err.code.length ? err.code : inferCode(message); if (code)
    return { status: postgresStatus(code), body: { code, message, details: err?.details ?? err?.detail ?? null, hint: err?.hint ?? null } }; return { status: 500, body: { code: 'PGRST500', message, details: null, hint: null } }; }
export function singularCardinalityError(rowCount) { return { code: 'PGRST116', details: `The result contains ${rowCount} rows`, hint: null, message: 'Cannot coerce the result to a single JSON object' }; }
export function requestedRangeNotSatisfiable(details) { return { code: 'PGRST103', details, hint: null, message: 'Requested range not satisfiable' }; }
export function invalidPreferences(tokens) { return { code: 'PGRST122', details: `Invalid preferences: ${tokens.join(', ')}`, hint: null, message: 'Invalid preferences given with handling=strict' }; }
export function maxAffectedViolation(rowCount) { return { code: 'PGRST124', details: `The query affects ${rowCount} rows`, hint: null, message: 'Query result exceeds max-affected preference constraint' }; }
export function maxAffectedRpcUnsupported() { return { code: 'PGRST128', details: null, hint: null, message: 'Function must return SETOF or TABLE when max-affected preference is used with handling=strict' }; }
export function noRpc(schema, name, argKeys) { const args = argKeys.join(', '), suffix = argKeys.length ? `(${args})` : ' without parameters', detailArgs = argKeys.length ? ` with parameter${argKeys.length > 1 ? 's' : ''} ${args}` : ' without parameters'; return { code: 'PGRST202', details: `Searched for the function ${schema}.${name}${detailArgs}, but no matches were found in the schema cache.`, hint: null, message: `Could not find the function ${schema}.${name}${suffix} in the schema cache` }; }
export function ambiguousRpc(signatures) { return { code: 'PGRST203', details: null, hint: 'Try renaming the parameters or the function itself in the database so function overloading can be resolved', message: `Could not choose the best candidate function between: ${signatures.join(', ')}` }; }
export function notEmbedded(resource, hint, details = null) { return { code: 'PGRST108', details, hint: hint ?? `Verify that '${resource}' is included in the 'select' query parameter.`, message: `'${resource}' is not an embedded resource in this request` }; }
export function relatedOrderNotToOne(parent, resource) { return { code: 'PGRST118', details: `'${parent}' and '${resource}' do not form a many-to-one or one-to-one relationship`, hint: null, message: `A related order on '${resource}' is not possible` }; }
export function noRelationship(schema, parent, child, hint = null) { return { code: 'PGRST200', details: `Searched for a foreign key relationship between '${parent}' and '${child}' in the schema '${schema}', but no matches were found.`, hint, message: `Could not find a relationship between '${parent}' and '${child}' in the schema cache` }; }
function relationshipDescription(rel) { const cardinality = rel.cardinality; const embedding = `${rel.sourceTable} with ${rel.targetTable}`; if (rel.cardinality === 'many-to-many' && rel.junction) {
    return { cardinality, embedding, relationship: `${rel.constraintName} using ${rel.junction.table}` };
} const source = rel.columnPairs.map(pair => pair.source).join(', '), target = rel.columnPairs.map(pair => pair.target).join(', '); return { cardinality, embedding, relationship: `${rel.constraintName} using ${rel.sourceTable}(${source}) and ${rel.targetTable}(${target})` }; }
export function ambiguousRelationship(parent, child, candidates) { const hints = [...new Set(candidates.map(rel => `${child}!${rel.constraintName.split(':')[0]}`))]; return { code: 'PGRST201', details: candidates.map(relationshipDescription), hint: `Try changing '${child}' to one of the following: ${hints.map(item => `'${item}'`).join(', ')}. Find the desired relationship in the 'details' key.`, message: `Could not embed because more than one relationship was found for '${parent}' and '${child}'` }; }
//# sourceMappingURL=errors.js.map