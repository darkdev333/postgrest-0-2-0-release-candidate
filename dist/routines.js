function asStringArray(value) { if (Array.isArray(value))
    return value.map(v => String(v ?? '')); if (typeof value !== 'string' || !value)
    return []; return value.replace(/^\{|\}$/g, '').split(',').map(v => v.replace(/^"|"$/g, '')); }
function inputArgNames(names, modes, pronargs) { if (!modes.length)
    return names.slice(0, pronargs); const out = []; for (let i = 0; i < names.length; i++) {
    const mode = modes[i] ?? 'i';
    if (mode === 'i' || mode === 'b' || mode === 'v')
        out.push(names[i] ?? '');
} return out.slice(0, pronargs); }
export class RoutineCache {
    sql;
    ttl;
    cache = new Map();
    constructor(sql, ttl = 60000) {
        this.sql = sql;
        this.ttl = ttl;
    }
    async get(schema, name) {
        const key = `${schema}.${name}`, now = Date.now(), existing = this.cache.get(key);
        if (existing && existing.expires > now)
            return existing.routines;
        const result = await this.sql(`
 SELECT p.oid::text AS oid,p.proname,p.proretset,(p.prorettype='pg_catalog.void'::regtype) AS returns_void,
        pg_get_function_result(p.oid) AS result_type,p.proargnames,p.proargmodes,p.pronargs,p.pronargdefaults,
        pg_catalog.oidvectortypes(p.proargtypes) AS arg_types
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname=$1 AND p.proname=$2
 `, [schema, name]);
        const routines = result.rows.map(row => { const names = asStringArray(row.proargnames), modes = asStringArray(row.proargmodes), pronargs = Number(row.pronargs ?? 0), defaults = Number(row.pronargdefaults ?? 0), argNames = inputArgNames(names, modes, pronargs), argTypes = String(row.arg_types ?? '').split(',').map(v => v.trim()).filter(Boolean), requiredCount = Math.max(0, pronargs - defaults); return { oid: String(row.oid ?? ''), name: String(row.proname ?? name), schema, returnsSet: row.proretset === true || row.proretset === 't', returnsVoid: row.returns_void === true || row.returns_void === 't', resultType: String(row.result_type ?? ''), argNames, argTypes, requiredArgNames: argNames.slice(0, requiredCount).filter(Boolean), hasUnnamedArgs: argNames.length < pronargs || argNames.some(v => !v) }; });
        this.cache.set(key, { expires: now + this.ttl, routines });
        return routines;
    }
    clear() { this.cache.clear(); }
}
export function matchRoutineByNamedArgs(routines, argNames) { const supplied = new Set(argNames), candidates = routines.filter(r => !r.hasUnnamedArgs && [...supplied].every(k => r.argNames.includes(k)) && r.requiredArgNames.every(k => supplied.has(k))); if (candidates.length === 1)
    return { routine: candidates[0], ambiguous: false, candidates }; return { ambiguous: candidates.length > 1, candidates }; }
export function routineSignature(routine) { return `${routine.schema}.${routine.name}(${routine.argNames.map((name, i) => `${name} => ${routine.argTypes[i] ?? 'unknown'}`).join(', ')})`; }
//# sourceMappingURL=routines.js.map