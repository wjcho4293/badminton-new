const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. 뷰 엔진 및 미들웨어 설정
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'badminton-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// 스크롤 위치 고정, 듀오 순번 부여 및 코트 입장 시 이름 왼쪽 듀오 표기를 위한 렌더 미들웨어
app.use((req, res, next) => {
  const originalRender = res.render;
  res.render = function(view, options, callback) {
    options = options || {};
    const members = options.members || [];
    const courts = options.courts || [];
    
    const duoMap = new Map();
    let duoCounter = 1;
    members.forEach(m => {
      if (m.duoPartnerId && m.duoGamesRemaining > 0) {
        const pairKey = [Math.min(m.id, m.duoPartnerId), Math.max(m.id, m.duoPartnerId)].join('-');
        if (!duoMap.has(pairKey)) {
          duoMap.set(pairKey, `듀오 ${duoCounter++}`);
        }
        m.duoLabel = duoMap.get(pairKey);
      } else {
        m.duoLabel = null;
      }
    });

    originalRender.call(this, view, options, (err, html) => {
      if (err) {
        if (callback) return callback(err);
        return next(err);
      }

      const duoMapping = {};
      const nameDuoMapping = {};
      members.forEach(m => {
        if (m.duoLabel) {
          duoMapping[m.id] = m.duoLabel;
          if (m.name) {
            nameDuoMapping[m.name] = m.duoLabel;
          }
        }
      });

      const playingNamesSet = new Set();
      courts.forEach(c => {
        if (c.status === 'playing') {
          if (c.teamA_p1 && c.teamA_p1 !== '-') playingNamesSet.add(c.teamA_p1);
          if (c.teamA_p2 && c.teamA_p2 !== '-') playingNamesSet.add(c.teamA_p2);
          if (c.teamB_p1 && c.teamB_p1 !== '-') playingNamesSet.add(c.teamB_p1);
          if (c.teamB_p2 && c.teamB_p2 !== '-') playingNamesSet.add(c.teamB_p2);
        }
      });

      const injectedScript = `
        <script>
          document.addEventListener("DOMContentLoaded", () => {
            const savedScroll = sessionStorage.getItem("mainScrollTop");
            const savedWindowScroll = sessionStorage.getItem("windowScrollY");
            
            if (savedScroll !== null || savedWindowScroll !== null) {
              requestAnimationFrame(() => {
                const container = document.querySelector('.overflow-y-auto');
                if (container && savedScroll !== null) {
                  container.scrollTop = parseInt(savedScroll, 10);
                }
                if (savedWindowScroll !== null) {
                  window.scrollTo(0, parseInt(savedWindowScroll, 10));
                  document.documentElement.scrollTop = parseInt(savedWindowScroll, 10);
                  document.body.scrollTop = parseInt(savedWindowScroll, 10);
                }
              });

              setTimeout(() => {
                sessionStorage.removeItem("mainScrollTop");
                sessionStorage.removeItem("windowScrollY");
              }, 500);
            }

            const duoMap = ${JSON.stringify(duoMapping)};
            const nameDuoMap = ${JSON.stringify(nameDuoMapping)};
            const playingNames = new Set(${JSON.stringify(Array.from(playingNamesSet))});
            const allMembers = ${JSON.stringify(members.map(m => ({ id: m.id, name: m.name })))};
            const duoForm = document.getElementById("duo-sync-form");

            document.querySelectorAll(".duo-badge, .court-duo-badge").forEach(el => el.remove());

            document.querySelectorAll("input[name='user_ids']").forEach(input => {
              const userId = input.value;
              if (duoMap[userId]) {
                const label = input.closest("label") || input.parentElement;
                if (label && !label.querySelector('.duo-badge')) {
                  const badge = document.createElement("span");
                  badge.className = "duo-badge ml-1 px-1 py-0.5 text-[10px] bg-indigo-100 text-indigo-700 font-semibold rounded whitespace-nowrap inline-flex items-center shrink-0";
                  badge.textContent = duoMap[userId];
                  label.appendChild(badge);
                }
              }
            });

            if (duoForm) {
              duoForm.querySelectorAll("label, input, div").forEach(el => {
                const wrapper = el.closest("label") || el;
                if (wrapper) wrapper.style.display = "";
              });
            }

            allMembers.forEach(m => {
              const pName = m.name;
              const isPlaying = playingNames.has(pName);

              const inputs = document.querySelectorAll("input[value='" + m.id + "'], input[name='user_ids'][value='" + m.id + "']");
              inputs.forEach(input => {
                const label = input.closest("label") || input.parentElement;
                if (label) {
                  const isInDuoForm = duoForm && duoForm.contains(label);
                  if (!isInDuoForm) {
                    label.style.display = isPlaying ? "none" : "";
                  }
                }
              });
            });

            setTimeout(() => {
              Object.keys(nameDuoMap).forEach(playerName => {
                if (!playingNames.has(playerName)) return;
                const duoLabel = nameDuoMap[playerName];

                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                let node;
                while (node = walker.nextNode()) {
                  if (node.nodeValue.trim() === playerName) {
                    const parent = node.parentElement;
                    if (parent && !parent.querySelector('.court-duo-badge')) {
                      const isCourtArea = parent.closest('.court-card, [id*="court"], .court, form[action*="score"], form[action*="assign"]') || 
                                         (parent.textContent && (parent.textContent.includes('팀') || parent.textContent.includes('VS')));
                      if (isCourtArea) {
                        const badge = document.createElement("span");
                        badge.className = "court-duo-badge mr-1 px-1 py-0.5 text-[10px] bg-indigo-100 text-indigo-700 font-semibold rounded whitespace-nowrap inline-flex items-center shrink-0 align-middle";
                        badge.textContent = duoLabel;
                        parent.insertBefore(badge, node);
                      }
                    }
                  }
                }
              });
            }, 50);
          });

          function saveScrollPosition() {
            const container = document.querySelector('.overflow-y-auto');
            if (container) {
              sessionStorage.setItem("mainScrollTop", container.scrollTop);
            }
            sessionStorage.setItem("windowScrollY", window.scrollY || window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0);
          }

          window.addEventListener("beforeunload", saveScrollPosition);

          document.addEventListener("click", (e) => {
            const target = e.target.closest("button, a, input[type='submit'], form, label");
            if (target) {
              saveScrollPosition();
            }
          });

          document.addEventListener("submit", saveScrollPosition);

          document.addEventListener("change", (e) => {
            if (e.target && e.target.name === "user_ids") {
              const form = e.target.closest("form");
              if (form && form.id === "duo-sync-form") {
                const activeCheckboxes = form.querySelectorAll("input[name='user_ids']:not(:disabled):checked");
                if (activeCheckboxes.length > 2) {
                  alert("듀오는 최대 2명까지만 지정할 수 있습니다.");
                  e.target.checked = false;
                  return;
                }
                if (activeCheckboxes.length === 2) {
                  saveScrollPosition();
                  form.submit();
                }
              }
            }
          });
        </script>
        <style>
          .attendance-toggle-container, .member-grid-3col, form .grid-cols-3 {
            display: grid !important;
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            gap: 0.5rem !important;
          }
          .duo-badge, .court-duo-badge {
            white-space: nowrap !important;
            flex-shrink: 0 !important;
          }
        </style>
      `;
      const modifiedHtml = html.replace('</body>', injectedScript + '</body>');
      if (callback) {
        callback(null, modifiedHtml);
      } else {
        res.send(modifiedHtml);
      }
    });
  };
  next();
});

