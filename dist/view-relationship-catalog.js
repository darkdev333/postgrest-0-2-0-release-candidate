/**
 * PostgreSQL catalog query adapted from upstream PostgREST
 * `SchemaCache.allViewsKeyDependencies`.
 *
 * The only deliberate transport adaptation is the final `json_agg` shape: the
 * Haskell implementation decodes an array of composites, while the TypeScript
 * SQLExecutor boundary is more portable when the same pairs are returned as
 * JSON objects. Relationship semantics and recursive dependency traversal are
 * unchanged.
 *
 * $1: exposed schema names (text[])
 * $2: extra search-path schema names (text[])
 */
export const VIEW_KEY_DEPENDENCIES_SQL = String.raw `
WITH RECURSIVE
pks_fks AS (
  SELECT
    contype::text AS contype,
    conname,
    array_length(conkey, 1) AS ncol,
    conrelid AS resorigtbl,
    col AS resorigcol,
    ord
  FROM pg_constraint
  LEFT JOIN LATERAL unnest(conkey) WITH ORDINALITY AS _(col, ord) ON true
  WHERE contype IN ('p', 'f')
  UNION
  SELECT
    concat(contype, '_ref') AS contype,
    conname,
    array_length(confkey, 1) AS ncol,
    confrelid,
    col,
    ord
  FROM pg_constraint
  LEFT JOIN LATERAL unnest(confkey) WITH ORDINALITY AS _(col, ord) ON true
  WHERE contype = 'f'
),
views AS (
  SELECT
    c.oid AS view_id,
    c.relnamespace AS view_schema_id,
    n.nspname AS view_schema,
    c.relname AS view_name,
    r.ev_action AS view_definition
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_rewrite r ON r.ev_class = c.oid
  WHERE c.relkind IN ('v', 'm')
    AND n.nspname = ANY($1::text[] || $2::text[])
),
transform_json AS (
  SELECT
    view_id, view_schema_id, view_schema, view_name,
    replace(
      replace(
      replace(
      replace(
      replace(
      replace(
      replace(
      regexp_replace(
      replace(
      replace(
      replace(
      replace(
      replace(
      replace(
      replace(
      replace(
      replace(
      replace(
      replace(
        view_definition::text,
         '<>'              , '()'
      ), ','               , ''
      ), E'\\{'            , ''
      ), E'\\}'            , ''
      ), ' :targetList '   , ',"targetList":'
      ), ' :resno '        , ',"resno":'
      ), ' :resorigtbl '   , ',"resorigtbl":'
      ), ' :resorigcol '   , ',"resorigcol":'
      ), '{'               , '{ :'
      ), '(('              , '{(('
      ), '({'              , '{({'
      ), ' :[^}{,]+'       , ',"":'              , 'g'
      ), ',"":}'           , '}'
      ), ',"":,'           , ','
      ), '{('              , '('
      ), '{,'              , '{'
      ), '('               , '['
      ), ')'               , ']'
      ), ' '               , ','
    )::json AS view_definition
  FROM views
),
target_entries AS (
  SELECT
    view_id, view_schema_id, view_schema, view_name,
    json_array_elements(view_definition->0->'targetList') AS entry
  FROM transform_json
),
results AS (
  SELECT
    view_id, view_schema_id, view_schema, view_name,
    (entry->>'resno')::int AS view_column,
    (entry->>'resorigtbl')::oid AS resorigtbl,
    (entry->>'resorigcol')::int AS resorigcol
  FROM target_entries
),
recursion(view_id, view_schema_id, view_schema, view_name, view_column, resorigtbl, resorigcol, is_cycle, path) AS (
  SELECT r.*, false, ARRAY[resorigtbl]
  FROM results r
  WHERE view_schema = ANY($1::text[])
  UNION ALL
  SELECT
    view.view_id,
    view.view_schema_id,
    view.view_schema,
    view.view_name,
    view.view_column,
    tab.resorigtbl,
    tab.resorigcol,
    tab.resorigtbl = ANY(path),
    path || tab.resorigtbl
  FROM recursion view
  JOIN results tab ON view.resorigtbl = tab.view_id AND view.resorigcol = tab.view_column
  WHERE NOT is_cycle
),
repeated_references AS (
  SELECT
    view_id,
    view_schema,
    view_name,
    resorigtbl,
    resorigcol,
    array_agg(attname) AS view_columns
  FROM recursion
  JOIN pg_attribute vcol ON vcol.attrelid = view_id AND vcol.attnum = view_column
  GROUP BY view_id, view_schema, view_name, resorigtbl, resorigcol
)
SELECT
  sch.nspname AS table_schema,
  tbl.relname AS table_name,
  rep.view_schema,
  rep.view_name,
  pks_fks.conname AS constraint_name,
  pks_fks.contype AS constraint_type,
  json_agg(
    json_build_object('table_column', col.attname, 'view_columns', view_columns)
    ORDER BY pks_fks.ord
  ) AS column_dependencies
FROM repeated_references rep
JOIN pks_fks USING (resorigtbl, resorigcol)
JOIN pg_class tbl ON tbl.oid = rep.resorigtbl
JOIN pg_attribute col ON col.attrelid = tbl.oid AND col.attnum = rep.resorigcol
JOIN pg_namespace sch ON sch.oid = tbl.relnamespace
GROUP BY sch.nspname, tbl.relname, rep.view_schema, rep.view_name,
         pks_fks.conname, pks_fks.contype, pks_fks.ncol
HAVING pks_fks.ncol = count(*)
`;
function stringArray(value) {
    if (Array.isArray(value))
        return value.map(String);
    if (typeof value !== 'string')
        return [];
    if (!value.startsWith('{') || !value.endsWith('}'))
        return value ? [value] : [];
    const body = value.slice(1, -1);
    return body ? body.split(',').map(item => item.replace(/^"|"$/g, '')) : [];
}
function decodeColumns(value) {
    let decoded = value;
    if (typeof decoded === 'string') {
        try {
            decoded = JSON.parse(decoded);
        }
        catch {
            return [];
        }
    }
    if (!Array.isArray(decoded))
        return [];
    const result = [];
    for (const item of decoded) {
        if (Array.isArray(item) && item.length >= 2) {
            result.push({ tableColumn: String(item[0]), viewColumns: stringArray(item[1]) });
            continue;
        }
        if (item && typeof item === 'object') {
            const record = item;
            const tableColumn = record.table_column ?? record.tableColumn;
            const viewColumns = record.view_columns ?? record.viewColumns;
            if (tableColumn != null)
                result.push({ tableColumn: String(tableColumn), viewColumns: stringArray(viewColumns) });
        }
    }
    return result;
}
function dependencyType(value) {
    return value === 'p' || value === 'f' || value === 'f_ref' ? value : null;
}
export function viewDependenciesFromCatalogRows(rows) {
    const result = [];
    for (const row of rows) {
        const type = dependencyType(row.constraint_type);
        if (!type)
            continue;
        const columns = decodeColumns(row.column_dependencies);
        if (!columns.length)
            continue;
        result.push({
            tableSchema: row.table_schema == null ? undefined : String(row.table_schema),
            tableName: String(row.table_name),
            viewSchema: row.view_schema == null ? undefined : String(row.view_schema),
            viewName: String(row.view_name),
            constraintName: String(row.constraint_name),
            type,
            columns,
        });
    }
    return result;
}
//# sourceMappingURL=view-relationship-catalog.js.map