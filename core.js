'use strict';

// ───── CONFIG ─────────────────────────────────────────────────────────────────
const ADMIN            = { username: 'minhdung', password: 'minhdung2025' };
const JSONBIN_KEY      = '$2a$10$iuarimglGf1Wa/ycQG6sSuMFK9LzjlZF1Ae0TTe1V2YouaEeDznYi';
const IMGBB_KEY        = 'ef931cc7d12541c349847bca449b980b';
const HARDCODED_BIN_ID = '69dcc25136566621a8aa0daf';
const SESSION_KEY      = 'mathExamSession_v1';

// Cache key — giữ nguyên với key cũ để không mất data
const CACHE_KEY   = 'mathExam_cache_v1';
const CACHE_TTL   = 25_000; // 25s — luôn lấy fresh data sau 25s

// ───── STATE ──────────────────────────────────────────────────────────────────
let isLoggedIn      = false;
let currentUser     = null;
let loggedInUserObj = null;
let posts           = [];
let users           = [];
let binId           = HARDCODED_BIN_ID;
let toastTimer;

const $ = id => document.getElementById(id);

// ───── DATA ENGINE ────────────────────────────────────────────────────────────
async function loadData() {
  if (!binId) { posts = []; users = []; return; }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
        headers: { 'X-Master-Key': JSONBIN_KEY },
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
      }
      const data = await res.json();
      posts = Array.isArray(data.record?.posts) ? data.record.posts : [];
      users = Array.isArray(data.record?.users) ? data.record.users : [];
      return;
    } catch (err) {
      if (attempt < 3) await new Promise(r => setTimeout(r, 800 * attempt));
      else throw err;
    }
  }
}

// Safe posts: loại bỏ base64 image (examImages/answerImages là URL rồi), giữ doc URL
function _safePosts() {
  return posts.map(p => ({
    ...p,
    // examImages và answerImages đã là ImgBB URL — giữ nguyên
    // docs: chỉ lưu URL/Download link, nếu không có Supabase thì lưu tạm base64 (data)
    docs: (p.docs || []).map(d => ({
      name: d.name || '',
      type: d.type || '',
      url : d.url  || '',
      size: d.size || 0,
      data: d.data || '',
    })),
  }));
}

async function saveData() {
  if (!binId) throw new Error('Chưa có bin ID!');
  const payload = { posts: _safePosts(), users };
  const res = await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
    method : 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
    body   : JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => String(res.status));
    throw new Error('Lưu thất bại: ' + err.slice(0, 200));
  }
  // Broadcast update sang tab khác
  if (_bc) _bc.postMessage({ type: 'DATA_UPDATED' });
  // Cập nhật cache
  _writeCache();
}

// ───── USER HYDRATION ─────────────────────────────────────────────────────────
function hydrateAllUsers() {
  // Đảm bảo admin luôn tồn tại
  const adminExists = users.find(u => u.username === ADMIN.username);
  if (!adminExists) {
    users.unshift({
      id       : 'admin',
      username : ADMIN.username,
      password : ADMIN.password,
      nickname : 'minhdung',
      bio      : '',
      avatar   : `https://ui-avatars.com/api/?name=minhdung&background=f97316&color=fff&size=200`,
      cover    : 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=1200&q=80',
      createdAt: new Date().toISOString(),
      savedPosts: [],
    });
  }

  // Tạo user record cho các author chưa có
  const authorSet = new Set(posts.map(p => p.author).filter(Boolean));
  let hadNew = false;
  authorSet.forEach(author => {
    if (!users.find(u => u.username === author)) {
      users.push({
        id       : Date.now().toString() + Math.random().toString(36).slice(2, 7),
        username : author,
        password : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
        nickname : author,
        bio      : '',
        avatar   : `https://ui-avatars.com/api/?name=${encodeURIComponent(author)}&background=random&color=fff&size=200`,
        cover    : 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1200',
        createdAt: new Date().toISOString(),
        savedPosts: [],
      });
      hadNew = true;
    }
  });

  // Fill thiếu fields
  users.forEach(u => {
    if (!u.id)         u.id         = Date.now().toString() + Math.random().toString(36).slice(2, 7);
    if (!u.savedPosts) u.savedPosts = [];
    if (!u.createdAt)  u.createdAt  = new Date().toISOString();
    if (!u.nickname)   u.nickname   = u.username;
    if (u.bio === undefined) u.bio  = '';
    if (!u.avatar)     u.avatar     = `https://ui-avatars.com/api/?name=${encodeURIComponent(u.username)}&background=random&color=fff&size=200`;
    if (!u.cover)      u.cover      = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1200';
  });

  if (hadNew && binId) {
    // Lưu async không chặn
    fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
      method : 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
      body   : JSON.stringify({ posts: _safePosts(), users }),
    }).catch(e => console.warn('[hydrateAllUsers] auto-save lỗi:', e));
  }
}

