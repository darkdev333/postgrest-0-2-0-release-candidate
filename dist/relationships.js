function sortedUnique(values) {
    return [...new Set(values)].sort();
}
function sameSet(a, b) {
    const aa = sortedUnique(a);
    const bb = sortedUnique(b);
    return aa.length === bb.length && aa.every((value, index) => value === bb[index]);
}
function groupsForTable(table) {
    const grouped = new Map();
    for (const fk of table.foreignKeys) {
        const key = `${fk.name}\u0000${fk.referencedTable}`;
        let group = grouped.get(key);
        if (!group) {
            group = {
                sourceTable: table.name,
                targetTable: fk.referencedTable,
                constraintName: fk.name,
                columnPairs: [],
            };
            grouped.set(key, group);
        }
        if (!group.columnPairs.some(pair => pair.source === fk.column && pair.target === fk.referencedColumn)) {
            group.columnPairs.push({ source: fk.column, target: fk.referencedColumn });
        }
    }
    return [...grouped.values()];
}
function directCardinality(table, group) {
    const sourceColumns = group.columnPairs.map(pair => pair.source);
    if (sameSet(sourceColumns, table.primaryKey))
        return 'one-to-one';
    const individuallyUnique = sourceColumns.length > 0 && sourceColumns.every(column => {
        const info = table.columns.get(column);
        return info?.isUnique === true || info?.isPrimaryKey === true;
    });
    return individuallyUnique ? 'one-to-one' : 'many-to-one';
}
function inverseCardinality(cardinality) {
    return cardinality === 'one-to-one' ? 'one-to-one' : 'one-to-many';
}
function directRelationships(tables) {
    const relationships = [];
    for (const table of tables.values()) {
        for (const group of groupsForTable(table)) {
            const direct = directCardinality(table, group);
            relationships.push({
                sourceTable: group.sourceTable,
                targetTable: group.targetTable,
                constraintName: group.constraintName,
                cardinality: direct,
                columnPairs: group.columnPairs,
                self: group.sourceTable === group.targetTable,
            });
            relationships.push({
                sourceTable: group.targetTable,
                targetTable: group.sourceTable,
                constraintName: group.constraintName,
                cardinality: inverseCardinality(direct),
                columnPairs: group.columnPairs.map(pair => ({ source: pair.target, target: pair.source })),
                self: group.sourceTable === group.targetTable,
            });
        }
    }
    return relationships;
}
function addManyToManyRelationships(tables, relationships) {
    for (const junctionTable of tables.values()) {
        const groups = groupsForTable(junctionTable);
        if (groups.length < 2)
            continue;
        for (let i = 0; i < groups.length; i += 1) {
            for (let j = i + 1; j < groups.length; j += 1) {
                const left = groups[i];
                const right = groups[j];
                if (left.targetTable === right.targetTable)
                    continue;
                const junctionColumns = [
                    ...left.columnPairs.map(pair => pair.source),
                    ...right.columnPairs.map(pair => pair.source),
                ];
                if (!sameSet(junctionColumns, junctionTable.primaryKey))
                    continue;
                relationships.push({
                    sourceTable: left.targetTable,
                    targetTable: right.targetTable,
                    constraintName: `${left.constraintName}:${right.constraintName}`,
                    cardinality: 'many-to-many',
                    columnPairs: [],
                    self: false,
                    junction: {
                        table: junctionTable.name,
                        sourceConstraint: left.constraintName,
                        targetConstraint: right.constraintName,
                        sourceColumns: left.columnPairs.map(pair => ({ source: pair.target, target: pair.source })),
                        targetColumns: right.columnPairs.map(pair => ({ source: pair.source, target: pair.target })),
                    },
                });
                relationships.push({
                    sourceTable: right.targetTable,
                    targetTable: left.targetTable,
                    constraintName: `${right.constraintName}:${left.constraintName}`,
                    cardinality: 'many-to-many',
                    columnPairs: [],
                    self: false,
                    junction: {
                        table: junctionTable.name,
                        sourceConstraint: right.constraintName,
                        targetConstraint: left.constraintName,
                        sourceColumns: right.columnPairs.map(pair => ({ source: pair.target, target: pair.source })),
                        targetColumns: left.columnPairs.map(pair => ({ source: pair.source, target: pair.target })),
                    },
                });
            }
        }
    }
}
/** Build a PostgREST-oriented relationship graph without silently resolving ambiguity. */
export function buildRelationships(tables) {
    const relationships = directRelationships(tables);
    addManyToManyRelationships(tables, relationships);
    return relationships;
}
export function isToOneRelationship(relationship) {
    return relationship.cardinality === 'many-to-one' || relationship.cardinality === 'one-to-one';
}
/** Return every matching candidate; ambiguity belongs to the planner/error layer. */
export function findRelationshipCandidates(relationships, sourceTable, targetTable, hint) {
    let candidates = relationships.filter(relationship => relationship.sourceTable === sourceTable && relationship.targetTable === targetTable);
    if (hint) {
        candidates = candidates.filter(relationship => {
            if (relationship.constraintName === hint)
                return true;
            if (relationship.columnPairs.some(pair => pair.source === hint || pair.target === hint))
                return true;
            if (relationship.junction) {
                return relationship.junction.sourceConstraint === hint || relationship.junction.targetConstraint === hint;
            }
            return false;
        });
    }
    return candidates;
}
export function foreignKeyRowsToPairs(rows) {
    return rows.map(row => ({ source: row.column, target: row.referencedColumn }));
}
//# sourceMappingURL=relationships.js.map