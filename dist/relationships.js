function sortedUnique(values) {
    return [...new Set(values)].sort();
}
function sameSet(a, b) {
    const aa = sortedUnique(a);
    const bb = sortedUnique(b);
    return aa.length === bb.length && aa.every((value, index) => value === bb[index]);
}
function isSubset(values, container) {
    const unique = sortedUnique(values);
    return unique.length > 0 && unique.every(value => container.includes(value));
}
function sameRelation(aSchema, aTable, bSchema, bTable) {
    return aTable === bTable && (!aSchema || !bSchema || aSchema === bSchema);
}
function groupsForTable(table) {
    const grouped = new Map();
    for (const fk of table.foreignKeys) {
        const key = `${fk.name}\u0000${fk.referencedTable}`;
        let group = grouped.get(key);
        if (!group) {
            group = {
                sourceSchema: table.schema,
                sourceTable: table.name,
                targetSchema: table.schema,
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
                sourceSchema: group.sourceSchema,
                sourceTable: group.sourceTable,
                targetSchema: group.targetSchema,
                targetTable: group.targetTable,
                constraintName: group.constraintName,
                cardinality: direct,
                columnPairs: group.columnPairs,
                self: sameRelation(group.sourceSchema, group.sourceTable, group.targetSchema, group.targetTable),
            });
            relationships.push({
                sourceSchema: group.targetSchema,
                sourceTable: group.targetTable,
                targetSchema: group.sourceSchema,
                targetTable: group.sourceTable,
                constraintName: group.constraintName,
                cardinality: inverseCardinality(direct),
                columnPairs: group.columnPairs.map(pair => ({ source: pair.target, target: pair.source })),
                self: sameRelation(group.sourceSchema, group.sourceTable, group.targetSchema, group.targetTable),
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
                const junctionColumns = [
                    ...left.columnPairs.map(pair => pair.source),
                    ...right.columnPairs.map(pair => pair.source),
                ];
                // Upstream SchemaCache.addM2MRels accepts a junction when the FK-column
                // union is contained in the primary key; the PK may contain additional
                // columns. Equality here incorrectly hid valid relationships.
                if (!isSubset(junctionColumns, junctionTable.primaryKey))
                    continue;
                relationships.push({
                    sourceSchema: left.targetSchema,
                    sourceTable: left.targetTable,
                    targetSchema: right.targetSchema,
                    targetTable: right.targetTable,
                    constraintName: `${left.constraintName}:${right.constraintName}`,
                    cardinality: 'many-to-many',
                    columnPairs: [],
                    self: sameRelation(left.targetSchema, left.targetTable, right.targetSchema, right.targetTable),
                    junction: {
                        schema: junctionTable.schema,
                        table: junctionTable.name,
                        sourceConstraint: left.constraintName,
                        targetConstraint: right.constraintName,
                        sourceColumns: left.columnPairs.map(pair => ({ source: pair.target, target: pair.source })),
                        targetColumns: right.columnPairs.map(pair => ({ source: pair.source, target: pair.target })),
                    },
                });
                relationships.push({
                    sourceSchema: right.targetSchema,
                    sourceTable: right.targetTable,
                    targetSchema: left.targetSchema,
                    targetTable: left.targetTable,
                    constraintName: `${right.constraintName}:${left.constraintName}`,
                    cardinality: 'many-to-many',
                    columnPairs: [],
                    self: sameRelation(right.targetSchema, right.targetTable, left.targetSchema, left.targetTable),
                    junction: {
                        schema: junctionTable.schema,
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
function singleColumnMatch(relationship, side, value) {
    return relationship.columnPairs.length === 1 && relationship.columnPairs[0]?.[side] === value;
}
function isDirectRelationship(relationship) {
    return relationship.cardinality !== 'many-to-many';
}
/**
 * Match PostgREST relationship selectors/hints using upstream `findRel` semantics.
 *
 * For ordinary relationships, an unhinted selector may be the target table, the
 * constraint name, or (for a single-column FK) the FK column on the origin.
 * The deprecated constraint/FK-column-as-target forms are not available when
 * the foreign relation is a view, matching upstream `not relFTableIsView`.
 * Once `!hint` is present, the selector itself must name the target relation and
 * the hint may name the constraint, either single FK column, or an M2M junction.
 *
 * Self relationships are intentionally asymmetric, matching upstream: the
 * to-one side is selected by its FK column (`parent(...)`), while the inverse
 * to-many side is selected by the table name and disambiguated with the FK
 * column (`children:table!parent(...)`). Upstream still marks self O2O/M2M
 * disambiguation as TODO, so we do not invent behavior for those cases here.
 */
export function findRelationshipCandidates(relationships, sourceTable, targetSelector, hint) {
    const computed = relationships.filter(relationship => relationship.sourceTable === sourceTable
        && relationship.computed?.functionName === targetSelector);
    if (computed.length)
        return computed;
    return relationships.filter(relationship => {
        if (relationship.sourceTable !== sourceTable || relationship.computed)
            return false;
        if (relationship.self) {
            if (!hint) {
                if (relationship.cardinality === 'one-to-many') {
                    return targetSelector === relationship.targetTable;
                }
                if (relationship.cardinality === 'many-to-one') {
                    return singleColumnMatch(relationship, 'source', targetSelector);
                }
                return false;
            }
            return relationship.cardinality === 'one-to-many'
                && targetSelector === relationship.targetTable
                && singleColumnMatch(relationship, 'target', hint);
        }
        if (!hint) {
            return targetSelector === relationship.targetTable
                || (!relationship.targetIsView && isDirectRelationship(relationship) && relationship.constraintName === targetSelector)
                || (!relationship.targetIsView && isDirectRelationship(relationship) && singleColumnMatch(relationship, 'source', targetSelector));
        }
        if (targetSelector !== relationship.targetTable)
            return false;
        if (isDirectRelationship(relationship) && relationship.constraintName === hint)
            return true;
        if (isDirectRelationship(relationship) && singleColumnMatch(relationship, 'source', hint))
            return true;
        if (isDirectRelationship(relationship) && singleColumnMatch(relationship, 'target', hint))
            return true;
        if (relationship.cardinality === 'many-to-many' && relationship.junction?.table === hint)
            return true;
        return false;
    });
}
export function foreignKeyRowsToPairs(rows) {
    return rows.map(row => ({ source: row.column, target: row.referencedColumn }));
}
//# sourceMappingURL=relationships.js.map