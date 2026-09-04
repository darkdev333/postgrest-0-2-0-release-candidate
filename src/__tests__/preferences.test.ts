import { describe,expect,it,vi } from 'vitest';
import { createPostgRESTRouter } from '../router.js';
import { parsePreferHeader } from '../headers.js';
import type { SQLExecutor } from '../executor.js';

describe('strict and transaction preferences',()=>{
  it('retains invalid tokens for strict validation',()=>{
    expect(parsePreferHeader('handling=strict, anything, foo=bar')).toMatchObject({handling:'strict',invalid:['anything','foo=bar']});
  });

  it('returns PGRST122 before executing SQL for unknown strict preferences',async()=>{
    const sql=vi.fn(async()=>({rows:[]})) as unknown as SQLExecutor;
    const app=createPostgRESTRouter(sql,{cors:false});
    // schema introspection is the only allowed executor work before request preference validation
    sql.mockImplementation(async(statement:string)=>statement.includes('information_schema')?{rows:[{table_name:'items',column_name:'id',data_type:'integer',is_nullable:'NO',column_default:null}]}:{rows:[]});
    const res=await app.request('http://local/items',{headers:{Prefer:'handling=strict, anything'}});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({code:'PGRST122',details:'Invalid preferences: anything',hint:null,message:'Invalid preferences given with handling=strict'});
  });

  it('ignores tx preference when dbTxEnd is disabled',async()=>{
    const sql=vi.fn(async(statement:string)=>statement.includes('information_schema')?{rows:[{table_name:'items',column_name:'id',data_type:'integer',is_nullable:'NO',column_default:null}]}:{rows:[]}) as unknown as SQLExecutor;
    const app=createPostgRESTRouter(sql,{cors:false});
    const res=await app.request('http://local/items',{headers:{Prefer:'tx=rollback'}});
    expect(res.status).toBe(200);
    // Upstream RollbackSpec: when tx override is disallowed, the tx preference is ignored and is not echoed.
    expect(res.headers.get('Preference-Applied')).toBeNull();
  });

  it('passes rollback disposition to a capable executor when enabled',async()=>{
    const sql=vi.fn(async(statement:string)=>statement.includes('information_schema')?{rows:[{table_name:'items',column_name:'id',data_type:'integer',is_nullable:'NO',column_default:null}]}:{rows:[]}) as unknown as SQLExecutor;
    sql.transaction=vi.fn(async(callback,context)=>{
      expect(context?.transactionEnd).toBe('rollback');
      return callback(async()=>({rows:[]}));
    });
    const app=createPostgRESTRouter(sql,{cors:false,dbTxEnd:true});
    const res=await app.request('http://local/items',{headers:{Prefer:'tx=rollback'}});
    expect(res.status).toBe(200);
    expect(res.headers.get('Preference-Applied')).toContain('tx=rollback');
  });
});
