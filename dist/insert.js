/** PostgREST-compatible INSERT/UPSERT SQL compiler. */
function quoteIdentifier(identifier) {
    return `"${identifier.replace(/"/g, '""')}"`;
}
function qualifiedTable(schema, table) {
    return schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(table)}` : quoteIdentifier(table);
}
/** Compile JSON object(s) using PostgREST missing/conflict semantics. */
export function buildInsertStatement(table, data, options = {}) {
    const rows = Array.isArray(data) ? data : [data];
    if (rows.length === 0)
        throw new Error('No data provided for insert');
    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
    if (columns.length === 0) {
        const sql = `INSERT INTO ${qualifiedTable(options.schema, table)} DEFAULT VALUES${buildConflictClause([], options)}${buildReturning(options.returning)}`;
        return { sql, params: [] };
    }
    const params = [];
    const addParam = (value) => {
        params.push(value);
        return `$${params.length}`;
    };
    const values = rows.map(row => {
        const fields = columns.map(column => {
            if (Object.prototype.hasOwnProperty.call(row, column) && row[column] !== undefined) {
                return addParam(row[column]);
            }
            return options.missing === 'default' ? 'DEFAULT' : addParam(null);
        });
        return `(${fields.join(', ')})`;
    });
    const quotedColumns = columns.map(quoteIdentifier).join(', ');
    const conflict = buildConflictClause(columns, options);
    const sql = `INSERT INTO ${qualifiedTable(options.schema, table)} (${quotedColumns}) VALUES ${values.join(', ')}${conflict}${buildReturning(options.returning)}`;
    return { sql, params };
}
function buildConflictClause(columns, options) {
    if (!options.resolution)
        return '';
    const conflictColumns = options.conflictColumns ?? [];
    const target = conflictColumns.length > 0 ? ` (${conflictColumns.map(quoteIdentifier).join(', ')})` : '';
    if (options.resolution === 'ignore-duplicates')
        return ` ON CONFLICT${target} DO NOTHING`;
    if (conflictColumns.length === 0)
        throw new Error('merge-duplicates requires a conflict target');
    const conflictSet = new Set(conflictColumns);
    const updateColumns = columns.filter(column => !conflictSet.has(column));
    if (updateColumns.length === 0)
        return ` ON CONFLICT${target} DO NOTHING`;
    const assignments = updateColumns
        .map(column => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`)
        .join(', ');
    return ` ON CONFLICT${target} DO UPDATE SET ${assignments}`;
}
function buildReturning(returning) {
    if (!returning)
        return '';
    return ` RETURNING ${returning === '*' ? '*' : returning.map(quoteIdentifier).join(', ')}`;
}
/** Add mutation preferences omitted by the legacy header helper. */
export function applyInsertPreferenceHeaders(headers, prefer) {
    if (!prefer.missing)
        return;
    const existing = headers.get('Preference-Applied');
    const token = `missing=${prefer.missing}`;
    if (!existing)
        headers.set('Preference-Applied', token);
    else if (!existing.split(',').map(value => value.trim()).includes(token)) {
        headers.set('Preference-Applied', `${existing}, ${token}`);
    }
}
//# sourceMappingURL=insert.js.map