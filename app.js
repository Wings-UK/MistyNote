/* ═══════════════════════════════════════════════════════════
   MISTYNOTE — app.js
   Complete rewrite: clean architecture, mobile-first
═══════════════════════════════════════════════════════════ */

'use strict';

// ── CONTENT PROTECTION ─────────────────────────────────────
// Block right-click context menu globally
document.addEventListener('contextmenu', e => e.preventDefault());

// Block image/media drag
document.addEventListener('dragstart', e => {
  if (e.target.tagName === 'IMG' || e.target.tagName === 'VIDEO') e.preventDefault();
});

// ── STATE ──────────────────────────────────────────────────
let currentUser = null;
let currentProfile = null;
let viewingProfile = null; // other user currently being viewed
let feedOffset = 0;
let feedLoading = false;
let feedExhausted = false;
let currentFeedTab = 'for-you'; // 'for-you' | 'following'

// Active moments map — userId → { type: 'regular'|'commerce'|'live'|'live_commerce' }
// Seeded from demo for now — replace with DB query when moments are built
const activeMoments = new Map();
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
const savedPosts = new Set();      // postIds saved/bookmarked by current user

const MAX_CHARS = 280;

// ── WAIT FOR SUPABASE ──────────────────────────────────────


// ══════════════════════════════════════════
// UPLOAD PROGRESS — COMPOSE BUTTON RING
// ══════════════════════════════════════════

const uploadState = {
  status: 'idle', // idle | uploading | success | failed
  retryFn: null,
  pendingPostData: null,
};

const RING_CIRCUMFERENCE = 138.2; // 2 * PI * 22

