/**
 * Consistent Hashing Ring
 *
 * Normal hash vs Consistent hash:
 *
 * Normal hash: key % nodeCount
 *   3 node → 4 node olunca: neredeyse tüm key'ler yeniden dağıtılır
 *   Neden kötü? Milyonlarca URL'yi taşımak gerekir
 *
 * Consistent hash: ring üzerinde en yakın node
 *   3 node → 4 node olunca: sadece ~%25 key taşınır
 *   Neden iyi? Minimal veri hareketi, kademeli geçiş mümkün
 *
 * Virtual Node nedir?
 * Her fiziksel node, ring'de birden fazla nokta tutar.
 * Neden? 3 node varsa her biri ring'in ~1/3'ünü kapsar.
 * Virtual node olmadan dağılım dengesiz olabilir.
 * 150 virtual node/fiziksel node → iyi dağılım.
 *
 * Örnek:
 *   PhysicalNode("pg-1") → ring'de 150 nokta
 *   PhysicalNode("pg-2") → ring'de 150 nokta
 *   Toplam 300 nokta, key gelince en yakın fiziksel node bulunur
 */

// FNV-1a hash — hızlı, iyi dağılım, 32-bit
function fnv1a(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
    hash >>>= 0; // 32-bit unsigned
  }
  return hash;
}

export interface ShardNode {
  id: string;        // "pg-shard-0", "pg-shard-1" vb.
  host: string;      // "postgres-0.nanourl.svc"
  port: number;
  database: string;
}

interface VirtualNode {
  hash: number;
  physicalNode: ShardNode;
}

export class ConsistentHashRing {
  private ring: VirtualNode[] = [];
  private readonly virtualNodesPerPhysical: number;

  constructor(virtualNodesPerPhysical: number = 150) {
    this.virtualNodesPerPhysical = virtualNodesPerPhysical;
  }

  // Ring'e fiziksel node ekle
  addNode(node: ShardNode): void {
    for (let i = 0; i < this.virtualNodesPerPhysical; i++) {
      // Her virtual node için farklı hash: "pg-shard-0:vn:0", "pg-shard-0:vn:1" ...
      const virtualKey = `${node.id}:vn:${i}`;
      const hash = fnv1a(virtualKey);
      this.ring.push({ hash, physicalNode: node });
    }

    // Ring'i hash değerine göre sırala — binary search için gerekli
    this.ring.sort((a, b) => a.hash - b.hash);
  }

  // Ring'den fiziksel node çıkar
  removeNode(nodeId: string): void {
    this.ring = this.ring.filter((vn) => vn.physicalNode.id !== nodeId);
  }

  // Key için hangi node? — O(log n) binary search
  getNode(key: string): ShardNode | null {
    if (this.ring.length === 0) return null;

    const hash = fnv1a(key);

    // Binary search: hash'ten büyük veya eşit ilk virtual node'u bul
    let lo = 0;
    let hi = this.ring.length - 1;

    // Hash ring'in sonunu geçiyorsa başa dön (wrap-around)
    if (hash > this.ring[hi].hash) {
      return this.ring[0].physicalNode;
    }

    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.ring[mid].hash < hash) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    return this.ring[lo].physicalNode;
  }

  // Kaç fiziksel node var?
  get nodeCount(): number {
    const unique = new Set(this.ring.map((vn) => vn.physicalNode.id));
    return unique.size;
  }

  // Ring'deki tüm fiziksel node'lar
  getNodes(): ShardNode[] {
    const seen = new Set<string>();
    const nodes: ShardNode[] = [];
    for (const vn of this.ring) {
      if (!seen.has(vn.physicalNode.id)) {
        seen.add(vn.physicalNode.id);
        nodes.push(vn.physicalNode);
      }
    }
    return nodes;
  }

  // Dağılım analizi — her node kaç virtual node tutuyor?
  getDistribution(): Record<string, number> {
    const dist: Record<string, number> = {};
    for (const vn of this.ring) {
      dist[vn.physicalNode.id] = (dist[vn.physicalNode.id] ?? 0) + 1;
    }
    return dist;
  }
}
