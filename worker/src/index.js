// TERRA 자유곡 보드 API — Cloudflare Worker + D1.
//
// 로그인 없음. 브라우저가 처음 열 때 만든 임의 토큰을 X-Owner 헤더로 보내고,
// 서버는 그 SHA-256을 owner로 저장한다. 공개 목록에는 owner(해시)만 나가므로
// 화면은 "내 곡인지"를 알 수 있지만, 남의 토큰은 해시에서 되돌릴 수 없다.
// 임원진은 X-Admin-Key(비밀값 ADMIN_KEY)로 모든 곡·신청을 관리할 수 있다.

const LIMITS = { leader: 20, title: 40, team: 80, descr: 600, style: 300, link: 300, name: 20, part: 40, note: 200 };

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(req, env);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
      console.error(e);
      return json({ error: "server_error" }, 500, cors);
    }
  },
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function route(req, env) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean); // ["api", "songs", id]
  if (parts[0] !== "api") throw new HttpError(404, "not_found");
  const [, kind, id] = parts;

  if (req.method === "GET" && kind === "state") return json(await state(env));

  // 쓰기는 허용된 출처에서만
  if (!originAllowed(req, env)) throw new HttpError(403, "origin_not_allowed");
  const who = await caller(req, env);

  if (kind === "songs" && req.method === "POST" && !id) return json(await createSong(env, who, await body(req)), 201);
  if (kind === "songs" && req.method === "PATCH" && id) return json(await updateSong(env, who, id, await body(req)));
  if (kind === "songs" && req.method === "DELETE" && id) return json(await deleteSong(env, who, id));
  if (kind === "applicants" && req.method === "POST" && !id) return json(await createApplicant(env, who, await body(req)), 201);
  if (kind === "applicants" && req.method === "PATCH" && id) return json(await updateApplicant(env, who, id, await body(req)));
  if (kind === "applicants" && req.method === "DELETE" && id) return json(await deleteApplicant(env, who, id));
  if (kind === "admin" && req.method === "GET") return json({ admin: who.admin });
  throw new HttpError(404, "not_found");
}

/* ---------- 읽기 ---------- */

async function state(env) {
  const [s, a] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM songs ORDER BY created_at DESC LIMIT 500"),
    env.DB.prepare("SELECT * FROM applicants ORDER BY created_at ASC LIMIT 5000"),
  ]);
  return {
    now: Date.now(),
    songs: s.results.map(r => ({
      id: r.id, leader: r.leader, title: r.title, team: r.team, desc: r.descr, style: r.style,
      link: r.link, closed: !!r.closed, createdAt: r.created_at, by: r.owner,
    })),
    applicants: a.results.map(r => ({
      id: r.id, songId: r.song_id, name: r.name, part: r.part, note: r.note,
      selected: !!r.selected, createdAt: r.created_at, by: r.owner,
    })),
  };
}

/* ---------- 곡 ---------- */

async function createSong(env, who, b) {
  if (b.sentFile !== true) throw new HttpError(400, "sent_file_required");
  const row = {
    id: newId(),
    leader: text(b.leader, "leader", true),
    title: text(b.title, "title"),
    team: text(b.team, "team"),
    descr: text(b.desc, "descr", true),
    style: text(b.style, "style"),
    link: httpLink(b.link),
    created_at: Date.now(),
    owner: who.id,
  };
  await env.DB.prepare(
    "INSERT INTO songs (id, leader, title, team, descr, style, link, closed, created_at, owner) VALUES (?,?,?,?,?,?,?,0,?,?)"
  ).bind(row.id, row.leader, row.title, row.team, row.descr, row.style, row.link, row.created_at, row.owner).run();
  return { id: row.id };
}

async function updateSong(env, who, id, b) {
  const song = await mustSong(env, id);
  if (!who.admin && song.owner !== who.id) throw new HttpError(403, "not_owner");
  if (typeof b.closed !== "boolean") throw new HttpError(400, "closed_required");
  await env.DB.prepare("UPDATE songs SET closed = ? WHERE id = ?").bind(b.closed ? 1 : 0, id).run();
  return { ok: true };
}

