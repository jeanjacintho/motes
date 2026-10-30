/** Serializes JSON data with recursively sorted keys and no insignificant whitespace. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();

  function serialize(input: unknown): string {
    if (input === null) return 'null';
    if (typeof input === 'string' || typeof input === 'boolean') return JSON.stringify(input);
    if (typeof input === 'number' && Number.isFinite(input)) return JSON.stringify(input);
    if (typeof input !== 'object') throw new TypeError('Expected a JSON value');
    if (ancestors.has(input)) throw new TypeError('Circular JSON value');

    const array = Array.isArray(input);
    const prototype: unknown = Object.getPrototypeOf(input);
    if (!array && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Expected a plain JSON object');
    }

    ancestors.add(input);
    try {
      if (array) {
        const items: string[] = [];
        for (let index = 0; index < input.length; index++) {
          if (!Object.hasOwn(input, index)) throw new TypeError('Sparse JSON array');
          items.push(serialize(input[index]));
        }
        return `[${items.join(',')}]`;
      }

      const record = input as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`)
        .join(',')}}`;
    } finally {
      ancestors.delete(input);
    }
  }

  return serialize(value);
}
