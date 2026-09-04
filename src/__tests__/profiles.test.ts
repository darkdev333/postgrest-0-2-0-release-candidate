import { describe, expect, it } from 'vitest';
import { selectSchemaProfile } from '../profiles.js';

describe('schema profile selection', () => {
  const schemas = ['public', 'tenant2'] as const;

  it('uses Accept-Profile for GET and HEAD', () => {
    expect(selectSchemaProfile('GET', 'tenant2', null, schemas)).toEqual({ schema: 'tenant2' });
    expect(selectSchemaProfile('HEAD', 'tenant2', null, schemas)).toEqual({ schema: 'tenant2' });
  });

  it('uses Content-Profile for mutations', () => {
    expect(selectSchemaProfile('POST', null, 'tenant2', schemas)).toEqual({ schema: 'tenant2' });
    expect(selectSchemaProfile('PATCH', null, 'tenant2', schemas)).toEqual({ schema: 'tenant2' });
    expect(selectSchemaProfile('DELETE', null, 'tenant2', schemas)).toEqual({ schema: 'tenant2' });
  });

  it('defaults to the first configured schema', () => {
    expect(selectSchemaProfile('GET', null, null, schemas)).toEqual({ schema: 'public' });
  });

  it('returns PGRST106 for unconfigured schemas', () => {
    expect(selectSchemaProfile('GET', 'private', null, schemas).error).toEqual({
      code: 'PGRST106', details: null, hint: null,
      message: 'The schema must be one of the following: public, tenant2',
    });
  });
});
