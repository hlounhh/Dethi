'use strict';

let itemsPerPage = window.innerWidth > 768 ? 9 : 5;
let viewingProfileUsername = null;
let profileCurrentTab  = 'posts';
let profileCurrentPage = 1;

// ───── DOM REFS ───────────────────────────────────────────────────────────────
const pCover        = $('profile-cover');
const pAvatar       = $('profile-avatar');
const pDisplayName  = $('profile-display-name');
const pUsername     = $('profile-username');
const pBio          = $('profile-bio');
const pPostCount    = $('profile-post-count');
const pSavedCount   = $('profile-saved-count');
const pJoined       = $('profile-joined');
const btnEditProfile= $('btn-edit-profile');
const pGrid         = $('profile-grid');
const pPagCtl       = $('profile-pagination-controls');
const pTabSavedBtn  = $('tab-saved-btn');

const editProfileOverlay = $('edit-profile-overlay');
const editPBtnSave       = $('btn-save-profile');
const editPNickname      = $('edit-nickname');
const editPBio           = $('edit-bio');
const editPAvatarPreview = $('edit-avatar-preview');
const editPCoverPreview  = $('edit-cover-preview');

const detailOverlay = $('detail-overlay');
const lightboxEl    = $('lightbox');
const lightboxImg   = $('lightbox-img');

// ───── INIT ───────────────────────────────────────────────────────────────────
async function initProfile() {
  loadSession();
  const urlParams = new URLSearchParams(window.location.search);
  viewingProfileUsername = urlParams.get('user');
  if (!viewingProfileUsername) {
    document.body.innerHTML = '<div style="text-align:center;padding:50px;font-family:sans-serif"><h2>Tham số không hợp lệ</h2><a href="index.html">Quay lại trang chủ</a></div>';
    return;
  }
  bindProfileEvents();

  // Hiện cache ngay
  const cached = loadCache();
  if (cached) {
    posts = cached.posts; users = cached.users;
    hydrateAllUsers(); hydrateUserObj();
    renderAuthUI(); renderProfileView();
  }

  // Luôn fetch fresh
  try {
    await loadData();
    hydrateAllUsers(); hydrateUserObj();
    saveCache({ posts, users });
    renderAuthUI(); renderProfileView();
  } catch (err) {
    console.error('[profile init] lỗi:', err);
    if (!cached) showToast('Không thể kết nối server!', 'error');
  }
  if (typeof startPolling === 'function') startPolling();
}

// ───── RENDER PROFILE ─────────────────────────────────────────────────────────
function renderProfileView() {
  const user = users.find(u => u.username === viewingProfileUsername);
  if (!user) {
    document.body.innerHTML = '<div style="text-align:center;padding:50px;font-family:sans-serif"><h2>Người dùng không tồn tại</h2><a href="index.html">Quay lại</a></div>';
    return;
  }
  if (pCover)       pCover.src        = user.cover  || '';
  if (pAvatar)      pAvatar.src       = user.avatar || '';
  if (pDisplayName) pDisplayName.textContent = user.nickname || user.username;
  if (pUsername)    pUsername.textContent    = '@' + user.username;
  if (pBio)         pBio.textContent         = user.bio || 'Chưa có tiểu sử.';
  if (pJoined)      pJoined.textContent      = user.createdAt ? new Date(user.createdAt).toLocaleDateString('vi-VN') : 'Từ lâu';

  const userPosts = posts.filter(p => p.author === viewingProfileUsername);
  if (pPostCount)  pPostCount.textContent  = userPosts.length;
  if (pSavedCount) pSavedCount.textContent = (user.savedPosts || []).length;

  const isOwner = currentUser === viewingProfileUsername;
  if (btnEditProfile) btnEditProfile.style.display = isOwner ? 'block' : 'none';
  if (pTabSavedBtn)   pTabSavedBtn.style.display   = isOwner ? 'inline-block' : 'none';

  // Delete account button — only for own account, not admin
  const deleteBtn = $('btn-delete-account');
  if (deleteBtn) deleteBtn.style.display = (isOwner && currentUser !== ADMIN.username) ? 'inline-block' : 'none';

  switchProfileTab('posts');
}

function switchProfileTab(tab) {
  window.profileCurrentTab = tab;
  profileCurrentTab = tab;
  document.querySelectorAll('.profile-tab').forEach(b => {
    b.classList.remove('active');
    b.style.color = 'var(--gray-500)';
    b.style.borderBottomColor = 'transparent';
  });
  const act = document.querySelector(`.profile-tab[data-tab="${tab}"]`);
  if (act) { act.classList.add('active'); act.style.color = 'var(--orange-600)'; act.style.borderBottomColor = 'var(--orange-500)'; }
  profileCurrentPage = 1;
  window.renderProfileContent();
}

