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
export declare function selectSchemaProfile(method: string, acceptProfile: string | null | undefined, contentProfile: string | null | undefined, allowedSchemas: readonly string[]): SchemaProfileSelection;
//# sourceMappingURL=profiles.d.ts.map