// 2. SQLite 데이터베이스 초기화 (파일 기반 DB로 변경하여 Render 배포 시 데이터 유지)
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('DB 연결 실패:', err.message);
  else console.log('SQLite 파일 DB 연결 성공 (저장 경로: ' + dbPath + ')');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    name TEXT,
    age INTEGER,
    gender TEXT,
    carrot_nickname TEXT,
    role TEXT DEFAULT 'member',
    mmr INTEGER DEFAULT 1000,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0
  )`, () => {
    const hashedPassword = bcrypt.hashSync('4293', 10);
    db.run(`INSERT INTO users (username, password, name, age, gender, carrot_nickname, role, mmr) 
            VALUES ('wjcho4293', ?, '조원준', 30, '남', '안산', 'master', 1500)
            ON CONFLICT(username) DO UPDATE SET 
            password = excluded.password,
            name = excluded.name,
            age = excluded.age,
            gender = excluded.gender,
            carrot_nickname = excluded.carrot_nickname,
            role = 'master'`, 
            [hashedPassword], () => {
              for (let i = 1; i <= 30; i++) {
                const vUsername = `member${i}`;
                const vPassword = bcrypt.hashSync('1234', 10);
                const vName = `회원${i}`;
                const vAge = 20 + (i % 15);
                const vGender = i % 2 === 0 ? '여' : '남';
                const vCarrot = `동네${i}`;
                db.run(`INSERT OR IGNORE INTO users (username, password, name, age, gender, carrot_nickname, role, mmr) 
                        VALUES (?, ?, ?, ?, ?, ?, 'member', ?)`,
                        [vUsername, vPassword, vName, vAge, vGender, vCarrot, 900 + (i * 10)]);
              }
            });
  });

  db.run(`CREATE TABLE IF NOT EXISTS participants (
    user_id INTEGER PRIMARY KEY,
    attended INTEGER DEFAULT 1,
    duoPartnerId INTEGER,
    duoGamesRemaining INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS courts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    status TEXT DEFAULT 'empty',
    teamA_p1 TEXT DEFAULT '-',
    teamA_p2 TEXT DEFAULT '-',
    teamB_p1 TEXT DEFAULT '-',
    teamB_p2 TEXT DEFAULT '-'
  )`, () => {
    db.get(`SELECT COUNT(*) as cnt FROM courts`, (err, row) => {
      if (row && row.cnt === 0) {
        for (let i = 1; i <= 4; i++) {
          db.run(`INSERT INTO courts (name) VALUES (?)`, [`코트 ${i}`]);
        }
      }
    });
  });

  db.run(`CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teamA_p1 TEXT,
    teamA_p2 TEXT,
    teamB_p1 TEXT,
    teamB_p2 TEXT,
    teamA_score INTEGER,
    teamB_score INTEGER,
    winner TEXT,
    playedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// 3. 메인 라우터
