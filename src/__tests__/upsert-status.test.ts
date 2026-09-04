import { describe,expect,it } from 'vitest';
import { getResponseStatus } from '../headers.js';

describe('merge-upsert response status',()=>{
  it('returns 200 when execution metadata says a merge-upsert inserted no rows',()=>{
    expect(getResponseStatus('POST',2,{resolution:'merge-duplicates'},{insertedCount:0})).toBe(200);
  });
  it('returns 201 when a merge-upsert inserted at least one row',()=>{
    expect(getResponseStatus('POST',2,{resolution:'merge-duplicates'},{insertedCount:1})).toBe(201);
  });
  it('conservatively keeps 201 when inserted-vs-updated metadata is unavailable',()=>{
    expect(getResponseStatus('POST',2,{resolution:'merge-duplicates'})).toBe(201);
  });
  it('does not turn ignore-duplicates into 200 merely because no row was inserted',()=>{
    expect(getResponseStatus('POST',0,{resolution:'ignore-duplicates'},{insertedCount:0})).toBe(201);
  });
});
