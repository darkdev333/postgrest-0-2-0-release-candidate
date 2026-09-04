/** Compare strings without early-exit on differing bytes. Browser/Worker safe. */
export function constantTimeCompare(a, b) {
    const encoder = new TextEncoder();
    const left = encoder.encode(a);
    const right = encoder.encode(b);
    const length = Math.max(left.length, right.length);
    let difference = left.length ^ right.length;
    for (let i = 0; i < length; i++) {
        difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
    }
    return difference === 0;
}
//# sourceMappingURL=crypto.js.map