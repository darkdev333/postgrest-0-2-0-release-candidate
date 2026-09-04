/** PostgREST schema profile selection. */
export function selectSchemaProfile(method, acceptProfile, contentProfile, allowedSchemas) {
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
//# sourceMappingURL=profiles.js.map