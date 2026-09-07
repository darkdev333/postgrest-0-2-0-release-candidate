export function qualifiedRelationKey(schema, table) {
    return `${schema ?? ''}\u0000${table}`;
}
function dependencyMatches(dependency, tableSchema, tableName, constraintName, type) {
    if (dependency.tableName !== tableName || dependency.constraintName !== constraintName || dependency.type !== type)
        return false;
    // Schema-less RelationshipInfo values are kept as a legacy/unit-test wildcard.
    return !tableSchema || !dependency.tableSchema || dependency.tableSchema === tableSchema;
}
/** Expand one base-key -> many view-column mapping like upstream `traverse snd`. */
export function expandViewColumnDependencies(columns) {
    let combinations = [[]];
    for (const column of columns) {
        const next = [];
        for (const combination of combinations) {
            for (const viewColumn of column.viewColumns)
                next.push([...combination, { source: column.tableColumn, target: viewColumn }]);
        }
        combinations = next;
    }
    return combinations;
}
/** Port of upstream SchemaCache.addViewM2OAndO2ORels for direct M2O/O2O relationships. */
export function deriveViewRelationships(directRelationships, dependencies) {
    const derived = [];
    for (const relationship of directRelationships) {
        if (relationship.computed)
            continue;
        if (relationship.cardinality !== 'many-to-one' && relationship.cardinality !== 'one-to-one')
            continue;
        const viewTableDeps = dependencies.filter(dependency => dependencyMatches(dependency, relationship.sourceSchema, relationship.sourceTable, relationship.constraintName, 'f'));
        const tableViewDeps = dependencies.filter(dependency => dependencyMatches(dependency, relationship.targetSchema, relationship.targetTable, relationship.constraintName, 'f_ref'));
        for (const dependency of viewTableDeps) {
            for (const mapping of expandViewColumnDependencies(dependency.columns)) {
                derived.push({
                    sourceSchema: dependency.viewSchema,
                    sourceTable: dependency.viewName,
                    targetSchema: relationship.targetSchema,
                    targetTable: relationship.targetTable,
                    constraintName: relationship.constraintName,
                    cardinality: relationship.cardinality,
                    columnPairs: relationship.columnPairs.map((pair, index) => ({ source: mapping[index]?.target ?? '', target: pair.target })),
                    self: dependency.viewName === relationship.targetTable && (!dependency.viewSchema || !relationship.targetSchema || dependency.viewSchema === relationship.targetSchema),
                    sourceIsView: true,
                    targetIsView: relationship.targetIsView ?? false,
                });
            }
        }
        for (const dependency of tableViewDeps) {
            for (const mapping of expandViewColumnDependencies(dependency.columns)) {
                derived.push({
                    sourceSchema: relationship.sourceSchema,
                    sourceTable: relationship.sourceTable,
                    targetSchema: dependency.viewSchema,
                    targetTable: dependency.viewName,
                    constraintName: relationship.constraintName,
                    cardinality: relationship.cardinality,
                    columnPairs: relationship.columnPairs.map((pair, index) => ({ source: pair.source, target: mapping[index]?.target ?? '' })),
                    self: relationship.sourceTable === dependency.viewName && (!relationship.sourceSchema || !dependency.viewSchema || relationship.sourceSchema === dependency.viewSchema),
                    sourceIsView: relationship.sourceIsView ?? false,
                    targetIsView: true,
                });
            }
        }
        for (const sourceDependency of viewTableDeps) {
            for (const sourceMapping of expandViewColumnDependencies(sourceDependency.columns)) {
                for (const targetDependency of tableViewDeps) {
                    for (const targetMapping of expandViewColumnDependencies(targetDependency.columns)) {
                        derived.push({
                            sourceSchema: sourceDependency.viewSchema,
                            sourceTable: sourceDependency.viewName,
                            targetSchema: targetDependency.viewSchema,
                            targetTable: targetDependency.viewName,
                            constraintName: relationship.constraintName,
                            cardinality: relationship.cardinality,
                            columnPairs: relationship.columnPairs.map((_, index) => ({ source: sourceMapping[index]?.target ?? '', target: targetMapping[index]?.target ?? '' })),
                            self: sourceDependency.viewName === targetDependency.viewName
                                && (!sourceDependency.viewSchema || !targetDependency.viewSchema || sourceDependency.viewSchema === targetDependency.viewSchema),
                            sourceIsView: true,
                            targetIsView: true,
                        });
                    }
                }
            }
        }
    }
    return derived.filter(relationship => relationship.columnPairs.every(pair => pair.source && pair.target));
}
/** Upstream addViewPrimaryKeys chooses the first view reference per PK column. */
export function viewPrimaryKeys(dependencies) {
    const result = new Map();
    for (const dependency of dependencies) {
        if (dependency.type !== 'p')
            continue;
        const columns = dependency.columns.map(column => column.viewColumns[0]).filter((column) => Boolean(column));
        if (!columns.length)
            continue;
        const qualified = qualifiedRelationKey(dependency.viewSchema, dependency.viewName);
        const existingQualified = result.get(qualified) ?? [];
        result.set(qualified, [...existingQualified, ...columns]);
        // Preserve the historical name-only key for schema-less consumers/tests.
        if (!result.has(dependency.viewName))
            result.set(dependency.viewName, [...columns]);
    }
    return result;
}
//# sourceMappingURL=view-relationships.js.map