app.get('/', (req, res) => {
  const currentUser = req.session.user || null;
  const currentView = currentUser ? (req.query.view || 'main') : 'auth';
  const activeTab = req.query.tab || 'courts';
  const authTab = req.query.authTab || 'login';
  const matchDateQuery = req.query.matchDate || null;

  db.all(`SELECT * FROM users ORDER BY mmr DESC`, [], (err, allUsers) => {
    let matchQuery = `SELECT * FROM matches`;
    let matchParams = [];
    if (matchDateQuery) {
      matchQuery += ` WHERE date(playedAt) = ?`;
      matchParams.push(matchDateQuery);
    }
    matchQuery += ` ORDER BY playedAt DESC`;

    db.all(matchQuery, matchParams, (err, allMatchesFiltered) => {
      db.all(`SELECT * FROM courts`, [], (err, courts) => {
        const playingNames = new Set();
        courts.forEach(c => {
          if (c.status === 'playing') {
            if (c.teamA_p1 && c.teamA_p1 !== '-') playingNames.add(c.teamA_p1);
            if (c.teamA_p2 && c.teamA_p2 !== '-') playingNames.add(c.teamA_p2);
            if (c.teamB_p1 && c.teamB_p1 !== '-') playingNames.add(c.teamB_p1);
            if (c.teamB_p2 && c.teamB_p2 !== '-') playingNames.add(c.teamB_p2);
          }
        });

        db.all(`SELECT u.*, p.attended, p.duoPartnerId, p.duoGamesRemaining FROM participants p JOIN users u ON p.user_id = u.id`, [], (err, membersRaw) => {
          membersRaw.forEach(m => {
            if (m.duoGamesRemaining <= 0 && m.duoPartnerId) {
              db.run(`UPDATE participants SET duoPartnerId = NULL, duoGamesRemaining = 0 WHERE user_id = ?`, [m.id]);
              m.duoPartnerId = null;
              m.duoGamesRemaining = 0;
            }
          });

          const members = membersRaw;

          const enrichedCourts = courts.map(court => {
            let tA_mmr_sum = 0, tA_count = 0;
            let tB_mmr_sum = 0, tB_count = 0;

            const pA1 = allUsers.find(u => u.name === court.teamA_p1);
            const pA2 = allUsers.find(u => u.name === court.teamA_p2);
            const pB1 = allUsers.find(u => u.name === court.teamB_p1);
            const pB2 = allUsers.find(u => u.name === court.teamB_p2);

            if (pA1) { tA_mmr_sum += pA1.mmr; tA_count++; }
            if (pA2) { tA_mmr_sum += pA2.mmr; tA_count++; }
            if (pB1) { tB_mmr_sum += pB1.mmr; tB_count++; }
            if (pB2) { tB_mmr_sum += pB2.mmr; tB_count++; }

            return {
              ...court,
              teamA_avgMmr: tA_count > 0 ? Math.round(tA_mmr_sum / tA_count) : 0,
              teamB_avgMmr: tB_count > 0 ? Math.round(tB_mmr_sum / tB_count) : 0,
              pA1_mmr: pA1 ? pA1.mmr : 0,
              pA2_mmr: pA2 ? pA2.mmr : 0,
              pB1_mmr: pB1 ? pB1.mmr : 0,
              pB2_mmr: pB2 ? pB2.mmr : 0,
            };
          });

          const rankingList = allUsers.map((u, idx) => ({
            rank: idx + 1,
            id: u.id,
            name: u.name,
            age: u.age,
            gender: u.gender,
            wins: u.wins,
            losses: u.losses,
            winRate: (u.wins + u.losses) > 0 ? ((u.wins / (u.wins + u.losses)) * 100).toFixed(1) : 0,
            mmr: u.mmr,
            role: u.role,
            carrot_nickname: u.carrot_nickname
          }));

          let partnerStats = [];
          let myAllMatches = [];
          let myRecentMatches = [];

          if (currentUser) {
            myAllMatches = allMatchesFiltered.filter(m => 
              m.teamA_p1 === currentUser.name || m.teamA_p2 === currentUser.name ||
              m.teamB_p1 === currentUser.name || m.teamB_p2 === currentUser.name
            );
            myRecentMatches = myAllMatches.slice(0, 5);

            const partnerMap = {};
            allMatchesFiltered.forEach(m => {
              const teamAPlayers = [m.teamA_p1, m.teamA_p2];
              const teamBPlayers = [m.teamB_p1, m.teamB_p2];

              if (teamAPlayers.includes(currentUser.name)) {
                const partner = teamAPlayers.find(p => p !== currentUser.name && p !== '-');
                if (partner) {
                  if (!partnerMap[partner]) partnerMap[partner] = { partner, wins: 0, losses: 0, total: 0 };
                  partnerMap[partner].total++;
                  if (m.winner === 'A') partnerMap[partner].wins++;
                  else partnerMap[partner].losses++;
                }
              }
              if (teamBPlayers.includes(currentUser.name)) {
                const partner = teamBPlayers.find(p => p !== currentUser.name && p !== '-');
                if (partner) {
                  if (!partnerMap[partner]) partnerMap[partner] = { partner, wins: 0, losses: 0, total: 0 };
                  partnerMap[partner].total++;
                  if (m.winner === 'B') partnerMap[partner].wins++;
                  else partnerMap[partner].losses++;
                }
              }
            });

            partnerStats = Object.values(partnerMap).map(p => ({
              ...p,
              winRate: p.total > 0 ? ((p.wins / p.total) * 100).toFixed(1) : 0
            })).sort((a, b) => b.winRate - a.winRate || b.total - a.total);
          }

          const joinedParticipantIds = membersRaw.filter(m => m.attended === 1).map(m => m.id);

          res.render('index', {
            currentView,
            activeTab,
            authTab,
            currentUser,
            allUsers, 
            members,
            courts: enrichedCourts,
            rankingList,
            fullRankingList: rankingList,
            allMatches: allMatchesFiltered,
            myAllMatches,
            myRecentMatches,
            myStats: currentUser ? rankingList.find(u => u.name === currentUser.name) : null,
            partnerStats,
            matchDateQuery,
            joinedParticipantIds,
            playingNames
          });
        });
      });
    });
  });
});