function hydrateUserObj() {
  loggedInUserObj = isLoggedIn
    ? (users.find(u => u.username === currentUser) || null)
    : null;
}

// ───── IMAGE UPLOAD (ImgBB) ───────────────────────────────────────────────────
async function uploadToImgBB(base64DataUrl) {
  const base64 = base64DataUrl.includes(',') ? base64DataUrl.split(',')[1] : base64DataUrl;
  const form = new FormData();
  form.append('image', base64);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, {
    method: 'POST',
    body  : form,
  });
  if (!res.ok) throw new Error('ImgBB upload thất bại (HTTP ' + res.status + ')');
  const data = await res.json();
  if (!data.success) throw new Error(data.error?.message || 'ImgBB lỗi không rõ');
  return data.data.display_url;
}

// ───── CACHE ──────────────────────────────────────────────────────────────────
function _writeCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      posts: _safePosts(),
      users,
      ts: Date.now(),
    }));
  } catch (e) { console.warn('Cache write lỗi:', e); }
}
function saveCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      posts: (data.posts || []).map(p => ({
        ...p,
        docs: (p.docs || []).map(d => ({ name: d.name, type: d.type, url: d.url || '', size: d.size || 0, data: d.data || '' })),
      })),
      users: data.users || [],
      ts: Date.now(),
    }));
  } catch (e) { console.warn('Cache write lỗi:', e); }
}
function loadCache() {
  try {
    const obj = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (obj && Array.isArray(obj.posts) && Array.isArray(obj.users)) return obj;
    // Kiểm tra key cũ hơn
    const old = JSON.parse(localStorage.getItem('mathExam_cache_v2') || 'null');
    if (old && Array.isArray(old.posts) && Array.isArray(old.users)) return old;
    return null;
  } catch { return null; }
}
function getCacheAge() {
  try {
    const obj = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return obj?.ts ? (Date.now() - obj.ts) : null;
  } catch { return null; }
}

// ───── SESSION ────────────────────────────────────────────────────────────────
function loadSession() {
  const saved = localStorage.getItem(SESSION_KEY);
  if (saved && saved !== 'false' && saved !== 'null') {
    isLoggedIn  = true;
    currentUser = (saved === 'true') ? ADMIN.username : saved;
  }
}
function saveSession(username) {
  localStorage.setItem(SESSION_KEY, username ? username : 'false');
}

// ───── REAL-TIME: BROADCAST + POLLING ────────────────────────────────────────
let _pollInterval = null;
let _bc = null;
try { _bc = new BroadcastChannel('exam-sync'); } catch {}

function startPolling() {
  if (_pollInterval) return;

  if (_bc) {
    _bc.onmessage = async (evt) => {
      const { type, username } = evt.data || {};
      if (type === 'DATA_UPDATED') {
        try {
          const prevIds = new Set(posts.map(p => p.id));
          await loadData();
          hydrateAllUsers(); hydrateUserObj();
          _writeCache();
          renderAuthUI();
          const newPosts = posts.filter(p => !prevIds.has(p.id));
          if (newPosts.length) {
            if (typeof renderPosts === 'function') renderPosts();
            showToast(`📢 Có ${newPosts.length} bài đăng mới!`, 'success');
          } else {
            if (typeof renderPosts === 'function') renderPosts();
          }
        } catch {}
      } else if (type === 'NEW_USER' && isLoggedIn && currentUser === ADMIN.username) {
        showNewUserNotif(username);
      }
    };
  }

  _pollInterval = setInterval(async () => {
    if (document.hidden) return;
    try {
      const prevIds       = new Set(posts.map(p => p.id));
      const prevUsernames = new Set(users.map(u => u.username));
      const prevPostsStr  = JSON.stringify(posts);
      const prevUsersStr  = JSON.stringify(users);

      await loadData();
      hydrateAllUsers(); hydrateUserObj();

      const newPostsStr = JSON.stringify(posts);
      const newUsersStr = JSON.stringify(users);

      if (prevPostsStr !== newPostsStr || prevUsersStr !== newUsersStr) {
          _writeCache();
          renderAuthUI();

          const newPosts = posts.filter(p => !prevIds.has(p.id));
          if (typeof renderPosts === 'function') renderPosts();
          if (typeof window.renderProfileContent === 'function') window.renderProfileContent();
          
          if (newPosts.length) {
            showToast(`📢 Có ${newPosts.length} bài đăng mới!`, 'success');
          }

          // Admin notification khi có user mới
          if (isLoggedIn && currentUser === ADMIN.username) {
            users.filter(u => !prevUsernames.has(u.username))
                 .forEach(u => showNewUserNotif(u.username));
          }
      }
    } catch (e) { console.warn('[poll]', e.message); }
  }, 5_000);
}

