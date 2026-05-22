import { describe, it, expect, beforeEach } from 'vitest';
import { ConsistentHashRing, ShardNode } from '../consistentHash';

function makeNode(id: string): ShardNode {
  return { id, host: `${id}.db`, port: 5432, database: 'nanourl' };
}

describe('ConsistentHashRing', () => {
  let ring: ConsistentHashRing;

  beforeEach(() => {
    ring = new ConsistentHashRing(150); // 150 virtual node/fiziksel node
  });

  it('returns null when ring is empty', () => {
    expect(ring.getNode('abc123')).toBeNull();
  });

  it('routes to the only node when there is one', () => {
    ring.addNode(makeNode('pg-0'));
    const node = ring.getNode('abc123');
    expect(node?.id).toBe('pg-0');
  });

  it('is deterministic — same key always maps to same node', () => {
    ring.addNode(makeNode('pg-0'));
    ring.addNode(makeNode('pg-1'));
    ring.addNode(makeNode('pg-2'));

    const node1 = ring.getNode('abc123');
    const node2 = ring.getNode('abc123');
    const node3 = ring.getNode('abc123');

    expect(node1?.id).toBe(node2?.id);
    expect(node2?.id).toBe(node3?.id);
  });

  it('minimal disruption — adding a node moves ~1/N keys', () => {
    // 3 node ile 1000 key dağıt
    ring.addNode(makeNode('pg-0'));
    ring.addNode(makeNode('pg-1'));
    ring.addNode(makeNode('pg-2'));

    const keys = Array.from({ length: 1000 }, (_, i) => `key-${i}`);
    const before = new Map(keys.map((k) => [k, ring.getNode(k)?.id]));

    // 4. node ekle
    ring.addNode(makeNode('pg-3'));

    let changed = 0;
    for (const key of keys) {
      if (ring.getNode(key)?.id !== before.get(key)) changed++;
    }

    // ~%25 key taşınmalı (1/4 node)
    // Tolerans: %15-%40 arası kabul edilebilir
    const changeRate = changed / keys.length;
    expect(changeRate).toBeGreaterThan(0.15);
    expect(changeRate).toBeLessThan(0.40);
  });

  it('removes a node and redistributes its keys', () => {
    ring.addNode(makeNode('pg-0'));
    ring.addNode(makeNode('pg-1'));
    ring.addNode(makeNode('pg-2'));

    const keysBefore = Array.from({ length: 100 }, (_, i) => `key-${i}`)
      .filter((k) => ring.getNode(k)?.id === 'pg-1');

    ring.removeNode('pg-1');

    // pg-1'e giden key'ler artık pg-0 veya pg-2'ye gitmeli
    for (const key of keysBefore) {
      const node = ring.getNode(key);
      expect(node?.id).not.toBe('pg-1');
      expect(['pg-0', 'pg-2']).toContain(node?.id);
    }
  });

  it('distributes keys roughly evenly across nodes', () => {
    ring.addNode(makeNode('pg-0'));
    ring.addNode(makeNode('pg-1'));
    ring.addNode(makeNode('pg-2'));

    const counts: Record<string, number> = { 'pg-0': 0, 'pg-1': 0, 'pg-2': 0 };
    const total = 3000;

    for (let i = 0; i < total; i++) {
      const node = ring.getNode(`url-${i}`);
      if (node) counts[node.id]++;
    }

    // Her node ~%33 almalı, tolerans: %15-%60 (hash dağılımı deterministik ama tam eşit değil)
    for (const count of Object.values(counts)) {
      const ratio = count / total;
      expect(ratio).toBeGreaterThan(0.15);
      expect(ratio).toBeLessThan(0.60);
    }
  });

  it('reports correct node count', () => {
    expect(ring.nodeCount).toBe(0);
    ring.addNode(makeNode('pg-0'));
    expect(ring.nodeCount).toBe(1);
    ring.addNode(makeNode('pg-1'));
    expect(ring.nodeCount).toBe(2);
    ring.removeNode('pg-0');
    expect(ring.nodeCount).toBe(1);
  });
});