// 4. 인증 라우터
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (user) {
      const match = await bcrypt.compare(password, user.password);
      if (match) {
        req.session.user = user;
        res.redirect('/?tab=courts');
      } else {
        res.send("<script>alert('아이디 또는 비밀번호가 일치하지 않습니다.'); history.back();</script>");
      }
    } else {
      res.send("<script>alert('아이디 또는 비밀번호가 일치하지 않습니다.'); history.back();</script>");
    }
  });
});

app.post('/auth/signup', async (req, res) => {
  const { username, password, name, age, gender, carrot_nickname } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (username, password, name, age, gender, carrot_nickname, role) VALUES (?, ?, ?, ?, ?, ?, 'member')`,
      [username, hashedPassword, name, age, gender, carrot_nickname], (err) => {
        if (err) {
          res.send("<script>alert('이미 존재하는 아이디이거나 회원가입 중 오류가 발생했습니다.'); history.back();</script>");
        } else {
          res.redirect('/?view=auth&authTab=login');
        }
      });
  } catch (e) {
    res.send("<script>alert('회원가입 처리 중 오류가 발생했습니다.'); history.back();</script>");
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// 5. 관리자 출석부 및 게스트 라우터
app.post('/admin/participants/toggle', (req, res) => {
  if (!req.session.user || (req.session.user.role !== 'master' && req.session.user.role !== 'admin')) {
    return res.send("<script>alert('권한이 없습니다.'); history.back();</script>");
  }
  const { user_id, attended } = req.body;
  
  if (attended === '1') {
    db.run(`INSERT OR REPLACE INTO participants (user_id, attended) VALUES (?, 1)`, [user_id], () => {
      res.redirect('/?tab=courts');
    });
  } else {
    db.run(`UPDATE participants SET duoPartnerId = NULL, duoGamesRemaining = 0 WHERE duoPartnerId = ? OR user_id = ?`, [user_id, user_id], () => {
      db.run(`DELETE FROM participants WHERE user_id = ?`, [user_id], () => {
        res.redirect('/?tab=courts');
      });
    });
  }
});

app.post('/admin/add-guest', (req, res) => {
  if (!req.session.user || (req.session.user.role !== 'master' && req.session.user.role !== 'admin')) {
    return res.send("<script>alert('권한이 없습니다.'); history.back();</script>");
  }

  const { name, age, gender } = req.body;
  const guestUsername = 'guest_' + Date.now();
  const dummyPassword = 'guest_password_secure';

  db.run(`INSERT INTO users (username, password, name, age, gender, carrot_nickname, role, mmr, wins, losses) VALUES (?, ?, ?, ?, ?, ?, 'member', 1000, 0, 0)`,
    [guestUsername, dummyPassword, name + ' (게스트)', parseInt(age), gender, '현장방문'], function(err) {
      if (err) {
        return res.send("<script>alert('게스트 등록 중 오류가 발생했습니다.'); history.back();</script>");
      }
      const newGuestId = this.lastID;
      db.run(`INSERT OR IGNORE INTO participants (user_id, attended) VALUES (?, 1)`, [newGuestId], () => {
        res.redirect('/?tab=courts');
      });
    });
});

// 6. 코트 관리 라우터
app.post('/courts/add', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.get(`SELECT COUNT(*) as cnt FROM courts`, (err, row) => {
    const nextNum = (row ? row.cnt : 0) + 1;
    db.run(`INSERT INTO courts (name) VALUES (?)`, [`코트 ${nextNum}`], () => {
      res.redirect('/?tab=courts');
    });
  });
});

app.post('/courts/remove', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.get(`SELECT * FROM courts ORDER BY id DESC LIMIT 1`, (err, court) => {
    if (court) {
      db.run(`DELETE FROM courts WHERE id = ?`, [court.id], () => {
        res.redirect('/?tab=courts');
      });
    } else {
      res.redirect('/?tab=courts');
    }
  });
});

// 7. 자동 매칭 및 점수 반영 라우터
app.post('/courts/:courtId/assign', (req, res) => {
  const { courtId } = req.params;
  
  db.all(`SELECT teamA_p1, teamA_p2, teamB_p1, teamB_p2 FROM courts WHERE status = 'playing'`, [], (err, activeCourts) => {
    const playingNames = new Set();
    activeCourts.forEach(c => {
      if (c.teamA_p1 && c.teamA_p1 !== '-') playingNames.add(c.teamA_p1);
      if (c.teamA_p2 && c.teamA_p2 !== '-') playingNames.add(c.teamA_p2);
      if (c.teamB_p1 && c.teamB_p1 !== '-') playingNames.add(c.teamB_p1);
      if (c.teamB_p2 && c.teamB_p2 !== '-') playingNames.add(c.teamB_p2);
    });

    db.all(`SELECT u.id, u.name, u.mmr, p.duoPartnerId, p.duoGamesRemaining 
            FROM participants p 
            JOIN users u ON p.user_id = u.id 
            WHERE p.attended = 1`, [], (err, rows) => {
      
      const availableRows = rows.filter(r => !playingNames.has(r.name));

      if (availableRows && availableRows.length >= 4) {
        let bestCombination = null;
        let minMmrDiff = Infinity;
        const candidatePool = availableRows.slice(0, 10);

        if (candidatePool.length >= 4) {
          for (let i = 0; i < candidatePool.length; i++) {
            for (let j = i + 1; j < candidatePool.length; j++) {
              for (let k = j + 1; k < candidatePool.length; k++) {
                for (let l = k + 1; l < candidatePool.length; l++) {
                  const group = [candidatePool[i], candidatePool[j], candidatePool[k], candidatePool[l]];
                  
                  const splits = [
                    { teamA: [group[0], group[1]], teamB: [group[2], group[3]] },
                    { teamA: [group[0], group[2]], teamB: [group[1], group[3]] },
                    { teamA: [group[0], group[3]], teamB: [group[1], group[2]] }
                  ];

                  splits.forEach(split => {
                    const avgA = (split.teamA[0].mmr + split.teamA[1].mmr) / 2;
                    const avgB = (split.teamB[0].mmr + split.teamB[1].mmr) / 2;
                    let diff = Math.abs(avgA - avgB);

                    split.teamA.forEach(p => {
                      if (p.duoPartnerId && p.duoGamesRemaining > 0 && split.teamA.some(o => o.id === p.duoPartnerId)) diff -= 100;
                    });
                    split.teamB.forEach(p => {
                      if (p.duoPartnerId && p.duoGamesRemaining > 0 && split.teamB.some(o => o.id === p.duoPartnerId)) diff -= 100;
                    });

                    if (diff < minMmrDiff) {
                      minMmrDiff = diff;
                      bestCombination = split;
                    }
                  });
                }
              }
            }
          }
        }

        if (bestCombination) {
          const tA = bestCombination.teamA;
          const tB = bestCombination.teamB;

          db.run(`UPDATE courts SET status = 'playing', teamA_p1 = ?, teamA_p2 = ?, teamB_p1 = ?, teamB_p2 = ? WHERE id = ?`,
            [tA[0].name, tA[1].name, tB[0].name, tB[1].name, courtId], () => {
              [tA[0], tA[1], tB[0], tB[1]].forEach(player => {
                if (player.duoGamesRemaining > 1) {
                  db.run(`UPDATE participants SET duoGamesRemaining = duoGamesRemaining - 1 WHERE user_id = ?`, [player.id]);
                } else if (player.duoGamesRemaining === 1) {
                  db.run(`UPDATE participants SET duoPartnerId = NULL, duoGamesRemaining = 0 WHERE user_id = ?`, [player.id]);
                }
              });
              res.redirect('/?tab=courts');
            });
        } else {
          const shuffled = availableRows.sort(() => 0.5 - Math.random());
          db.run(`UPDATE courts SET status = 'playing', teamA_p1 = ?, teamA_p2 = ?, teamB_p1 = ?, teamB_p2 = ? WHERE id = ?`,
            [shuffled[0].name, shuffled[1].name, shuffled[2].name, shuffled[3].name, courtId], () => {
              res.redirect('/?tab=courts');
            });
        }
      } else {
        res.send("<script>alert('투입할 인원이 부족합니다. (대기 인원 4인 미만)'); history.back();</script>");
      }
    });
  });
});

app.post('/courts/:courtId/score', (req, res) => {
  const { courtId } = req.params;
  const { teamA_score, teamB_score } = req.body;

  db.get(`SELECT * FROM courts WHERE id = ?`, [courtId], (err, court) => {
    if (court) {
      const scoreA = parseInt(teamA_score);
      const scoreB = parseInt(teamB_score);
      const winner = scoreA > scoreB ? 'A' : 'B';

      db.run(`INSERT INTO matches (teamA_p1, teamA_p2, teamB_p1, teamB_p2, teamA_score, teamB_score, winner) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [court.teamA_p1, court.teamA_p2, court.teamB_p1, court.teamB_p2, scoreA, scoreB, winner], function() {
          
          db.all(`SELECT * FROM users WHERE name IN (?, ?, ?, ?)`, [court.teamA_p1, court.teamA_p2, court.teamB_p1, court.teamB_p2], (err, users) => {
            if (users && users.length > 0) {
              const teamAUsers = users.filter(u => u.name === court.teamA_p1 || u.name === court.teamA_p2);
              const teamBUsers = users.filter(u => u.name === court.teamB_p1 || u.name === court.teamB_p2);

              const avgA = teamAUsers.reduce((acc, u) => acc + u.mmr, 0) / (teamAUsers.length || 1);
              const avgB = teamBUsers.reduce((acc, u) => acc + u.mmr, 0) / (teamBUsers.length || 1);

              const kFactor = 32;
              const expectedA = 1 / (1 + Math.pow(10, (avgB - avgA) / 400));
              
              // 점수 차이에 따른 과도한 뻥튀기 방지를 위해 표준 Elo 공식으로 단순화 적용
              const changeAmount = Math.round(kFactor * ( (winner === 'A' ? 1 : 0) - expectedA ));

              users.forEach(u => {
                const isTeamA = teamAUsers.some(tu => tu.id === u.id);
                const isWinner = (winner === 'A' && isTeamA) || (winner === 'B' && !isTeamA);
                const newWins = u.wins + (isWinner ? 1 : 0);
                const newLosses = u.losses + (isWinner ? 0 : 1);
                const mmrDelta = isWinner ? Math.abs(changeAmount) : -Math.abs(changeAmount);
                const newMmr = Math.max(100, u.mmr + mmrDelta);

                db.run(`UPDATE users SET mmr = ?, wins = ?, losses = ? WHERE id = ?`, [newMmr, newWins, newLosses, u.id]);
              });
            }

            db.run(`UPDATE courts SET status = 'empty', teamA_p1 = '-', teamA_p2 = '-', teamB_p1 = '-', teamB_p2 = '-' WHERE id = ?`, [courtId], () => {
              res.redirect('/?tab=courts');
            });
          });
        });
    } else {
      res.redirect('/?tab=courts');
    }
  });
});

