# TERRA 자유곡 보드

곡장은 자유곡을 올리고, 플레이어는 카드에서 바로 참여 신청하는 모집 보드.

| 부분 | 쓰는 것 | 위치 |
|---|---|---|
| 화면 | 정적 HTML 한 장 (GitHub Pages) | `index.html`, `config.js`, `logo.png` |
| API | Cloudflare Worker | `worker/src/index.js` |
| 데이터베이스 | Cloudflare D1 (SQLite) | `worker/schema.sql` |

로그인은 없음. 브라우저가 처음 열릴 때 임의 토큰을 만들어 저장하고, 그 토큰으로 "내가 올린 곡/내 신청"을 구분함.
같은 브라우저에서만 내 곡을 관리할 수 있으니, 다른 기기에서 관리해야 하면 임원진 모드를 씀.

## 처음 한 번: 배포

Cloudflare 계정에 로그인된 컴퓨터에서 실행.

```bash
cd worker
npm install
npx wrangler login                      # 이미 로그인돼 있으면 생략
npx wrangler d1 create terra-freetrack  # 출력된 database_id를 wrangler.jsonc에 붙여넣기
npm run db:remote                       # 표 만들기 (schema.sql)
npx wrangler secret put ADMIN_KEY       # 임원진 관리 키 입력 (아무에게도 공유하지 않을 문장)
npx wrangler deploy                     # 출력된 https://terra-freetrack-api.<계정>.workers.dev 주소 복사
```

1. 루트의 `config.js`에서 `window.TERRA_API = "";` 안에 위 workers.dev 주소를 넣고 커밋.
2. GitHub 저장소 → Settings → Pages → Source: **Deploy from a branch**, Branch: `claude/youthful-pasteur-gd181y` / `(root)` (지금 저장소의 유일한 브랜치. 나중에 `main`을 만들면 그쪽으로 바꾸기).
3. 몇 분 뒤 https://shinehyeuk-pixel.github.io/repository-1/ 에서 열림.

사이트 주소가 바뀌면(다른 도메인 연결 등) `worker/wrangler.jsonc`의 `ALLOWED_ORIGINS`에 새 주소를 넣고 `npx wrangler deploy`.
목록에 없는 주소에서 온 요청은 읽기만 되고 저장은 거절됨.

## 로컬에서 실행

```bash
cd worker && npm install
npm run db:local
printf 'ADMIN_KEY=test-admin-key\n' > .dev.vars   # 로컬 전용 관리 키 (커밋 안 됨)
npx wrangler dev --port 8787                       # API
# 다른 터미널, 저장소 루트에서
python3 -m http.server 8765                        # 화면: http://localhost:8765
```

로컬 화면이 로컬 API를 쓰게 하려면 `config.js`를 잠시 `window.TERRA_API = "http://localhost:8787";`로 바꿈 (커밋하지 않기).
`config.js`가 비어 있으면 "미리보기 모드"로 열리고 신청 내용은 그 브라우저에만 저장됨.

## 기능

- **곡 등록**: 이름, 곡 제목, 팀원, 곡 설명, 원하는 플레이어 스타일, 음원 링크, 곡 파일 전송 확인.
- **모집 기간**: 등록 후 2시간은 "모집 중", 그 뒤 "선정 중". 곡장이 마감하면 "마감".
- **참여 신청**: 같은 곡에 같은 이름으로 두 번 신청 불가. 마감된 곡은 신청 불가.
- **겹침 경고**: 신청할 때 같은 사람과 이번 학기 이미 몇 곡을 함께했는지 알려 줌.
- **곡장 관리**: 선정·선정 취소, 신청 삭제, 마감·다시 열기, 곡 삭제.
- **듣기**: 유튜브·사운드클라우드 링크는 곡 상세 창에서 바로 재생. 다른 링크는 새 탭으로 열림.
- **임원진 모드**: 화면 맨 아래 "임원진 모드"에 관리 키를 넣으면 모든 곡과 신청을 관리할 수 있음.

## API

| 요청 | 하는 일 | 권한 |
|---|---|---|
| `GET /api/state` | 모든 곡과 신청 | 누구나 |
| `POST /api/songs` | 곡 등록 | 허용된 사이트 |
| `PATCH /api/songs/:id` `{closed}` | 마감·다시 열기 | 곡장, 임원진 |
| `DELETE /api/songs/:id` | 곡과 신청 삭제 | 곡장, 임원진 |
| `POST /api/applicants` | 참여 신청 | 허용된 사이트 |
| `PATCH /api/applicants/:id` `{selected}` | 선정·취소 | 곡장, 임원진 |
| `DELETE /api/applicants/:id` | 신청 취소·삭제 | 신청자 본인, 곡장, 임원진 |
| `GET /api/admin` | 관리 키 확인 | — |

쓰기 요청은 `X-Owner`(브라우저 토큰) 헤더가 필요하고, 임원진은 `X-Admin-Key`를 함께 보냄.
화면은 5초마다 `/api/state`를 다시 읽어 다른 사람의 신청을 반영함.

## 공개되는 정보

곡 정보와 신청자 이름·파트·한마디는 사이트를 여는 누구에게나 보임. 연락처를 한마디 칸에 적으면 그대로 공개되니 주의.
