/* ═══════════════════════════════════════════════════════════
   WINGED — app.js
   Complete rewrite: clean architecture, mobile-first
═══════════════════════════════════════════════════════════ */

'use strict';

// ── STATE ──────────────────────────────────────────────────
let currentUser = null;
let currentProfile = null;
let feedOffset = 0;
let feedLoading = false;
let feedExhausted = false;
let unreadCount = 0;
let notifChannel = null;
let postsChannel = null;
let selectedFile = null;
let repostTargetId = null;
let repostTargetBtn = null;
let slideStack = [];           // navigation stack for back button
let lastMainPage = 'feed';     // track which main tab was active before sliding
let longPressTimer = null;
let detailPostId = null;
let detailCommentParentId = null;
let editAvatarFile = null;
let editCoverFile = null;
const likedPosts = new Set();
const repostedPosts = new Map();   // postId → myRepostId
const loadedPostIds = new Set();

const MAX_CHARS = 280;

// ── WAIT FOR SUPABASE ──────────────────────────────────────
window.addEventListener('supabase-ready', init);

// ── INIT ──────────────────────────────────────────────────
async function init() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      showAuthScreen();
      return;
    }
    currentUser = session.user;
    await bootApp();
  } catch (e) {
    console.error('Init error:', e);
    showAuthScreen();
  }
}

async function bootApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').classList.remove('hidden');

  injectFeedPostStyles();
  injectEchoesPanel();

  await loadMyProfile();
  updateNavAvatar();
  loadFeed();
  loadNotifications();
  loadInitialNotifCount();
  subscribeToNotifs();
  subscribeToPostUpdates();
  initComposerFile();
  initIntersectionObserver();
  initCommentBarInput();

  // Check dark mode pref
  if (localStorage.getItem('darkMode') === 'true') {
    document.documentElement.setAttribute('data-theme', 'dark');
    const toggle = document.getElementById('dark-mode-toggle');
    if (toggle) toggle.checked = true;
  }
}

// ══════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════

let isSignup = false;

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').classList.add('hidden');
}

function setAuthTab(mode) {
  isSignup = mode === 'signup';
  document.getElementById('tab-login').classList.toggle('active', !isSignup);
  document.getElementById('tab-signup').classList.toggle('active', isSignup);
  document.getElementById('auth-btn-text').textContent = isSignup ? 'Create Account' : 'Sign In';
  document.getElementById('username-wrap').style.display = isSignup ? 'flex' : 'none';
  document.getElementById('auth-error').textContent = '';
}

async function handleAuth() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errorEl = document.getElementById('auth-error');
  const loader = document.getElementById('auth-loader');
  const btnText = document.getElementById('auth-btn-text');

  if (!email || !password) { errorEl.textContent = 'Please fill in all fields'; return; }

  loader.style.display = 'block'; btnText.style.display = 'none';
  errorEl.textContent = '';

  try {
    if (isSignup) {
      const username = document.getElementById('auth-username')?.value?.trim() || '';
      if (!username) { throw new Error('Please enter a username'); }

      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;

      if (data.user) {
        await supabase.from('users').upsert({
          id: data.user.id,
          username: '@' + username.replace(/^@/, '').replace(/\s/g, ''),
          bio: '', location: '', avatar: '', cover: '',
          followers: 0, following: 0
        });

        // Auto-login
        const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
        if (!loginErr) {
          currentUser = data.user;
          await bootApp();
          return;
        }
        errorEl.style.color = '#6C47FF';
        errorEl.textContent = 'Account created! Check your email to verify, then sign in.';
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      currentUser = data.user;
      await bootApp();
    }
  } catch (e) {
    errorEl.textContent = e.message || 'Authentication failed';
  } finally {
    loader.style.display = 'none'; btnText.style.display = 'block';
  }
}

async function handleLogout() {
  showActionSheet([
    { label: 'Sign Out', danger: true, action: async () => {
      await supabase.auth.signOut();
      currentUser = null; currentProfile = null;
      loadedPostIds.clear(); likedPosts.clear(); repostedPosts.clear();

      // Clean up realtime channels
      if (notifChannel) { supabase.removeChannel(notifChannel); notifChannel = null; }
      if (postsChannel) { supabase.removeChannel(postsChannel); postsChannel = null; }

      document.getElementById('app').classList.add('hidden');
      showAuthScreen();
    }}
  ]);
}

// ══════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════

function navTo(pageId) {
  const pages = ['feed','discover','notifications','profile'];
  pages.forEach(id => {
    const el = document.getElementById('page-' + id);
    if (el) el.classList.toggle('active', id === pageId);
    document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === pageId);
    });
  });

  if (pageId === 'notifications') {
    unreadCount = 0;
    updateNotifDot();
    markAllRead();
  }
  if (pageId === 'profile') {
    renderMyProfile();
    const myHdr = document.getElementById('my-profile-header');
    if (myHdr) myHdr.style.display = 'flex';
    // Re-evaluate header colour based on current scroll position
    const myPage = document.getElementById('page-profile');
    if (myPage?._myprfScroll) myPage._myprfScroll();
    else if (myHdr) myHdr.style.background = 'rgba(0,0,0,0)';
  } else {
    const myHdr = document.getElementById('my-profile-header');
    if (myHdr) { myHdr.style.display = 'none'; }
    const myPage = document.getElementById('page-profile');
    if (myPage?._myprfAvatarObs) myPage._myprfAvatarObs.disconnect();
  }
  if (pageId === 'discover') {
    loadDiscover();
  }
  if (pageId === 'feed') {
    if (loadedPostIds.size === 0) loadFeed();
  }
}

function animateCount(el, newVal) {
  if (!el) return;
  const current = parseInt(el.textContent.replace(/[^0-9]/g,'')) || 0;
  // Stat table elements always show 0; feed hearts hide when 0
  const isStatEl = el.closest('.dp-stat, .detail-stats');
  el.textContent = (newVal > 0 || isStatEl) ? fmtNum(newVal) : '';

  if (newVal === current) return;

  const scale = newVal > current ? 1.35 : 0.75;
  el.style.transition = 'none';
  el.style.transform = `scale(${scale})`;
  void el.offsetWidth;
  el.style.transition = 'transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
  el.style.transform = 'scale(1)';
}

function slideTo(pageId, setupFn) {
  slideStack.push(pageId);
  const el = document.getElementById('page-' + pageId);
  if (!el) return;

  // Track which main page we're leaving
  const mainPages = ['feed','discover','notifications','profile'];
  mainPages.forEach(id => {
    if (document.getElementById('page-' + id)?.classList.contains('active')) {
      lastMainPage = id;
    }
  });

  // Dim bottom nav pages
  ['feed','discover','notifications','profile'].forEach(id => {
    document.getElementById('page-' + id)?.classList.remove('active');
  });

  if (setupFn) setupFn();

  // Show floating header only for user-profile
  const floatingHeader = document.getElementById('user-profile-header');
  if (floatingHeader) floatingHeader.style.display = pageId === 'user-profile' ? 'flex' : 'none';

  // Always hide my-profile floating header when navigating away
  const myHeader = document.getElementById('my-profile-header');
  if (myHeader) myHeader.style.display = 'none';

  requestAnimationFrame(() => {
    el.classList.add('active');
    el.scrollTop = 0;
    if (floatingHeader) floatingHeader.style.background = 'rgba(0,0,0,0)';
  });
}

function slideBack() {
  const pageId = slideStack.pop();
  if (pageId) {
    const el = document.getElementById('page-' + pageId);
    el?.classList.remove('active');
  }

  // Restore bottom nav, hide comment bar
  document.getElementById('bottom-nav').style.display = '';
  document.getElementById('comment-bar').style.display = 'none';

  // Only hide floating header if not returning to user-profile
  const returningTo = slideStack.length > 0 ? slideStack[slideStack.length - 1] : null;
  const floatingHeader = document.getElementById('user-profile-header');
  if (floatingHeader) floatingHeader.style.display = returningTo === 'user-profile' ? 'flex' : 'none';
  // Re-evaluate header colour based on current scroll position
  if (returningTo === 'user-profile') {
    const upPage = document.getElementById('page-user-profile');
    if (upPage?._uprfScroll) upPage._uprfScroll();
  }
  // Reset mini elements only when fully leaving user-profile
  if (returningTo !== 'user-profile') {
    const miniIdentity = document.getElementById('uprf-header-identity');
    const miniFollow   = document.getElementById('uprf-header-follow');
    if (miniIdentity) { miniIdentity.style.opacity='0'; miniIdentity.style.pointerEvents='none'; }
    if (miniFollow)   { miniFollow.style.opacity='0'; miniFollow.style.display='none'; }
    if (document.getElementById('page-user-profile')?._uprfAvatarObs) {
      document.getElementById('page-user-profile')._uprfAvatarObs.disconnect();
    }
  }

  // Restore last main page
  const lastMain = slideStack.length > 0 ? slideStack[slideStack.length - 1] : lastMainPage;
  const mainPages = ['feed','discover','notifications','profile'];
  if (mainPages.includes(lastMain)) {
    document.getElementById('page-' + lastMain)?.classList.add('active');
    if (lastMain === 'profile') {
      const myHeader = document.getElementById('my-profile-header');
      if (myHeader) myHeader.style.display = 'flex';
      const myPage = document.getElementById('page-profile');
      if (myPage?._myprfScroll) myPage._myprfScroll();
    }
  } else if (slideStack.length > 0) {
    document.getElementById('page-' + lastMain)?.classList.add('active');
  } else {
    document.getElementById('page-' + lastMainPage)?.classList.add('active');
    if (lastMainPage === 'profile') {
      const myHeader = document.getElementById('my-profile-header');
      if (myHeader) myHeader.style.display = 'flex';
      const myPage = document.getElementById('page-profile');
      if (myPage?._myprfScroll) myPage._myprfScroll();
    }
  }
}

// ══════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════

async function loadMyProfile() {
  if (!currentUser) return;
  const { data } = await supabase.from('users').select('*').eq('id', currentUser.id).maybeSingle();
  if (data) {
    currentProfile = data;
  } else {
    // Auto-create
    const fallback = {
      id: currentUser.id,
      username: '@user_' + currentUser.id.slice(0,6),
      bio: '', location: '', avatar: '', cover: '', followers: 0, following: 0
    };
    await supabase.from('users').insert(fallback);
    currentProfile = fallback;
  }
}

function updateNavAvatar() {
  if (!currentProfile) return;
  const navAvatar = document.getElementById('nav-avatar');
  const navIcon = document.getElementById('nav-avatar-icon');
  if (currentProfile.avatar) {
    navAvatar.src = currentProfile.avatar;
    navAvatar.style.display = 'block';
    navIcon.style.display = 'none';
  }
  const composerAv = document.getElementById('composer-avatar');
  if (composerAv && currentProfile.avatar) composerAv.src = currentProfile.avatar;
  const commentBarAv = document.getElementById('comment-bar-avatar');
  if (commentBarAv && currentProfile.avatar) commentBarAv.src = currentProfile.avatar;
}

// ══════════════════════════════════════════
// PROFILE STYLES — injected once
// ══════════════════════════════════════════
// ══════════════════════════════════════════
// PROFILE — Original MistyNote DNA, elevated
// ══════════════════════════════════════════

function injectProfileStyles() {
  if (document.getElementById('prf-styles')) return;
  const s = document.createElement('style');
  s.id = 'prf-styles';
  s.textContent = `
    .prf-wrap { display:flex; flex-direction:column; padding-bottom:120px; }

    /* ── COVER ── */
    .prf-cover { position:relative; width:100%; height:190px; overflow:hidden; flex-shrink:0; }
    .prf-cover-img { width:100%; height:100%; object-fit:cover; display:block; }
    .prf-cover-gradient { width:100%; height:100%; background:linear-gradient(135deg,#6C47FF 0%,#a855f7 50%,#ff3b5c 100%); }

    /* ── TOP BAR OVER COVER ── */
    .prf-cover-bar {
      position:absolute; top:0; left:0; right:0;
      display:flex; align-items:center; justify-content:space-between;
      padding:12px 16px; z-index:4;
    }
    .prf-back-btn {
      width:34px; height:34px; border-radius:50%;
      background:rgba(0,0,0,0.35); backdrop-filter:blur(10px);
      display:flex; align-items:center; justify-content:center;
      cursor:pointer; border:none; transition:background .15s;
    }
    .prf-back-btn:active { background:rgba(0,0,0,.55); }
    .prf-cover-actions { display:flex; gap:8px; }
    .prf-cover-action-btn {
      width:34px; height:34px; border-radius:50%;
      background:rgba(0,0,0,0.35); backdrop-filter:blur(10px);
      display:flex; align-items:center; justify-content:center;
      cursor:pointer; border:none; transition:background .15s;
    }
    .prf-cover-action-btn:active { background:rgba(0,0,0,.55); }

    /* ── AVATAR ROW — sits between cover and identity ── */
    .prf-avatar-row {
      display:flex; justify-content:space-between; align-items:flex-end;
      padding:10px 16px 0; margin-top:-44px; position:relative; z-index:10;
    }
    .prf-avatar-wrap {
      width:88px; height:88px; border-radius:50%;
      position:relative; flex-shrink:0;
    }
    .prf-avatar-wrap:active { transform:scale(.97); }
    .prf-avatar {
      width:100%; height:100%; border-radius:50%;
      object-fit:cover; object-position:top; display:block;
      border:4px solid var(--bg,#fff);
      position:relative; z-index:2;
    }
    .prf-avatar-ring {
      position:absolute; inset:-3px; border-radius:50%;
      background:conic-gradient(#6C47FF,#ff3b5c,#ff9500,#6C47FF);
      z-index:1; animation:prfRingSpin 6s linear infinite;
    }
    @keyframes prfRingSpin { to { transform:rotate(360deg); } }
    .prf-avatar-action-btns {
      display:flex; gap:8px; align-items:center; padding-bottom:8px;
    }

    /* ── IDENTITY ── */
    .prf-identity { padding:12px 16px 0; position:relative; z-index:2; }
    .prf-name { font-size:21px; font-weight:700; color:var(--text); margin:0; line-height:1.2; }
    .prf-name-row { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
    .prf-verified svg { display:block; }
    .prf-handle { font-size:14px; color:var(--text2); margin-top:3px; }

    /* ── LOCATION + QR ── */
    .prf-location-row { display:flex; align-items:center; justify-content:space-between; margin-top:10px; }
    .prf-location { display:flex; align-items:center; gap:5px; font-size:14px; color:var(--text2); }
    .prf-qr-chip {
      display:flex; align-items:center; gap:5px;
      background:var(--bg2,#f3f4f6); border:1px solid var(--border,#e5e7eb);
      padding:4px 10px; border-radius:8px;
      font-size:12px; font-weight:600; color:var(--text2);
      cursor:pointer; transition:background .15s;
    }
    .prf-qr-chip:active { background:var(--border); }

    /* ── FOLLOWING · FOLLOWERS inline ── */
    .prf-follow-line { margin-top:10px; font-size:15px; color:var(--text2); }
    .prf-bld { color:var(--text); font-weight:700; cursor:pointer; margin-right:2px; }
    .prf-bld:hover { text-decoration:underline; }
    .prf-follow-sep { margin:0 5px; }

    /* ── BIO ── */
    .prf-bio { margin-top:10px; font-size:15px; color:var(--text); line-height:1.55; white-space:pre-wrap; word-break:break-word; }

    /* ── STATS BAR ── */
    .prf-stats-row {
      display:flex; margin:16px 12px 0;
      background:var(--bg2,#f9fafb);
      border-radius:16px; overflow:hidden;
      border:1px solid var(--border,#e5e7eb);
    }
    .prf-stat-card {
      flex:1; display:flex; flex-direction:column;
      align-items:center; padding:12px 4px; gap:3px;
      position:relative; transition:background .15s;
    }
    .prf-stat-card + .prf-stat-card::before {
      content:''; position:absolute; left:0; top:20%;
      height:60%; width:1px; background:var(--border,#e5e7eb);
    }
    .prf-stat-card.clickable { cursor:pointer; }
    .prf-stat-card.clickable:active { background:rgba(108,71,255,.06); }
    .prf-stat-n { font-size:17px; font-weight:700; color:var(--text); line-height:1; }
    .prf-stat-l { font-size:10px; color:var(--text2); text-transform:uppercase; letter-spacing:.04em; }

    /* ── BUTTONS ── */
    .prf-btn-row { display:flex; gap:10px; margin-top:16px; flex-wrap:wrap; }
    .prf-btn { height:36px; padding:0 18px; border-radius:20px; font-size:14px; font-weight:600; cursor:pointer; border:none; transition:all .18s; display:flex; align-items:center; gap:6px; font-family:inherit; }
    .prf-btn-primary { background:#6C47FF; color:#fff; box-shadow:0 2px 12px rgba(108,71,255,.3); }
    .prf-btn-primary:active { transform:scale(.96); opacity:.9; }
    .prf-btn-dark { background:var(--text); color:var(--bg); }
    .prf-btn-dark:active { transform:scale(.96); opacity:.85; }
    .prf-btn-outline { background:transparent; color:var(--text); border:1.5px solid var(--border,#e5e7eb); }
    .prf-btn-outline:active { transform:scale(.96); }
    .prf-btn-following { background:transparent; color:var(--text); border:1.5px solid var(--border,#e5e7eb); border-radius:20px; }
    .prf-btn-icon { width:36px; height:36px; padding:0; border-radius:50%; justify-content:center; background:var(--bg2); border:1.5px solid var(--border,#e5e7eb); color:var(--text); }
    .prf-btn-icon:active { transform:scale(.94); }

    /* ── OTHER USER PROFILE FLOATING HEADER ── */
    #user-profile-header {
      position:fixed; top:0; left:0; right:0;
      background:rgba(0,0,0,0);
      border:none !important;
      box-shadow:none !important;
      transition:background .25s ease;
      z-index:200;
    }
    #user-profile-header .back-btn {
      background:transparent !important;
      border:none !important;
      box-shadow:none !important;
    }
    #user-profile-header .header-action {
      background:transparent !important;
      border:none !important;
      box-shadow:none !important;
    }
    #user-profile-header .back-btn path,
    #user-profile-header .back-btn polyline {
      stroke:#fff !important;
    }
    #user-profile-header .header-action circle {
      fill:#fff !important;
    }


    .prf-storefront-banner { margin:18px 16px 18px; background:linear-gradient(135deg,#f4f3ff,#fdf2ff); border:1.5px solid #ddd6fe; border-radius:16px; padding:14px 16px; display:flex; align-items:center; gap:12px; cursor:pointer; transition:all .18s; }
    .prf-storefront-banner:active { transform:scale(.98); }
    .prf-storefront-icon { font-size:28px; flex-shrink:0; }
    .prf-storefront-text { flex:1; }
    .prf-storefront-title { font-size:15px; font-weight:700; color:#6C47FF; }
    .prf-storefront-sub { font-size:12px; color:#9b87f5; margin-top:2px; }
    .prf-storefront-pill { font-size:11px; font-weight:700; color:#fff; background:#6C47FF; border-radius:20px; padding:3px 10px; white-space:nowrap; flex-shrink:0; }

    /* ── ICON TAB BAR (original ewe/yeb DNA, elevated) ── */
    .prf-icon-tabs {
      display:flex; width:100%; margin-top:0;
      border-top:1px solid var(--border,#e5e7eb);
      border-bottom:1px solid var(--border,#e5e7eb);
      background:var(--bg);
      position:sticky; top:56px; z-index:10;
      backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
    }
    .prf-icon-tab {
      flex:1; display:flex; align-items:center; justify-content:center;
      height:56px; cursor:pointer; transition:all .18s;
      border-bottom:3px solid transparent; color:var(--text2); position:relative;
    }
    .prf-icon-tab.active { border-bottom-color:#6C47FF; color:#6C47FF; }
    .prf-icon-tab:active { background:var(--bg2); }
    .prf-icon-tab svg { width:22px; height:22px; }
    .prf-icon-tab-dot { position:absolute; top:10px; right:calc(50% - 14px); width:6px; height:6px; border-radius:50%; background:#6C47FF; opacity:0; transition:opacity .2s; }
    .prf-icon-tab.active .prf-icon-tab-dot { opacity:1; }

    /* ── PANELS ── */
    .prf-panel { min-height:160px; }
    #prf-panel-masonry-list, #prf-panel-likes, .prf-posts-panel { display:flex; flex-direction:column; gap:10px; padding:10px 0; }

    /* ── TWO-COLUMN MASONRY (original left/right column split) ── */
    .prf-masonry { display:flex; gap:5px; padding:5px; align-items:flex-start; width:100%; }
    .prf-masonry-col { flex:1; display:flex; flex-direction:column; gap:5px; }
    .prf-masonry-tile { border-radius:12px; overflow:hidden; position:relative; cursor:pointer; background:var(--bg2); transition:transform .18s; }
    .prf-masonry-tile:active { transform:scale(.97); }
    .prf-masonry-img { width:100%; display:block; object-fit:cover; }
    .prf-masonry-text-tile { width:100%; min-height:120px; display:flex; align-items:center; justify-content:center; padding:16px 12px; position:relative; }
    .prf-masonry-text-tile p { font-size:13px; color:#fff; line-height:1.45; text-align:center; font-weight:600; margin:0; }
    .prf-masonry-overlay { position:absolute; inset:0; background:linear-gradient(to top,rgba(0,0,0,.55) 0%,transparent 55%); opacity:0; transition:opacity .18s; display:flex; align-items:flex-end; gap:8px; padding:8px 10px; }
    .prf-masonry-tile:hover .prf-masonry-overlay, .prf-masonry-tile:active .prf-masonry-overlay { opacity:1; }
    .prf-masonry-stat { font-size:12px; color:#fff; font-weight:600; }

    /* ── PLACEHOLDERS ── */
    .prf-placeholder { margin:20px 16px; border-radius:18px; padding:24px 20px; display:flex; flex-direction:column; align-items:center; gap:10px; text-align:center; }
    .prf-placeholder-icon { font-size:36px; }
    .prf-placeholder h3 { font-size:16px; font-weight:700; margin:0; }
    .prf-placeholder p { font-size:13px; margin:0; line-height:1.5; }

    /* ── EMPTY ── */
    .prf-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:56px 24px; gap:10px; text-align:center; }
    .prf-empty-icon { font-size:40px; opacity:.35; }
    .prf-empty p { font-size:16px; font-weight:600; color:var(--text); margin:0; }
    .prf-empty span { font-size:14px; color:var(--text2); }
  `;
  document.head.appendChild(s);
}

