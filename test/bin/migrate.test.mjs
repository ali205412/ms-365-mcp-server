import { describe, expect, it } from 'vitest';

const { parseCommand, parseCount } = await import('../../bin/migrate.mjs');

describe('bin/migrate.mjs argument parsing', () => {
  it('rejects unknown commands instead of defaulting to up', () => {
    expect(() => parseCommand('statuz')).toThrow(/Invalid migrate command/);
    expect(parseCommand(undefined)).toBe('up');
    expect(parseCommand('down')).toBe('down');
  });

  it('requires --count to be a strict positive integer', () => {
    expect(parseCount([], 'up')).toBe(Infinity);
    expect(parseCount([], 'down')).toBe(1);
    expect(parseCount(['--count=3'], 'down')).toBe(3);
    expect(Number.isNaN(parseCount(['--count=0'], 'down'))).toBe(true);
    expect(Number.isNaN(parseCount(['--count=-1'], 'down'))).toBe(true);
    expect(Number.isNaN(parseCount(['--count=1abc'], 'down'))).toBe(true);
  });
});
