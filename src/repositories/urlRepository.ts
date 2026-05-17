export interface CreateURLDTO {
  originalURL: string;
  shortCode: string;
  expiresAt?: Date | null;
}

export interface URLRecord {
  id: string;
  originalUrl: string;
  shortCode: string;
  clickCount: number;
  createdAt: Date;
  expiresAt?: Date | null;
}

export interface URLRepository {
  create(data: CreateURLDTO): Promise<URLRecord>;

  findByShortCode(shortCode: string): Promise<URLRecord | null>;

  incrementClickCount(shortCode: string): Promise<void>;

  delete(shortCode: string): Promise<void>;
}