import { describe,expect,it,vi } from 'vitest';
import { buildUpdateStatement } from '../update.js';
import { createPostgRESTRouter } from '../router.js';
import type { SQLExecutor } from '../executor.js';

describe('PATCH columns and missing semantics',()=>{
  it('ignores payload keys outside explicit columns',()=>{
    const built=buildUpdateStatement('articles',{body:'real',smth:'ignored',fake_id:13},[],{schema:'public',columns:['body']})!;
    expect(built.sql).toContain('SET "body" = $1');
    expect(built.sql).not.toContain('smth');
    expect(built.sql).not.toContain('fake_id');
    expect(built.params).toEqual(['real']);
  });

  it('uses DEFAULT for a listed but omitted key only with missing=default',()=>{
    const withDefault=buildUpdateStatement('complex_items',{name:'Tres'},[],{columns:['name','field-with_sep'],missing:'default'})!;
    expect(withDefault.sql).toContain('"name" = $1, "field-with_sep" = DEFAULT');
    expect(withDefault.params).toEqual(['Tres']);

    const withNull=buildUpdateStatement('complex_items',{name:'Tres'},[],{columns:['name','field-with_sep']})!;
    expect(withNull.sql).toContain('"field-with_sep" = $2');
    expect(withNull.params).toEqual(['Tres',null]);
  });

  it('returns null for an empty update target',()=>{
    expect(buildUpdateStatement('items',{},[],{})).toBeNull();
  });

  it('rejects unknown explicit columns before mutation',async()=>{
    let updates=0;
    const sql=vi.fn(async(statement:string)=>{
      if(statement.includes('information_schema.columns'))return{rows:[{table_name:'articles',column_name:'body',data_type:'text',is_nullable:'YES',column_default:null,character_maximum_length:null,numeric_precision:null,numeric_scale:null,is_primary_key:false,is_unique:false}]};
      if(statement.includes('information_schema.table_constraints'))return{rows:[]};
      if(/^UPDATE/i.test(statement))updates++;
      return{rows:[]};
    }) as unknown as SQLExecutor;
    const app=createPostgRESTRouter(sql,{cors:false});
    const res=await app.request('/articles?id=eq.1&columns=helicopter',{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({body:'yyy'})});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({code:'PGRST204',details:null,hint:null,message:"Could not find the 'helicopter' column of 'articles' in the schema cache"});
    expect(updates).toBe(0);
  });

  it('echoes canonical missing/default preference order on PATCH',async()=>{
    let updateSql='';
    const sql=vi.fn(async(statement:string)=>{
      if(statement.includes('information_schema.columns'))return{rows:[
        {table_name:'complex_items',column_name:'name',data_type:'text',is_nullable:'YES',column_default:null,character_maximum_length:null,numeric_precision:null,numeric_scale:null,is_primary_key:false,is_unique:false},
        {table_name:'complex_items',column_name:'field-with_sep',data_type:'text',is_nullable:'YES',column_default:"'default'::text",character_maximum_length:null,numeric_precision:null,numeric_scale:null,is_primary_key:false,is_unique:false},
      ]};
      if(statement.includes('information_schema.table_constraints'))return{rows:[]};
      if(/^UPDATE/i.test(statement)){updateSql=statement;return{rows:[{name:'Tres','field-with_sep':'default'}]};}
      return{rows:[]};
    }) as unknown as SQLExecutor;
    const app=createPostgRESTRouter(sql,{cors:false});
    const res=await app.request('/complex_items?id=eq.3&columns=name,field-with_sep',{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'missing=default, return=representation'},body:JSON.stringify({name:'Tres'})});
    expect(res.status).toBe(200);
    expect(res.headers.get('Preference-Applied')).toBe('missing=default, return=representation');
    expect(updateSql).toContain('"field-with_sep" = DEFAULT');
  });
});
