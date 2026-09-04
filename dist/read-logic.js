import { PostgrestParser } from './parser.js';
function splitTopLevel(input) {
    const parts = [];
    let current = '';
    let parenDepth = 0;
    let braceDepth = 0;
    let inQuotes = false;
    let escaped = false;
    for (const char of input) {
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (inQuotes && char === '\\') {
            current += char;
            escaped = true;
            continue;
        }
        if (char === '"') {
            inQuotes = !inQuotes;
            current += char;
            continue;
        }
        if (!inQuotes) {
            if (char === '(')
                parenDepth += 1;
            else if (char === ')')
                parenDepth -= 1;
            else if (char === '{')
                braceDepth += 1;
            else if (char === '}')
                braceDepth -= 1;
            else if (char === ',' && parenDepth === 0 && braceDepth === 0) {
                parts.push(current);
                current = '';
                continue;
            }
        }
        current += char;
    }
    if (current)
        parts.push(current);
    return parts;
}
function parseTerm(parser, expression) {
    const trimmed = expression.trim();
    if (!trimmed)
        return null;
    const group = trimmed.match(/^(not\.)?(and|or)\((.*)\)$/s);
    if (group) {
        const operator = group[2];
        const terms = splitTopLevel(group[3] ?? '')
            .map(term => parseTerm(parser, term))
            .filter((term) => term !== null);
        if (terms.length === 0)
            return null;
        return { column: operator, operator, value: terms, negate: group[1] === 'not.' };
    }
    const dot = trimmed.indexOf('.');
    if (dot <= 0)
        return null;
    return parser.parseFilter(trimmed.slice(0, dot), trimmed.slice(dot + 1));
}
export function parseReadLogicFilter(operator, value, parser = new PostgrestParser(), negate = false) {
    if (!value.startsWith('(') || !value.endsWith(')'))
        return null;
    const terms = splitTopLevel(value.slice(1, -1))
        .map(term => parseTerm(parser, term))
        .filter((term) => term !== null);
    if (terms.length === 0)
        return null;
    return { column: operator, operator, value: terms, negate };
}
//# sourceMappingURL=read-logic.js.map