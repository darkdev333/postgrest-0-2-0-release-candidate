import { describe,expect,it,vi } from 'vitest';
import { createPostgRESTRouter } from '../router.js';
import type { SQLExecutor } from '../executor.js';

describe('RPC result shaping',()=>{
  it('keeps POST body arguments separate from result filters and executes the function once',async()=>{
    let shapedSql='',shapedParams:unknown[]=[];
    const sql=vi.fn(async(statement:string)=>{if(statement.includes('pg_catalog.pg_proc'))return{rows:[{oid:'1',proname:'search_items',proretset:true,returns_void:false,result_type:'SETOF record',proargnames:['term'],proargmodes:null,pronargs:1,pronargdefaults:0,arg_types:'text'}]};return{rows:[]};}) as unknown as SQLExecutor;
    sql.transaction=vi.fn(async callback=>callback(async(statement:string,params?:unknown[])=>{shapedSql=statement;shapedParams=params??[];return{rows:[{__pgrst_rows:[{id:12,name:'B'},{id:11,name:'A'}],__pgrst_count:'4',__pgrst_affected:'6'}]};}));
    const app=createPostgRESTRouter(sql,{cors:false,schemas:['api']});
    const res=await app.request('/rpc/search_items?select=id,name&id=gt.10&order=id.desc&limit=2&offset=1',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'count=exact'},body:JSON.stringify({term:'abc'})});
    expect(res.status).toBe(206);expect(await res.json()).toEqual([{id:12,name:'B'},{id:11,name:'A'}]);expect(res.headers.get('Content-Range')).toBe('1-2/4');expect((shapedSql.match(/"api"\."search_items"/g)??[]).length).toBe(1);expect(shapedSql).toContain('"id" > $2');expect(shapedParams).toEqual(['abc',10]);
  });

  it('separates GET named arguments from result filters/modifiers using routine metadata',async()=>{
    let shapedSql='',shapedParams:unknown[]=[];
    const sql=vi.fn(async(statement:string)=>statement.includes('pg_catalog.pg_proc')?{rows:[{oid:'9',proname:'search_items',proretset:true,returns_void:false,result_type:'SETOF record',proargnames:['term'],proargmodes:null,pronargs:1,pronargdefaults:0,arg_types:'text'}]}:{rows:[]}) as unknown as SQLExecutor;
    sql.transaction=vi.fn(async callback=>callback(async(statement:string,params?:unknown[])=>{shapedSql=statement;shapedParams=params??[];return{rows:[{__pgrst_rows:[{id:12}],__pgrst_count:'3',__pgrst_affected:'5'}]};}));
    const app=createPostgRESTRouter(sql,{cors:false,schemas:['api']});
    const res=await app.request('/rpc/search_items?term=abc&select=id&id=gt.10&order=id.desc',{headers:{Prefer:'count=exact',Range:'items=1-1'}});
    expect(res.status).toBe(206);expect(await res.json()).toEqual([{id:12}]);expect(res.headers.get('Content-Range')).toBe('1-1/3');expect((shapedSql.match(/"api"\."search_items"/g)??[]).length).toBe(1);expect(shapedSql).toContain('"id" > $2');expect(shapedSql).toContain('ORDER BY "id" DESC LIMIT 1 OFFSET 1');expect(shapedParams).toEqual(['abc',10]);
  });

  it('returns canonical PGRST202 for an unmatched GET RPC signature without invoking the function',async()=>{
    let invoked=false;
    const sql=vi.fn(async(statement:string)=>{
      if(statement.includes('pg_catalog.pg_proc'))return{rows:[{oid:'2',proname:'overloaded',proretset:false,returns_void:false,result_type:'integer',proargnames:['a','b'],proargmodes:null,pronargs:2,pronargdefaults:0,arg_types:'integer, integer'}]};
      invoked=true;return{rows:[]};
    }) as unknown as SQLExecutor;
    const app=createPostgRESTRouter(sql,{cors:false,schemas:['test']});
    const res=await app.request('/rpc/overloaded?wrong_arg=value');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({code:'PGRST202',details:'Searched for the function test.overloaded with parameter wrong_arg, but no matches were found in the schema cache.',hint:null,message:'Could not find the function test.overloaded(wrong_arg) in the schema cache'});
    expect(invoked).toBe(false);
  });

  it('uses Range header to override RPC limit/offset query params',async()=>{
    let shapedSql='';const sql=vi.fn(async(statement:string)=>statement.includes('pg_catalog.pg_proc')?{rows:[{oid:'1',proname:'search_items',proretset:true,returns_void:false,result_type:'SETOF record',proargnames:[],proargmodes:null,pronargs:0,pronargdefaults:0,arg_types:''}]}:{rows:[]}) as unknown as SQLExecutor;
    sql.transaction=vi.fn(async callback=>callback(async(statement:string)=>{shapedSql=statement;return{rows:[{__pgrst_rows:[{id:3},{id:4}],__pgrst_count:'10',__pgrst_affected:'10'}]};}));
    const app=createPostgRESTRouter(sql,{cors:false});const res=await app.request('/rpc/search_items?limit=9&offset=0',{method:'POST',headers:{'Content-Type':'application/json',Range:'items=2-3',Prefer:'count=exact'},body:'{}'});expect(res.headers.get('Content-Range')).toBe('2-3/10');expect(shapedSql).toContain('LIMIT 2 OFFSET 2');
  });
});
