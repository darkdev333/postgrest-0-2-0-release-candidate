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


  it('keeps PATCH target filters aligned with upstream read/RPC operators',()=>{
    const built=buildUpdateStatement('items',{status:'done'},[
      {column:'name',operator:'imatch',value:'^a'},
      {column:'window',operator:'nxl',value:'[4,7]'},
      {column:'done',operator:'is',value:'unknown'},
      {column:'body',operator:'fts',value:'fat cats',config:'english'},
      {column:'id',operator:'eq',value:'{3,4,5}',quantifier:'any'},
      {column:'state',operator:'isdistinct',value:'archived'},
    ],{schema:'public'})!;
    expect(built.sql).toContain('"name" ~* $2');
    expect(built.sql).toContain('"window" &> $3');
    expect(built.sql).toContain('"done" IS UNKNOWN');
    expect(built.sql).toContain('"body" @@ to_tsquery($4, $5)');
    expect(built.sql).toContain('"id" = ANY($6)');
    expect(built.sql).toContain('"state" IS DISTINCT FROM $7');
    expect(built.params).toEqual(['done','^a','[4,7]','english','fat cats','{3,4,5}','archived']);
  });

  it('uses canonical neq/nxl/nxr spellings on PATCH filters',()=>{
    const built=buildUpdateStatement('items',{status:'done'},[
      {column:'old_status',operator:'neq',value:'deleted'},
      {column:'left_range',operator:'nxl',value:'[1,2]'},
      {column:'right_range',operator:'nxr',value:'[3,4]'},
    ])!;
    expect(built.sql).toContain('"old_status" <> $2');
    expect(built.sql).toContain('"left_range" &> $3');
    expect(built.sql).toContain('"right_range" &< $4');
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