// ───── NEW USER NOTIFICATION ──────────────────────────────────────────────────
let _notifQueue = [];
let _notifBusy  = false;

function showNewUserNotif(username) {
  _notifQueue.push(username);
  if (!_notifBusy) _drainNotifQueue();
}
function _drainNotifQueue() {
  if (!_notifQueue.length) { _notifBusy = false; return; }
  _notifBusy = true;
  const uname = _notifQueue.shift();
  let el = document.getElementById('new-user-notif');
  if (!el) {
    el = document.createElement('div');
    el.id = 'new-user-notif';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="nun-icon">🎉</div>
    <div class="nun-body">
      <div class="nun-title">Thành viên mới!</div>
      <div class="nun-sub"><strong>${escHtml(uname)}</strong> vừa đăng ký</div>
    </div>`;
  el.className = 'new-user-notif show';
  setTimeout(() => { el.classList.remove('show'); setTimeout(_drainNotifQueue, 450); }, 5000);
}

// ───── COMMON UTILS ───────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.className   = 'toast' + (type ? ' ' + type : '');
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

window.isSupabaseConfigured = function() { return false; };
window.uploadToSupabase = async function() { throw new Error('Supabase not configured'); };

function formatTimeAgo(iso) {
  if (!iso) return 'gần đây';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (isNaN(s) || s < 0) return 'gần đây';
  if (s < 60)  return 'Vừa xong';
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d < 7)   return `${d} ngày trước`;
  const w = Math.floor(d / 7);
  if (w < 52)  return `${w} tuần trước`;
  return `${Math.floor(d / 365)} năm trước`;
}

function openModal(el)  { if (el) { el.classList.add('open');    document.body.style.overflow = 'hidden'; } }
function closeModal(el) { if (el) { el.classList.remove('open'); document.body.style.overflow = ''; } }

// ───── AUTH UI ────────────────────────────────────────────────────────────────
function renderAuthUI() {
  hydrateUserObj();
  const btnLogin  = $('btn-login');
  const userChip  = $('user-chip');
  const nameSpan  = $('user-name-display');
  const navAvatar = $('nav-avatar');
  const fabAdd    = $('fab-add');

  if (isLoggedIn && loggedInUserObj) {
    btnLogin?.setAttribute('style', 'display:none');
    if (userChip)  userChip.style.display  = 'flex';
    if (nameSpan)  nameSpan.textContent    = loggedInUserObj.nickname || loggedInUserObj.username;
    if (navAvatar && loggedInUserObj.avatar) navAvatar.src = loggedInUserObj.avatar;
    fabAdd?.classList.add('visible');
  } else {
    btnLogin?.setAttribute('style', 'display:flex');
    if (userChip)  userChip.style.display  = 'none';
    fabAdd?.classList.remove('visible');
  }
}

function loginAs(username) {
  isLoggedIn  = true;
  currentUser = username;
  saveSession(username);
  closeModal($('login-modal'));
  hydrateUserObj();
  renderAuthUI();
  if (typeof renderPosts          === 'function') renderPosts();
  if (typeof renderProfileContent === 'function') renderProfileContent();
  showToast('Đăng nhập thành công! 🎉', 'success');
  $('login-form')?.reset();
}

// ───── BOOKMARK ───────────────────────────────────────────────────────────────
window.toggleBookmark = async function(e, postId) {
  e.stopPropagation();
  if (!isLoggedIn || !loggedInUserObj) {
    showToast('Vui lòng đăng nhập để lưu bài.', 'error');
    openModal($('login-modal'));
    return;
  }
  if (!loggedInUserObj.savedPosts) loggedInUserObj.savedPosts = [];
  const idx  = loggedInUserObj.savedPosts.indexOf(postId);
  const icon = e.currentTarget.querySelector('svg');
  if (idx !== -1) {
    loggedInUserObj.savedPosts.splice(idx, 1);
    e.currentTarget.style.color = 'white';
    icon?.setAttribute('fill', 'rgba(0,0,0,0.3)');
    showToast('Đã bỏ lưu bài viết.');
  } else {
    loggedInUserObj.savedPosts.push(postId);
    e.currentTarget.style.color = '#ef4444';
    icon?.setAttribute('fill', '#ef4444');
    showToast('Đã lưu bài viết vào hồ sơ! ❤️', 'success');
  }
  _writeCache();
  saveData().catch(err => console.warn('[bookmark]', err.message));
  if (typeof renderProfileContent === 'function' && window.profileCurrentTab === 'saved')
    renderProfileContent();
};

window.openUserProfile = function(username) {
  window.location.href = `profile.html?user=${encodeURIComponent(username)}`;
};

// ───── DOM BOOTSTRAP ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Nút đăng nhập
  $('btn-login')?.addEventListener('click', () => openModal($('login-modal')));

  // User chip → dropdown
  const chipInner  = $('user-chip-inner');
  const dropdown   = $('user-menu-dropdown');
  if (chipInner && dropdown) {
    chipInner.addEventListener('click', e => {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    });
    document.addEventListener('click', () => { if (dropdown) dropdown.style.display = 'none'; });
    dropdown.addEventListener('click', e => e.stopPropagation());
  }

  $('menu-view-profile')?.addEventListener('click', () => {
    if (currentUser) window.location.href = `profile.html?user=${encodeURIComponent(currentUser)}`;
  });

  $('menu-logout')?.addEventListener('click', () => {
    isLoggedIn = false; currentUser = null; loggedInUserObj = null;
    saveSession(null);
    if (dropdown) dropdown.style.display = 'none';
    renderAuthUI();
    if (typeof renderPosts === 'function') renderPosts();
    showToast('Đã đăng xuất!');
    if (window.location.pathname.includes('profile.html'))
      window.location.href = 'index.html';
  });

  // Modal close buttons (data-close="<id>")
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-close');
      if (id) closeModal($(id));
    });
  });

  // ── Auth form ──────────────────────────────────────────────────────────────
  let isRegisterMode = false;

  function _setAuthMode(register) {
    isRegisterMode = register;
    const title  = $('auth-modal-title');
    const submit = $('auth-submit-btn');
    const swText = $('auth-switch-text');
    const swLink = $('auth-toggle-btn');
    if (title)  title.textContent  = register ? 'Đăng ký'     : 'Đăng nhập';
    if (submit) submit.textContent = register ? 'Đăng ký'     : 'Đăng nhập';
    if (swText) swText.textContent = register ? 'Đã có tài khoản?' : 'Chưa có tài khoản?';
    if (swLink) swLink.textContent = register ? 'Đăng nhập'   : 'Đăng ký ngay';
    const errEl = $('login-error');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  }

  $('auth-toggle-btn')?.addEventListener('click', e => {
    e.preventDefault();
    _setAuthMode(!isRegisterMode);
  });

  // Reset mode mỗi khi mở modal
  $('btn-login')?.addEventListener('click', () => _setAuthMode(false));

  $('login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const uRaw = $('login-username')?.value?.trim() || '';
    const p    = $('login-password')?.value || '';
    const u    = uRaw.toLowerCase();
    const errEl = $('login-error');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

    if (!u || !p) return;

    const showErr = msg => {
      if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    };

    const submitBtn = $('auth-submit-btn');

    if (isRegisterMode) {
      // Đăng ký
      if (u === ADMIN.username || users.find(x => x.username === u)) {
        showErr('Tên đăng nhập đã tồn tại!');
        return;
      }
      if (u.length < 3) { showErr('Tên đăng nhập phải có ít nhất 3 ký tự!'); return; }
      if (p.length < 4) { showErr('Mật khẩu phải có ít nhất 4 ký tự!'); return; }

      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Đang xử lý...';

      const newUser = {
        id        : Date.now().toString() + Math.random().toString(36).slice(2, 7),
        username  : u,
        password  : p,
        nickname  : uRaw,
        bio       : '',
        avatar    : `https://ui-avatars.com/api/?name=${encodeURIComponent(uRaw)}&background=random&color=fff&size=200`,
        cover     : 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1200',
        createdAt : new Date().toISOString(),
        savedPosts: [],
      };
      users.push(newUser);
      _writeCache();                              // lưu cache ngay
      loginAs(u);                                 // đăng nhập ngay
      if (_bc) _bc.postMessage({ type: 'NEW_USER', username: u });
      saveData().catch(err => console.warn('[register] save lỗi:', err));

      submitBtn.disabled = false;
      submitBtn.textContent = 'Đăng ký';
    } else {
      // Đăng nhập
      const isAdmin = u === ADMIN.username && p === ADMIN.password;
      const userRec = users.find(x => x.username === u && x.password === p);
      if (isAdmin || userRec) {
        loginAs(u);
      } else {
        showErr('Tên đăng nhập hoặc mật khẩu không đúng.');
        $('login-password').value = '';
      }
    }
  });
});
