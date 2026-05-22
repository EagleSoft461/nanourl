# ─── Aşama 1: Builder ────────────────────────────────────────────────────────
# TypeScript'i derle, tüm bağımlılıkları kur (devDependencies dahil)
# Bu aşama production image'ına dahil edilmez — sadece derleme için kullanılır
FROM node:20-alpine AS builder

WORKDIR /app

# Önce sadece package dosyalarını kopyala
# Neden? Docker layer cache — package.json değişmezse npm install tekrar çalışmaz
# Kod değişse bile bağımlılıklar cache'den gelir → hızlı build
COPY package*.json ./
RUN npm ci --include=dev

# Kaynak kodu kopyala ve derle
# scripts ve tests de tsconfig.json'da include edildiği için kopyalanmalı
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# ─── Aşama 2: Production ─────────────────────────────────────────────────────
# Sadece derlenmiş JS + production bağımlılıkları
# devDependencies (TypeScript, ts-jest vb.) dahil edilmez → küçük image
FROM node:20-alpine AS production

# Güvenlik: root yerine ayrı kullanıcı
# Neden? Container root olarak çalışırsa güvenlik açığı oluşabilir
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Sadece production bağımlılıklarını kur
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Builder aşamasından derlenmiş kodu kopyala
COPY --from=builder /app/dist ./dist

# Migration dosyalarını da kopyala
COPY migrations ./migrations

# Kullanıcıyı değiştir
USER appuser

# Uygulama portu
EXPOSE 3000

# Health check — Docker/K8s container'ın sağlıklı olup olmadığını kontrol eder
# --interval: kaç saniyede bir kontrol
# --timeout: kaç saniye içinde cevap gelmezse başarısız say
# --retries: kaç başarısız denemeden sonra "unhealthy" say
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/src/index.js"]
