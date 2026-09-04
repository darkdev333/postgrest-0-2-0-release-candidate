/** PostgREST media-type negotiation helpers. */
export const JSON_MEDIA_TYPE = 'application/json';
export const SINGULAR_MEDIA_TYPE = 'application/vnd.pgrst.object+json';
export const SINGULAR_MEDIA_TYPE_SHORT = 'application/vnd.pgrst.object';
export function acceptsSingularObject(header) {
    if (!header)
        return false;
    return header
        .split(',')
        .map(value => value.trim().split(';', 1)[0]?.toLowerCase())
        .some(value => value === SINGULAR_MEDIA_TYPE || value === SINGULAR_MEDIA_TYPE_SHORT);
}
//# sourceMappingURL=media.js.map