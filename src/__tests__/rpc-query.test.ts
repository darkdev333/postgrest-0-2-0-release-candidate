import { describe,expect,it } from 'vitest';
import { PostgrestParser } from '../parser.js';
import { buildRpcEnvelopeQuery,decodeRpcEnvelope,partitionGetRpcParams } from '../rpc.js';
import { matchRoutineByNamedArgs,routineSignature,type RoutineInfo } from '../routines.js';

describe('single-execution RPC result query',()=>{
  it('materializes one function call and applies result filters/order/range',()=>{
    const query=new PostgrestParser().parse(new URLSearchParams('select=id,name&id=gt.10&order=id.desc&limit=5&offset=2'));
    const built=buildRpcEnvelopeQuery('search_items',{term:'abc'},query,{schema:'api',defaultLimit:100,maxLimit:1000});
    expect((built.sql.match(/"api"\."search_items"/g)??[]).length).toBe(1);
    expect(built.sql).toContain('"id" > $2');
    expect(built.sql).toContain('ORDER BY "id" DESC LIMIT 5 OFFSET 2');
    expect(built.sql).toContain('COUNT(*) FROM "__pgrst_filtered"');
    expect(built.sql).toContain('COUNT(*) FROM "__pgrst_rpc"');
    expect(built.params).toEqual(['abc',10]);
  });

  it('applies JSON-path filters and ordering to RPC result rows',()=>{
    const query=new PostgrestParser().parse(new URLSearchParams('data->foo->>bar=eq.baz&order=data->items->>0.desc'));
    const built=buildRpcEnvelopeQuery('search_items',{},query,{schema:'api'});
    expect(built.sql).toContain(`"data"->'foo'->>'bar' = $1`);
    expect(built.sql).toContain(`ORDER BY "data"->'items'->>0 DESC`);
    expect(built.params).toEqual(['baz']);
  });

  it('projects RPC JSON paths, casts, and aliases with PostgREST output names',()=>{
    const query=new PostgrestParser().parse(new URLSearchParams('select=settings->foo->>bar,myInt:settings->foo->>int::integer,data->>0::int'));
    const built=buildRpcEnvelopeQuery('search_items',{},query,{schema:'api'});
    expect(built.sql).toContain(`"settings"->'foo'->>'bar' AS "bar"`);
    expect(built.sql).toContain(`CAST("settings"->'foo'->>'int' AS integer) AS "myInt"`);
    expect(built.sql).toContain(`CAST("data"->>0 AS int) AS "data"`);
  });

  it('partitions GET function args from result modifiers and filters',()=>{
    const routine:RoutineInfo={oid:'1',name:'search_items',schema:'api',returnsSet:true,returnsVoid:false,resultType:'SETOF api.items',argNames:['term','limit_hint'],argTypes:['text','integer'],requiredArgNames:['term'],hasUnnamedArgs:false};
    const partition=partitionGetRpcParams(new URLSearchParams('term=abc&select=id,name&id=eq.4&order=id.desc&limit_hint=9'),routine);
    expect(partition.args).toEqual({term:'abc',limit_hint:'9'});
    expect(partition.resultParams.toString()).toContain('select=id%2Cname');
    expect(partition.resultParams.get('id')).toBe('eq.4');
    expect(partition.resultParams.get('order')).toBe('id.desc');
  });

  it('matches a unique overload by required and supplied named args',()=>{
    const routines:RoutineInfo[]=[
      {oid:'1',name:'f',schema:'api',returnsSet:false,returnsVoid:false,resultType:'integer',argNames:['a'],argTypes:['integer'],requiredArgNames:['a'],hasUnnamedArgs:false},
      {oid:'2',name:'f',schema:'api',returnsSet:false,returnsVoid:false,resultType:'text',argNames:['a','b'],argTypes:['text','text'],requiredArgNames:['a','b'],hasUnnamedArgs:false},
    ];
    const match=matchRoutineByNamedArgs(routines,['a']);
    expect(match.ambiguous).toBe(false);
    expect(match.routine?.oid).toBe('1');
    expect(routineSignature(match.routine!)).toBe('api.f(a => integer)');
  });

  it('reports ambiguous overloads when names cannot disambiguate types',()=>{
    const routines:RoutineInfo[]=[
      {oid:'1',name:'f',schema:'api',returnsSet:false,returnsVoid:false,resultType:'integer',argNames:['a'],argTypes:['integer'],requiredArgNames:['a'],hasUnnamedArgs:false},
      {oid:'2',name:'f',schema:'api',returnsSet:false,returnsVoid:false,resultType:'text',argNames:['a'],argTypes:['text'],requiredArgNames:['a'],hasUnnamedArgs:false},
    ];
    expect(matchRoutineByNamedArgs(routines,['a']).ambiguous).toBe(true);
  });

  it('decodes JSON/string envelope rows and numeric counts',()=>{
    expect(decodeRpcEnvelope({__pgrst_rows:'[{"id":1}]',__pgrst_count:'3',__pgrst_affected:'5'})).toEqual({rows:[{id:1}],count:3,affected:5});
  });
});