// ══════════════════════════════════════════
// MY PROFILE
// ══════════════════════════════════════════
async function renderMyProfile() {
  const container = document.getElementById('my-profile-content');
  if (!container) return;

  injectProfileStyles();
  await loadMyProfile();
  const profile = currentProfile;
  if (!profile) return;

  const [postsRes, likedRes] = await Promise.all([
    supabase.from('posts')
      .select(`id,content,image,video,created_at,like_count,repost_count,views,reposted_post_id,
               user:users(id,username,avatar),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar))`)
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase.from('likes')
      .select(`post:posts(id,content,image,video,created_at,like_count,repost_count,views,user_id,
               user:users(id,username,avatar))`)
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(60)
  ]);

  const posts         = postsRes.data || [];
  const likedPostsArr = (likedRes.data || []).map(r => r.post).filter(Boolean);
  const mediaPosts    = posts.filter(p => p.image || p.video || p.reposted_post?.image);
  const totalViews    = posts.reduce((s, p) => s + (p.views || 0), 0);
  const totalLikes    = posts.reduce((s, p) => s + (p.like_count || 0), 0);

  likedPostsArr.forEach(p => { if (p?.id) likedPosts.add(p.id); });

  container.innerHTML = `
    <div class="prf-wrap">

      <!-- COVER -->
      <div class="prf-cover">
        ${profile.cover
          ? `<img src="${escHtml(profile.cover)}" alt="" class="prf-cover-img">`
          : `<div class="prf-cover-gradient"></div>`}
        <div class="prf-cover-bar">
          <div></div>
          <div class="prf-cover-actions"></div>
        </div>
      </div>

      <!-- AVATAR ROW -->
      <div class="prf-avatar-row">
        <div class="prf-avatar-wrap">
          <div class="prf-avatar-ring"></div>
          <img class="prf-avatar" src="${escHtml(profile.avatar||'')}" onerror="this.src=''" alt="">
        </div>
        <div class="prf-avatar-action-btns">
          <button class="prf-btn prf-btn-icon" onclick="showSettings()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </button>
          <button class="prf-btn prf-btn-primary" onclick="openEditProfile()">Edit Profile</button>
        </div>
      </div>

      <!-- IDENTITY -->
      <div class="prf-identity">
        <div class="prf-name-row">
          <h1 class="prf-name">${escHtml(profile.username || 'User')}</h1>
          ${profile.verified ? `<span class="prf-verified"><svg width="18" height="18" viewBox="0 0 24 24" fill="#6C47FF"><path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/></svg></span>` : ''}
        </div>
        ${profile.bio ? `<p class="prf-bio">${escHtml(profile.bio)}</p>` : ''}
      </div>

      <!-- STATS BAR -->
      <div class="prf-stats-row">
        <div class="prf-stat-card">
          <span class="prf-stat-n">${fmtNum(posts.length)}</span>
          <span class="prf-stat-l">Posts</span>
        </div>
        <div class="prf-stat-card clickable">
          <span class="prf-stat-n">${fmtNum(profile.followers||0)}</span>
          <span class="prf-stat-l">Followers</span>
        </div>
        <div class="prf-stat-card clickable">
          <span class="prf-stat-n">${fmtNum(profile.following||0)}</span>
          <span class="prf-stat-l">Following</span>
        </div>
        <div class="prf-stat-card">
          <span class="prf-stat-n">${fmtNum(totalViews)}</span>
          <span class="prf-stat-l">Views</span>
        </div>
        <div class="prf-stat-card">
          <span class="prf-stat-n">${fmtNum(totalLikes)}</span>
          <span class="prf-stat-l">Likes</span>
        </div>
      </div>

      <!-- STOREFRONT -->
      <div class="prf-storefront-banner" onclick="showToast('Storefronts coming soon 🛍️')">
        <div class="prf-storefront-icon">🛍️</div>
        <div class="prf-storefront-text">
          <div class="prf-storefront-title">Open your storefront</div>
          <div class="prf-storefront-sub">Sell anything. Get paid safely.</div>
        </div>
        <span class="prf-storefront-pill">Soon</span>
      </div>

      <!-- ICON TAB BAR -->
      <div class="prf-icon-tabs" id="prf-tabs">
        <div class="prf-icon-tab active" data-tab="list" onclick="switchPrfTab('list',this)">
          <div class="prf-icon-tab-dot"></div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
        </div>
        <div class="prf-icon-tab" data-tab="media" onclick="switchPrfTab('media',this)">
          <div class="prf-icon-tab-dot"></div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </div>
        <div class="prf-icon-tab" data-tab="likes" onclick="switchPrfTab('likes',this)">
          <div class="prf-icon-tab-dot"></div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
        </div>
        <div class="prf-icon-tab" data-tab="saved" onclick="switchPrfTab('saved',this)">
          <div class="prf-icon-tab-dot"></div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
        </div>
      </div>

      <div id="prf-panel-list"   class="prf-panel prf-posts-panel"></div>
      <div id="prf-panel-media"  class="prf-panel" style="display:none"></div>
      <div id="prf-panel-likes"  class="prf-panel prf-posts-panel" style="display:none"></div>
      <div id="prf-panel-saved"  class="prf-panel" style="display:none"></div>
    </div>

    <div class="wing-fab" onclick="openComposer()">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>
    </div>
  `;

  if (!document.getElementById('fab-style')) {
    const fs = document.createElement('style');
    fs.id = 'fab-style';
    fs.textContent = `.wing-fab{position:fixed;bottom:calc(var(--nav-h,60px) + 20px + var(--safe-bottom,0px));right:20px;width:52px;height:52px;border-radius:16px;background:linear-gradient(135deg,var(--accent),#ff3b5c);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(108,71,255,.4);cursor:pointer;z-index:50;transition:transform .2s}.wing-fab:active{transform:scale(.92)}`;
    document.head.appendChild(fs);
  }

  container._prfData = { posts, likedPosts: likedPostsArr, mediaPosts };
  renderPrfPosts(posts, 'prf-panel-list', true);
  document.getElementById('prf-panel-list')._loaded = true;

  // ── Floating header for own profile ──
  const myPage   = document.getElementById('page-profile');
  const myHeader = document.getElementById('my-profile-header');
  if (!myHeader) return;

  // Set mini avatar
  const myMiniAvatar = document.getElementById('myprf-header-avatar');
  if (myMiniAvatar) myMiniAvatar.src = profile.avatar || '';

  // Sample cover colour
  let myR=0, myG=0, myB=0;
  const myCoverImg = container.querySelector('.prf-cover-img');
  if (myCoverImg) {
    const sampleMyColour = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 50; canvas.height = 10;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(myCoverImg, 0, 0, 50, 10);
        const d = ctx.getImageData(0, 0, 50, 10).data;
        let r=0,g=0,b=0,count=0;
        for (let i=0;i<d.length;i+=4){ r+=d[i];g+=d[i+1];b+=d[i+2];count++; }
        myR=Math.round(r/count*0.4);
        myG=Math.round(g/count*0.4);
        myB=Math.round(b/count*0.4);
      } catch(e) {}
    };
    if (myCoverImg.complete) sampleMyColour();
    else myCoverImg.addEventListener('load', sampleMyColour, {once:true});
  }

  // Scroll → header bg
  if (myPage._myprfScroll) myPage.removeEventListener('scroll', myPage._myprfScroll);
  myPage._myprfScroll = () => {
    const opacity = Math.min(myPage.scrollTop / 60, 1);
    myHeader.style.background = `rgba(${myR},${myG},${myB},${opacity})`;
  };
  myPage.addEventListener('scroll', myPage._myprfScroll);

  // Avatar observer → mini avatar in header
  const myAvatarWrap = container.querySelector('.prf-avatar-wrap');
  const myMiniIdentity = document.getElementById('myprf-header-identity');
  if (myPage._myprfAvatarObs) myPage._myprfAvatarObs.disconnect();
  myPage._myprfAvatarObs = new IntersectionObserver(([entry]) => {
    const visible = entry.isIntersecting;
    if (myMiniIdentity) {
      myMiniIdentity.style.opacity = visible ? '0' : '1';
      myMiniIdentity.style.pointerEvents = visible ? 'none' : 'auto';
    }
  }, { root: myPage, threshold: 0 });
  if (myAvatarWrap) myPage._myprfAvatarObs.observe(myAvatarWrap);
}

function switchPrfTab(tab, el) {
  const container = document.getElementById('my-profile-content');
  document.querySelectorAll('#prf-tabs .prf-icon-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['list','media','likes','saved'].forEach(t => {
    const p = document.getElementById('prf-panel-' + t);
    if (p) p.style.display = 'none';
  });
  const panel = document.getElementById('prf-panel-' + tab);
  if (!panel) return;
  panel.style.display = (tab === 'list' || tab === 'likes') ? 'flex' : 'block';
  if (panel._loaded) return;
  const { posts, likedPosts: likedArr, mediaPosts } = container._prfData || {};
  if (tab === 'list')  renderPrfPosts(posts || [],    'prf-panel-list',  true);
  if (tab === 'media') renderPrfMasonry(mediaPosts || [], 'prf-panel-media', true);
  if (tab === 'likes') renderPrfPosts(likedArr || [], 'prf-panel-likes', false);
  if (tab === 'saved') renderPrfSaved('prf-panel-saved');
  panel._loaded = true;
}

function switchProfileTab(mode, btn) { switchPrfTab('posts', btn); }

function renderPrfPosts(posts, containerId, isOwn) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!posts.length) {
    container.innerHTML = `<div class="prf-empty"><div class="prf-empty-icon">${isOwn ? '✍️' : '❤️'}</div><p>${isOwn ? 'No posts yet' : 'No likes yet'}</p>${isOwn ? '<span>Share your first thought</span>' : ''}</div>`;
    return;
  }
  container.innerHTML = '';
  posts.forEach(p => {
    const el = createFeedPost(p);
    if (el) { container.appendChild(el); observePost(el); }
  });
}

function renderPrfMasonry(posts, containerId, mediaOnly = false) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const items = mediaOnly ? posts.filter(p => p.image || p.video || p.reposted_post?.image) : posts;
  if (!items.length) {
    container.innerHTML = `<div class="prf-empty"><div class="prf-empty-icon">✍️</div><p>No posts yet</p><span>Start sharing your world</span></div>`;
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'prf-masonry';
  const left = document.createElement('div');
  left.className = 'prf-masonry-col';
  const right = document.createElement('div');
  right.className = 'prf-masonry-col';

  items.forEach((post, i) => {
    const img  = post.image || post.reposted_post?.image || '';
    const text = post.content || post.reposted_post?.content || '';
    const tile = document.createElement('div');
    tile.className = 'prf-masonry-tile';
    if (img) {
      tile.innerHTML = `<img src="${escHtml(img)}" alt="" loading="lazy" class="prf-masonry-img">
        <div class="prf-masonry-overlay">
          <span class="prf-masonry-stat">❤️ ${fmtNum(post.like_count||0)}</span>
          <span class="prf-masonry-stat">👁 ${fmtNum(post.views||0)}</span>
        </div>`;
    } else {
      tile.innerHTML = `<div class="prf-masonry-text-tile" style="background:${gradientFor(post.id)}">
          <p>${escHtml(text.slice(0,100))}</p>
          <div class="prf-masonry-overlay"><span class="prf-masonry-stat">❤️ ${fmtNum(post.like_count||0)}</span></div>
        </div>`;
    }
    tile.addEventListener('click', () => openDetail(post.id));
    if (i % 2 === 0) left.appendChild(tile);
    else             right.appendChild(tile);
  });

  wrap.appendChild(left);
  wrap.appendChild(right);
  container.innerHTML = '';
  container.appendChild(wrap);
}

function renderPrfSaved(containerId) {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.innerHTML = `<div class="prf-placeholder" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1.5px solid #bbf7d0">
    <div class="prf-placeholder-icon">🔖</div>
    <h3 style="color:#15803d">Bookmarks coming soon</h3>
    <p style="color:#16a34a">Save any post from your feed.<br>Appears here — private and organised.</p>
  </div>`;
}

function renderPrfStore(containerId) {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.innerHTML = `<div class="prf-placeholder" style="background:linear-gradient(135deg,#f4f3ff,#fdf2ff);border:1.5px solid #ddd6fe">
    <div class="prf-placeholder-icon">🛍️</div>
    <h3 style="color:#6C47FF">Your storefront</h3>
    <p style="color:#9b87f5">List products, get paid safely via escrow.<br>Launching very soon.</p>
  </div>`;
}

function renderProfileGrid(posts, profile, containerId, isOwn) {
  renderPrfMasonry(posts, containerId);
}

