import { PostgrestParser } from './parser.js';
import type { ReadPlan } from './read-plan.js';
export declare class ReadQueryPathError extends Error {
    readonly code = "PGRST108";
    readonly resource: string;
    readonly hintText: string;
    readonly detailsText: string | null;
    constructor(resource: string, hintText?: string, detailsText?: string | null);
}
export declare class RelatedOrderError extends Error {
    readonly code = "PGRST118";
    readonly parent: string;
    readonly resource: string;
    constructor(parent: string, resource: string);
}
export declare function applyReadQueryParams(plan: ReadPlan, searchParams: URLSearchParams, parser?: PostgrestParser): ReadPlan;
//# sourceMappingURL=read-query.d.ts.map