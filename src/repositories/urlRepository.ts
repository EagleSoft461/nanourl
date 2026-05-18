export interface CreateURLDTO {
  originalURL: string;
  shortCode: string;
  expiresAt?: Date | null;
}

export interface UpdateURLDTO {
  originalURL?: string;
  expiresAt?: Date | null;
}

// Sayfalama için giriş parametreleri
export interface ListURLsOptions {
  page: number;       // 1'den başlar
  pageSize: number;   // Sayfa başına kayıt
  sort: 'created_at' | 'click_count';
  order: 'asc' | 'desc';
  search?: string;    // original_url veya short_code içinde arama
}

// Sayfalama sonucu — hem veri hem meta bilgi döner
export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface URLRecord {
  id: string;
  originalUrl: string;
  shortCode: string;
  clickCount: number;
  createdAt: Date;
  expiresAt?: Date | null;
  userId?: string | null;
}

export interface URLRepository {
  create(data: CreateURLDTO): Promise<URLRecord>;
  findByShortCode(shortCode: string): Promise<URLRecord | null>;
  update(shortCode: string, data: UpdateURLDTO): Promise<URLRecord | null>;
  delete(shortCode: string): Promise<void>;
  incrementClickCount(shortCode: string): Promise<void>;
  list(options: ListURLsOptions): Promise<PaginatedResult<URLRecord>>;
}
