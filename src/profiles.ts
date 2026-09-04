/** PostgREST schema profile selection. */

export interface SchemaProfileSelection {
  schema?: string;
  error?: {
    code: 'PGRST106';
    details: null;
    hint: null;
    message: string;
  };
}

export function selectSchemaProfile(
  method: string,
  acceptProfile: string | null | undefined,
  contentProfile: string | null | undefined,
  allowedSchemas: readonly string[],
): SchemaProfileSelection {
  const defaultSchema = allowedSchemas[0] ?? 'public';
  const requested = method === 'GET' || method === 'HEAD' ? acceptProfile : contentProfile;
  const schema = requested?.trim() || defaultSchema;

  if (!allowedSchemas.includes(schema)) {
    return {
      error: {
        code: 'PGRST106',
        details: null,
        hint: null,
        message: `The schema must be one of the following: ${allowedSchemas.join(', ')}`,
      },
    };
  }

  return { schema };
}
