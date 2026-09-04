import { describe,expect,it,vi } from 'vitest';
import { createPostgRESTRouter } from '../router.js';
import type { SQLExecutor } from '../executor.js';

function rpcMock(options:{page?:Record<string,unknown>[];affected?:number;returnsVoid?:boolean}={}){
  let rolledBack=false,rpcCalls=0;
  const sql=vi.fn(async(statement:string)=>statement.includes('pg_catalog.pg_proc')?{rows:[{proname:'do_work',proretset:!options.returnsVoid,returns_void:!!options.returnsVoid,result_type:options.returnsVoid?'void':'SETOF record'}]}:{rows:[]}) as unknown as SQLExecutor;
  sql.transaction=vi.fn(async callback=>{try{return await callback(async(statement:string)=>{if(statement.includes('"do_work"'))rpcCalls++;return{rows:[{__pgrst_rows:options.page??[],__pgrst_count:String(options.page?.length??0),__pgrst_affected:String(options.affected??options.page?.length??0)}]};});}catch(error){rolledBack=true;throw error;}});
  return{sql,get rolledBack(){return rolledBack;},get rpcCalls(){return rpcCalls;}};
}

describe('RPC max-affected',()=>{
  it('uses unpaged affected count and rolls back overflow with PGRST124',async()=>{
    const db=rpcMock({page:[{id:1}],affected:15});
    const app=createPostgRESTRouter(db.sql,{cors:false});
    const res=await app.request('/rpc/do_work?limit=1',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'handling=strict, max-affected=10'},body:'{}'});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({code:'PGRST124',details:'The query affects 15 rows'});
    expect(db.rolledBack).toBe(true);
  });
  it('returns PGRST128 for known void RPC before invoking it',async()=>{
    const db=rpcMock({returnsVoid:true});const app=createPostgRESTRouter(db.sql,{cors:false});
    const res=await app.request('/rpc/do_work',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'handling=strict, max-affected=20'},body:'{}'});
    expect(res.status).toBe(400);expect(await res.json()).toMatchObject({code:'PGRST128'});expect(db.rpcCalls).toBe(0);
  });
  it('succeeds at the strict affected limit',async()=>{
    const db=rpcMock({page:[{id:1},{id:2}],affected:2});const app=createPostgRESTRouter(db.sql,{cors:false});
    const res=await app.request('/rpc/do_work',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'handling=strict, max-affected=2'},body:'{}'});
    expect(res.status).toBe(200);expect(res.headers.get('Preference-Applied')).toContain('handling=strict, max-affected=2');expect(db.rolledBack).toBe(false);
  });
});
