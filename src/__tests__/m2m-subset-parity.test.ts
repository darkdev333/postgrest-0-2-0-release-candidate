import { describe, expect, it } from 'vitest'
import type { ColumnInfo, ForeignKeyInfo, TableSchema } from '../schema.js'
import { buildRelationships } from '../relationships.js'
import { relationshipsFromCatalogRows } from '../relationship-cache.js'

function columns(names: Array<[string, Partial<ColumnInfo>?]>): Map<string, ColumnInfo> {
  return new Map(names.map(([name, extra]) => [name, {
    name,
    type: 'integer',
    nullable: false,
    isPrimaryKey: false,
    isUnique: false,
    ...extra,
  }]))
}

function table(name: string, primaryKey: string[], foreignKeys: ForeignKeyInfo[], cols: Map<string, ColumnInfo>): TableSchema {
  return { name, schema: 'public', columns: cols, primaryKey, foreignKeys, indexes: [] }
}

describe('upstream many-to-many primary-key subset rule', () => {
  it('discovers in-memory M2M when FK columns are a subset of a wider junction primary key', () => {
    const users = table('users', ['id'], [], columns([['id', { isPrimaryKey: true }]]))
    const tasks = table('tasks', ['id'], [], columns([['id', { isPrimaryKey: true }]]))
    const userTaskRoles = table('user_task_roles', ['user_id', 'task_id', 'role_id'], [
      { name: 'user_task_roles_user_id_fkey', column: 'user_id', referencedTable: 'users', referencedColumn: 'id' },
      { name: 'user_task_roles_task_id_fkey', column: 'task_id', referencedTable: 'tasks', referencedColumn: 'id' },
    ], columns([
      ['user_id', { isPrimaryKey: true }],
      ['task_id', { isPrimaryKey: true }],
      ['role_id', { isPrimaryKey: true }],
    ]))

    const relationships = buildRelationships(new Map([
      ['users', users], ['tasks', tasks], ['user_task_roles', userTaskRoles],
    ]))
    const m2m = relationships.find(rel => rel.sourceTable === 'users' && rel.targetTable === 'tasks' && rel.cardinality === 'many-to-many')
    expect(m2m?.junction?.table).toBe('user_task_roles')
  })

  it('uses the same subset rule for catalog-backed relationships', () => {
    const relationships = relationshipsFromCatalogRows([
      { source_table: 'user_task_roles', target_table: 'users', constraint_name: 'user_task_roles_user_fkey', source_columns: ['user_id'], target_columns: ['id'], source_unique: false, source_primary_key: ['user_id', 'task_id', 'role_id'] },
      { source_table: 'user_task_roles', target_table: 'tasks', constraint_name: 'user_task_roles_task_fkey', source_columns: ['task_id'], target_columns: ['id'], source_unique: false, source_primary_key: ['user_id', 'task_id', 'role_id'] },
    ])
    const m2m = relationships.find(rel => rel.sourceTable === 'users' && rel.targetTable === 'tasks' && rel.cardinality === 'many-to-many')
    expect(m2m?.junction?.table).toBe('user_task_roles')
  })
})
