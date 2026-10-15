-- TERRA 자유곡 보드. 빈 DB에 처음 한 번 적용.
-- owner = 등록한 브라우저 토큰의 SHA-256 (토큰 자체는 저장하지 않음)

CREATE TABLE IF NOT EXISTS songs (
  id         TEXT PRIMARY KEY,
  leader     TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  team       TEXT NOT NULL DEFAULT '',
  descr      TEXT NOT NULL,
  style      TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL DEFAULT '',
  closed     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  owner      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applicants (
  id         TEXT PRIMARY KEY,
  song_id    TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  part       TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  selected   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  owner      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS applicants_song ON applicants(song_id);