// 8. 관리자 듀오 및 설정 라우터
app.post('/admin/sync-duo', (req, res) => {
  if (!req.session.user || (req.session.user.role !== 'master' && req.session.user.role !== 'admin')) {
    return res.send("<script>alert('권한이 없습니다.'); history.back();</script>");
  }
  
  let user_ids = req.body.user_ids;
  if (!user_ids) {
    db.run(`UPDATE participants SET duoPartnerId = NULL, duoGamesRemaining = 0`, [], () => {
      res.redirect('/?tab=courts');
    });
    return;
  }

  if (!Array.isArray(user_ids)) {
    user_ids = [user_ids];
  }
  user_ids = user_ids.map(id => parseInt(id));

  db.all(`SELECT user_id, duoPartnerId, duoGamesRemaining FROM participants WHERE duoGamesRemaining > 0`, [], (err, currentDuos) => {
    const existingDuoIds = new Set();
    currentDuos.forEach(d => existingDuoIds.add(d.user_id));

    const newSelected = user_ids.filter(id => !existingDuoIds.has(id));

    if (newSelected.length === 2) {
      db.run(`UPDATE participants SET duoPartnerId = ?, duoGamesRemaining = 3 WHERE user_id = ?`, [newSelected[1], newSelected[0]], () => {
        db.run(`UPDATE participants SET duoPartnerId = ?, duoGamesRemaining = 3 WHERE user_id = ?`, [newSelected[0], newSelected[1]], () => {
          res.redirect('/?tab=courts');
        });
      });
    } else {
      res.redirect('/?tab=courts');
    }
  });
});

