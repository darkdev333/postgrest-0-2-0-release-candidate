/** PostgREST-compatible PATCH compiler with explicit columns/missing semantics. */
import type { Filter,FilterOperator } from './parser.js';

export interface UpdateCompileOptions { schema?:string; columns?:string[]; missing?:'default'|'null'; returning?:'*'|string[]; }
export interface BuiltUpdate { sql:string; params:unknown[]; }
const OP:Partial<Record<FilterOperator,string>>={eq:'=',neq:'!=',gt:'>',gte:'>=',lt:'<',lte:'<=',like:'LIKE',ilike:'ILIKE',cs:'@>',cd:'<@',ov:'&&',sl:'<<',sr:'>>',nxl:'&<',nxr:'&>',adj:'-|-'};
const FTS:Partial<Record<FilterOperator,string>>={fts:'to_tsquery',plfts:'plainto_tsquery',phfts:'phraseto_tsquery',wfts:'websearch_to_tsquery'};
const q=(value:string)=>`"${value.replace(/"/g,'""')}"`;

export function buildUpdateStatement(table:string,data:Record<string,unknown>,filters:Filter[],options:UpdateCompileOptions={}):BuiltUpdate|null{
  const columns=options.columns??Object.keys(data);
  if(columns.length===0)return null;
  const params:unknown[]=[];
  const add=(value:unknown)=>{params.push(value);return '$' + params.length;};
  const assignments=columns.map(column=>{
    if(Object.prototype.hasOwnProperty.call(data,column))return`${q(column)} = ${add(data[column])}`;
    return options.missing==='default'?`${q(column)} = DEFAULT`:`${q(column)} = ${add(null)}`;
  });
  const where=filters.map(filter=>condition(filter,add)).filter(Boolean).join(' AND ');
  const schemaPrefix=options.schema?`${q(options.schema)}.`:'';
  let sql=`UPDATE ${schemaPrefix}${q(table)} SET ${assignments.join(', ')}`;
  if(where)sql+=` WHERE ${where}`;
  if(options.returning){const fields=options.returning==='*'?'*':options.returning.map(q).join(', ');sql+=` RETURNING ${fields}`;}
  return{sql,params};
}

function condition(filter:Filter,add:(value:unknown)=>string):string{
  const{column,operator,value,negate}=filter;
  if(operator==='or'||operator==='and'){const inner=(value as Filter[]).map(item=>condition(item,add)).filter(Boolean).join(operator==='or'?' OR ':' AND ');return negate?`NOT ((${inner}))`:`(${inner})`;}
  let result:string;
  if(operator==='is')result=value===null?`${q(column)} IS NULL`:value===true?`${q(column)} IS TRUE`:value===false?`${q(column)} IS FALSE`:`${q(column)} IS ${add(value)}`;
  else if(operator==='in')result=`${q(column)} IN (${(value as unknown[]).map(add).join(', ')})`;
  else if(operator==='like'||operator==='ilike')result=`${q(column)} ${OP[operator]} ${add(typeof value==='string'?value.replace(/\*/g,'%'):value)}`;
  else if(FTS[operator])result=`${q(column)} @@ ${FTS[operator]}(${add(value)})`;
  else result=`${q(column)} ${OP[operator]??'='} ${add(value)}`;
  return negate?`NOT (${result})`:result;
}