window.renderProfileContent = function() {
  let filtered = [];
  if (profileCurrentTab === 'posts') {
    filtered = posts.filter(p => p.author === viewingProfileUsername);
  } else {
    const u = users.find(u => u.username === viewingProfileUsername);
    if (u?.savedPosts) filtered = u.savedPosts.map(id => posts.find(p => p.id === id)).filter(Boolean);
  }
  pGrid.innerHTML = ''; pPagCtl.innerHTML = '';
  if (!filtered.length) {
    pGrid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:50px;color:var(--gray-500)">Chưa có bài đăng nào.</div>`;
    return;
  }
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  if (profileCurrentPage > totalPages && totalPages > 0) profileCurrentPage = totalPages;
  const slice = filtered.slice((profileCurrentPage - 1) * itemsPerPage, profileCurrentPage * itemsPerPage);
  slice.forEach((post, idx) => pGrid.appendChild(buildPostCard(post, idx)));
  if (totalPages > 1) {
    for (let i = 1; i <= totalPages; i++) {
      const btn = document.createElement('button');
      btn.className = `pagination-btn ${i === profileCurrentPage ? 'active' : ''}`;
      btn.textContent = i;
      btn.onclick = () => { profileCurrentPage = i; window.renderProfileContent(); pGrid.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      pPagCtl.appendChild(btn);
    }
  }
};

// ───── BUILD POST CARD ────────────────────────────────────────────────────────
function buildPostCard(post, idx) {
  const card = document.createElement('article');
  card.className = 'post-card';
  card.style.animationDelay = (idx * 60) + 'ms';

  const isSaved = !!(loggedInUserObj?.savedPosts?.includes(post.id));
  const bookmarkHtml = `
    <button class="btn-bookmark" onclick="toggleBookmark(event,'${post.id}')" title="${isSaved ? 'Tháo lưu' : 'Lưu'}"
      style="position:absolute;top:8px;right:8px;z-index:10;background:none;border:none;color:${isSaved ? '#ef4444' : 'white'};cursor:pointer;padding:2px;transition:all .2s">
      <svg width="24" height="24" fill="${isSaved ? '#ef4444' : 'rgba(0,0,0,0.3)'}" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/>
      </svg>
    </button>`;

  let thumbHtml = '';
  if (post.examImages?.length)  thumbHtml = `<img src="${post.examImages[0]}" alt="Ảnh đề" loading="lazy">`;
  else if (post.docs?.length)   thumbHtml = `<div class="no-image" style="background:#fffaf0;color:var(--orange-500)"><span style="font-size:32px;display:block;margin-bottom:8px">📄</span><span>Có ${post.docs.length} tệp</span></div>`;
  else                          thumbHtml = `<div class="no-image"><svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg><span>Chưa có ảnh</span></div>`;

  const pAuthorObj  = users.find(u => u.username === post.author);
  const displayName = pAuthorObj?.nickname || pAuthorObj?.username || post.author;

  card.innerHTML = `
    <div class="post-card-thumb">
      ${thumbHtml}
      ${bookmarkHtml}
    </div>
    <div class="post-card-body">
      <div class="post-card-title">${escHtml(post.title)}</div>
      <div class="post-card-meta">
        <span class="post-card-author" onclick="event.stopPropagation();window.openUserProfile('${post.author}')" style="cursor:pointer">
          <img src="${pAuthorObj?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random&color=fff&size=100`}"
            style="width:18px;height:18px;border-radius:50%;object-fit:cover;margin-right:2px"
            onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random&color=fff&size=100'">
          ${escHtml(displayName)}
        </span>
        <span style="color:var(--orange-500);font-weight:600">${formatTimeAgo(post.createdAt)}</span>
      </div>
    </div>`;

  card.querySelector('.post-card-thumb').addEventListener('click', e => { if (!e.target.closest('.btn-bookmark')) window.openDetail(post.id); });
  card.querySelector('.post-card-body').addEventListener('click', () => window.openDetail(post.id));
  return card;
}

// ───── DETAIL VIEW (standalone on profile page) ───────────────────────────────
function _buildDocHtml(doc) {
  const src = doc.url || doc.data || '';
  if (!src) return '';
  const ext  = (doc.name || '').split('.').pop().toLowerCase();
  const icon = ext === 'pdf' ? '📕' : ext.startsWith('doc') ? '📘' : '📄';
  const sizeStr = doc.size ? `(${(doc.size / 1024).toFixed(0)} KB)` : '';
  return `
    <div class="doc-item-container">
      <div class="doc-title">
        <span>${icon} ${escHtml(doc.name || 'Tệp đính kèm')} <span style="font-size:12px;color:var(--gray-400);font-weight:400">${sizeStr}</span></span>
        <a href="${src}" download="${escHtml(doc.name || 'file')}" target="_blank" class="doc-download-btn lg">⬇ Tải xuống</a>
      </div>
    </div>`;
}

window.openDetail = function(postId) {
  const post = posts.find(p => p.id === postId);
  if (!post || !detailOverlay) return;

  const docHtml   = post.docs?.length ? post.docs.map(_buildDocHtml).join('') : '';
  const hasExam   = !!(post.examImages?.length);
  const examHtml  = hasExam ? post.examImages.map((src, i) => `<div class="exam-image-item"><span class="page-label">Trang ${i+1}</span><img src="${src}" loading="lazy" onclick="openLightbox('${src}')"></div>`).join('') : '';
  const hasAnswer = !!(post.answerImages?.length);
  const ansHtml   = hasAnswer ? post.answerImages.map((src, i) => `<div class="exam-image-item"><span class="page-label">Trang ${i+1}</span><img src="${src}" loading="lazy" onclick="openLightbox('${src}')"></div>`).join('') : '';
  const pAuthorObj  = users.find(u => u.username === post.author);
  const displayName = pAuthorObj?.nickname || pAuthorObj?.username || post.author;

  detailOverlay.innerHTML = `
    <div class="detail-container">
      <button class="detail-close-btn" onclick="window.closeDetail()">
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
        Quay lại
      </button>
      <div class="detail-header">
        <div class="detail-title">${escHtml(post.title)}</div>
        <div class="detail-meta" style="margin-top:12px">
          <span class="detail-meta-item author" onclick="window.closeDetail();window.openUserProfile('${post.author}')" style="cursor:pointer">
            <img src="${pAuthorObj?.avatar||`https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random&color=fff&size=100`}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;">
            ${escHtml(displayName)}
          </span>
          <span class="detail-meta-item">
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
            <span style="font-weight:600;color:var(--gray-800)">${formatTimeAgo(post.createdAt)}</span>
          </span>
        </div>
      </div>
      ${docHtml}
      ${hasExam ? `<div class="detail-section-title"><div class="detail-section-title-dot"></div>Đề thi</div><div class="exam-images-grid" id="detail-exam-grid">${examHtml}</div>` : ''}
      ${hasAnswer ? `
        <button class="answer-toggle-btn" id="answer-toggle-btn" onclick="toggleAnswer()"><span class="btn-icon">📖</span> XEM ĐÁP ÁN</button>
        <div class="detail-section-title" id="ans-section-title" style="display:none"><div class="detail-section-title-dot" style="background:#4ade80;box-shadow:0 0 8px #4ade80"></div>Đáp án</div>
        <div class="answer-images-grid" id="detail-ans-grid">${ansHtml}</div>` : ''}
    </div>`;
  openModal(detailOverlay);
};

window.closeDetail = function() {
  if (detailOverlay) { closeModal(detailOverlay); detailOverlay.innerHTML = ''; }
};

window.toggleAnswer = function() {
  const grid = $('detail-ans-grid'), btn = $('answer-toggle-btn'), sec = $('ans-section-title');
  if (!grid) return;
  const isOpen = grid.classList.toggle('open');
  if (sec) sec.style.display = isOpen ? 'flex' : 'none';
  btn.innerHTML = isOpen ? `<span class="btn-icon">🙈</span> ẨN ĐÁP ÁN` : `<span class="btn-icon">📖</span> XEM ĐÁP ÁN`;
};

window.openLightbox = function(src) { if (lightboxImg) lightboxImg.src = src; openModal(lightboxEl); };
lightboxEl?.addEventListener('click', e => {
  if (e.target === lightboxEl || e.target.classList.contains('lightbox-close')) {
    lightboxEl.classList.remove('open');
    document.body.style.overflow = detailOverlay?.classList.contains('open') ? 'hidden' : '';
  }
});

let selectedAvatarBase64 = null;
let selectedCoverBase64  = null;

function bindProfileEvents() {
  window.addEventListener('resize', () => {
    const np = window.innerWidth > 768 ? 9 : 5;
    if (np !== itemsPerPage) { itemsPerPage = np; profileCurrentPage = 1; window.renderProfileContent(); }
  });

  document.querySelectorAll('.profile-tab').forEach(btn =>
    btn.addEventListener('click', () => switchProfileTab(btn.dataset.tab))
  );

  btnEditProfile?.addEventListener('click', () => {
    if (!loggedInUserObj) return;
    editPNickname.value          = loggedInUserObj.nickname || loggedInUserObj.username;
    editPBio.value               = loggedInUserObj.bio || '';
    editPAvatarPreview.src       = loggedInUserObj.avatar || '';
    editPAvatarPreview.style.display = 'inline-block';
    editPCoverPreview.src        = loggedInUserObj.cover  || '';
    editPCoverPreview.style.display  = 'block';
    $('edit-avatar-input').value = '';
    $('edit-cover-input').value  = '';
    selectedAvatarBase64 = null;
    selectedCoverBase64  = null;
    openModal(editProfileOverlay);
  });

  // Optimistic avatar preview — update instantly before upload via FileReader
  $('edit-avatar-input')?.addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = ev => {
      selectedAvatarBase64 = ev.target.result;
      editPAvatarPreview.src = ev.target.result; 
      editPAvatarPreview.style.display = 'inline-block';
    };
    r.readAsDataURL(file);
  });

  // Optimistic cover preview — update instantly before upload via FileReader
  $('edit-cover-input')?.addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = ev => {
      selectedCoverBase64 = ev.target.result;
      editPCoverPreview.src = ev.target.result;
      editPCoverPreview.style.display = 'block';
    };
    r.readAsDataURL(file);
  });

  editPBtnSave?.addEventListener('click', async () => {
    if (!loggedInUserObj) return;
    const newNick = editPNickname.value.trim();
    if (!newNick) { showToast('Nickname không được để trống!', 'error'); return; }
    editPBtnSave.disabled = true; editPBtnSave.textContent = '⏳ Đang lưu...';

    try {
      let finalAvatar = loggedInUserObj.avatar;
      let finalCover  = loggedInUserObj.cover;

      if (selectedAvatarBase64) {
        finalAvatar = await uploadToImgBB(selectedAvatarBase64);
      }
      if (selectedCoverBase64) {
        finalCover = await uploadToImgBB(selectedCoverBase64);
      }

      // Cập nhật lên object reference mới nhất sau khi await (phòng trường hợp polling đã replace users array)
      const targetUser = users.find(u => u.username === currentUser);
      if (targetUser) {
        targetUser.nickname = newNick;
        targetUser.bio      = editPBio.value.trim();
        targetUser.avatar   = finalAvatar;
        targetUser.cover    = finalCover;
      } else {
        // Fallback
        loggedInUserObj.nickname = newNick;
        loggedInUserObj.bio      = editPBio.value.trim();
        loggedInUserObj.avatar   = finalAvatar;
        loggedInUserObj.cover    = finalCover;
      }

      hydrateUserObj();
      _writeCache(); // Dùng func chuẩn từ core.js
      saveData().catch(e => console.warn('Lưu profile lỗi:', e));
      showToast('Cập nhật hồ sơ thành công!', 'success');
      closeModal(editProfileOverlay);
      renderProfileView(); renderAuthUI();
    } catch (err) {
      showToast('Lỗi: ' + err.message, 'error');
    } finally {
      editPBtnSave.disabled = false; editPBtnSave.textContent = '💾 Lưu thông tin';
    }
  });

  // ── Delete account ──────────────────────────────────────────────────────────
  $('btn-delete-account')?.addEventListener('click', () => {
    $('delete-confirm-input').value = '';
    const errEl = $('delete-account-error');
    if (errEl) errEl.textContent = '';
    openModal($('delete-account-modal'));
  });

  $('btn-confirm-delete-account')?.addEventListener('click', async () => {
    const typed = $('delete-confirm-input').value.trim();
    if (typed !== currentUser) {
      const errEl = $('delete-account-error');
      if (errEl) errEl.textContent = 'Tên tài khoản không khớp!';
      return;
    }
    const btn = $('btn-confirm-delete-account');
    btn.disabled = true; btn.textContent = '⏳ Đang xóa...';
    try {
      posts = posts.filter(p => p.author !== currentUser);
      users = users.filter(u => u.username !== currentUser);
      users.forEach(u => { if (u.savedPosts) u.savedPosts = u.savedPosts.filter(id => posts.find(p => p.id === id)); });
      saveCache({ posts, users });
      await saveData();
      isLoggedIn = false; currentUser = null;
      saveSession(false);
      showToast('Tài khoản đã được xóa.', 'success');
      setTimeout(() => { window.location.href = 'index.html'; }, 1200);
    } catch (err) {
      showToast('Lỗi xóa tài khoản: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = '🗑️ Xác nhận xóa';
    }
  });

  $('btn-cancel-delete-account')?.addEventListener('click', () => closeModal($('delete-account-modal')));
}

document.addEventListener('DOMContentLoaded', initProfile);