app.post('/admin/remove-duo', (req, res) => {
  if (!req.session.user || (req.session.user.role !== 'master' && req.session.user.role !== 'admin')) {
    return res.send("<script>alert('권한이 없습니다.'); history.back();</script>");
  }
  const { user_id } = req.body;
  db.get(`SELECT duoPartnerId FROM participants WHERE user_id = ?`, [user_id], (err, row) => {
    const partnerId = row ? row.duoPartnerId : null;
    db.run(`UPDATE participants SET duoPartnerId = NULL, duoGamesRemaining = 0 WHERE user_id = ?`, [user_id], () => {
      if (partnerId) {
        db.run(`UPDATE participants SET duoPartnerId = NULL, duoGamesRemaining = 0 WHERE user_id = ?`, [partnerId], () => {
          res.redirect('/?tab=courts');
        });
      } else {
        res.redirect('/?tab=courts');
      }
    });
  });
});

app.post('/admin/reset-all-mmr', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'master') return res.send("<script>alert('마스터 권한이 필요합니다.'); history.back();</script>");
  db.run(`UPDATE users SET mmr = 1000, wins = 0, losses = 0`, () => {
    db.run(`DELETE FROM matches`, () => {
      res.redirect('/?profile');
    });
  });
});

app.post('/admin/users/:id/role', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'master') return res.send("<script>alert('마스터 권한이 필요합니다.'); history.back();</script>");
  const userId = req.params.id;
  const { role } = req.body;
  db.run(`UPDATE users SET role = ? WHERE id = ?`, [role, userId], () => {
    res.redirect('/?profile');
  });
});

// 서버 실행
app.listen(PORT, () => {
  console.log(`서버가 정상적으로 실행 중입니다: http://localhost:${PORT}`);
});