async function deleteSong(env, who, id) {
  const song = await mustSong(env, id);
  if (!who.admin && song.owner !== who.id) throw new HttpError(403, "not_owner");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM applicants WHERE song_id = ?").bind(id),
    env.DB.prepare("DELETE FROM songs WHERE id = ?").bind(id),
  ]);
  return { ok: true };
}

/* ---------- 신청 ---------- */

async function createApplicant(env, who, b) {
  const song = await mustSong(env, String(b.songId || ""));
  if (song.closed) throw new HttpError(409, "song_closed");
  const name = text(b.name, "name", true);
  const dup = await env.DB.prepare("SELECT 1 FROM applicants WHERE song_id = ? AND REPLACE(LOWER(name), ' ', '') = REPLACE(LOWER(?), ' ', '')")
    .bind(song.id, name).first();
  if (dup) throw new HttpError(409, "duplicate_name");
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO applicants (id, song_id, name, part, note, selected, created_at, owner) VALUES (?,?,?,?,?,0,?,?)"
  ).bind(id, song.id, name, text(b.part, "part"), text(b.note, "note"), Date.now(), who.id).run();
  return { id };
}

async function updateApplicant(env, who, id, b) {
  const app = await mustApplicant(env, id);
  const song = await mustSong(env, app.song_id);
  if (!who.admin && song.owner !== who.id) throw new HttpError(403, "not_owner");
  if (typeof b.selected !== "boolean") throw new HttpError(400, "selected_required");
  await env.DB.prepare("UPDATE applicants SET selected = ? WHERE id = ?").bind(b.selected ? 1 : 0, id).run();
  return { ok: true };
}

async function deleteApplicant(env, who, id) {
  const app = await mustApplicant(env, id);
  const song = await env.DB.prepare("SELECT owner FROM songs WHERE id = ?").bind(app.song_id).first();
  if (!who.admin && app.owner !== who.id && song?.owner !== who.id) throw new HttpError(403, "not_owner");
  await env.DB.prepare("DELETE FROM applicants WHERE id = ?").bind(id).run();
  return { ok: true };
}

/* ---------- 도우미 ---------- */

async function mustSong(env, id) {
  const r = await env.DB.prepare("SELECT * FROM songs WHERE id = ?").bind(id).first();
  if (!r) throw new HttpError(404, "song_not_found");
  return r;
}

async function mustApplicant(env, id) {
  const r = await env.DB.prepare("SELECT * FROM applicants WHERE id = ?").bind(id).first();
  if (!r) throw new HttpError(404, "applicant_not_found");
  return r;
}

async function caller(req, env) {
  const token = req.headers.get("X-Owner") || "";
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(token)) throw new HttpError(401, "owner_token_required");
  const key = req.headers.get("X-Admin-Key") || "";
  const admin = !!env.ADMIN_KEY && key.length > 0 && (await sha256(key)) === (await sha256(env.ADMIN_KEY));
  return { id: await sha256(token), admin };
}

async function body(req) {
  if (Number(req.headers.get("Content-Length") || 0) > 8192) throw new HttpError(413, "too_large");
  try { const b = await req.json(); if (b && typeof b === "object") return b; } catch {}
  throw new HttpError(400, "invalid_json");
}

function text(v, field, required = false) {
  const s = (typeof v === "string" ? v : "").trim();
  if (required && !s) throw new HttpError(400, field + "_required");
  if (s.length > LIMITS[field]) throw new HttpError(400, field + "_too_long");
  return s;
}

// http(s) 주소만 저장. 스킴이 없으면 https:// 를 붙인다.
function httpLink(v) {
  let s = text(v, "link");
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:") return u.href;
  } catch {}
  throw new HttpError(400, "link_invalid");
}

function newId() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, "0")).join("");
}

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
}

function originAllowed(req, env) {
  const o = req.headers.get("Origin");
  return !!o && allowedOrigins(env).includes(o);
}

function corsHeaders(req, env) {
  const o = req.headers.get("Origin");
  const h = { "Vary": "Origin" };
  if (o && allowedOrigins(env).includes(o)) {
    h["Access-Control-Allow-Origin"] = o;
    h["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type, X-Owner, X-Admin-Key";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
