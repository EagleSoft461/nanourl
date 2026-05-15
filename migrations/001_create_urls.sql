CREATE TABLE IF NOT EXISTS urls (
    id BIGSERIAL PRIMARY KEY,
    short_code VARCHAR(20) UNIQUE NOT NULL,
    original_url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NULL,
    click_count BIGINT DEFAULT 0,
    user_id UUID NULL,
    custom_alias BOOLEAN DEFAULT FALSE,
    
    CONSTRAINT valid_url CHECK (LENGTH(original_url) <= 2048)
);

CREATE INDEX IF NOT EXISTS idx_short_code ON urls(short_code);
CREATE INDEX IF NOT EXISTS idx_expires_at ON urls(expires_at) WHERE expires_at IS NOT NULL;