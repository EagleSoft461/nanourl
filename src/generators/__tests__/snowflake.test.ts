import { describe, it, expect } from 'vitest';
import { SnowflakeGenerator } from '../snowflake';

describe('SnowflakeGenerator', () => {
  it('should generate short codes', () => {
    const gen = new SnowflakeGenerator(1);
    const code = gen.generateShortCode();
    
    expect(code.length).toBeGreaterThan(0);
    expect(code.length).toBeLessThan(12);
  });

  it('should be sortable by time', () => {
    const gen = new SnowflakeGenerator(1);
    const id1 = gen.generate();
    
    const start = Date.now();
    while (Date.now() - start < 2) { /* wait */ }
    
    const id2 = gen.generate();
    
    expect(id2 > id1).toBe(true);
  });

  it('should decode base62 correctly', () => {
    const gen = new SnowflakeGenerator(1);
    const code = gen.generateShortCode();
    const decoded = SnowflakeGenerator.base62Decode(code);
    
    expect(typeof decoded).toBe('number');
    expect(decoded > 0).toBe(true);
  });

  it('should extract timestamp', () => {
    const gen = new SnowflakeGenerator(1);
    const before = new Date();
    const id = gen.generate();
    const extracted = SnowflakeGenerator.extractTimestamp(id);
    const after = new Date();
    
    expect(extracted >= before && extracted <= after).toBe(true);
  });

  it('should handle multiple node IDs', () => {
    const gen1 = new SnowflakeGenerator(1);
    const gen2 = new SnowflakeGenerator(2);
    
    const id1 = gen1.generate();
    const id2 = gen2.generate();
    
    expect(id1).not.toBe(id2);
  });
});
