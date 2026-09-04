import { describe,expect,it } from 'vitest';
import { matchRoutineByNamedArgs,type RoutineInfo } from '../routines.js';

const r=(oid:string,argNames:string[],requiredArgNames:string[]=argNames):RoutineInfo=>({oid,name:'f',schema:'public',returnsSet:false,returnsVoid:false,resultType:'integer',argNames,argTypes:argNames.map(()=> 'integer'),requiredArgNames,hasUnnamedArgs:false});

describe('PostgREST named RPC overload matching',()=>{
  it('does not prefer an exact arity when another overload also matches through defaults',()=>{
    const match=matchRoutineByNamedArgs([r('1',['a']),r('2',['a','b'],['a'])],['a']);
    expect(match.ambiguous).toBe(true);
    expect(match.candidates.map(v=>v.oid)).toEqual(['1','2']);
  });
  it('matches a routine when required args are present and optional args are omitted',()=>{
    const match=matchRoutineByNamedArgs([r('1',['a','b'],['a'])],['a']);
    expect(match.routine?.oid).toBe('1');
  });
  it('does not use PostgreSQL argument types to break same-name ambiguity',()=>{
    const a={...r('1',['value']),argTypes:['integer']};
    const b={...r('2',['value']),argTypes:['text']};
    expect(matchRoutineByNamedArgs([a,b],['value']).ambiguous).toBe(true);
  });
});
