import { describe, expect, it, vi } from 'vitest';
import { createPostgRESTRouter } from '../router.js';
import type { SQLExecutor } from '../executor.js';

function mock(rows: Record<string, unknown>[]) {
  let rolledBack = false;
  const sql = vi.fn(async (statement: string) => {
    if (statement.includes('information_schema.columns')) return { rows: [
      { table_name:'items',column_name:'id',data_type:'integer',is_nullable:'NO',column_default:null,character_maximum_length:null,numeric_precision:32,numeric_scale:0,is_primary_key:true,is_unique:true },
      { table_name:'items',column_name:'name',data_type:'text',is_nullable:'YES',column_default:null,character_maximum_length:null,numeric_precision:null,numeric_scale:null,is_primary_key:false,is_unique:false },
    ] };
    if (statement.includes('information_schema.table_constraints')) return { rows: [] };
    return { rows: [] };
  }) as unknown as SQLExecutor;
  sql.transaction = vi.fn(async callback => {
    try { return await callback(async () => ({ rows })); }
    catch (error) { rolledBack = true; throw error; }
  });
  return { sql, get rolledBack(){ return rolledBack; } };
}

describe('Prefer: max-affected', () => {
  it('rolls back and returns canonical PGRST124 when strict limit is exceeded', async () => {
    const db = mock(Array.from({ length: 14 }, (_,i) => ({ id:i+1 })));
    const app = createPostgRESTRouter(db.sql,{cors:false});
    const res = await app.request('/items?id=lt.15',{method:'DELETE',headers:{Prefer:'handling=strict, max-affected=10'}});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({code:'PGRST124',details:'The query affects 14 rows',hint:null,message:'Query result exceeds max-affected preference constraint'});
    expect(db.rolledBack).toBe(true);
  });

  it('succeeds at or below strict max and echoes both applied preferences', async () => {
    const db = mock([{id:1}]);
    const app = createPostgRESTRouter(db.sql,{cors:false});
    const res = await app.request('/items?id=eq.1',{method:'DELETE',headers:{Prefer:'handling=strict, max-affected=1'}});
    expect(res.status).toBe(204);
    expect(res.headers.get('Preference-Applied')).toContain('handling=strict, max-affected=1');
    expect(db.rolledBack).toBe(false);
  });

  it('ignores max-affected under lenient handling and only echoes handling=lenient', async () => {
    const db = mock(Array.from({length:14},(_,i)=>({id:i+1})));
    const app = createPostgRESTRouter(db.sql,{cors:false});
    const res = await app.request('/items?id=lt.15',{method:'DELETE',headers:{Prefer:'handling=lenient, max-affected=10'}});
    expect(res.status).toBe(204);
    expect(res.headers.get('Preference-Applied')).toBe('handling=lenient');
    expect(db.rolledBack).toBe(false);
  });

  it('refuses strict max-affected before mutation without transaction capability', async () => {
    let mutations=0;
    const sql = vi.fn(async (statement:string) => {
      if(statement.includes('information_schema.columns')) return {rows:[{table_name:'items',column_name:'id',data_type:'integer',is_nullable:'NO',column_default:null,character_maximum_length:null,numeric_precision:32,numeric_scale:0,is_primary_key:true,is_unique:true}]};
      if(statement.includes('information_schema.table_constraints')) return {rows:[]};
      if(/^(UPDATE|DELETE)/i.test(statement)) mutations++;
      return {rows:[]};
    }) as unknown as SQLExecutor;
    const app=createPostgRESTRouter(sql,{cors:false});
    const res=await app.request('/items',{method:'DELETE',headers:{Prefer:'handling=strict, max-affected=0'}});
    expect(res.status).toBe(501);
    expect(mutations).toBe(0);
  });
});
