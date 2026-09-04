const OP = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'LIKE', ilike: 'ILIKE', cs: '@>', cd: '<@', ov: '&&', sl: '<<', sr: '>>', nxl: '&<', nxr: '&>', adj: '-|-' };
const FTS = { fts: 'to_tsquery', plfts: 'plainto_tsquery', phfts: 'phraseto_tsquery', wfts: 'websearch_to_tsquery' };
const FILTER_PREFIX = /^(?:not\.)?(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|ov|sl|sr|nxl|nxr|adj|fts|plfts|phfts|wfts)\./i;
const RESULT_KEYS = new Set(['select', 'order', 'limit', 'offset', 'or', 'and']);
const q = (value) => `"${value.replace(/"/g, '""')}"`;
export function partitionGetRpcParams(params, routine) { const args = {}, resultParams = new URLSearchParams(), candidateArgNames = []; for (const [key, value] of params.entries()) {
    const isModifier = RESULT_KEYS.has(key), looksFilter = FILTER_PREFIX.test(value);
    if (!isModifier && !looksFilter)
        candidateArgNames.push(key);
    if (routine && !isModifier && !looksFilter && routine.argNames.includes(key))
        args[key] = value;
    else
        resultParams.append(key, value);
} return { args, resultParams, candidateArgNames }; }
export function buildRpcEnvelopeQuery(functionName, args, query, options = {}) { const params = []; const add = (value) => { params.push(value); return '$' + params.length; }; const schemaPrefix = options.schema ? `${q(options.schema)}.` : ''; const argSql = Object.keys(args).map(name => `${q(name)} => ${add(args[name])}`).join(', '); const where = buildWhere(query.filters, add); const order = query.order.length ? ` ORDER BY ${query.order.map(item => `${q(item.column)} ${item.direction.toUpperCase()}${item.nullsFirst === undefined ? '' : item.nullsFirst ? ' NULLS FIRST' : ' NULLS LAST'}`).join(', ')}` : ''; let limit = query.limit ?? options.defaultLimit; if (limit !== undefined && options.maxLimit !== undefined)
    limit = Math.min(limit, options.maxLimit); const page = `${limit !== undefined ? ` LIMIT ${limit}` : ''}${query.offset !== undefined && query.offset > 0 ? ` OFFSET ${query.offset}` : ''}`; const columns = query.columns === '*' ? '*' : query.columns.map(column => { const alias = column.match(/^(\w+):(\w+)$/); return alias ? `${q(alias[1])} AS ${q(alias[2])}` : q(column); }).join(', '); const sql = `WITH "__pgrst_rpc" AS MATERIALIZED (\n  SELECT * FROM ${schemaPrefix}${q(functionName)}(${argSql})\n),\n"__pgrst_filtered" AS MATERIALIZED (\n  SELECT * FROM "__pgrst_rpc"${where ? ` WHERE ${where}` : ''}\n),\n"__pgrst_page" AS (\n  SELECT ${columns} FROM "__pgrst_filtered"${order}${page}\n)\nSELECT\n  COALESCE((SELECT json_agg(row_to_json("__pgrst_page")) FROM "__pgrst_page"), '[]'::json) AS "__pgrst_rows",\n  (SELECT COUNT(*) FROM "__pgrst_filtered")::bigint AS "__pgrst_count",\n  (SELECT COUNT(*) FROM "__pgrst_rpc")::bigint AS "__pgrst_affected"`; return { sql, params }; }
function buildWhere(filters, add) { return filters.map(filter => condition(filter, add)).filter(Boolean).join(' AND '); }
function condition(filter, add) { const { column, operator, value, negate } = filter; if (operator === 'or' || operator === 'and') {
    const joiner = operator === 'or' ? ' OR ' : ' AND ', inner = value.map(item => condition(item, add)).filter(Boolean).join(joiner);
    return negate ? `NOT ((${inner}))` : `(${inner})`;
} let result; if (operator === 'is')
    result = value === null ? `${q(column)} IS NULL` : value === true ? `${q(column)} IS TRUE` : value === false ? `${q(column)} IS FALSE` : `${q(column)} IS ${add(value)}`;
else if (operator === 'in')
    result = `${q(column)} IN (${value.map(add).join(', ')})`;
else if (operator === 'like' || operator === 'ilike')
    result = `${q(column)} ${OP[operator]} ${add(typeof value === 'string' ? value.replace(/\*/g, '%') : value)}`;
else if (FTS[operator])
    result = `${q(column)} @@ ${FTS[operator]}(${add(value)})`;
else
    result = `${q(column)} ${OP[operator] ?? '='} ${add(value)}`; return negate ? `NOT (${result})` : result; }
export function decodeRpcEnvelope(row) { if (!row)
    return { rows: [], count: 0, affected: 0 }; let raw = row.__pgrst_rows; if (typeof raw === 'string') {
    try {
        raw = JSON.parse(raw);
    }
    catch {
        raw = [];
    }
} const rows = Array.isArray(raw) ? raw : []; return { rows, count: Number(row.__pgrst_count ?? 0), affected: Number(row.__pgrst_affected ?? 0) }; }
//# sourceMappingURL=rpc.js.map