function setComposeRing(status, progress = 0) {
  const btn  = document.getElementById('nav-compose-btn');
  const fill = document.getElementById('compose-ring-fill');
  const inner = document.getElementById('compose-btn-inner');
  if (!btn || !fill || !inner) return;

  // Remove all state classes
  btn.classList.remove('uploading', 'upload-success', 'upload-failed');

  if (status === 'idle') {
    fill.style.strokeDashoffset = RING_CIRCUMFERENCE;
    inner.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="white" fill-opacity="0.15"/><path d="M12 5v14M5 12h14" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>`;
    btn.style.animation = '';
  } else if (status === 'uploading') {
    btn.classList.add('uploading');
    const offset = RING_CIRCUMFERENCE - (progress / 100) * RING_CIRCUMFERENCE;
    fill.style.strokeDashoffset = offset;
    inner.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  } else if (status === 'success') {
    btn.classList.add('upload-success');
    fill.style.strokeDashoffset = 0;
    inner.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    // Auto-reset after 2 seconds
    setTimeout(() => setComposeRing('idle'), 2000);
  } else if (status === 'failed') {
    btn.classList.add('upload-failed');
    inner.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 17h.01" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  uploadState.status = status;
}

function composeOrRetry() {
  if (uploadState.status === 'uploading') return; // ignore tap while uploading
  if (uploadState.status === 'failed') {
    // Show retry / discard action sheet
    showActionSheet([
      { label: 'Retry Upload', action: () => { if (uploadState.retryFn) uploadState.retryFn(); } },
      { label: 'Discard Post', style: 'destructive', action: () => {
        uploadState.retryFn = null;
        uploadState.pendingPostData = null;
        setComposeRing('idle');
      }},
      { label: 'Cancel', action: () => {} }
    ]);
    return;
  }
  openComposer();
}

// ══════════════════════════════════════════
// ROUTER
// ══════════════════════════════════════════

function getRoute() {
  const path = window.location.pathname;
  if (path === '/' || path === '') return { type: 'home' };
  const postMatch = path.match(/^\/post\/([^/]+)$/);
  if (postMatch) return { type: 'post', id: postMatch[1] };
  const profileMatch = path.match(/^\/profile\/([^/]+)$/);
  if (profileMatch) return { type: 'profile', username: profileMatch[1] };
  return { type: 'home' };
}

function pushRoute(path) {
  if (window.location.pathname !== path) {
    window.history.pushState({}, '', path);
  }
}

function replaceRoute(path) {
  window.history.replaceState({}, '', path);
}

async function handleRoute(route) {
  if (!route) route = getRoute();
  if (route.type === 'post') {
    await openDetail(route.id);
  } else if (route.type === 'profile') {
    // Look up user by username then open profile
    const { data: user } = await supabase.from('users').select('id').eq('username', route.username).maybeSingle();
    if (user) await showUserProfile(user.id, null);
  }
}

window.addEventListener('popstate', () => {
  const route = getRoute();
  if (route.type === 'home') {
    // Close any open slide pages
    if (slideStack.length > 0) {
      slideBack();
    }
  } else {
    handleRoute(route);
  }
});


// ══════════════════════════════════════════
// USERNAME / BIO VALIDATION
// ══════════════════════════════════════════

function validateUsername(raw) {
  // Strip leading @ if present
  const username = raw.replace(/^@/, '').trim();
  if (!username) return { valid: false, error: 'Username is required', value: '' };
  if (username.length < 3) return { valid: false, error: 'At least 3 characters required', value: username };
  if (username.length > 15) return { valid: false, error: 'Max 15 characters', value: username };
  if (!/^[a-z0-9_]+$/.test(username)) return { valid: false, error: 'Only lowercase letters, numbers and _ allowed', value: username };
  if (/^_/.test(username) || /_$/.test(username)) return { valid: false, error: 'Cannot start or end with underscore', value: username };
  if (/__/.test(username)) return { valid: false, error: 'No consecutive underscores', value: username };
  return { valid: true, error: '', value: username };
}

function sanitizeUsernameInput(input) {
  // Force lowercase, strip invalid chars as user types
  return input.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

window.addEventListener('supabase-ready', init);

// ── INIT ──────────────────────────────────────────────────
async function init() {
  const route = getRoute();
  const isDeepLink = route.type !== 'home';

  // On deep links — show splash immediately, hide auth form so it never flashes
  if (isDeepLink) {
    showDeepLinkSplash();
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      hideDeepLinkSplash();
      showAuthScreen();
      return;
    }
    currentUser = session.user;
    await bootApp(isDeepLink);
  } catch (e) {
    console.error('Init error:', e);
    hideDeepLinkSplash();
    showAuthScreen();
  }
}

function showDeepLinkSplash() {
  // Hide auth screen completely
  const auth = document.getElementById('auth-screen');
  if (auth) auth.style.display = 'none';

  // Create and show a minimal branded splash
  if (document.getElementById('deep-link-splash')) return;
  const splash = document.createElement('div');
  splash.id = 'deep-link-splash';
  splash.innerHTML = `
    <div style="
      position:fixed;inset:0;
      background:var(--bg, #fff);
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      z-index:9999;gap:16px;
    ">
      <svg width="52" height="52" viewBox="0 0 48 48" fill="none">
        <path d="M8 24C8 24 12 8 24 8C36 8 40 24 40 24" stroke="#6C47FF" stroke-width="3" stroke-linecap="round"/>
        <path d="M8 24C8 24 16 18 24 24C32 30 40 24 40 24" stroke="#6C47FF" stroke-width="3" stroke-linecap="round"/>
        <path d="M8 24C8 24 12 40 24 40C36 40 40 24 40 24" stroke="#6C47FF" stroke-width="3" stroke-linecap="round"/>
      </svg>
      <div style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:700;font-size:22px;color:var(--text,#111);">MistyNote</div>
      <div style="width:32px;height:3px;background:#6C47FF;border-radius:2px;animation:splashBar 1.2s ease-in-out infinite alternate;"></div>
    </div>
    <style>
      @keyframes splashBar {
        from { width: 24px; opacity: 0.5; }
        to   { width: 48px; opacity: 1; }
      }
    </style>
  `;
  document.body.appendChild(splash);
}

function hideDeepLinkSplash() {
  const splash = document.getElementById('deep-link-splash');
  if (splash) {
    splash.style.transition = 'opacity 0.25s';
    splash.style.opacity = '0';
    setTimeout(() => splash.remove(), 260);
  }
}

// ══════════════════════════════════════════
// LOCATION — silent auto-detect on every boot
// ══════════════════════════════════════════

async function detectAndSaveLocation() {
  if (!currentUser) return;
  if (!navigator.geolocation) return;

  // Snapshot current user id — prevents race condition if user switches accounts
  const userId = currentUser.id;

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
        const data = await res.json();
        const city    = data.address?.city || data.address?.town || data.address?.village || data.address?.county || '';
        const country = data.address?.country || '';
        const location = [city, country].filter(Boolean).join(', ');

        if (!location) return;

        // Always save GPS location — overrides any old manual value
        await supabase.from('users')
          .update({ location })
          .eq('id', userId)
          .catch(() => {});

        // Log only if changed
        const oldLocation = currentProfile?.location;
        if (oldLocation !== location) {
          await logProfileChange('location', oldLocation, location).catch(() => {});
        }

        // Update local profile and UI
        if (currentProfile && currentUser?.id === userId) {
          currentProfile.location = location;
          // Update edit profile display if open
          const locDisplay = document.getElementById('edit-location-display');
          if (locDisplay) {
            locDisplay.textContent = location;
            locDisplay.style.color = '';
          }
          // Refresh profile page if visible
          if (document.getElementById('page-profile')?.classList.contains('active')) {
            renderMyProfile();
          }
        }
      } catch(_) {
        // Reverse geocode failed — silently ignore
      }
    },
    async (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        await supabase.from('users')
          .update({ location_denied: true })
          .eq('id', userId)
          .catch(() => {});
        if (currentProfile && currentUser?.id === userId) {
          currentProfile.location_denied = true;
        }
      }
    },
    { timeout: 10000, maximumAge: 60000 } // max 1 min cache — always get fresh location per session
  );
}

function sortMomentsRow() {
  const row = document.getElementById('stories-row');
  if (!row) return;
  // Move all .seen cards to the end, keeping unseen at front
  const seen   = Array.from(row.querySelectorAll('.moment-card.seen'));
  const unseen = Array.from(row.querySelectorAll('.moment-card:not(.seen)'));
  // Re-append: add button stays first (it's not .moment-card), then unseen, then seen
  unseen.forEach(el => row.appendChild(el));
  seen.forEach(el  => row.appendChild(el));
}

async function bootApp(isDeepLink = false) {
  document.getElementById('auth-screen').style.display = 'none';

  // On deep links — keep feed hidden until content is ready, preventing feed flash
  const appEl = document.getElementById('app');
  const feedEl = document.getElementById('page-feed');
  if (isDeepLink && feedEl) feedEl.style.visibility = 'hidden';
  appEl.classList.remove('hidden');

  injectFeedPostStyles();
  injectEchoesPanel();

  // Apply dark mode early to avoid flash
  if (localStorage.getItem('darkMode') === 'true') {
    document.documentElement.setAttribute('data-theme', 'dark');
    const toggle = document.getElementById('dark-mode-toggle');
    if (toggle) toggle.checked = true;
  }

  await loadMyProfile();
  updateNavAvatar();
  initComposerFile();
  // Delay location detection slightly — Chrome needs page to be fully interactive
  setTimeout(() => detectAndSaveLocation(), 2000);
  sortMomentsRow();
  initIntersectionObserver();
  requestAnimationFrame(initFeedTabBar);
  initCommentBarInput();
  subscribeToNotifs();
  subscribeToPostUpdates();

  if (isDeepLink) {
    // Deep link — go straight to content, load feed silently in background
    const route = getRoute();
    hideDeepLinkSplash();
    await handleRoute(route);
    // Restore feed visibility and load in background
    if (feedEl) feedEl.style.visibility = '';
    setTimeout(() => {
      // Only load feed if not already loading from bootApp
      if (!feedLoading && loadedPostIds.size === 0) loadFeed();
      loadNotifications();
      loadInitialNotifCount();
    }, 600);
  } else {
    // Normal load — show feed immediately
    loadFeed();
    loadNotifications();
    loadInitialNotifCount();
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
      const rawUsername = document.getElementById('auth-username')?.value || '';
      const usernameCheck = validateUsername(rawUsername);
      if (!usernameCheck.valid) { throw new Error(usernameCheck.error); }
      const cleanUsername = usernameCheck.value;

      // Check username not already taken
      const { data: existing } = await supabase.from('users').select('id').eq('username', cleanUsername).maybeSingle();
      if (existing) { throw new Error('Username already taken — try another'); }

      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;

      if (data.user) {
        await supabase.from('users').upsert({
          id: data.user.id,
          username: cleanUsername,
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

      // Reset ALL state — full clean slate for next login
      currentUser = null; currentProfile = null; viewingProfile = null;
      loadedPostIds.clear(); likedPosts.clear(); repostedPosts.clear();
      savedPosts.clear();
      activeMoments.clear();
      feedOffset = 0; feedLoading = false; feedExhausted = false;
      currentFeedTab = 'for-you';
      unreadCount = 0;

      // Clear feed DOM
      const feedList = document.getElementById('feed-list');
      if (feedList) feedList.innerHTML = '';

      // Reset feed tab UI back to Explore
      document.querySelectorAll('.feed-tab').forEach(t => t.classList.remove('active'));
      const forYouTab = document.getElementById('feed-tab-foryou');
      if (forYouTab) forYouTab.classList.add('active');

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
  // If any slide panels are open, close them all cleanly before navigating
  if (slideStack.length > 0) {
    slideStack.forEach(id => {
      document.getElementById('page-' + id)?.classList.remove('active');
    });
    slideStack.length = 0;
    // Clean up all floating headers and comment bar
    document.getElementById('comment-bar').style.display = 'none';
    const floatingHeader = document.getElementById('user-profile-header');
    if (floatingHeader) floatingHeader.style.display = 'none';
    const miniIdentity = document.getElementById('uprf-header-identity');
    const miniFollow   = document.getElementById('uprf-header-follow');
    if (miniIdentity) { miniIdentity.style.opacity='0'; miniIdentity.style.pointerEvents='none'; }
    if (miniFollow)   { miniFollow.style.opacity='0'; miniFollow.style.display='none'; }
    document.getElementById('page-user-profile')?._uprfAvatarObs?.disconnect();
    document.getElementById('page-profile')?._myprfAvatarObs?.disconnect();
    const myHdr = document.getElementById('my-profile-header');
    if (myHdr) myHdr.style.display = 'none';
  }

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
    const feedList = document.getElementById('feed-list');
    const hasPosts = feedList && feedList.querySelector('.poster');
    if (!hasPosts && !feedLoading) loadFeed();
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

  // Block ALL post taps during slide — prevents ghost clicks from landing on profile posts
  document.querySelectorAll('[data-post-id]').forEach(post => {
    post.dataset.blockNavigation = 'true';
    setTimeout(() => { post.dataset.blockNavigation = 'false'; }, 600);
  });

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

  // Deactivate any currently active slide page so they don't stack visually
  const slidePages = ['detail','user-profile','settings','wallet','storefront','messages','chat'];
  slidePages.forEach(id => {
    if (id !== pageId) document.getElementById('page-' + id)?.classList.remove('active');
  });

  // Hide bottom nav for slide pages that need full screen
  if (['messages','chat'].includes(pageId)) {
    document.getElementById('bottom-nav').style.display = 'none';
  }

  // If leaving detail, hide comment bar and restore bottom nav
  if (slideStack[slideStack.length - 2] === 'detail' || document.getElementById('comment-bar')?.style.display === 'flex') {
    if (pageId !== 'detail') {
      document.getElementById('comment-bar').style.display = 'none';
      document.getElementById('bottom-nav').style.display = '';
    }
  }

  if (setupFn) setupFn();

  // Show floating header only for user-profile
  const floatingHeader = document.getElementById('user-profile-header');
  if (floatingHeader) floatingHeader.style.display = pageId === 'user-profile' ? 'flex' : 'none';
  // Reset uprf mini identity immediately — prevent stale content showing during load
  if (pageId === 'user-profile') {
    const _uprfIdentity = document.getElementById('uprf-header-identity');
    const _uprfFollow   = document.getElementById('uprf-header-follow');
    if (_uprfIdentity) { _uprfIdentity.style.opacity = '0'; _uprfIdentity.style.pointerEvents = 'none'; }
    if (_uprfFollow)   { _uprfFollow.style.opacity = '0'; _uprfFollow.style.display = 'none'; }
  }

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

  const returningTo = slideStack.length > 0 ? slideStack[slideStack.length - 1] : null;

  // If still inside a slide page, re-activate it and stop
  if (returningTo) {
    document.getElementById('page-' + returningTo)?.classList.add('active');
  }

  // Hide comment bar only when leaving detail
  if (pageId === 'detail') {
    document.getElementById('comment-bar').style.display = 'none';
  }

  // If returning to detail, re-show comment bar and hide bottom nav
  if (returningTo === 'detail') {
    document.getElementById('comment-bar').style.display = 'flex';
    document.getElementById('bottom-nav').style.display = 'none';
    // Ensure user-profile floating header is hidden when returning to detail
    const fh = document.getElementById('user-profile-header');
    if (fh) fh.style.display = 'none';
    return;
  }

  // Restore URL when sliding back
  if (returningTo === 'detail' && detailPostId) {
    pushRoute('/post/' + detailPostId);
  } else if (!returningTo) {
    replaceRoute('/');
  }

  // Restore bottom nav only when back to a main page
  if (!returningTo) {
    document.getElementById('bottom-nav').style.display = '';
  }

  // Floating user-profile header
  const floatingHeader = document.getElementById('user-profile-header');
  if (floatingHeader) floatingHeader.style.display = returningTo === 'user-profile' ? 'flex' : 'none';
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

  // Restore last main page when fully back
  const lastMain = returningTo || lastMainPage;
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
    .prf-bld:hover { text-decoration:none; }
    .prf-follow-sep { margin:0 5px; }

    /* ── BIO ── */
    .prf-bio { margin-top:10px; font-size:15px; color:var(--text); line-height:1.55; white-space:pre-wrap; word-break:break-word; }
    .prf-location { margin-top:6px; font-size:13px; color:var(--text3); display:flex; align-items:center; gap:3px; }
    .prf-location-denied { margin-top:8px; font-size:12px; color:var(--red,#ff3b5c); background:rgba(255,59,92,0.08); padding:8px 12px; border-radius:8px; line-height:1.4; }

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
    .prf-btn-primary { background:#6C47FF; color:#fff; border:1.5px solid #6C47FF; }
    .prf-btn-primary:active { transform:scale(.96); opacity:.9; }
    .prf-btn-dark { background:var(--text); color:var(--bg); }
    .prf-btn-dark:active { transform:scale(.96); opacity:.85; }
    .prf-btn-outline { background:transparent; color:var(--text); border:1.5px solid var(--border,#e5e7eb); }
    .prf-btn-outline:active { transform:scale(.96); }
    .prf-btn-following { background:transparent; color:#6C47FF; border:1.5px solid #6C47FF; border-radius:20px; }
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
    .prf-masonry { display:flex; gap:8px; padding:8px; align-items:flex-start; width:100%; box-sizing:border-box; }
    .prf-masonry-col { flex:1; display:flex; flex-direction:column; gap:8px; }
    .prf-masonry-tile { border-radius:12px; overflow:hidden; cursor:pointer; background:var(--surface); transition:transform .18s; box-shadow:0 1px 4px rgba(0,0,0,.08); }
    .prf-masonry-tile:active { transform:scale(.97); }
    .prf-masonry-img { width:100%; display:block; object-fit:cover; }
    .prf-masonry-text-tile { width:100%; min-height:120px; display:flex; align-items:center; justify-content:center; padding:16px 12px; }
    .prf-masonry-text-tile p { font-size:13px; color:#fff; line-height:1.45; text-align:center; font-weight:600; margin:0; }
    .prf-masonry-caption { font-size:16px; color:var(--text); line-height:1.4; padding:8px 10px 4px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .prf-masonry-footer { display:flex; align-items:center; justify-content:space-between; padding:6px 10px 10px; gap:6px; }
    .prf-masonry-author { display:flex; align-items:center; gap:5px; min-width:0; flex:1; }
    .prf-masonry-avatar { width:20px; height:20px; border-radius:50%; object-fit:cover; flex-shrink:0; }
    .prf-masonry-username { font-size:11px; color:var(--text2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .prf-masonry-like { display:flex; align-items:center; gap:3px; background:none; border:none; cursor:pointer; flex-shrink:0; padding:2px 0; color:var(--text3); -webkit-tap-highlight-color:transparent; }
    .prf-masonry-like.liked { color:rgb(244,7,82); }
    .prf-masonry-like-count { font-size:11px; font-weight:500; color:inherit; }

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

  const [postsRes, likedRes, savedRes] = await Promise.all([
    supabase.from('posts')
      .select(`id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
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
      .limit(60),
    supabase.from('saved_posts')
      .select(`post:posts(id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
               user:users(id,username,avatar),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar)))`)
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(60)
  ]);

  const posts         = postsRes.data || [];
  const likedPostsArr = (likedRes.data || []).map(r => r.post).filter(Boolean);
  const savedPostsArr = (savedRes.data || []).map(r => r.post).filter(Boolean);
  const mediaPosts    = posts.filter(p => (p.image || p.video) && !p.reposted_post_id);
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
          ${profile.is_verified ? `<span class="prf-verified"><svg width="18" height="18" viewBox="0 0 24 24" fill="#6C47FF"><path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/></svg></span>` : ''}
        </div>
        ${profile.bio ? `<p class="prf-bio">${escHtml(profile.bio)}</p>` : ''}
        ${profile.location ? `<p class="prf-location"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="vertical-align:-1px;margin-right:3px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="currentColor"/></svg>${escHtml(profile.location)}</p>` : ''}
        ${profile.location_denied && isOwn ? `<p class="prf-location-denied">⚠ Location denied — enable in browser settings to unlock commerce features</p>` : ''}
      </div>

      <!-- STATS BAR -->
      <div class="prf-stats-row">
        <div class="prf-stat-card">
          <span class="prf-stat-n">${fmtNum(posts.length)}</span>
          <span class="prf-stat-l">Posts</span>
        </div>
        <div class="prf-stat-card clickable" onclick="openFollowList('followers', currentUser.id)">
          <span class="prf-stat-n" id="prf-followers-count">${fmtNum(profile.followers||0)}</span>
          <span class="prf-stat-l">Followers</span>
        </div>
        <div class="prf-stat-card clickable" onclick="openFollowList('following', currentUser.id)">
          <span class="prf-stat-n" id="prf-following-count">${fmtNum(profile.following||0)}</span>
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

      <!-- PEOPLE TO FOLLOW BOX -->
      <div class="prf-suggest-box" id="prf-suggest-own" style="display:none">
        <div class="prf-suggest-header">
          <span class="prf-suggest-title">People you might vibe with</span>
          <button class="prf-suggest-close" onclick="dismissSuggestBox('prf-suggest-own')" aria-label="Dismiss">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="prf-suggest-scroll" id="prf-suggest-own-list"></div>
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
      <div id="prf-panel-saved"  class="prf-panel prf-posts-panel" style="display:none"></div>
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

  container._prfData = { posts, likedPosts: likedPostsArr, mediaPosts, savedPosts: savedPostsArr };
  renderPrfPosts(posts, 'prf-panel-list', true, true);
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

  // Load people suggestions after profile renders
  setTimeout(() => loadSuggestedForMe(), 100);
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
  panel.style.display = (tab === 'list' || tab === 'likes' || tab === 'saved') ? 'flex' : 'block';
  if (panel._loaded) return;
  const { posts, likedPosts: likedArr, mediaPosts, savedPosts: savedArr } = container._prfData || {};
  if (tab === 'list')  renderPrfPosts(posts || [],    'prf-panel-list',  true, true);
  if (tab === 'media') renderPrfMasonry(mediaPosts || [], 'prf-panel-media', true);
  if (tab === 'likes') renderPrfPosts(likedArr || [], 'prf-panel-likes', false, true);
  if (tab === 'saved') renderPrfSavedSync(savedArr || [], 'prf-panel-saved');
  panel._loaded = true;
}

function switchProfileTab(mode, btn) { switchPrfTab('posts', btn); }

function renderPrfPosts(posts, containerId, isOwn, isProfilePage = false, viewingUserId = null) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!posts.length) {
    container.innerHTML = `<div class="prf-empty"><div class="prf-empty-icon">${isOwn ? '✍️' : '❤️'}</div><p>${isOwn ? 'No posts yet' : 'No likes yet'}</p>${isOwn ? '<span>Share your first thought</span>' : ''}</div>`;
    return;
  }
  container.innerHTML = '';
  posts.forEach(p => {
    const el = createFeedPost(p, isProfilePage, viewingUserId);
    if (el) { container.appendChild(el); observePost(el); }
  });
}

