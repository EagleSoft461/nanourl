const BASE62_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const EPOCH = 1704067200000;

export class SnowflakeGenerator {
  private lastTimestamp = -1;
  private sequence = 0;
  private readonly nodeId: number;

  constructor(nodeId: number = 1) {
    if (nodeId < 0 || nodeId > 1023) {
      throw new Error('Node ID must be between 0 and 1023');
    }
    this.nodeId = nodeId;
  }

  generate(): number {
    let timestamp = Date.now() - EPOCH;

    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1) & 0xFFF;
      if (this.sequence === 0) {
        timestamp = this.waitNextMillis(timestamp);
      }
    } else {
      this.sequence = 0;
    }

    this.lastTimestamp = timestamp;

    const id = (timestamp * 4194304) + (this.nodeId * 4096) + this.sequence;
    return id;
  }

  generateShortCode(): string {
    const id = this.generate();
    return this.base62Encode(id);
  }

  private base62Encode(num: number): string {
    if (num === 0) return '0';
    
    let result = '';
    let n = num;
    
    while (n > 0) {
      const remainder = n % 62;
      result = BASE62_CHARS[remainder] + result;
      n = Math.floor(n / 62);
    }
    
    return result;
  }

  static base62Decode(str: string): number {
    let result = 0;
    
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      const value = BASE62_CHARS.indexOf(char);
      
      if (value === -1) {
        throw new Error('Invalid Base62 character: ' + char);
      }
      
      result = result * 62 + value;
    }
    
    return result;
  }

  static extractTimestamp(id: number): Date {
    const timestamp = Math.floor(id / 4194304) + EPOCH;
    return new Date(timestamp);
  }

  private waitNextMillis(currentTimestamp: number): number {
    let timestamp = Date.now() - EPOCH;
    while (timestamp <= currentTimestamp) {
      // Windows'ta Date.now() 15-16ms granularity var
      // performance.now() daha hassas (microsecond)
      const start = performance.now();
      while (performance.now() - start < 1) {
        // busy wait 1ms
      }
      timestamp = Date.now() - EPOCH;
    }
    return timestamp;
  }
}

const nodeId = process.env.NODE_ID ? parseInt(process.env.NODE_ID, 10) : 1;
export const snowflake = new SnowflakeGenerator(nodeId);
