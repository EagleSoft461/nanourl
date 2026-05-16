export interface URLEntity {
  id?: number;
  shortCode: string;
  originalUrl: string;
  createdAt?: Date;
  expiresAt?: Date | null;
  clickCount: number;
  userId?: string | null;
  customAlias: boolean;
}

export interface CreateURLRequest {
  url: string;
  customAlias?: string;
  expiresIn?: number;
  password?: string;
  utmSource?: string;
}

export interface CreateURLResponse {
  shortCode: string;
  shortUrl: string;
  originalUrl: string;
  expiresAt: string | null;
  createdAt: string;
  qrCode: string;
}

export type RedirectResolution =
  | { status: 'found'; originalUrl: string }
  | { status: 'not_found' }
  | { status: 'expired' };

export interface URLAnalytics {
  shortCode: string;
  totalClicks: number;
  uniqueClicks: number;
  topCountries: string[];
  topReferrers: string[];
  clickHistory: Array<{ date: string; clicks: number }>;
}