// ══════════════════════════════════════════
// OTHER USER PROFILE
// ══════════════════════════════════════════
async function showUserProfile(userId) {
  if (!userId) return;
  if (userId === currentUser?.id) { navTo('profile'); return; }
  injectProfileStyles();

  slideTo('user-profile', async () => {
    const body = document.getElementById('user-profile-body');
    body.innerHTML = '<div class="loading-pulse" style="height:300px;margin:0"></div>';

    const { data: profile } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
    if (!profile) { body.innerHTML = '<div class="empty-state"><p>User not found</p></div>'; return; }

    const { data: posts } = await supabase.from('posts')
      .select(`id,content,image,video,created_at,like_count,repost_count,views,reposted_post_id,
               user:users(id,username,avatar),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar))`)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(60);

    const allPosts   = posts || [];
    const likedPosts = [];
    const mediaPosts = allPosts.filter(p => p.image || p.video || p.reposted_post?.image);

    body.innerHTML = `
      <div class="prf-wrap">
        <div class="prf-cover">
          ${profile.cover
            ? `<img src="${escHtml(profile.cover)}" alt="" class="prf-cover-img">`
            : `<div class="prf-cover-gradient"></div>`}
          <div class="prf-cover-bar">
            <div></div>
            <div class="prf-cover-actions"></div>
          </div>
        </div>

        <!-- AVATAR ROW -->
        <div class="prf-avatar-row">
          <div class="prf-avatar-wrap">
            <div class="prf-avatar-ring"></div>
            <img class="prf-avatar" src="${escHtml(profile.avatar||'')}" onerror="this.src=''" alt="">
          </div>
          <div class="prf-avatar-action-btns">
            <button class="prf-btn prf-btn-icon" onclick="showToast('DMs coming soon 💬')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            </button>
            <button class="prf-btn prf-btn-primary" id="follow-btn-${userId}" onclick="toggleFollow('${userId}',this)">Follow</button>
          </div>
        </div>

        <!-- IDENTITY -->
        <div class="prf-identity" style="padding-top:8px">
          <div class="prf-name-row">
            <h1 class="prf-name">${escHtml(profile.username || 'User')}</h1>
            ${profile.verified ? `<span class="prf-verified"><svg width="18" height="18" viewBox="0 0 24 24" fill="#6C47FF"><path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/></svg></span>` : ''}
          </div>
          ${profile.bio ? `<p class="prf-bio">${escHtml(profile.bio)}</p>` : ''}
        </div>

        <!-- STATS BAR -->
        <div class="prf-stats-row">
          <div class="prf-stat-card">
            <span class="prf-stat-n">${fmtNum(allPosts.length)}</span>
            <span class="prf-stat-l">Posts</span>
          </div>
          <div class="prf-stat-card clickable">
            <span class="prf-stat-n">${fmtNum(profile.followers||0)}</span>
            <span class="prf-stat-l">Followers</span>
          </div>
          <div class="prf-stat-card clickable">
            <span class="prf-stat-n">${fmtNum(profile.following||0)}</span>
            <span class="prf-stat-l">Following</span>
          </div>
          <div class="prf-stat-card">
            <span class="prf-stat-n">${fmtNum(allPosts.reduce((s,p)=>s+(p.views||0),0))}</span>
            <span class="prf-stat-l">Views</span>
          </div>
        </div>

        <!-- CREATOR STOREFRONT BANNER -->
        <div class="prf-storefront-banner" onclick="showToast('Creator storefronts coming soon 🛍️')">
          <div class="prf-storefront-icon">🛍️</div>
          <div class="prf-storefront-text">
            <div class="prf-storefront-title">Shop ${escHtml(profile.username || 'this creator')}'s store</div>
            <div class="prf-storefront-sub">Browse their products & support their hustle.</div>
          </div>
          <span class="prf-storefront-pill">Soon</span>
        </div>

        <!-- ICON TABS: List · Media only on other profiles -->
        <div class="prf-icon-tabs" id="uprf-tabs-${userId}">
          <div class="prf-icon-tab active" onclick="switchUPrfTab('list','${userId}',this)">
            <div class="prf-icon-tab-dot"></div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
          </div>
          <div class="prf-icon-tab" onclick="switchUPrfTab('media','${userId}',this)">
            <div class="prf-icon-tab-dot"></div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </div>
        </div>

        <div id="uprf-list-${userId}"  class="prf-panel prf-posts-panel"></div>
        <div id="uprf-media-${userId}" class="prf-panel" style="display:none"></div>
      </div>
    `;

    body._uprfData = { posts: allPosts, mediaPosts, likedPosts };
    renderPrfPosts(allPosts, `uprf-list-${userId}`, false);
    document.getElementById(`uprf-list-${userId}`)._loaded = true;

    const upPage   = document.getElementById('page-user-profile');
    const upHeader = document.getElementById('user-profile-header');
    if (upPage._uprfScroll) upPage.removeEventListener('scroll', upPage._uprfScroll);

    // ── 1. Sample dominant colour from cover photo ──
    let headerR = 0, headerG = 0, headerB = 0; // default black
    const coverImg = body.querySelector('.prf-cover-img');
    if (coverImg) {
      const sampleColour = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 50; canvas.height = 10;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(coverImg, 0, 0, 50, 10);
          const d = ctx.getImageData(0, 0, 50, 10).data;
          let r=0,g=0,b=0,count=0;
          for (let i=0;i<d.length;i+=4){ r+=d[i];g+=d[i+1];b+=d[i+2];count++; }
          r=Math.round(r/count*0.4); // darken by 60%
          g=Math.round(g/count*0.4);
          b=Math.round(b/count*0.4);
          headerR=r; headerG=g; headerB=b;
        } catch(e) { /* CORS fallback — stays black */ }
      };
      if (coverImg.complete) sampleColour();
      else coverImg.addEventListener('load', sampleColour, {once:true});
    }

    // ── 2. Scroll → header bg colour ──
    upPage._uprfScroll = () => {
      const opacity = Math.min(upPage.scrollTop / 60, 1);
      upHeader.style.background = `rgba(${headerR},${headerG},${headerB},${opacity})`;
    };
    upPage.addEventListener('scroll', upPage._uprfScroll);

    // ── 3. Mini avatar + follow in header via IntersectionObserver ──
    const miniIdentity = document.getElementById('uprf-header-identity');
    const miniAvatar   = document.getElementById('uprf-header-avatar');
    const miniFollow   = document.getElementById('uprf-header-follow');

    // Set mini avatar src and wire follow button to main follow btn
    miniAvatar.src = profile.avatar || '';
    const mainFollowBtn = document.getElementById(`follow-btn-${userId}`);
    miniFollow.onclick = () => mainFollowBtn?.click();
    // Sync follow label
    const syncFollowLabel = () => {
      if (!mainFollowBtn) return;
      const isFollowing = mainFollowBtn.classList.contains('prf-btn-following');
      miniFollow.textContent = isFollowing ? 'Following' : 'Follow';
    };
    syncFollowLabel();
    const followObserver = new MutationObserver(syncFollowLabel);
    if (mainFollowBtn) followObserver.observe(mainFollowBtn, { attributes:true, attributeFilter:['class'] });

    // Watch avatar element — when it leaves viewport top, show mini
    const avatarWrap = body.querySelector('.prf-avatar-wrap');
    if (upPage._uprfAvatarObs) upPage._uprfAvatarObs.disconnect();
    upPage._uprfAvatarObs = new IntersectionObserver(([entry]) => {
      const visible = entry.isIntersecting;
      miniIdentity.style.opacity  = visible ? '0' : '1';
      miniIdentity.style.pointerEvents = visible ? 'none' : 'auto';
      miniFollow.style.display    = 'block';
      miniFollow.style.opacity    = visible ? '0' : '1';
      miniFollow.style.pointerEvents = visible ? 'none' : 'auto';
    }, { root: upPage, threshold: 0 });
    if (avatarWrap) upPage._uprfAvatarObs.observe(avatarWrap);
  });
}

function switchUPrfTab(tab, userId, el) {
  const body = document.getElementById('user-profile-body');
  document.querySelectorAll(`#uprf-tabs-${userId} .prf-icon-tab`).forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['list','media'].forEach(t => {
    const p = document.getElementById(`uprf-${t}-${userId}`);
    if (p) p.style.display = 'none';
  });
  const panel = document.getElementById(`uprf-${tab}-${userId}`);
  if (!panel) return;
  panel.style.display = tab === 'list' ? 'flex' : 'block';
  if (panel._loaded) return;
  const { posts, mediaPosts } = body._uprfData || {};
  if (tab === 'media') renderPrfMasonry(mediaPosts || [], `uprf-media-${userId}`, true);
  panel._loaded = true;
}

function toggleFollow(userId, btn) {
  const isFollowing = btn.classList.contains('prf-btn-following');
  btn.classList.toggle('prf-btn-following', !isFollowing);
  btn.classList.toggle('prf-btn-dark', isFollowing);
  btn.textContent = !isFollowing ? 'Following' : 'Follow';
  showToast(!isFollowing ? 'Following ✓' : 'Unfollowed');
}

// ══════════════════════════════════════════
// FEED
// ══════════════════════════════════════════

async function loadFeed(reset = false) {
  if (feedLoading || feedExhausted) return;
  feedLoading = true;

  const list = document.getElementById('feed-list');
  if (!list) { feedLoading = false; return; }

  if (reset) {
    feedOffset = 0; feedExhausted = false;
    loadedPostIds.clear(); list.innerHTML = '';
  }

  const PER_PAGE = 10;

  // Show skeletons
  if (feedOffset === 0) {
    list.innerHTML = Array(5).fill(0).map(() => skeletonPost()).join('');
  }

  try {
    const { data: posts, error } = await supabase
      .from('posts')
      .select(`id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
               user:users(id,username,avatar),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar)),
               comments(count)`)
      .order('created_at', { ascending: false })
      .range(feedOffset, feedOffset + PER_PAGE - 1);

    if (error) throw error;

    if (feedOffset === 0) list.innerHTML = '';

    if (!posts || posts.length === 0) {
      feedExhausted = true;
      if (feedOffset === 0) list.innerHTML = `<div class="empty-state"><div class="empty-icon">🌙</div><p>Nothing here yet</p><span>Be the first to post!</span></div>`;
      return;
    }

    for (const p of posts) {
      if (loadedPostIds.has(p.id)) continue;
      loadedPostIds.add(p.id);
      const el = createFeedPost(p);
      if (el) { list.appendChild(el); observePost(el); }
    }

    feedOffset += posts.length;
    if (posts.length < PER_PAGE) feedExhausted = true;

    // Batch check likes and reposts
    const ids = [...loadedPostIds];
    checkLikedPosts(ids);
    checkRepostedPosts(ids);
    reObserveAllFeedPosts();

  } catch (e) {
    console.error('Feed error:', e);
    if (feedOffset === 0) list.innerHTML = `<div class="empty-state"><div class="empty-icon">😕</div><p>Couldn't load posts</p><span>${e.message}</span></div>`;
  } finally {
    feedLoading = false;
  }
}