function renderPrfMasonry(posts, containerId, mediaOnly = false) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const items = mediaOnly ? posts.filter(p => (p.image || p.video) && !p.reposted_post_id) : posts;
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
    const img    = post.image || post.reposted_post?.image || '';
    const text   = post.content || post.reposted_post?.content || '';
    const user   = post.user || post.reposted_post?.user || {};
    const avatar = user.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${user.username}`;
    const uname  = user.username || '';
    const liked  = likedPosts.has(post.id);
    const likes  = post.like_count || 0;

    const tile = document.createElement('div');
    tile.className = 'prf-masonry-tile';
    tile.innerHTML = `
      ${img
        ? `<img src="${escHtml(img)}" alt="" loading="lazy" class="prf-masonry-img">`
        : `<div class="prf-masonry-text-tile" style="background:${gradientFor(post.id)}"><p>${escHtml(text.slice(0,120))}</p></div>`
      }
      ${text && img ? `<div class="prf-masonry-caption">${escHtml(text.slice(0,80))}${text.length > 80 ? '…' : ''}</div>` : ''}
      <div class="prf-masonry-footer">
        <div class="prf-masonry-author">
          <img class="prf-masonry-avatar" src="${escHtml(avatar)}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(uname)}'">
          <span class="prf-masonry-username">${escHtml(uname)}</span>
        </div>
        <button class="prf-masonry-like ${liked ? 'liked' : ''}" data-post-id="${post.id}" onclick="event.stopPropagation(); toggleMasonryLike(this, '${post.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="${liked ? 'rgb(244,7,82)' : 'none'}" stroke="${liked ? 'rgb(244,7,82)' : 'currentColor'}" stroke-width="2">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
          <span class="prf-masonry-like-count">${likes > 0 ? fmtNum(likes) : ''}</span>
        </button>
      </div>`;

    tile.addEventListener('click', () => openDetail(post.id));
    if (i % 2 === 0) left.appendChild(tile);
    else             right.appendChild(tile);
  });

  wrap.appendChild(left);
  wrap.appendChild(right);
  container.innerHTML = '';
  container.appendChild(wrap);
}

// ══════════════════════════════════════════
// SAVE / BOOKMARK
// ══════════════════════════════════════════

function setSaveBtnState(btn, isSaved) {
  if (!btn) return;
  const icon = btn.querySelector('.save-icon');
  if (isSaved) {
    btn.classList.add('saved');
    if (icon) { icon.setAttribute('fill', '#6C47FF'); icon.setAttribute('stroke', '#6C47FF'); }
  } else {
    btn.classList.remove('saved');
    if (icon) { icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', '#000000'); }
  }
}

async function toggleSave(postId, btn) {
  if (!currentUser) { showToast('Sign in to save posts'); return; }
  const isSaved = savedPosts.has(postId);
  // Optimistic
  if (isSaved) { savedPosts.delete(postId); setSaveBtnState(btn, false); }
  else          { savedPosts.add(postId);    setSaveBtnState(btn, true);  }

  if (isSaved) {
    const { error } = await supabase.from('saved_posts')
      .delete().eq('user_id', currentUser.id).eq('post_id', postId);
    if (error) { savedPosts.add(postId); setSaveBtnState(btn, true); showToast('Failed to unsave'); }
    else showToast('Removed from saved');
  } else {
    const { error } = await supabase.from('saved_posts')
      .insert({ user_id: currentUser.id, post_id: postId });
    if (error) { savedPosts.delete(postId); setSaveBtnState(btn, false); showToast('Failed to save'); }
    else showToast('Saved 🔖');
  }
  // Refresh saved panel immediately if it's currently visible
  const panel = document.getElementById('prf-panel-saved');
  if (panel) {
    panel._loaded = false;
    if (panel.style.display !== 'none') renderPrfSaved('prf-panel-saved');
  }
}

async function checkSavedPosts(postIds) {
  if (!currentUser || !postIds.length) return;
  const { data } = await supabase.from('saved_posts')
    .select('post_id').eq('user_id', currentUser.id).in('post_id', postIds);
  if (!data) return;
  data.forEach(r => {
    savedPosts.add(r.post_id);
    document.querySelectorAll(`.save-btn[data-post-id="${r.post_id}"]`).forEach(btn => setSaveBtnState(btn, true));
  });
}

function renderPrfSavedSync(posts, containerId) {
  const c = document.getElementById(containerId);
  if (!c) return;
  if (!posts.length) {
    c.innerHTML = '<div class="prf-empty"><div class="prf-empty-icon">🔖</div><p>No saved posts yet</p><span>Tap the bookmark on any post</span></div>';
    return;
  }
  c.innerHTML = '';
  posts.forEach(p => {
    if (!p) return;
    const el = createFeedPost(p, true);
    if (el) { c.appendChild(el); observePost(el); }
  });
}

// Keep async version for invalidation/refresh after save toggle
async function renderPrfSaved(containerId) {
  const c = document.getElementById(containerId);
  if (!c) return;
  if (!currentUser) { c.innerHTML = '<div class="prf-empty"><p>Sign in to see saved posts</p></div>'; return; }
  const { data, error } = await supabase.from('saved_posts')
    .select(`post:posts(id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,user:users(id,username,avatar),reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar)))`)
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error || !data?.length) {
    c.innerHTML = '<div class="prf-empty"><div class="prf-empty-icon">🔖</div><p>No saved posts yet</p><span>Tap the bookmark on any post</span></div>';
    return;
  }
  c.innerHTML = '';
  data.map(r => r.post).filter(Boolean).forEach(p => {
    const el = createFeedPost(p, true);
    if (el) { c.appendChild(el); observePost(el); }
  });
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
// ── SELF TAP — pulse instead of navigating ──────────────────
function selfTap(el) {
  if (!el) return;
  el.classList.remove('self-pulse');
  void el.offsetWidth; // force reflow to restart animation
  el.classList.add('self-pulse');
  el.addEventListener('animationend', () => el.classList.remove('self-pulse'), { once: true });
}

async function showUserProfile(userId, tapEl) {
  if (!userId) return;
  if (userId === currentUser?.id) { selfTap(tapEl); return; }
  injectProfileStyles();

  // Clear immediately — prevents ghost click landing on previous user's posts
  const body = document.getElementById('user-profile-body');
  if (body) body.innerHTML = '<div class="loading-pulse" style="height:300px;margin:0"></div>';

  slideTo('user-profile', async () => {
    const body = document.getElementById('user-profile-body');
    body.innerHTML = '<div class="loading-pulse" style="height:300px;margin:0"></div>';

    const { data: profile } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
    if (!profile) { body.innerHTML = '<div class="empty-state"><p>User not found</p></div>'; return; }
    pushRoute('/profile/' + profile.username);

    const { data: posts } = await supabase.from('posts')
      .select(`id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
               user:users(id,username,avatar),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar))`)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(60);

    const allPosts   = posts || [];
    const likedPosts = [];
    const mediaPosts = allPosts.filter(p => (p.image || p.video) && !p.reposted_post_id);

    // Await follow state BEFORE rendering — same pattern as detail page, no flash
    const isFollowing = currentUser ? await checkFollowState(userId) : false;

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
            <button class="prf-btn prf-btn-icon" onclick="openDM('${userId}')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            </button>
            <button class="prf-btn ${isFollowing ? 'prf-btn-following' : 'prf-btn-primary'}" id="follow-btn-${userId}" onclick="toggleFollow('${userId}',this)">${isFollowing ? 'Following' : 'Follow'}</button>
          </div>
        </div>

        <!-- IDENTITY -->
        <div class="prf-identity" style="padding-top:8px">
          <div class="prf-name-row">
            <h1 class="prf-name">${escHtml(profile.username || 'User')}</h1>
            ${profile.is_verified ? `<span class="prf-verified"><svg width="18" height="18" viewBox="0 0 24 24" fill="#6C47FF"><path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/></svg></span>` : ''}
          </div>
          ${profile.bio ? `<p class="prf-bio">${escHtml(profile.bio)}</p>` : ''}
          ${profile.location ? `<p class="prf-location"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="vertical-align:-1px;margin-right:3px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="currentColor"/></svg>${escHtml(profile.location)}</p>` : ''}
        ${profile.location ? `<p class="prf-location"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="vertical-align:-1px;margin-right:3px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="currentColor"/></svg>${escHtml(profile.location)}</p>` : ''}
          ${getMomentBanner(userId)}
        </div>

        <!-- STATS BAR -->
        <div class="prf-stats-row">
          <div class="prf-stat-card">
            <span class="prf-stat-n">${fmtNum(allPosts.length)}</span>
            <span class="prf-stat-l">Posts</span>
          </div>
          <div class="prf-stat-card clickable" onclick="openFollowList('followers','${userId}')">
            <span class="prf-stat-n" id="uprf-followers-${userId}">${fmtNum(profile.followers||0)}</span>
            <span class="prf-stat-l">Followers</span>
          </div>
          <div class="prf-stat-card clickable" onclick="openFollowList('following','${userId}')">
            <span class="prf-stat-n" id="uprf-following-${userId}">${fmtNum(profile.following||0)}</span>
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
    renderPrfPosts(allPosts, `uprf-list-${userId}`, false, true, userId);
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

    // ── Wire 3-dots more button ──
    viewingProfile = profile;

    // ── 3. Mini avatar + follow in header via IntersectionObserver ──
    const miniIdentity = document.getElementById('uprf-header-identity');
    const miniAvatar   = document.getElementById('uprf-header-avatar');
    const miniFollow   = document.getElementById('uprf-header-follow');

    // Set mini avatar src and wire follow/message buttons
    miniAvatar.src = profile.avatar || '';
    const mainFollowBtn = document.getElementById(`follow-btn-${userId}`);
    const miniMsgBtn    = document.getElementById('uprf-header-message');

    miniFollow.onclick  = () => mainFollowBtn?.click();
    if (miniMsgBtn) miniMsgBtn.onclick = () => openDM(userId);

    // Sync: if following → show Message, hide Follow. If not → show Follow, hide Message
    const syncHeaderBtn = () => {
      if (!mainFollowBtn) return;
      const isFollowing = mainFollowBtn.classList.contains('prf-btn-following');
      // Always show Follow text (legacy) but we hide/show via display
      miniFollow.textContent = 'Follow';
      if (miniMsgBtn) {
        // If following: hide Follow entirely, show Message
        // If not following: show Follow, hide Message
        miniFollow.style.display  = isFollowing ? 'none' : '';
        miniMsgBtn.style.display  = isFollowing ? 'flex' : 'none';
      }
      // Also trigger recommendation box when following
      if (isFollowing) renderSuggestedForOtherProfile(userId, profile.username);
    };
    syncHeaderBtn();
    const followObserver = new MutationObserver(syncHeaderBtn);
    if (mainFollowBtn) followObserver.observe(mainFollowBtn, { attributes:true, attributeFilter:['class'] });

    // Watch avatar element — when it leaves viewport top, show mini
    const avatarWrap = body.querySelector('.prf-avatar-wrap');
    if (upPage._uprfAvatarObs) upPage._uprfAvatarObs.disconnect();
    upPage._uprfAvatarObs = new IntersectionObserver(([entry]) => {
      const visible = entry.isIntersecting;
      miniIdentity.style.opacity       = visible ? '0' :