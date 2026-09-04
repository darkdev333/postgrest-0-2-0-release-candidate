import { describe,expect,it } from 'vitest';
import { responsePreferences,type PreferHeader } from '../headers.js';

const all:PreferHeader={
  resolution:'merge-duplicates',
  return:'representation',
  count:'exact',
  missing:'default',
  tx:'rollback',
  handling:'strict',
  maxAffected:5,
};

describe('Preference-Applied applicability',()=>{
  it('reports only request-wide preferences for reads',()=>{
    expect(responsePreferences(all,'read')).toEqual({count:'exact',tx:'rollback',handling:'strict'});
  });

  it('reports insert resolution only when a conflict target exists',()=>{
    expect(responsePreferences(all,'insert')).toEqual({return:'representation',count:'exact',tx:'rollback',missing:'default',handling:'strict'});
    expect(responsePreferences(all,'insert',{hasConflictTarget:true})).toEqual({resolution:'merge-duplicates',return:'representation',count:'exact',tx:'rollback',missing:'default',handling:'strict'});
  });

  it('keeps update-specific missing and max-affected preferences',()=>{
    expect(responsePreferences(all,'update')).toEqual({return:'representation',count:'exact',tx:'rollback',missing:'default',handling:'strict',maxAffected:5});
  });

  it('drops missing and resolution for deletes',()=>{
    expect(responsePreferences(all,'delete')).toEqual({return:'representation',count:'exact',tx:'rollback',handling:'strict',maxAffected:5});
  });

  it('keeps max-affected for RPC but drops mutation representation preferences',()=>{
    expect(responsePreferences(all,'rpc')).toEqual({count:'exact',tx:'rollback',handling:'strict',maxAffected:5});
  });
});