function setFeedTab(tab, btn) {
  document.querySelectorAll('.feed-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  loadFeed(true);
}

function createFeedPost(p) {
  const user = p.user || { username: '@unknown', avatar: '' };
  const isRepost = !!p.reposted_post_id && !!p.reposted_post;
  const orig = isRepost ? p.reposted_post : null;
  const origUser = orig?.user || { username: '@unknown', avatar: '' };
  const isOwnPost = currentUser && p.user_id === currentUser.id;

  const el = document.createElement('div');
  el.className = 'poster' + (isRepost ? ' is-repost' : '');
  el.dataset.postId = p.id;
  if (isRepost && p.reposted_post_id) el.dataset.repostedPostId = p.reposted_post_id;

  const commentCount = p.comments?.[0]?.count || 0;
  const text = p.content || '';
  const textLimit = (p.image || p.video) ? 150 : 300;
  const truncated = text.length > textLimit;
  const displayText = truncated
    ? text.slice(0, textLimit).trimEnd() + `...<br><span class="reer">see more</span>`
    : escHtml(text);

  // ── Main content: repost vs normal ──
  let mainContentHTML = '';

  if (isRepost) {
    const origText = orig.content || '';
    const origTruncated = origText.length > textLimit;
    const origDisplay = origTruncated
      ? origText.slice(0, textLimit).trimEnd() + `...<span class="reer">see more</span>`
      : escHtml(origText);

    mainContentHTML = `
      ${text ? `<div class="tir repost-commentary"><p class="tired">${displayText}</p></div>` : ''}

      <div class="original-post-card" data-original-id="${orig.id}">
        <div class="repost-indicator" style="display:flex;align-items:center;gap:6px;padding:8px 10px 4px;font-size:13px;color:#888;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          <span>Reposted from ${escHtml(origUser.username)}</span>
        </div>

        <div class="cust-name" style="padding:0 10px;">
          <a class="post-avatar-link" onclick="showUserProfile('${orig.user_id}');event.stopPropagation()">
            <img class="small-photo" src="${origUser.avatar || ''}" onerror="this.style.display='none'" alt="" style="width:35px;height:35px;">
          </a>
          <div class="post-meta">
            <a class="post-author-link" onclick="showUserProfile('${orig.user_id}');event.stopPropagation()">
              <span class="jerry">${escHtml(origUser.username)}</span>
              <svg xmlns="http://www.w3.org/2000/svg" class="verif" viewBox="0 0 24 24" width="15" height="15"><path d="M12 2L3 7v5c0 5 4 9 9 10 5-1 9-5 9-10V7z" fill="#6C47FF"/><polyline points="8,12 11,15 16,9" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </a>
            <span class="time">${timeSince(orig.created_at)}</span>
          </div>
        </div>

        ${orig.content ? `<div class="tir" style="margin:0 10px;"><p class="tired">${origDisplay}</p></div>` : ''}

        ${orig.image ? `<div class="repost-img-wrap"><img src="${orig.image}" class="repost-img" alt="" loading="lazy"></div>` : ''}

        ${orig.video && !orig.image ? `
          <div class="video-container laptop1" data-post-id="${orig.id}">
            <video class="video-thumbnail" preload="metadata">
              <source src="${orig.video}" type="video/mp4">
            </video>
            <div class="video-overlay">
              <div class="play-button">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="22" fill="rgba(244,7,82,0.5)" stroke="white" stroke-width="3"/>
                  <path d="M34 24L18 34V14L34 24Z" fill="white"/>
                </svg>
              </div>
            </div>
          </div>
        ` : ''}

      </div>
    `;
  } else {
    mainContentHTML = `
      ${p.image ? `<div class="laptop1"><img src="${p.image}" class="laptop" alt="" loading="lazy"></div>` : ''}

      ${p.video && !p.image ? `
        <div class="video-container laptop1" data-post-id="${p.id}">
          <video class="video-thumbnail" preload="metadata">
            <source src="${p.video}" type="video/mp4">
          </video>
          <div class="video-overlay">
            <div class="play-button">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="22" fill="rgba(244,7,82,0.5)" stroke="white" stroke-width="3"/>
                <path d="M34 24L18 34V14L34 24Z" fill="white"/>
              </svg>
            </div>
          </div>
        </div>
      ` : ''}

      <div class="tir">
        <p class="tired">${displayText}</p>
      </div>
    `;
  }

  el.innerHTML = `
    <div class="cust-name">
      <a class="post-avatar-link" onclick="${isOwnPost ? 'navTo(\'profile\')' : `showUserProfile('${p.user_id}')`};event.stopPropagation()">
        <img class="small-photo" src="${user.avatar || ''}" onerror="this.style.display='none'" alt="">
      </a>
      <div class="post-meta">
        <a class="post-author-link" onclick="${isOwnPost ? 'navTo(\'profile\')' : `showUserProfile('${p.user_id}')`};event.stopPropagation()">
          <span class="jerry">${escHtml(user.username)}</span>
          <svg xmlns="http://www.w3.org/2000/svg" class="verif" viewBox="0 0 24 24" width="15" height="15"><path d="M12 2L3 7v5c0 5 4 9 9 10 5-1 9-5 9-10V7z" fill="#6C47FF"/><polyline points="8,12 11,15 16,9" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        <span class="time">${timeSince(p.created_at)}</span>
      </div>
      <div class="dots">
        <svg xmlns="http://www.w3.org/2000/svg" class="dot" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
      </div>
    </div>

    ${mainContentHTML}

    <div class="lefto">
      <div class="dick">
        <div><svg xmlns="http://www.w3.org/2000/svg" class="lefti" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><path d="M8 8 Q18 10 17 20"/></svg></div>
        <div><p class="viewe echoes-btn" data-post-id="${p.id}" onclick="openEchoes('${p.id}', event)"><span class="echoes-count">${commentCount || 0}</span> echoes</p></div>
      </div>
      <div class="twits">
        <div><svg xmlns="http://www.w3.org/2000/svg" class="lefti" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></div>
        <div><p class="viewe"><span class="echoes-count">${fmtNum(p.views) || 0}</span> views</p></div>
      </div>
    </div>

    <div class="reaction">
      <div class="reaction-container">
        <div class="call">
          <div class="mee">
            <div class="comment-btn" data-post-id="${p.id}">
              <svg xmlns="http://www.w3.org/2000/svg" class="feeling" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
              <span>${commentCount > 0 ? fmtNum(commentCount) : ''}</span>
            </div>

            <div class="repost-btn" data-post-id="${p.id}" data-reposted="false">
              <svg xmlns="http://www.w3.org/2000/svg" class="feeling repost-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
              <span>${p.repost_count > 0 ? fmtNum(p.repost_count) : ''}</span>
            </div>

            <div class="heart-ai" data-post-id="${p.id}" data-liked="false">
              <svg class="heart-icon heart-clickable" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path class="heart-path" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="none" stroke="#000000" stroke-width="2"/>
              </svg>
              <span class="like-count heart-clickable">${p.like_count > 0 ? fmtNum(p.like_count) : ''}</span>
            </div>
          </div>
          <div class="mee">
            <div class="donate-btn"><svg xmlns="http://www.w3.org/2000/svg" class="feeling" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></div>
            <div class="donate-btn share-action" data-post-id="${p.id}"><svg xmlns="http://www.w3.org/2000/svg" class="feeling" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // ── Event listeners ──
  el.addEventListener('click', e => {
    if (el.dataset.blockNavigation === 'true') return;

    if (e.target.closest('.dots')) {
      showPostMenu(p, el, e.target.closest('.dots'));
      return;
    }
    if (e.target.closest('.heart-ai')) {
      toggleLike(p.id, e.target.closest('.heart-ai'));
      return;
    }
    if (e.target.closest('.repost-btn')) {
      handleRepost(p.id, e.target.closest('.repost-btn'));
      return;
    }
    if (e.target.closest('.comment-btn')) {
      openDetail(p.id, true);
      return;
    }
    if (e.target.closest('.share-action')) {
      sharePost(p);
      return;
    }
    if (e.target.closest('.reer')) {
      const tired = e.target.closest('.tired');
      if (tired) { tired.innerHTML = escHtml(text); e.stopPropagation(); return; }
    }
    if (e.target.closest('.post-avatar-link') || e.target.closest('.post-author-link')) return;
    if (e.target.closest('.view-original') || e.target.closest('.original-post-card')) {
      openDetail(e.target.closest('[data-original-id]')?.dataset.originalId || orig?.id);
      return;
    }
    openDetail(p.id);
  });

  // Repost button — check initial state
  const repostBtn = el.querySelector('.repost-btn');
  if (repostBtn && repostedPosts.has(p.id)) {
    repostBtn.setAttribute('data-reposted', 'true');
    repostBtn.classList.add('reposted');
    const svg = repostBtn.querySelector('.repost-icon');
    if (svg) {
      svg.setAttribute('stroke', '#6C47FF');
      svg.setAttribute('stroke-width', '2.5');
    }
    const span = repostBtn.querySelector('span');
    if (span) span.style.color = '#6C47FF';
  }

  // Like button — check initial state
  const heartContainer = el.querySelector('.heart-ai');
  if (heartContainer && likedPosts.has(p.id)) {
    heartContainer.setAttribute('data-liked', 'true');
    heartContainer.querySelector('.heart-icon')?.classList.add('liked');
    heartContainer.querySelector('.like-count')?.classList.add('liked');
  }

  // Long-press for post menu
  let lpTimer;
  el.addEventListener('touchstart', e => {
    if (e.target.closest('.heart-ai, .repost-btn, .comment-btn, .donate-btn, .dots, .post-avatar-link, .post-author-link')) return;
    lpTimer = setTimeout(() => showPostMenu(p, el, null, true), 550);
  }, { passive: true });
  el.addEventListener('touchmove', () => clearTimeout(lpTimer), { passive: true });
  el.addEventListener('touchend', () => clearTimeout(lpTimer), { passive: true });

  return el;
}


// ══════════════════════════════════════════
// FEED POST STYLES (view.js UI)
// ══════════════════════════════════════════

function injectFeedPostStyles() {
  if (document.getElementById('feed-post-view-styles')) return;
  const style = document.createElement('style');
  style.id = 'feed-post-view-styles';
  style.textContent = `
    #feed-list { display: flex; flex-direction: column; gap: 10px; }

    .poster {
      display: block;
      width: 100%;
      border: 0.5px solid rgb(220,220,220);
      border-radius: 10px;
      padding: 10px 10px 0px;
      transition: background-color 0.2s;
      position: relative;
      cursor: pointer;
      overflow: hidden;
    }
    .poster:hover { background-color: rgb(250,250,250); }

    .cust-name {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .post-avatar-link { flex-shrink: 0; text-decoration: none; }
    .small-photo {
      width: 38px;
      height: 38px;
      object-fit: cover;
      object-position: center;
      border-radius: 10px;
      display: block;
      transition: filter 0.15s;
    }
    .small-photo:hover { filter: brightness(0.9); }
    .post-meta { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .post-author-link { display: flex; align-items: center; gap: 4px; text-decoration: none; cursor: pointer; width: fit-content; }
    .post-author-link:hover .jerry { text-decoration: underline; text-decoration-thickness: 2px; }
    .jerry { font-weight: 600; font-size: 15px; font-family: 'Noto Sans JP', -apple-system, sans-serif; color: var(--text); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* Consistent username weight across all pages */
    .detail-name, .profile-name, .original-card-name { font-weight: 600; }
    .verif { width: 15px; flex-shrink: 0; display: block; }
    .time { font-size: 12px; color: var(--text2); margin: 0; line-height: 1; }
    .time:hover { text-decoration: underline; }
    .dots { display: flex; align-items: center; padding: 4px; flex-shrink: 0; margin-left: auto; }
    .dot { display: block; }

    .tir {
      padding: 10px 5px 8px;
    }
    .tired { width: 100%; font-size: 15px; white-space: pre-wrap; word-break: break-word; color: var(--text); }
    .reer { color: rgba(244,7,82,0.7); cursor: pointer; }

    .laptop1 { max-width: 100%; margin-top: 10px; padding: 0; overflow: hidden; border-radius: 12px; background: #f0f0f0; max-height: 400px; display: flex; align-items: center; justify-content: center; }
    .laptop { max-height: 400px; width: 100%; object-fit: contain; display: block; margin: 0; }

    /* Video */
    .video-container { position: relative; background: #000; border-radius: 12px; overflow: hidden; margin-top: 10px; }
    .video-thumbnail { width: 100%; display: block; max-height: 400px; }
    .video-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.15); }
    .play-button { display: flex; align-items: center; justify-content: center; }

    /* Stats row */
    .lefto {
      display: flex;
      flex-direction: row;
      gap: 10px;
      width: 100%;
      justify-content: space-between;
      align-items: center;
      margin-top: 10px;
      padding-bottom: 10px;
      border-bottom: 0.5px solid rgb(220,220,220);
    }
    .dick { display: flex; gap: 5px; margin-left: 10px; align-items: center; }
    .twits { display: flex; align-items: center; gap: 5px; margin-right: 10px; }
    .lefti { width: 15px; height: 15px; display: block; }
    .viewe { font-size: 13px; color: var(--text2); margin: 0; line-height: 1; }
    .werey { font-weight: 600; }
    .echoes-count { font-weight: 400; color: var(--text2); }
    .echoes-btn { cursor: pointer; transition: color 0.15s; }
    .echoes-btn:hover { color: #6C47FF; }
    .echoes-btn:hover .echoes-count { color: #6C47FF; }

    /* ── ECHOES PANEL ── */
    .echoes-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.45);
      z-index: 9000; display: flex; align-items: flex-end;
      opacity: 0; transition: opacity 0.25s ease;
      pointer-events: none;
    }
    .echoes-overlay.open { opacity: 1; pointer-events: all; }
    .echoes-sheet {
      width: 100%; max-height: 82vh; background: var(--bg);
      border-radius: 20px 20px 0 0; display: flex; flex-direction: column;
      transform: translateY(100%); transition: transform 0.3s cubic-bezier(.32,.72,0,1);
      overflow: hidden;
    }
    .echoes-overlay.open .echoes-sheet { transform: translateY(0); }
    .echoes-handle-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 18px 10px; border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .echoes-title { font-size: 16px; font-weight: 700; color: var(--text); }
    .echoes-close {
      width: 30px; height: 30px; border-radius: 50%; border: none;
      background: var(--bg2); cursor: pointer; display: flex;
      align-items: center; justify-content: center; color: var(--text);
      font-size: 16px; flex-shrink: 0;
    }
    .echoes-tabs {
      display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0;
    }
    .echoes-tab {
      flex: 1; padding: 11px 8px; font-size: 14px; font-weight: 600;
      color: var(--text2); background: none; border: none; cursor: pointer;
      border-bottom: 3px solid transparent; transition: all 0.2s;
    }
    .echoes-tab.active { color: #6C47FF; border-bottom-color: #6C47FF; }
    .echoes-body {
      flex: 1; overflow-y: auto; padding: 0;
    }
    .echoes-empty {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; padding: 60px 20px; gap: 12px;
      color: var(--text2); font-size: 14px; text-align: center;
    }
    .echoes-empty-icon { font-size: 36px; opacity: 0.4; }
    .echo-item {
      display: flex; gap: 10px; padding: 14px 16px;
      border-bottom: 1px solid var(--border); cursor: pointer;
      transition: background 0.15s;
    }
    .echo-item:hover { background: var(--bg2); }
    .echo-avatar {
      width: 38px; height: 38px; border-radius: 50%;
      object-fit: cover; flex-shrink: 0;
      background: var(--bg2);
    }
    .echo-content { flex: 1; min-width: 0; }
    .echo-header { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
    .echo-username { font-weight: 600; font-size: 14px; color: var(--text); }
    .echo-time { font-size: 12px; color: var(--text2); }
    .echo-type-badge {
      font-size: 11px; font-weight: 600; padding: 2px 7px;
      border-radius: 20px; margin-left: auto; flex-shrink: 0;
    }
    .echo-type-repost { background: #f0eeff; color: #6C47FF; }
    .echo-type-reply  { background: #f0fdf4; color: #16a34a; }
    .echo-text { font-size: 16px; color: var(--text); line-height: 1.4; word-break: break-word; }
    .echo-stats { display: flex; gap: 14px; margin-top: 6px; }
    .echo-stat { font-size: 12px; color: var(--text2); display: flex; align-items: center; gap: 4px; }

    /* Reaction bar */
    .reaction {
      display: flex;
      justify-content: space-between;
      padding: 10px 10px 10px;
    }
    .reaction-container { width: 100%; display: flex; align-items: center; }
    .call { width: 100%; display: flex; justify-content: space-between; }
    .mee { display: flex; gap: 20px; align-items: center; }
    .feeling { width: 22px; }

    .comment-btn { display: flex; width: 55px; align-items: center; gap: 10px; cursor: pointer; font-size: 15px; font-family: 'Noto Sans JP', -apple-system, sans-serif; color: #000000; }
    .comment-btn:hover { color: var(--text); }

    .repost-btn { display: flex; width: 55px; align-items: center; gap: 10px; cursor: pointer; font-size: 15px; font-family: 'Noto Sans JP', -apple-system, sans-serif; color: #000000; }
    .repost-btn:hover { color: var(--text); }
    .repost-icon { transition: stroke 0.2s ease; }
    .repost-btn.reposted .repost-icon { stroke: #6C47FF; stroke-width: 2.5; }
    .repost-btn.reposted span { color: #6C47FF; font-weight: 600; }

    .heart-ai { width: 55px; gap: 10px; display: flex; align-items: center; cursor: pointer; }
    .heart-clickable { cursor: pointer; }
    .heart-icon { transition: all 0.3s ease; }
    .heart-icon .heart-path { stroke: var(--text); fill: none; transition: all 0.3s ease; }
    .heart-icon.liked .heart-path { fill: rgb(244,7,82); stroke: rgb(244,7,82); }
    .like-count { font-size: 14px; font-family: 'Noto Sans JP', -apple-system, sans-serif; color: #000000; }
    .like-count.liked { font-weight: 500; color: rgb(244,7,82); }
    .like-count:empty { display: none; }

    @keyframes heartBeat {
      0% { transform: scale(0.5); }
      50% { transform: scale(1.7); }
      100% { transform: scale(1); }
    }
    .heart-animation { animation: heartBeat 0.7s ease-in-out; }
    @keyframes pop {
      0% { transform: scale(1); }
      50% { transform: scale(1.5); }
      100% { transform: scale(1); }
    }
    @keyframes shrinkFade {
      0% { transform: scale(1); opacity: 1; }
      50% { transform: scale(0.5); opacity: 0.5; }
      100% { transform: scale(1); opacity: 1; }
    }
    .unfill-animation { animation: shrinkFade 0.3s ease forwards; }

    .donate-btn { display: flex; align-items: center; cursor: pointer; }
    .donate-btn img { width: 22px; opacity: 0.7; }
    .donate-btn:hover img { opacity: 1; }

    /* Repost card inside feed */
    .original-post-card {
      border: 1px solid rgb(220,220,220);
      border-radius: 12px;
      margin-top: 10px;
      overflow: hidden;
      background: rgb(250,250,250);
      cursor: pointer;
      transition: background 0.15s;
    }
    .original-post-card:hover { background: rgb(245,245,245); }
    .repost-img-wrap { width: 100%; aspect-ratio: 1/1; overflow: hidden; }
    .repost-img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
    .repost-commentary .tir { padding-bottom: 2px; }

    /* Post action menu */
    .post-action-bar {
      position: absolute;
      bottom: 20%;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(255,255,255,0.94);
      backdrop-filter: blur(20px);
      border-radius: 14px;
      padding: 6px 8px;
      display: flex;
      align-items: center;
      gap: 10px;
      width: fit-content;
      height: auto;
      z-index: 10;
      box-shadow: 0 10px 30px rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.08);
    }
    @keyframes slideUpFromBottom {
      0%   { transform: translateX(-50%) translateY(40px); opacity: 0; scale: 0.92; }
      60%  { transform: translateX(-50%) translateY(-6px); opacity: 1; scale: 1.04; }
      100% { transform: translateX(-50%) translateY(0);   opacity: 1; scale: 1; }
    }
    @keyframes slideOutFromBottom {
      0%   { transform: translateX(-50%) translateY(0);    opacity: 1; scale: 1; }
      100% { transform: translateX(-50%) translateY(34px); opacity: 0; scale: 0.94; }
    }
  `;
  document.head.appendChild(style);
}

function expandText(el, fullText) {
  el.innerHTML = escHtml(fullText);
}

function skeletonPost() {
  return `<div class="skeleton-post">
    <div class="sk-header">
      <div class="sk-circle loading-pulse"></div>
      <div style="flex:1">
        <div class="sk-line loading-pulse" style="width:45%"></div>
        <div class="sk-line loading-pulse" style="width:25%"></div>
      </div>
    </div>
    <div style="padding:0 0 0 53px">
      <div class="sk-line loading-pulse" style="width:100%"></div>
      <div class="sk-line loading-pulse" style="width:80%"></div>
      <div class="sk-line loading-pulse" style="width:60%"></div>
    </div>
  </div>`;
}

// ── INTERSECTION OBSERVER (infinite scroll only) ──
let scrollObserver;
function initIntersectionObserver() {
  scrollObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      if (entry.target.id === 'feed-load-trigger') loadFeed();
    });
  }, { threshold: 0.1 });

  const trigger = document.getElementById('feed-load-trigger');
  if (trigger) scrollObserver.observe(trigger);
}

// ── VIEW TRACKING (separate observer) ──
let _viewObserver = null;

function getViewObserver() {
  if (_viewObserver) return _viewObserver;
  _viewObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const el = entry.target;
      const postId = el.dataset.postId;
      if (!postId) return;
      if (entry.isIntersecting) {
        if (el.dataset.viewTracked === 'true') return;
        el._viewTimer = setTimeout(async () => {
          if (!document.contains(el)) return;
          await recordView(postId);
          await syncViewCount(postId);
        }, 1000);
      } else {
        if (el._viewTimer) {
          clearTimeout(el._viewTimer);
          el._viewTimer = null;
          el.dataset.viewTracked = 'false';
        }
      }
    });
  }, { threshold: 0.6 });
  return _viewObserver;
}

function observePost(el) {
  if (el && el.dataset.postId) getViewObserver().observe(el);
}

function reObserveAllFeedPosts() {
  document.querySelectorAll('.poster[data-post-id]').forEach(el => {
    if (el.dataset.viewTracked !== 'true') getViewObserver().observe(el);
  });
}

async function syncViewCount(postId) {
  if (!postId) return;
  try {
    const { data, error } = await supabase
      .from('posts').select('views').eq('id', postId).single();
    if (error || !data) return;
    const count = data.views ?? 0;
    document.querySelectorAll(`.poster[data-post-id="${postId}"] .twits .viewe`)
      .forEach(el => { el.textContent = `${fmtNum(count) || 0} views`; });
    if (detailPostId === postId) {
      const el = document.querySelector(`.detail-stat-n[data-type="views"]`);
      if (el) animateCount(el, count);
    }
  } catch (err) {
    console.warn('syncViewCount error:', err.message);
  }
}

// ══════════════════════════════════════════
// LIKES
// ══════════════════════════════════════════

async function checkLikedPosts(postIds) {
  if (!currentUser || !postIds.length) return;
  const { data } = await supabase
    .from('likes').select('post_id').eq('user_id', currentUser.id).in('post_id', postIds);
  (data || []).forEach(r => likedPosts.add(r.post_id));
  postIds.forEach(id => {
    if (likedPosts.has(id)) setLikeUI(id, true, null);
  });
}

async function checkRepostedPosts(postIds) {
  if (!currentUser || !postIds.length) return;
  // Find any of the current user's reposts where the original is in our postIds
  const { data } = await supabase
    .from('posts')
    .select('id, reposted_post_id')
    .eq('user_id', currentUser.id)
    .not('reposted_post_id', 'is', null)
    .in('reposted_post_id', postIds);

  (data || []).forEach(r => {
    repostedPosts.set(r.reposted_post_id, r.id);
  });

  // Apply bold state to all matching buttons in DOM
  postIds.forEach(id => {
    if (repostedPosts.has(id)) setRepostUI(id, true);
  });
}

async function toggleLike(postId, btn) {
  if (!currentUser) { showToast('Sign in to like'); return; }
  const isLiked = btn?.dataset.liked === 'true';
  const countSpan = btn?.querySelector('span');
  let count = parseInt(countSpan?.textContent || '0') || 0;

  const newLiked = !isLiked;
  setLikeUI(postId, newLiked, null);
  if (newLiked) likedPosts.add(postId); else likedPosts.delete(postId);

  // Animate
  btn?.classList.add('heart-pop');
  setTimeout(() => btn?.classList.remove('heart-pop'), 400);

  try {
    if (newLiked) {
      const { error } = await supabase.from('likes').insert({ post_id: postId, user_id: currentUser.id });
      if (error && error.code !== '23505') throw error;
    } else {
      await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', currentUser.id);
    }

    // Get real count
    const { data } = await supabase.from('posts').select('like_count').eq('id', postId).single();
    if (data) syncLikeCount(postId, data.like_count);

    // Notification
    if (newLiked && currentUser) {
      const { data: post } = await supabase.from('posts').select('user_id').eq('id', postId).single();
      if (post && post.user_id !== currentUser.id) {
        await supabase.from('notifications').insert({ user_id: post.user_id, actor_id: currentUser.id, post_id: postId, type: 'like', read: false });
      }
    }
  } catch (e) {
    // Revert
    const wasLiked = !newLiked;
    setLikeUI(postId, wasLiked, count);
    if (wasLiked) likedPosts.add(postId); else likedPosts.delete(postId);
  }
}

function setLikeUI(postId, liked, count) {
  // Feed posts (view.js-style .heart-ai divs)
  document.querySelectorAll(`.heart-ai[data-post-id="${postId}"]`).forEach(container => {
    container.dataset.liked = liked ? 'true' : 'false';
    const icon = container.querySelector('.heart-icon');
    const countEl = container.querySelector('.like-count');
    icon?.classList.toggle('liked', liked);
    countEl?.classList.toggle('liked', liked);
    const path = container.querySelector('.heart-path');
    if (path) {
      path.setAttribute('fill', liked ? 'rgb(244,7,82)' : 'none');
      path.setAttribute('stroke', liked ? 'rgb(244,7,82)' : 'currentColor');
    }
    if (count !== null && countEl) animateCount(countEl, count);
  });
  // Detail page like button
  document.querySelectorAll(`.dp-like-btn[data-post-id="${postId}"], .detail-action.like-action[data-post-id="${postId}"]`).forEach(btn => {
    btn.dataset.liked = liked ? 'true' : 'false';
    // support both old and new class names
    btn.classList.toggle('liked', liked);
    btn.classList.toggle('dp-liked', liked);
    if (count !== null) {
      const sp = btn.querySelector('span');
      if (sp) animateCount(sp, count);
    }
    const path = btn.querySelector('.heart-path, .dp-heart-path');
    if (path) {
      path.setAttribute('fill', liked ? 'var(--red)' : 'none');
      path.setAttribute('stroke', liked ? 'var(--red)' : 'currentColor');
    }
  });
  // Sync comment bar like button
  const cbLike = document.getElementById('cb-like-btn');
  if (cbLike && cbLike.dataset.postId === postId) {
    cbLike.dataset.liked = liked ? 'true' : 'false';
    cbLike.classList.toggle('cb-liked', liked);
    const cbPath = cbLike.querySelector('.cb-heart-path');
    if (cbPath) { cbPath.setAttribute('fill', liked ? 'rgb(244,7,82)' : 'none'); cbPath.setAttribute('stroke', liked ? 'rgb(244,7,82)' : 'currentColor'); }
  }
}

function syncLikeCount(postId, count) {
  // Feed hearts
  document.querySelectorAll(`.heart-ai[data-post-id="${postId}"] .like-count`).forEach(sp => {
    animateCount(sp, count);
  });
  // Detail stat table
  const statEl = document.querySelector(`.detail-stat-n[data-type="likes"]`);
  if (statEl && detailPostId === postId) {
    animateCount(statEl, count);
  }
  // Comment bar like count
  const cbCount = document.getElementById('cb-like-count');
  const cbLike = document.getElementById('cb-like-btn');
  if (cbCount && cbLike?.dataset.postId === postId) {
    animateCount(cbCount, count);
  }
}

// ══════════════════════════════════════════
// REPOSTS
// ══════════════════════════════════════════

function setRepostUI(postId, reposted) {
  document.querySelectorAll(`.repost-btn[data-post-id="${postId}"]`).forEach(btn => {
    btn.dataset.reposted = reposted ? 'true' : 'false';
    btn.classList.toggle('reposted', reposted);
    const svg = btn.querySelector('.repost-icon');
    if (svg) {
      svg.setAttribute('stroke', reposted ? '#6C47FF' : '#000000');
      svg.setAttribute('stroke-width', reposted ? '2.5' : '2');
    }
    const span = btn.querySelector('span');
    if (span && reposted) span.style.color = '#6C47FF';
    else if (span) span.style.color = '';
  });
  // Detail page repost button
  document.querySelectorAll(`.dp-repost-btn[data-post-id="${postId}"], .detail-action.repost-action[data-post-id="${postId}"]`).forEach(btn => {
    btn.dataset.reposted = reposted ? 'true' : 'false';
    btn.classList.toggle('reposted', reposted);
    btn.classList.toggle('dp-reposted', reposted);
    const svg = btn.querySelector('.dp-repost-svg, .repost-icon');
    if (svg) {
      svg.setAttribute('stroke', reposted ? '#6C47FF' : 'currentColor');
      svg.setAttribute('stroke-width', reposted ? '2.5' : '2.2');
    }
  });
  // Sync comment bar repost button
  const cbRepost = document.getElementById('cb-repost-btn');
  if (cbRepost && cbRepost.dataset.postId === postId) {
    cbRepost.dataset.reposted = reposted ? 'true' : 'false';
    cbRepost.classList.toggle('cb-reposted', reposted);
    const cbSvg = cbRepost.querySelector('.cb-repost-svg');
    if (cbSvg) { cbSvg.setAttribute('stroke', reposted ? '#6C47FF' : 'currentColor'); cbSvg.setAttribute('stroke-width', reposted ? '2.5' : '2'); }
  }
}

async function syncRepostCount(postId) {
  if (!postId) return;
  try {
    const { data, error } = await supabase
      .from('posts').select('repost_count').eq('id', postId).single();
    if (error || !data) return;
    const count = data.repost_count ?? 0;

    // Feed cards
    document.querySelectorAll(`.repost-btn[data-post-id="${postId}"] span`)
      .forEach(sp => { sp.textContent = count > 0 ? fmtNum(count) : ''; });

    // Detail page stat
    document.querySelectorAll('.repost-count-display')
      .forEach(el => { if (detailPostId === postId) animateCount(el, count); });
  } catch (err) {
    console.warn('syncRepostCount error:', err.message);
  }
}


async function getMyRepostOfPost(originalPostId) {
  if (!currentUser) return null;
  const { data, error } = await supabase
    .from('posts')
    .select('id')
    .eq('user_id', currentUser.id)
    .eq('reposted_post_id', originalPostId)
    .maybeSingle();
  if (error) { console.error('getMyRepostOfPost failed:', error.message); return null; }
  return data?.id || null;
}

async function handleRepost(postId, btn) {
  if (!currentUser) { showToast('Sign in to repost'); return; }
  const alreadyReposted = btn?.dataset.reposted === 'true';

  if (alreadyReposted) {
    showActionSheet([
      { label: 'Undo Repost', icon: '🔄', action: () => undoRepost(postId, btn) },
    ]);
  } else {
    // Open composer in repost mode
    repostTargetId = postId;
    repostTargetBtn = btn;

    const { data: orig } = await supabase.from('posts')
      .select(`id,content,image,user_id,user:users(username,avatar)`)
      .eq('id', postId).single();

    openComposer();

    if (orig) {
      const preview = document.getElementById('composer-repost-preview');
      preview.innerHTML = `<div class="composer-repost-card">
        <div class="composer-repost-label">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#6C47FF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          Reposting from ${escHtml(orig.user?.username || '')}
        </div>
        ${orig.content ? `<p class="composer-repost-text">${escHtml(orig.content.slice(0,100))}${orig.content.length>100?'…':''}</p>` : ''}
        <button class="composer-repost-remove" onclick="clearRepost()">×</button>
      </div>`;
      updateComposerBtn();
    }
  }
}

function clearRepost() {
  repostTargetId = null; repostTargetBtn = null;
  const preview = document.getElementById('composer-repost-preview');
  if (preview) preview.innerHTML = '';
  updateComposerBtn();
}

async function undoRepost(postId, btn) {
  // Optimistic UI immediately
  setRepostUI(postId, false);

  try {
    // Always query DB directly — don't rely on Map which resets on refresh
    const myRepostId = repostedPosts.get(postId) || await getMyRepostOfPost(postId);
    if (!myRepostId) {
      setRepostUI(postId, false);
      showToast('Repost removed');
      return;
    }

    const { error: deleteError } = await supabase
      .from('posts').delete()
      .eq('id', myRepostId)
      .eq('user_id', currentUser.id);

    if (deleteError) throw deleteError;

    // NOTE: No manual decrement here — the DB trigger handles it automatically
    // calling decrement_repost_count manually too would double-decrement the count
    repostedPosts.delete(postId);

    // Wait briefly for trigger to fire before fetching real count
    await new Promise(resolve => setTimeout(resolve, 500));

    const { data: updated } = await supabase
      .from('posts').select('repost_count').eq('id', postId).single();
    const newCount = updated?.repost_count ?? 0;

    document.querySelectorAll(`.repost-btn[data-post-id="${postId}"] span`)
      .forEach(sp => { sp.textContent = newCount > 0 ? fmtNum(newCount) : ''; });
    document.querySelectorAll('.repost-count-display')
      .forEach(el => { if (detailPostId === postId) el.textContent = newCount; });

    // Remove repost card from feed
    document.querySelector(`.poster[data-post-id="${myRepostId}"]`)?.remove();

    showToast('Repost removed');
  } catch (err) {
    console.error('undoRepost failed:', err.message);
    setRepostUI(postId, true);
    showToast("Couldn't remove repost. Try again.");
  }
}

// ══════════════════════════════════════════
// COMPOSER
// ══════════════════════════════════════════

function openComposer() {
  const overlay = document.getElementById('composer-overlay');
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => {
    document.getElementById('composer-sheet').classList.add('open');
    document.getElementById('composer-textarea').focus();
  });

  // Avatar
  if (currentProfile?.avatar) {
    document.getElementById('composer-avatar').src = currentProfile.avatar;
  }
}

function closeComposer() {
  const sheet = document.getElementById('composer-sheet');
  sheet.classList.remove('open');
  setTimeout(() => {
    document.getElementById('composer-overlay').classList.add('hidden');
    document.getElementById('composer-textarea').value = '';
    document.getElementById('composer-media-preview').innerHTML = '';
    document.getElementById('composer-repost-preview').innerHTML = '';
    selectedFile = null;
    repostTargetId = null;
    repostTargetBtn = null;
    updateComposerBtn();
  }, 400);
}

function initComposerFile() {
  const fileInput = document.getElementById('composer-file');
  if (!fileInput) return;
  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Images only'); return; }
    if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5MB'); return; }
    selectedFile = file;

    const reader = new FileReader();
    reader.onload = ev => {
      const preview = document.getElementById('composer-media-preview');
      preview.innerHTML = `<div class="media-preview-item"><img src="${ev.target.result}" alt=""><button class="media-preview-remove" onclick="removeMedia()">×</button></div>`;
      updateComposerBtn();
    };
    reader.readAsDataURL(file);
  });

  const ta = document.getElementById('composer-textarea');
  ta?.addEventListener('input', () => {
    updateComposerBtn();
    updateCharCount(ta.value.length);
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  });
}

function removeMedia() {
  selectedFile = null;
  document.getElementById('composer-media-preview').innerHTML = '';
  document.getElementById('composer-file').value = '';
  updateComposerBtn();
}

function updateComposerBtn() {
  const ta = document.getElementById('composer-textarea');
  const btn = document.getElementById('composer-post-btn');
  const hasText = ta?.value?.trim().length > 0;
  const hasMedia = !!selectedFile;
  const hasRepost = !!repostTargetId;
  if (btn) btn.disabled = !(hasText || hasMedia || hasRepost);
}

function updateCharCount(len) {
  const el = document.getElementById('composer-char-count');
  if (!el) return;
  const remaining = MAX_CHARS - len;
  el.textContent = remaining;
  el.className = 'composer-char-count' + (remaining < 20 ? ' critical' : remaining < 60 ? ' low' : '');
}

function insertEmoji() {
  showToast('Emoji picker coming soon!');
}

async function submitPost() {
  const ta = document.getElementById('composer-textarea');
  const content = ta?.value?.trim() || '';
  const btn = document.getElementById('composer-post-btn');

  if (!content && !selectedFile && !repostTargetId) return;
  if (!currentUser) { showToast('Please sign in'); return; }

  if (btn) btn.disabled = true;

  // Capture these before closeComposer clears them
  const targetId = repostTargetId;

  let imageUrl = null;
  if (selectedFile) {
    try {
      if (btn) btn.textContent = 'Uploading...';
      imageUrl = await uploadImage(selectedFile, 'post-images');
      if (btn) btn.textContent = 'Post';
    } catch (e) {
      showToast('Upload failed after 3 attempts. Check your connection.');
      if (btn) { btn.disabled = false; btn.textContent = 'Post'; }
      return;
    }
  }

  const payload = {
    user_id: currentUser.id,
    content: content || null,
    image: imageUrl || null,
    reposted_post_id: targetId || null
  };

  const { data: newPost, error } = await supabase
    .from('posts')
    .insert([payload])
    .select(`id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
             user:users(id,username,avatar),
             reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar))`)
    .single();

  if (error) {
    showToast('Post failed: ' + error.message);
    if (btn) btn.disabled = false;
    return;
  }

  // Close composer first so UI feels instant
  closeComposer();
  showToast('Posted! 🎉');

  // Prepend to feed immediately
  const adapted = { ...newPost, comments: [{ count: 0 }] };
  const el = createFeedPost(adapted);
  const list = document.getElementById('feed-list');
  if (list && el) {
    list.prepend(el);
    loadedPostIds.add(newPost.id);
    el.classList.add('fade-up');
    observePost(el);
  }

  // Mark repost state immediately — before any async work
  if (targetId) {
    repostedPosts.set(targetId, newPost.id);
    setRepostUI(targetId, true);
  }

  // Handle repost async after UI is already updated
  if (targetId) {
    const { error: _e_increment_repost_count } = await supabase.rpc('increment_repost_count', { post_id: targetId }); // ignore error

    // Fetch real count and update DOM
    const { data: updated } = await supabase
      .from('posts').select('repost_count').eq('id', targetId).single();
    const newCount = updated?.repost_count ?? 0;
    document.querySelectorAll(`.repost-btn[data-post-id="${targetId}"] span`)
      .forEach(sp => { sp.textContent = newCount > 0 ? fmtNum(newCount) : String(newCount); });
    document.querySelectorAll('.repost-count-display')
      .forEach(el => { el.textContent = newCount; });

    // Notify original post author
    const { data: orig } = await supabase.from('posts').select('user_id').eq('id', targetId).single();
    if (orig && orig.user_id !== currentUser.id) {
      await supabase.from('notifications').insert({
        user_id: orig.user_id, actor_id: currentUser.id,
        post_id: targetId, type: 'repost', read: false
      }).catch(() => {});
    }
  }

  // Update profile if on that page
  if (document.getElementById('page-profile')?.classList.contains('active')) {
    renderMyProfile();
  }
}

// ══════════════════════════════════════════
// POST DETAIL
// ══════════════════════════════════════════

async function openDetail(postId, scrollToComments = false) {
  if (!postId) return;
  detailPostId = postId;
  detailCommentParentId = null;

  // ── Inject styles once ──
  if (!document.getElementById('detail-styles')) {
    const s = document.createElement('style');
    s.id = 'detail-styles';
    s.textContent = `

      /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
         DETAIL PAGE
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
      #detail-body { padding-bottom: 160px; }

      /* ── Post wrapper ── */
      .dp-wrap { background: var(--bg); }

      /* ── Author row ── */
      .dp-author {
        display: flex; align-items: center; gap: 12px;
        padding: 16px 16px 0;
      }
      .dp-avatar {
        width: 46px; height: 46px; border-radius: 50%;
        object-fit: cover; object-position: top;
        flex-shrink: 0; cursor: pointer;
        border: 2px solid var(--border, #e5e7eb);
        transition: opacity .15s;
      }
      .dp-avatar:active { opacity: .7; }
      .dp-author-info { flex: 1; min-width: 0; }
      .dp-name {
        font-size: 14px; font-weight: 700; color: var(--text);
        cursor: pointer; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis;
        line-height: 1.2;
      }
      .dp-name:hover { text-decoration: underline; }
      .dp-handle { font-size: 14px; color: var(--text2); margin-top: 1px; }
      .dp-follow-btn {
        height: 32px; padding: 0 18px;
        border-radius: 20px; font-size: 13px; font-weight: 700;
        border: 1.5px solid var(--border, #e5e7eb);
        background: transparent; color: var(--text);
        cursor: pointer; transition: all .2s; flex-shrink: 0;
        letter-spacing: -.01em;
      }
      .dp-follow-btn.following {
        background: #6C47FF; color: #fff; border-color: #6C47FF;
      }
      .dp-follow-btn:active { transform: scale(.93); }

      /* ── Content text ── */
      .dp-text {
        font-size: 17px; line-height: 1.65; color: var(--text);
        padding: 14px 16px 4px; margin: 0;
        white-space: pre-wrap; word-break: break-word;
      }

      /* ── Media ── */
      .dp-media { margin: 12px 0 0; overflow: hidden; }
      .dp-media img {
        width: 100%; display: block;
        max-height: 500px; object-fit: contain;
        background: #000; cursor: zoom-in;
      }
      .dp-media .dp-video-wrap {
        position: relative; background: #000; cursor: pointer;
      }
      .dp-media video { width: 100%; display: block; max-height: 420px; }
      .dp-media .dp-play-overlay {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,.18);
      }
      .dp-play-circle {
        width: 60px; height: 60px; border-radius: 50%;
        background: rgba(0,0,0,.6); backdrop-filter: blur(10px);
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 20px rgba(0,0,0,.4);
      }

      /* ── Quoted / Repost card ── */
      .dp-quote-intro {
        font-size: 14px; color: var(--text2); padding: 12px 16px 0;
        display: flex; align-items: center; gap: 6px;
      }
      .dp-quote-card {
        margin: 10px 16px 0;
        border: 1.5px solid var(--border, #e5e7eb);
        border-radius: 18px; overflow: hidden;
        background: var(--bg2, #f9fafb);
        cursor: pointer; transition: background .15s, border-color .15s;
      }
      .dp-quote-card:hover { border-color: #6C47FF; }
      .dp-quote-card:active { background: rgba(108,71,255,.04); }
      .dp-quote-inner { padding: 12px 14px 14px; }
      .dp-quote-header {
        display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
      }
      .dp-quote-avatar {
        width: 26px; height: 26px; border-radius: 50%;
        object-fit: cover; flex-shrink: 0;
      }
      .dp-quote-name { font-size: 14px; font-weight: 700; color: var(--text); }
      .dp-quote-time { font-size: 12px; color: var(--text2); margin-left: auto; }
      .dp-quote-text {
        font-size: 16px; color: var(--text); line-height: 1.5;
        white-space: pre-wrap; word-break: break-word; margin: 0;
      }
      .dp-quote-img {
        width: 100%; display: block;
        max-height: 220px; object-fit: cover;
      }

      /* ── Full date ── */
      .dp-date {
        padding: 14px 16px 0;
        font-size: 14px; color: var(--text2);
        letter-spacing: -.01em;
      }
      .dp-date b { color: var(--text); font-weight: 600; }

      /* ── Stats bar ── */
      .dp-stats {
        display: flex; margin: 14px 0 0;
        border-top: 1px solid var(--border, #e5e7eb);
        border-bottom: 1px solid var(--border, #e5e7eb);
      }
      .dp-stat {
        flex: 1; display: flex; flex-direction: column;
        align-items: center; padding: 11px 4px; gap: 3px;
        position: relative;
      }
      .dp-stat + .dp-stat::before {
        content: ''; position: absolute; left: 0; top: 18%;
        height: 64%; width: 1px;
        background: var(--border, #e5e7eb);
      }
      .dp-stat-n {
        font-size: 17px; font-weight: 700; color: var(--text);
        line-height: 1; letter-spacing: -.02em;
      }
      .dp-stat-l {
        font-size: 10px; color: var(--text2);
        text-transform: uppercase; letter-spacing: .06em; font-weight: 600;
      }

      /* ── Action row ── */
      .dp-actions {
        display: flex; align-items: center;
        padding: 2px 6px;
        border-bottom: 1px solid var(--border, #e5e7eb);
      }
      .dp-action {
        flex: 1; display: flex; align-items: center; justify-content: center;
        gap: 6px; height: 46px; border-radius: 12px;
        font-size: 13px; font-weight: 600; color: var(--text2);
        background: transparent; border: none; cursor: pointer;
        transition: all .18s; -webkit-tap-highlight-color: transparent;
      }
      .dp-action:active { background: var(--bg2); transform: scale(.93); }
      .dp-action.dp-liked { color: rgb(244,7,82); }
      .dp-action.dp-liked .dp-heart-path { fill: rgb(244,7,82); stroke: rgb(244,7,82); }
      .dp-action.dp-reposted { color: #6C47FF; }
      .dp-action.dp-reposted .dp-repost-svg { stroke: #6C47FF; }
      .dp-heart-path { transition: all .25s ease; }

      /* ── Divider ── */
      .dp-divider {
        height: 8px;
        background: var(--bg2, #f3f4f6);
        border-top: 1px solid var(--border, #e5e7eb);
        border-bottom: 1px solid var(--border, #e5e7eb);
      }

      /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
         COMMENTS
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
      .comments-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 16px 8px;
      }
      .comments-title { font-size: 16px; font-weight: 500; color: var(--text); }
      .comments-empty {
        padding: 44px 20px; text-align: center;
        font-size: 14px; color: var(--text2); line-height: 1.6;
      }
      .comments-empty-icon { font-size: 32px; margin-bottom: 8px; opacity: .5; }

      /* ── Comment item ── */
      .comment-item {
        display: flex; gap: 10px;
        padding: 12px 16px;
        border-bottom: 1px solid var(--border, #e5e7eb);
      }
      .comment-item.reply {
        padding-left: 52px;
        background: var(--bg2, #f9fafb);
      }
      @keyframes cmtFadeUp {
        from { opacity: 0; transform: translateY(10px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .comment-item { animation: cmtFadeUp .22s ease both; }
      .comment-avatar {
        width: 36px; height: 36px; border-radius: 50%;
        object-fit: cover; flex-shrink: 0; cursor: pointer;
        border: 1.5px solid var(--border, #e5e7eb);
        transition: opacity .15s;
      }
      .comment-avatar:active { opacity: .7; }
      .comment-body { flex: 1; min-width: 0; }

      /* bubble */
      .comment-bubble {
        background: var(--bg2, #f3f4f6);
        border-radius: 4px 18px 18px 18px;
        padding: 9px 13px 10px;
      }
      .comment-item.reply .comment-bubble {
        background: var(--bg);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 4px 18px 18px 18px;
      }
      .comment-name-row {
        display: flex; align-items: center; gap: 6px; margin-bottom: 3px;
        flex-wrap: wrap;
      }
      .comment-name {
        font-size: 13px; font-weight: 700; color: var(--text);
        cursor: pointer; line-height: 1.2;
      }
      .comment-name:hover { text-decoration: underline; }
      .comment-time { font-size: 11px; color: var(--text2); }
      .comment-text {
        font-size: 16px; line-height: 1.55; color: var(--text);
        white-space: pre-wrap; word-break: break-word; margin: 0;
      }

      /* action row below bubble */
      .comment-actions-row {
        display: flex; align-items: center; gap: 14px;
        padding: 5px 2px 0; flex-wrap: wrap;
      }
      .comment-action {
        font-size: 12px; font-weight: 600; color: var(--text2);
        background: none; border: none; cursor: pointer;
        padding: 3px 0; display: flex; align-items: center; gap: 4px;
        transition: color .15s; -webkit-tap-highlight-color: transparent;
      }
      .comment-action:hover { color: var(--text); }
      .comment-action.liked { color: rgb(244,7,82); }
      .comment-action.delete-comment-btn:hover { color: rgb(244,7,82); }
      .cmt-heart-path { transition: all .2s; }
      .like-comment-btn.liked .cmt-heart-path { fill: rgb(244,7,82); stroke: rgb(244,7,82); }

      /* ── Inline reply composer ── */
      .reply-composer {
        display: none; margin-top: 8px;
        border-radius: 16px; overflow: hidden;
        border: 1.5px solid var(--border, #e5e7eb);
        background: var(--bg);
      }
      .reply-composer.open { display: block; }
      .reply-composer-inner {
        display: flex; gap: 8px; padding: 10px 12px 6px; align-items: flex-start;
      }
      .reply-composer-avatar {
        width: 28px; height: 28px; border-radius: 50%;
        object-fit: cover; flex-shrink: 0;
      }
      .reply-textarea {
        flex: 1; border: none; outline: none; resize: none;
        font-size: 14px; line-height: 1.5; color: var(--text);
        background: transparent; font-family: inherit; min-height: 36px;
      }
      .reply-composer-footer {
        display: flex; justify-content: flex-end; gap: 8px;
        padding: 4px 12px 10px;
      }
      .reply-cancel, .reply-submit {
        height: 30px; padding: 0 16px; border-radius: 20px;
        font-size: 13px; font-weight: 700; cursor: pointer; border: none;
        transition: all .15s;
      }
      .reply-cancel { background: var(--bg2); color: var(--text2); }
      .reply-submit { background: #6C47FF; color: #fff; }
      .reply-submit:disabled { opacity: .35; cursor: not-allowed; }

      /* ── Load replies btn ── */
      .load-replies-btn {
        font-size: 13px; font-weight: 700; color: #6C47FF;
        background: none; border: none; cursor: pointer;
        padding: 6px 0 0; display: flex; align-items: center; gap: 5px;
      }
      .load-replies-btn::before {
        content: ''; display: inline-block;
        width: 18px; height: 1px;
        background: rgba(108,71,255,.35);
        vertical-align: middle;
      }

      /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
         COMMENT BAR (fixed bottom)
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
      .comment-bar {
        display: none;
        position: fixed; bottom: 0; left: 0; right: 0;
        flex-direction: column;
        background: #f0f0f5;
        padding: 10px 14px;
        padding-bottom: calc(10px + env(safe-area-inset-bottom));
        z-index: 200;
        border-top: 1px solid rgba(0,0,0,0.08);
      }
      .comment-bar-input {
        width: 100%; border: none; outline: none;
        background: transparent; resize: none;
        font-size: 16px; line-height: 1.4;
        color: var(--text); font-family: inherit;
        max-height: 120px; margin-bottom: 10px;
      }
      .comment-bar-input::placeholder { color: #999; }
      .cb-actions {
        display: flex; align-items: center;
        justify-content: space-between;
      }
      .cb-left { display: flex; align-items: center; gap: 2px; }
      .cb-right { display: flex; align-items: center; gap: 2px; }
      .cb-action-btn {
        width: 40px; height: 40px; border-radius: 50%;
        border: none; background: transparent; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        color: #333; transition: all .15s;
        -webkit-tap-highlight-color: transparent; flex-shrink: 0;
      }
      .cb-action-btn:active { transform: scale(.85); }
      .cb-like-btn { display: flex; align-items: center; gap: 10px; width: auto; padding: 0 6px; border-radius: 20px; }
      .cb-like-count { font-size: 14px; font-weight: 400; color: #000000; transition: color 0.25s; }
      .cb-action-btn.cb-liked { color: rgb(244,7,82); }
      .cb-action-btn.cb-liked .cb-heart-path { fill: rgb(244,7,82); stroke: rgb(244,7,82); }
      .cb-action-btn.cb-liked .cb-like-count { color: rgb(244,7,82); font-weight: 500; }
      .cb-action-btn.cb-reposted { color: #6C47FF; }
      .cb-action-btn.cb-reposted .cb-repost-svg { stroke: #6C47FF; stroke-width: 2.5; }
      .cb-heart-path { transition: all .25s; }
      .cb-send-btn {
        width: 44px; height: 44px;
        background: rgb(244,7,82); color: #fff; border-radius: 50%;
      }
      .cb-send-btn:disabled { opacity: .4; cursor: not-allowed; background: rgb(244,7,82); }
      .cb-send-btn:not(:disabled):active { transform: scale(.88); }
    `;
    document.head.appendChild(s);
  }

  slideTo('detail', async () => {
    const body = document.getElementById('detail-body');
    body.innerHTML = `<div class="dp-wrap">${skeletonPost()}</div>`;

    const { data: p, error } = await supabase
      .from('posts')
      .select(`id,content,image,video,created_at,like_count,comment_count,repost_count,views,user_id,reposted_post_id,
               user:users(id,username,avatar),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar))`)
      .eq('id', postId)
      .single();

    if (error || !p) {
      body.innerHTML = '<div class="empty-state"><p>Post not found</p></div>';
      return;
    }

    const user     = p.user || { username: '@unknown', avatar: '' };
    const isOwn    = currentUser && p.user_id === currentUser.id;
    const isLiked  = likedPosts.has(postId);
    const isRepost = !!p.reposted_post_id && !!p.reposted_post;
    const orig     = isRepost ? p.reposted_post : null;
    const origUser = orig?.user || { username: '@unknown', avatar: '' };

    // ── Media ──
    let mediaHtml = '';
    if (p.image) {
      mediaHtml = `<div class="dp-media"><img src="${p.image}" alt="" onclick="openImageFS('${p.image}')"></div>`;
    } else if (p.video) {
      mediaHtml = `<div class="dp-media"><div class="dp-video-wrap" onclick="openVideoFS('${p.video}')"><video preload="metadata"><source src="${p.video}#t=0.5" type="video/mp4"></video><div class="dp-play-overlay"><div class="dp-play-circle"><svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M5 3l14 9L5 21V3z"/></svg></div></div></div></div>`;
    }

    // ── Quoted card ──
    let quoteHtml = '';
    if (isRepost && orig) {
      quoteHtml = `
        <div class="dp-quote-card" onclick="openDetail('${orig.id}')">
          <div class="dp-quote-inner">
            <div class="dp-quote-header">
              <img class="dp-quote-avatar" src="${origUser.avatar||''}" onerror="this.style.display='none'">
              <span class="dp-quote-name">${escHtml(origUser.username)}</span>
              <span class="dp-quote-time">${timeSince(orig.created_at)}</span>
            </div>
            ${orig.content ? `<p class="dp-quote-text">${escHtml(orig.content.slice(0,240))}${orig.content.length>240?'…':''}</p>` : ''}
          </div>
          ${orig.image ? `<img class="dp-quote-img" src="${orig.image}" alt="">` : ''}
        </div>`;
    }

    // ── Full timestamp (your original style: "8 May 2025 · 11:42 PM") ──
    const d = new Date(p.created_at);
    const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const dateStr = d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

    body.innerHTML = `
      <div class="dp-wrap">

        <!-- AUTHOR -->
        <div class="dp-author">
          <img class="dp-avatar"
            src="${user.avatar||''}" onerror="this.style.display='none'"
            onclick="${isOwn ? "navTo('profile')" : `showUserProfile('${p.user_id}')`}">
          <div class="dp-author-info">
            <div class="dp-name"
              onclick="${isOwn ? "navTo('profile')" : `showUserProfile('${p.user_id}')`}">${escHtml(user.username)}</div>
            <div class="dp-handle">@${escHtml(user.username)}</div>
          </div>
          ${!isOwn
            ? `<button class="dp-follow-btn" id="dp-follow-${postId}" onclick="toggleDetailFollow(this,'${p.user_id}')">Follow</button>`
            : ''}
        </div>

        <!-- TEXT -->
        ${p.content ? `<p class="dp-text">${escHtml(p.content)}</p>` : ''}

        <!-- MEDIA -->
        ${mediaHtml}

        <!-- QUOTED POST -->
        ${quoteHtml}

        <!-- FULL DATE -->
        <div class="dp-date"><b>${timeStr}</b> · ${dateStr}</div>

        <!-- STATS -->
        <div class="dp-stats">
          <div class="dp-stat">
            <span class="dp-stat-n detail-stat-n" data-type="likes">${fmtNum(p.like_count||0)}</span>
            <span class="dp-stat-l">Likes</span>
          </div>
          <div class="dp-stat">
            <span class="dp-stat-n repost-count-display">${fmtNum(p.repost_count||0)}</span>
            <span class="dp-stat-l">Reposts</span>
          </div>
          <div class="dp-stat">
            <span class="dp-stat-n" data-type="comments">${fmtNum(p.comment_count||0)}</span>
            <span class="dp-stat-l">Replies</span>
          </div>
          <div class="dp-stat">
            <span class="dp-stat-n detail-stat-n" data-type="views">${fmtNum(p.views||0)}</span>
            <span class="dp-stat-l">Views</span>
          </div>
        </div>

        <!-- ACTIONS removed — handled by fixed comment bar below -->

      </div>

      <div class="dp-divider"></div>
      <div id="comments-container"></div>
    `;

    // Share btn (header)
    document.getElementById('detail-share-btn').onclick = () => sharePost(p);

    // Comment bar placeholder
    document.getElementById('comment-input').placeholder = `Reply to ${user.username} 💜...`;

    // Comment bar — wire like button
    const cbLike = document.getElementById('cb-like-btn');
    if (cbLike) {
      cbLike.dataset.postId = postId;
      cbLike.dataset.liked = isLiked ? 'true' : 'false';
      const cbPath = cbLike.querySelector('.cb-heart-path');
      const cbCount = document.getElementById('cb-like-count');
      if (isLiked) {
        cbPath?.setAttribute('fill', 'rgb(244,7,82)');
        cbPath?.setAttribute('stroke', 'rgb(244,7,82)');
        cbLike.classList.add('cb-liked');
      } else {
        cbPath?.setAttribute('fill', 'none');
        cbPath?.setAttribute('stroke', 'currentColor');
        cbLike.classList.remove('cb-liked');
      }
      if (cbCount) cbCount.textContent = p.like_count > 0 ? fmtNum(p.like_count) : '';
      cbLike.onclick = () => toggleLike(postId, cbLike);
    }

    // Comment bar — wire repost button
    const cbRepost = document.getElementById('cb-repost-btn');
    if (cbRepost) {
      cbRepost.dataset.postId = postId;
      const alreadyReposted = repostedPosts.has(postId);
      cbRepost.dataset.reposted = alreadyReposted ? 'true' : 'false';
      const cbSvg = cbRepost.querySelector('.cb-repost-svg');
      if (alreadyReposted) {
        cbRepost.classList.add('cb-reposted');
        cbSvg?.setAttribute('stroke', '#6C47FF');
        cbSvg?.setAttribute('stroke-width', '2.5');
      } else {
        cbRepost.classList.remove('cb-reposted');
        cbSvg?.setAttribute('stroke', 'currentColor');
        cbSvg?.setAttribute('stroke-width', '2');
      }
      cbRepost.onclick = () => handleRepost(postId, cbRepost);
    }

    // Swap bottom nav → comment bar
    document.getElementById('bottom-nav').style.display = 'none';
    document.getElementById('comment-bar').style.display = 'flex';

    // Track view + load comments
    await recordView(postId);
    await syncViewCount(postId);
    await loadComments(postId);

    // Live comment count straight from comments table — don't trust cached column
    supabase
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId)
      .then(({ count }) => {
        const statEl = document.querySelector('.dp-stat-n[data-type="comments"]');
        if (statEl && count !== null) animateCount(statEl, count);
        // Also keep the cached column in sync
        supabase.from('posts').update({ comment_count: count }).eq('id', postId);
      });

    if (scrollToComments) {
      setTimeout(() => {
        document.getElementById('comments-container')?.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    }
  });
}

function toggleDetailFollow(btn, userId) {
  const isFollowing = btn.classList.contains('following');
  btn.classList.toggle('following', !isFollowing);
  btn.textContent = !isFollowing ? 'Following' : 'Follow';
}

function focusCommentBar() {
  document.getElementById('comment-input')?.focus();
}

function insertMention() {
  const input = document.getElementById('comment-input');
  if (!input) return;
  const pos = input.selectionStart;
  input.value = input.value.slice(0, pos) + '@' + input.value.slice(pos);
  input.setSelectionRange(pos + 1, pos + 1);
  input.focus();
  input.dispatchEvent(new Event('input'));
}

function triggerCommentImage() {
  showToast('Image attachments in replies coming soon 🙏');
}

// ── COMMENT BAR ──
function initCommentBarInput() {
  const input = document.getElementById('comment-input');
  const sendBtn = document.getElementById('comment-send-btn');
  if (!input || !sendBtn) return;

  input.addEventListener('input', () => {
    sendBtn.disabled = input.value.trim().length === 0;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
}

async function submitReplyFromBar() {
  const input = document.getElementById('comment-input');
  const content = input?.value?.trim();
  if (!content || !detailPostId || !currentUser) return;

  input.value = '';
  input.style.height = 'auto';
  document.getElementById('comment-send-btn').disabled = true;

  await submitComment(detailPostId, detailCommentParentId, content);
  detailCommentParentId = null;
  input.placeholder = detailPostId ? `Reply…` : 'Add a reply…';
}

// ── COMMENTS ──
async function loadComments(postId) {
  const container = document.getElementById('comments-container');
  if (!container) return;

  container.innerHTML = `<div class="comments-header"><span class="comments-title">Replies</span></div><div id="comments-list"></div>`;

  const { data: comments, error } = await supabase
    .from('comments')
    .select(`id,content,created_at,like_count,parent_id,user_id,user:users(id,username,avatar)`)
    .eq('post_id', postId)
    .is('parent_id', null)
    .order('created_at', { ascending: false })
    .limit(30);

  const list = document.getElementById('comments-list');
  if (!list) return;

  const pill = document.getElementById('comments-count-pill');
  if (pill) pill.textContent = (comments || []).length;

  // Update stat table with real count from DB
  const statEl = document.querySelector('.dp-stat-n[data-type="comments"]');
  if (statEl) statEl.textContent = fmtNum((comments || []).length);

  if (!comments || !comments.length) {
    list.innerHTML = '<div class="comments-empty"><div class="comments-empty-icon">💬</div>No replies yet — be the first!</div>';
    return;
  }

  // Check liked comments
  const commentIds = comments.map(c => c.id);
  const { data: likedComments } = await supabase
    .from('comment_likes').select('comment_id').eq('user_id', currentUser.id).in('comment_id', commentIds);
  const likedSet = new Set((likedComments || []).map(r => r.comment_id));

  list.innerHTML = '';
  comments.forEach((c, i) => {
    const el = buildCommentEl(c, null, likedSet, postId);
    el.style.animationDelay = (i * 0.03) + 's';
    el.classList.add('fade-up');
    list.appendChild(el);
  });
}

function buildCommentEl(c, parentId, likedSet, postId) {
  const u = c.user || { username: '@unknown', avatar: '' };
  const isOwn = currentUser && c.user_id === currentUser.id;
  const liked = likedSet.has(c.id);

  const wrap = document.createElement('div');
  wrap.className = 'comment-item' + (parentId ? ' reply' : '');
  wrap.dataset.commentId = c.id;

  wrap.innerHTML = `
    <img class="comment-avatar" src="${u.avatar||''}" onerror="this.style.display='none'" alt="" onclick="showUserProfile('${c.user_id}')">
    <div class="comment-body">
      <div class="comment-bubble">
        <div class="comment-name-row">
          <span class="comment-name" onclick="showUserProfile('${c.user_id}')">${escHtml(u.username)}</span>
          <span class="comment-time">${timeSince(c.created_at)}</span>
        </div>
        <p class="comment-text">${escHtml(c.content)}</p>
      </div>
      <div class="comment-actions-row">
        <button class="comment-action like-comment-btn ${liked ? 'liked' : ''}" data-comment-id="${c.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path class="cmt-heart-path" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" stroke="${liked ? 'var(--red)' : 'currentColor'}" fill="${liked ? 'var(--red)' : 'none'}" stroke-width="2"/></svg>
          <span>${c.like_count > 0 ? c.like_count : ''}</span>
        </button>
        ${!parentId ? `<button class="comment-action reply-btn" data-comment-id="${c.id}">Reply</button>` : ''}
        ${isOwn ? `<button class="comment-action delete-comment-btn" data-comment-id="${c.id}">Delete</button>` : ''}
      </div>
      ${!parentId ? `<div class="reply-composer" id="reply-composer-${c.id}"><div class="reply-composer-inner"><img class="reply-composer-avatar" src="${currentProfile?.avatar||''}" onerror="this.style.display='none'"><textarea class="reply-textarea" placeholder="Reply to ${u.username}…" rows="1"></textarea></div><div class="reply-composer-footer"><button class="reply-cancel" onclick="closeReplyComposer('${c.id}')">Cancel</button><button class="reply-submit" disabled onclick="submitReplyInline('${c.id}','${postId}',this)">Reply</button></div></div>` : ''}
      ${!parentId ? `<div class="replies-container" id="replies-${c.id}"></div>` : ''}
    </div>
  `;

  // Reply btn
  wrap.querySelector('.reply-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    const composer = document.getElementById(`reply-composer-${c.id}`);
    document.querySelectorAll('.reply-composer.open').forEach(rc => {
      if (rc !== composer) rc.classList.remove('open');
    });
    composer?.classList.toggle('open');
    if (composer?.classList.contains('open')) {
      composer.querySelector('.reply-textarea')?.focus();
      detailCommentParentId = c.id;
    }
  });

  // Reply textarea
  const replyTa = wrap.querySelector('.reply-textarea');
  const replySubmit = wrap.querySelector('.reply-submit');
  replyTa?.addEventListener('input', () => {
    if (replySubmit) replySubmit.disabled = !replyTa.value.trim();
    replyTa.style.height = 'auto';
    replyTa.style.height = Math.min(replyTa.scrollHeight, 100) + 'px';
  });

  // Like comment
  wrap.querySelector('.like-comment-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    toggleCommentLike(c.id, e.currentTarget);
  });

  // Delete comment
  wrap.querySelector('.delete-comment-btn')?.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('Delete reply?')) return;
    await supabase.from('comments').delete().eq('id', c.id).eq('user_id', currentUser.id);
    wrap.style.transition = 'opacity 0.25s, transform 0.25s';
    wrap.style.opacity = '0'; wrap.style.transform = 'scale(0.95)';
    setTimeout(() => wrap.remove(), 250);
    await supabase.rpc('increment_post_comment_count', { pid: postId, delta: -1 });
    updateCommentCountDelta(-1);
  });

  // Load replies toggle
  loadReplyCount(c.id).then(count => {
    if (count > 0) {
      const repliesContainer = document.getElementById(`replies-${c.id}`);
      if (!repliesContainer) return;
      const loadBtn = document.createElement('button');
      loadBtn.className = 'load-replies-btn';
      loadBtn.textContent = `${count} ${count === 1 ? 'reply' : 'replies'}`;
      loadBtn.onclick = () => { loadBtn.remove(); loadReplies(c.id, repliesContainer, likedSet, postId); };
      repliesContainer.appendChild(loadBtn);
    }
  });

  return wrap;
}

async function submitReplyInline(parentCommentId, postId, btn) {
  const composer = document.getElementById(`reply-composer-${parentCommentId}`);
  const ta = composer?.querySelector('.reply-textarea');
  const content = ta?.value?.trim();
  if (!content || !currentUser) return;

  btn.disabled = true;
  ta.value = '';
  ta.style.height = 'auto';
  composer.classList.remove('open');

  await submitComment(postId, parentCommentId, content);

  // Add optimistic reply
  const repliesContainer = document.getElementById(`replies-${parentCommentId}`);
  const optimistic = buildCommentEl({
    id: 'opt-' + Date.now(), content, created_at: new Date().toISOString(),
    like_count: 0, parent_id: parentCommentId, user_id: currentUser.id,
    user: currentProfile
  }, parentCommentId, new Set(), postId);
  repliesContainer?.prepend(optimistic);
}

async function submitComment(postId, parentId, content) {
  const { data, error } = await supabase.from('comments').insert({
    post_id: postId, user_id: currentUser.id, parent_id: parentId || null, content
  }).select(`id,content,created_at,like_count,parent_id,user_id,user:users(id,username,avatar)`).single();

  if (!error) {
    await supabase.rpc('increment_post_comment_count', { pid: postId, delta: 1 });
    updateCommentCountDelta(1);
    if (!parentId) {
      const list = document.getElementById('comments-list');
      if (list) {
        const el = buildCommentEl(data, null, new Set(), postId);
        el.classList.add('fade-up');
        list.prepend(el);
        const emptyEl = list.querySelector('.comments-empty');
        if (emptyEl) emptyEl.remove();
      }
      supabase.from('posts').select('user_id').eq('id', postId).single().then(({ data: post }) => {
        if (post && post.user_id !== currentUser.id) {
          supabase.from('notifications').insert({ user_id: post.user_id, actor_id: currentUser.id, post_id: postId, type: 'comment', comment_text: content, read: false });
        }
      });
    }
  }
}

function updateCommentCountDelta(delta) {
  // Update replies pill (if present)
  const pill = document.getElementById('comments-count-pill');
  if (pill) {
    const v = parseInt(pill.textContent) || 0;
    pill.textContent = Math.max(0, v + delta);
  }
  // Update stat table replies count
  const statEl = document.querySelector('.dp-stat-n[data-type="comments"]');
  if (statEl) {
    const v = parseInt(statEl.textContent.replace(/[^0-9]/g,'')) || 0;
    animateCount(statEl, Math.max(0, v + delta));
  }
  // Update feed card comment count
  if (detailPostId) {
    const feedSpan = document.querySelector(`.comment-btn[data-post-id="${detailPostId}"] span`);
    if (feedSpan) {
      const v = parseInt(feedSpan.textContent.replace(/[^0-9]/g,'')) || 0;
      const newVal = Math.max(0, v + delta);
      feedSpan.textContent = newVal > 0 ? fmtNum(newVal) : '';
    }
  }
}

async function toggleCommentLike(commentId, btn) {
  if (!currentUser) return;
  const isLiked = btn.classList.contains('liked');
  const newLiked = !isLiked;
  btn.classList.toggle('liked', newLiked);
  const path = btn.querySelector('.heart-path');
  if (path) { path.setAttribute('fill', newLiked ? 'var(--red)' : 'none'); path.setAttribute('stroke', newLiked ? 'var(--red)' : 'currentColor'); }
  btn.classList.add('heart-pop');
  setTimeout(() => btn.classList.remove('heart-pop'), 400);
  const sp = btn.querySelector('span');
  const cnt = parseInt(sp?.textContent || '0') || 0;
  if (sp) sp.textContent = newLiked ? cnt + 1 : Math.max(0, cnt - 1) || '';

  if (newLiked) {
    supabase.from('comment_likes').insert({ comment_id: commentId, user_id: currentUser.id }).then(({ error }) => {
      if (!error) supabase.rpc('increment_comment_like', { cid: commentId, delta: 1 });
    });
  } else {
    supabase.from('comment_likes').delete().eq('comment_id', commentId).eq('user_id', currentUser.id).then(() => {
      supabase.rpc('increment_comment_like', { cid: commentId, delta: -1 });
    });
  }
}

async function loadReplyCount(parentId) {
  const { count } = await supabase.from('comments').select('*', { count: 'exact', head: true }).eq('parent_id', parentId);
  return count || 0;
}

async function loadReplies(parentId, container, likedSet, postId) {
  container.innerHTML = '<div class="loading-pulse" style="height:60px;margin:8px 0"></div>';
  const { data } = await supabase
    .from('comments')
    .select(`id,content,created_at,like_count,parent_id,user_id,user:users(id,username,avatar)`)
    .eq('parent_id', parentId)
    .order('created_at', { ascending: true })
    .limit(20);

  container.innerHTML = '';
  (data || []).forEach(r => {
    const el = buildCommentEl(r, parentId, likedSet, postId);
    container.appendChild(el);
  });
}

function closeReplyComposer(commentId) {
  document.getElementById(`reply-composer-${commentId}`)?.classList.remove('open');
  detailCommentParentId = null;
}

// ══════════════════════════════════════════
// DISCOVER
// ══════════════════════════════════════════

async function loadDiscover() {
  const container = document.getElementById('discover-posts');
  if (!container || container.dataset.loaded) return;
  container.dataset.loaded = '1';

  container.innerHTML = '<div class="loading-pulse" style="height:200px"></div>';

  const { data: posts } = await supabase
    .from('posts')
    .select(`id,content,image,video,created_at,like_count,user_id,user:users(id,username,avatar)`)
    .not('image', 'is', null)
    .order('like_count', { ascending: false })
    .limit(20);

  container.innerHTML = '';
  (posts || []).forEach(p => {
    const tile = document.createElement('div');
    tile.className = 'discover-tile fade-in';
    tile.innerHTML = `
      <img src="${p.image}" alt="" loading="lazy">
      <div class="discover-tile-overlay">
        <p class="discover-tile-text">${escHtml(p.content?.slice(0,60) || '')}</p>
        <div class="discover-tile-author">
          <img class="discover-tile-avatar" src="${p.user?.avatar||''}" onerror="this.style.display='none'">
          <span class="discover-tile-username">${escHtml(p.user?.username || '')}</span>
        </div>
      </div>`;
    tile.addEventListener('click', () => openDetail(p.id));
    container.appendChild(tile);
  });

  // Search
  const searchInput = document.getElementById('discover-search');
  searchInput?.addEventListener('input', debounce(async e => {
    const q = e.target.value.trim();
    if (!q) { container.dataset.loaded = ''; loadDiscover(); return; }
    container.innerHTML = '';
    const { data } = await supabase.from('posts')
      .select(`id,content,image,user_id,user:users(id,username,avatar)`)
      .ilike('content', `%${q}%`).limit(20);
    (data || []).forEach(p => {
      const tile = document.createElement('div');
      tile.className = 'discover-tile';
      tile.innerHTML = `${p.image ? `<img src="${p.image}" alt="" loading="lazy">` : `<div style="background:${gradientFor(p.id)};width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:12px"><p style="color:white;font-size:12px;text-align:center">${escHtml(p.content?.slice(0,60)||'')}</p></div>`}<div class="discover-tile-overlay"><p class="discover-tile-text">${escHtml(p.content?.slice(0,60)||'')}</p></div>`;
      tile.addEventListener('click', () => openDetail(p.id));
      container.appendChild(tile);
    });
  }, 400));
}

// ══════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════

async function loadNotifications() {
  if (!currentUser) return;
  const container = document.getElementById('notif-list');
  if (!container) return;

  const { data, error } = await supabase
    .from('notifications')
    .select(`id,created_at,read,type,actor_id,post_id,comment_text,
             actor:users!actor_id(id,username,avatar),
             post:posts!fk_notifications_post_id(id,image,user_id,user:users!user_id(username,avatar))`)
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(40);

  if (!data || !data.length) return;

  container.innerHTML = '';
  data.forEach(n => {
    const actor = n.actor || { username: '@someone', avatar: '' };
    const post = n.post;

    let msg = '';
    if (n.type === 'like') msg = 'liked your post';
    else if (n.type === 'repost') msg = 'reposted your post';
    else if (n.type === 'comment') msg = 'replied to your post';
    else if (n.type === 'follow') msg = 'started following you';

    const item = document.createElement('div');
    item.className = 'notif-item' + (!n.read ? ' unread' : '');
    item.innerHTML = `
      <img class="notif-avatar" src="${actor.avatar||''}" onerror="this.style.display='none'" alt="">
      <div class="notif-body">
        <p class="notif-text"><strong>${escHtml(actor.username)}</strong> ${msg}${n.comment_text ? `: "${escHtml(n.comment_text.slice(0,60))}"` : ''}</p>
        <p class="notif-time">${timeSince(n.created_at)}</p>
      </div>
      ${post?.image ? `<img class="notif-thumb" src="${post.image}" alt="">` : ''}
    `;
    item.addEventListener('click', () => {
      if (n.post_id) openDetail(n.post_id);
      else showUserProfile(n.actor_id);
    });
    container.appendChild(item);
  });
}

async function loadInitialNotifCount() {
  if (!currentUser) return;
  const { count } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id).eq('read', false);
  unreadCount = count || 0;
  updateNotifDot();
}

function updateNotifDot() {
  const dot = document.getElementById('notif-dot');
  if (dot) dot.style.display = unreadCount > 0 ? 'block' : 'none';
}

function subscribeToNotifs() {
  if (!currentUser || notifChannel) return;
  notifChannel = supabase
    .channel('notifs-' + currentUser.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUser.id}` }, (payload) => {
      if (!payload.new.read) { unreadCount++; updateNotifDot(); }
      if (navigator.vibrate) navigator.vibrate(40);
    })
    .subscribe();
}

function subscribeToPostUpdates() {
  if (postsChannel) return;

  postsChannel = supabase
    .channel('posts-realtime')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'posts'
    }, (payload) => {
      const post = payload.new;
      if (!post?.id) return;

      const postId = post.id;
      const likeCount    = post.like_count    ?? 0;
      const repostCount  = post.repost_count  ?? 0;
      const viewCount    = post.views         ?? 0;

      // ── Like count ──
      // Only update if this user didn't trigger it (they already have optimistic UI)
      document.querySelectorAll(`.heart-ai[data-post-id="${postId}"] .like-count`)
        .forEach(el => {
          const currentVal = parseInt(el.textContent || '0') || 0;
          if (currentVal !== likeCount) animateCount(el, likeCount);
        });

      // Detail page like stat
      if (detailPostId === postId) {
        const statEl = document.querySelector(`.detail-stat-n[data-type="likes"]`);
        if (statEl) {
          const currentVal = parseInt(statEl.textContent || '0') || 0;
          if (currentVal !== likeCount) animateCount(statEl, likeCount);
        }
      }

      // ── Repost count ──
      document.querySelectorAll(`.repost-btn[data-post-id="${postId}"] span`)
        .forEach(el => {
          const currentVal = parseInt(el.textContent || '0') || 0;
          if (currentVal !== repostCount) {
            el.textContent = repostCount > 0 ? fmtNum(repostCount) : '';
          }
        });

      // Detail page repost stat
      if (detailPostId === postId) {
        document.querySelectorAll('.repost-count-display').forEach(el => {
          const currentVal = parseInt(el.textContent || '0') || 0;
          if (currentVal !== repostCount) animateCount(el, repostCount);
        });
      }

      // ── View count ──
      document.querySelectorAll(`.poster[data-post-id="${postId}"] .twits .viewe`)
        .forEach(el => {
          el.textContent = `${fmtNum(viewCount) || 0} views`;
        });

      if (detailPostId === postId) {
        const viewEl = document.querySelector(`.detail-stat-n[data-type="views"]`);
        if (viewEl) {
          const currentVal = parseInt(viewEl.textContent || '0') || 0;
          if (currentVal !== viewCount) animateCount(viewEl, viewCount);
        }
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✓ Realtime post updates active');
      }
    });
}

// ══════════════════════════════════════════
// ECHOES PANEL
// ══════════════════════════════════════════

function injectEchoesPanel() {
  if (document.getElementById('echoes-overlay')) return;
  const el = document.createElement('div');
  el.id = 'echoes-overlay';
  el.className = 'echoes-overlay';
  el.innerHTML = `
    <div class="echoes-sheet" id="echoes-sheet">
      <div class="echoes-handle-row">
        <span class="echoes-title">✦ echoes</span>
        <button class="echoes-close" onclick="closeEchoes()">✕</button>
      </div>
      <div class="echoes-tabs">
        <button class="echoes-tab active" data-tab="all"     onclick="switchEchoTab('all',this)">All</button>
        <button class="echoes-tab"        data-tab="reposts" onclick="switchEchoTab('reposts',this)">Reposts</button>
        <button class="echoes-tab"        data-tab="replies" onclick="switchEchoTab('replies',this)">Replies</button>
      </div>
      <div class="echoes-body" id="echoes-body">
        <div class="echoes-empty"><div class="echoes-empty-icon">🔇</div><p>No echoes yet</p></div>
      </div>
    </div>
  `;
  el.addEventListener('click', e => { if (e.target === el) closeEchoes(); });
  document.body.appendChild(el);
}

let echoesPostId   = null;
let echoesAllData  = { reposts: [], replies: [] };
let echoesActiveTab = 'all';

async function openEchoes(postId, e) {
  e?.stopPropagation();
  echoesPostId = postId;
  echoesActiveTab = 'all';

  // Reset tabs UI
  document.querySelectorAll('.echoes-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.echoes-tab[data-tab="all"]')?.classList.add('active');

  const overlay = document.getElementById('echoes-overlay');
  const body    = document.getElementById('echoes-body');
  overlay.classList.add('open');

  // Loading state
  body.innerHTML = `<div class="echoes-empty"><div class="echoes-empty-icon" style="font-size:28px;animation:spin 1s linear infinite">⟳</div><p>Loading echoes…</p></div>`;

  // Fetch reposts and replies in parallel
  const [repostsRes, repliesRes] = await Promise.all([
    supabase
      .from('posts')
      .select(`id, content, created_at, like_count, repost_count, user_id,
               user:users(id, username, avatar)`)
      .eq('reposted_post_id', postId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('comments')
      .select(`id, content, created_at, like_count, user_id,
               user:users(id, username, avatar)`)
      .eq('post_id', postId)
      .is('parent_id', null)
      .order('created_at', { ascending: false })
      .limit(50)
  ]);

  echoesAllData = {
    reposts: repostsRes.data || [],
    replies: repliesRes.data || []
  };

  renderEchoTab('all');
}

function closeEchoes() {
  const overlay = document.getElementById('echoes-overlay');
  overlay?.classList.remove('open');
  echoesPostId = null;
}

function switchEchoTab(tab, btn) {
  echoesActiveTab = tab;
  document.querySelectorAll('.echoes-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderEchoTab(tab);
}

function renderEchoTab(tab) {
  const body = document.getElementById('echoes-body');
  const { reposts, replies } = echoesAllData;

  let items = [];
  if (tab === 'all') {
    // Merge and sort by date
    const r = reposts.map(p => ({ ...p, _type: 'repost' }));
    const c = replies.map(p => ({ ...p, _type: 'reply' }));
    items = [...r, ...c].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } else if (tab === 'reposts') {
    items = reposts.map(p => ({ ...p, _type: 'repost' }));
  } else {
    items = replies.map(p => ({ ...p, _type: 'reply' }));
  }

  if (!items.length) {
    const labels = { all: 'No echoes yet', reposts: 'No reposts yet', replies: 'No replies yet' };
    const icons  = { all: '🔇', reposts: '🔁', replies: '💬' };
    body.innerHTML = `<div class="echoes-empty"><div class="echoes-empty-icon">${icons[tab]}</div><p>${labels[tab]}</p></div>`;
    return;
  }

  body.innerHTML = items.map(item => {
    const user    = item.user || { username: '@unknown', avatar: '' };
    const isRepost = item._type === 'repost';
    const badge   = isRepost
      ? `<span class="echo-type-badge echo-type-repost">🔁 Repost</span>`
      : `<span class="echo-type-badge echo-type-reply">💬 Reply</span>`;
    const text    = item.content
      ? `<p class="echo-text">${escHtml(item.content.slice(0, 200))}${item.content.length > 200 ? '…' : ''}</p>`
      : `<p class="echo-text" style="color:var(--text2);font-style:italic">Reposted without comment</p>`;
    const stats   = isRepost
      ? `<span class="echo-stat">❤️ ${fmtNum(item.like_count||0)}</span><span class="echo-stat">🔁 ${fmtNum(item.repost_count||0)}</span>`
      : `<span class="echo-stat">❤️ ${fmtNum(item.like_count||0)}</span>`;

    return `
      <div class="echo-item" onclick="${isRepost ? `openDetail('${item.id}')` : `openDetail('${echoesPostId}', true)`}; closeEchoes();">
        <img class="echo-avatar" src="${escHtml(user.avatar||'')}" onerror="this.src=''" alt="">
        <div class="echo-content">
          <div class="echo-header">
            <span class="echo-username">${escHtml(user.username)}</span>
            <span class="echo-time">${timeSince(item.created_at)}</span>
            ${badge}
          </div>
          ${text}
          <div class="echo-stats">${stats}</div>
        </div>
      </div>
    `;
  }).join('');
}

async function markAllRead() {
  if (!currentUser) return;
  await supabase.from('notifications').update({ read: true }).eq('user_id', currentUser.id).eq('read', false);
  unreadCount = 0; updateNotifDot();
  document.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
}

// ══════════════════════════════════════════
// POST MENU / ACTION SHEET
// ══════════════════════════════════════════

function showPostMenu(post, el, triggerBtn, fromLongPress = false) {
  const isOwn = currentUser && post.user_id === currentUser.id;
  const actions = isOwn
    ? [
        { label: 'Delete Post', icon: '🗑️', danger: true, action: () => deletePost(post.id, el) }
      ]
    : [
        { label: 'Report Post', icon: '🚩', action: () => showToast('Reported') },
        { label: 'Not Interested', icon: '🙅', action: () => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); showToast('Got it'); } }
      ];

  showActionSheet(actions);
}

function showActionSheet(actions) {
  const overlay = document.createElement('div');
  overlay.className = 'action-sheet-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'action-sheet';

  actions.forEach((a, i) => {
    if (i > 0 && a.divider) {
      const div = document.createElement('div');
      div.className = 'action-sheet-divider';
      sheet.appendChild(div);
    }
    const item = document.createElement('div');
    item.className = 'action-sheet-item' + (a.danger ? ' danger' : '');
    item.innerHTML = `${a.icon ? `<span style="font-size:20px">${a.icon}</span>` : ''}<span>${a.label}</span>`;
    item.addEventListener('click', () => { document.body.removeChild(overlay); a.action?.(); });
    sheet.appendChild(item);
  });

  const cancelItem = document.createElement('div');
  cancelItem.className = 'action-sheet-item';
  cancelItem.style.cssText = 'font-weight:700;margin-top:8px;border-top:1px solid var(--border);';
  cancelItem.textContent = 'Cancel';
  cancelItem.addEventListener('click', () => document.body.removeChild(overlay));
  sheet.appendChild(cancelItem);

  overlay.appendChild(sheet);
  overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });
  document.body.appendChild(overlay);
}

async function deletePost(postId, el) {
  if (!currentUser) return;

  // Check if this is a repost before deleting
  const originalPostId = el?.dataset.repostedPostId || null;

  const { error } = await supabase.from('posts').delete().eq('id', postId).eq('user_id', currentUser.id);
  if (error) { showToast('Delete failed'); return; }

  // Animate out
  el.style.transition = 'opacity .3s, transform .3s';
  el.style.opacity = '0'; el.style.transform = 'scale(0.96)';
  setTimeout(() => el.remove(), 300);
  loadedPostIds.delete(postId);
  repostedPosts.delete(originalPostId);

  // If this was a repost — clean up UI on the original post
  if (originalPostId) {
    setRepostUI(originalPostId, false);

    // Fetch real count from DB (trigger already decremented it) and update DOM
    const { data } = await supabase
      .from('posts').select('repost_count').eq('id', originalPostId).single();
    const newCount = data?.repost_count ?? 0;
    document.querySelectorAll(`.repost-btn[data-post-id="${originalPostId}"] span`)
      .forEach(sp => { sp.textContent = newCount > 0 ? fmtNum(newCount) : ''; });
    document.querySelectorAll('.repost-count-display')
      .forEach(sp => { if (detailPostId === originalPostId) sp.textContent = newCount; });
  }

  showToast('Post deleted');
}

// ══════════════════════════════════════════
// EDIT PROFILE
// ══════════════════════════════════════════

function openEditProfile() {
  if (!currentProfile) return;
  const overlay = document.getElementById('edit-profile-overlay');
  overlay.classList.remove('hidden');

  document.getElementById('edit-username').value = currentProfile.username || '';
  document.getElementById('edit-bio').value = currentProfile.bio || '';
  document.getElementById('edit-location').value = currentProfile.location || '';
  if (currentProfile.cover) document.getElementById('edit-cover-img').src = currentProfile.cover;
  if (currentProfile.avatar) document.getElementById('edit-avatar-img').src = currentProfile.avatar;

  editAvatarFile = null; editCoverFile = null;
}

function closeEditProfile() {
  document.getElementById('edit-profile-overlay').classList.add('hidden');
}

function previewAvatar(e) {
  editAvatarFile = e.target.files[0];
  if (!editAvatarFile) return;
  const reader = new FileReader();
  reader.onload = ev => document.getElementById('edit-avatar-img').src = ev.target.result;
  reader.readAsDataURL(editAvatarFile);
}

function previewCover(e) {
  editCoverFile = e.target.files[0];
  if (!editCoverFile) return;
  const reader = new FileReader();
  reader.onload = ev => document.getElementById('edit-cover-img').src = ev.target.result;
  reader.readAsDataURL(editCoverFile);
}

async function saveProfile() {
  const updates = {
    username: document.getElementById('edit-username').value.trim(),
    bio: document.getElementById('edit-bio').value.trim(),
    location: document.getElementById('edit-location').value.trim()
  };

  const saveBtn = document.querySelector('.modal-save');
  if (saveBtn) { saveBtn.textContent = '…'; saveBtn.style.opacity = '0.5'; }

  try {
    if (editAvatarFile) updates.avatar = await uploadImage(editAvatarFile, 'avatars');
    if (editCoverFile) updates.cover = await uploadImage(editCoverFile, 'covers');

    const { error } = await supabase.from('users').update(updates).eq('id', currentUser.id);
    if (error) throw error;

    Object.assign(currentProfile, updates);
    updateNavAvatar();
    closeEditProfile();
    renderMyProfile();
    showToast('Profile updated ✓');
  } catch (e) {
    showToast('Update failed: ' + e.message);
  } finally {
    if (saveBtn) { saveBtn.textContent = 'Save'; saveBtn.style.opacity = '1'; }
  }
}

// ══════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════

function showSettings() {
  slideTo('settings');
}

function toggleDarkMode(isDark) {
  if (isDark) {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('darkMode', 'true');
  } else {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('darkMode', 'false');
  }
}

// ══════════════════════════════════════════
// WALLET
// ══════════════════════════════════════════

function openWallet() {
  slideTo('wallet');
}

function walletAction(type) {
  const msgs = { add: 'Add funds coming soon!', send: 'Send money coming soon!', withdraw: 'Withdraw coming soon!', convert: 'Convert points coming soon!' };
  showToast(msgs[type] || 'Coming soon!');
}

// ══════════════════════════════════════════
// VIEW TRACKING
// ══════════════════════════════════════════

async function recordView(postId) {
  if (!currentUser || !postId) return;
  try {
    const el = document.querySelector(`.poster[data-post-id="${postId}"]`);
    if (el) el.dataset.viewTracked = 'true';
    const { error } = await supabase.rpc('record_post_view', {
      p_post_id: postId,
      p_user_id: currentUser.id
    });
    if (error) console.warn('recordView error (non-fatal):', error.message);
  } catch (err) {
    console.warn('recordView error (non-fatal):', err.message);
  }
}

// ══════════════════════════════════════════
// IMAGE UPLOAD
// ══════════════════════════════════════════

async function uploadImage(file, bucket) {
  const compressed = await compressImage(file);
  const ext = 'jpg';
  // Unique path: userId + timestamp + random to avoid any collision
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${currentUser.id}_${Date.now()}_${rand}.${ext}`;

  // Retry up to 3 times with exponential backoff
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const uploadPromise = supabase.storage.from(bucket).upload(path, compressed, {
        upsert: true, // overwrite on collision instead of failing
        contentType: 'image/jpeg'
      });
      // 30 second timeout per attempt
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Upload timed out')), 30000)
      );
      const { error } = await Promise.race([uploadPromise, timeoutPromise]);
      if (error) throw error;
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      return data.publicUrl;
    } catch (e) {
      lastError = e;
      if (attempt < 3) {
        showToast(`Upload attempt ${attempt} failed, retrying...`);
        await new Promise(r => setTimeout(r, attempt * 1000)); // 1s, 2s backoff
      }
    }
  }
  throw lastError;
}

async function compressImage(file, maxW = 1200, quality = 0.82) {
  // Always compress through canvas to guarantee JPEG output
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = ev => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to decode image'));
      img.onload = () => {
        try {
          const scale = Math.min(1, maxW / Math.max(img.width, 1));
          const w = Math.max(1, Math.floor(img.width * scale));
          const h = Math.max(1, Math.floor(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          // White background for transparent PNGs
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(blob => {
            if (!blob) { reject(new Error('Canvas compression failed')); return; }
            resolve(new File([blob], 'image.jpg', { type: 'image/jpeg' }));
          }, 'image/jpeg', quality);
        } catch(e) { reject(e); }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ══════════════════════════════════════════
// SHARE
// ══════════════════════════════════════════

function sharePost(post) {
  const text = post.content ? post.content.slice(0, 100) : 'Check this out on Winged';
  if (navigator.share) {
    navigator.share({ title: 'Winged', text, url: window.location.href }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(window.location.href).then(() => showToast('Link copied!'));
  }
}

function shareMyProfile() {
  const user = currentProfile;
  const text = user?.username ? `Check out ${user.username} on Winged` : 'Check out my profile on Winged';
  if (navigator.share) {
    navigator.share({ title: 'Winged', text, url: window.location.href }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(window.location.href).then(() => showToast('Profile link copied!'));
  }
}


// ══════════════════════════════════════════
// VIDEO FULLSCREEN
// ══════════════════════════════════════════

function openVideoFS(src) {
  const overlay = document.getElementById('video-fs');
  const player = document.getElementById('video-fs-player');
  if (!overlay || !player) return;
  player.src = src;
  overlay.classList.remove('hidden');
  player.play().catch(() => {});
}

function closeVideoFS() {
  const overlay = document.getElementById('video-fs');
  const player = document.getElementById('video-fs-player');
  player?.pause();
  overlay?.classList.add('hidden');
}

// ══════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════

let toastTimer;
function showToast(msg, duration = 2500) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ══════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════

function timeSince(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s/60) + 'm';
  if (s < 86400) return Math.floor(s/3600) + 'h';
  if (s < 172800) return 'yesterday';
  if (s < 604800) return Math.floor(s/86400) + 'd';
  return Math.floor(s/604800) + 'w';
}

function fmtNum(n) {
  if (n === null || n === undefined) return '0';
  if (n === 0) return '0';
  if (n >= 1000000) return (n/1000000).toFixed(1).replace(/\.0$/,'') + 'M';
  if (n >= 1000) return (n/1000).toFixed(1).replace(/\.0$/,'') + 'K';
  return String(n);
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function gradientFor(id) {
  const gradients = [
    'linear-gradient(135deg,#667eea,#764ba2)',
    'linear-gradient(135deg,#f093fb,#f5576c)',
    'linear-gradient(135deg,#4facfe,#00f2fe)',
    'linear-gradient(135deg,#43e97b,#38f9d7)',
    'linear-gradient(135deg,#fa709a,#fee140)',
    'linear-gradient(135deg,#a18cd1,#fbc2eb)',
  ];
  const hash = (str) => str ? [...str].reduce((a,c) => a + c.charCodeAt(0), 0) : 0;
  return gradients[hash(id) % gradients.length];
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };

}
