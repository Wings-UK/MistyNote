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
      loadFeed();
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

    // Set mini avatar src and wire follow button to main follow btn
    miniAvatar.src = profile.avatar || '';
    const mainFollowBtn = document.getElementById(`follow-btn-${userId}`);

    // Follow state already baked into button at render time — no post-render check needed
    miniFollow.onclick = () => mainFollowBtn?.click();
    // Sync follow label + state to match main button
    const syncFollowLabel = () => {
      if (!mainFollowBtn) return;
      const isFollowing = mainFollowBtn.classList.contains('prf-btn-following');
      miniFollow.textContent = isFollowing ? 'Following' : 'Follow';
      miniFollow.classList.toggle('following', isFollowing);
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

async function toggleFollow(userId, btn) {
  if (!currentUser) { showToast('Sign in to follow'); return; }
  const isFollowing = btn.classList.contains('prf-btn-following');

  // Optimistic UI update
  setFollowBtnState(btn, !isFollowing);

  if (isFollowing) {
    // Unfollow — delete from follows table
    const { data: delData, error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', currentUser.id)
      .eq('following_id', userId)
      .select();

    if (error || !delData?.length) {
      setFollowBtnState(btn, true); // revert
      showToast('Failed to unfollow');
      return;
    }
    showToast('Unfollowed');
  } else {
    // Follow — insert into follows table
    const { data: insertData, error } = await supabase
      .from('follows')
      .insert({ follower_id: currentUser.id, following_id: userId })
      .select();

    if (error) {
      console.error('Follow failed:', error, 'follower:', currentUser.id, 'following:', userId);
      setFollowBtnState(btn, false); // revert
      showToast('Failed to follow');
      return;
    }
    showToast('Following ✓');
  }

  // Refresh follower count on the visible profile
  refreshFollowCounts(userId);
}

function setFollowBtnState(btn, isFollowing) {
  btn.classList.toggle('prf-btn-following', isFollowing);
  btn.classList.toggle('prf-btn-primary', !isFollowing);
  btn.textContent = isFollowing ? 'Following' : 'Follow';
}

async function refreshFollowCounts(userId) {
  const { data } = await supabase
    .from('users')
    .select('followers, following')
    .eq('id', userId)
    .maybeSingle();
  if (!data) return;

  // Update visible follower count on other user's profile
  const followerEl = document.querySelector(`#uprf-followers-${userId}`);
  if (followerEl) followerEl.textContent = fmtNum(data.followers || 0);

  // Update own following count on ME page
  if (currentUser) {
    const { data: me } = await supabase
      .from('users')
      .select('followers, following')
      .eq('id', currentUser.id)
      .maybeSingle();
    if (me) {
      currentProfile = { ...currentProfile, ...me };
      const myFollowingEl = document.querySelector('#prf-following-count');
      if (myFollowingEl) myFollowingEl.textContent = fmtNum(me.following || 0);
    }
  }
}

async function checkFollowState(userId) {
  if (!currentUser || userId === currentUser.id) return false;
  const { data } = await supabase
    .from('follows')
    .select('id')
    .eq('follower_id', currentUser.id)
    .eq('following_id', userId)
    .maybeSingle();
  return !!data;
}

// ══════════════════════════════════════════
// FEED
// ══════════════════════════════════════════

async function loadFeed(reset = false) {
  const list = document.getElementById('feed-list');
  if (!list) return;

  if (reset) {
    feedOffset = 0; feedExhausted = false; feedLoading = false;
    loadedPostIds.clear(); list.innerHTML = '';
  }

  if (feedLoading || feedExhausted) return;
  feedLoading = true;

  const PER_PAGE = 15;

  if (feedOffset === 0) {
    list.innerHTML = Array(5).fill(0).map(() => skeletonPost()).join('');
  }

  try {
    // ── FOLLOWING TAB — pure chronological from followed users ──
    if (currentFeedTab === 'following') {
      await loadFollowingFeed(list, PER_PAGE);
      return;
    }

    // ── EXPLORE TAB — Phase 2 algorithm ──
    await loadExploreFeed(list, PER_PAGE);

  } catch (e) {
    console.error('Feed error:', e);
    if (feedOffset === 0) list.innerHTML = `<div class="empty-state"><div class="empty-icon">😕</div><p>Couldn't load posts</p><span>${e.message}</span></div>`;
  } finally {
    feedLoading = false;
  }
}

// ── FOLLOWING FEED — chronological from followed users only ──
async function loadFollowingFeed(list, PER_PAGE) {
  try {
    if (!currentUser) { feedLoading = false; return; }

    const { data: followingRows } = await supabase
      .from('follows').select('following_id').eq('follower_id', currentUser.id);

    const followingIds = followingRows?.map(r => r.following_id) || [];

    if (followingIds.length === 0) {
      feedExhausted = true;
      if (feedOffset === 0) {
        list.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>No posts yet</p><span>Follow people to see their posts here</span></div>`;
      }
      return;
    }

    const { data: posts, error } = await supabase
      .from('posts')
      .select(`id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
               user:users(id,username,avatar),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar)),
               comments(count)`)
      .in('user_id', followingIds)
      .neq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .range(feedOffset, feedOffset + PER_PAGE - 1);

    if (error) throw error;
    renderFeedPosts(list, posts, PER_PAGE);
  } finally {
    feedLoading = false;
  }
}

// ── EXPLORE FEED — Phase 2 algorithm ──
async function loadExploreFeed(list, PER_PAGE) {
  try {
    const SELECT = `id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
      user:users(id,username,avatar,location),
      reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar)),
      comments(count)`;

    const TWO_DAYS_AGO = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const TWO_HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    // Fetch user's following list and their location
    let followingIds = [];
    let userLocation  = currentProfile?.location || null;
    let userCountry   = null;

    if (currentUser) {
      const { data: fl } = await supabase
        .from('follows').select('following_id').eq('follower_id', currentUser.id);
      followingIds = fl?.map(r => r.following_id) || [];
    }

    // Parse country from location string e.g. "Lagos, Nigeria" → "Nigeria"
    if (userLocation) {
      const parts = userLocation.split(',');
      userCountry = parts[parts.length - 1]?.trim() || null;
    }

    // ── Fetch friends-of-friends ──
    let fofIds = [];
    if (followingIds.length > 0) {
      const { data: fofRows } = await supabase
        .from('follows')
        .select('following_id')
        .in('follower_id', followingIds)
        .not('following_id', 'in', `(${[...(currentUser ? [currentUser.id] : []), ...followingIds].join(',') || 'null'})`)
        .limit(50);
      fofIds = [...new Set(fofRows?.map(r => r.following_id) || [])];
    }

    // ── Run all bucket queries in parallel ──
    const [
      bucket1Result,  // People I follow
      bucket2Result,  // Friends of friends
      bucket3Result,  // Trending right now (last 2hrs)
      bucket4Result,  // Location-based
      bucket5Result,  // Everything else (fallback)
    ] = await Promise.all([

      // Bucket 1 — Following (30%)
      followingIds.length > 0
        ? supabase.from('posts').select(SELECT)
            .in('user_id', followingIds)
            .gte('created_at', TWO_DAYS_AGO)
            .order('created_at', { ascending: false })
            .limit(12)
        : Promise.resolve({ data: [] }),

      // Bucket 2 — Friends of friends (25%)
      fofIds.length > 0
        ? supabase.from('posts').select(SELECT)
            .in('user_id', fofIds)
            .gte('created_at', TWO_DAYS_AGO)
            .order('created_at', { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] }),

      // Bucket 3 — Trending now, velocity = high likes in last 2hrs (20%)
      supabase.from('posts').select(SELECT)
        .gte('created_at', TWO_HOURS_AGO)
        .order('like_count', { ascending: false })
        .limit(8),

      // Bucket 4 — Location (15%) — posts from users in same country
      userCountry
        ? supabase.from('posts').select(SELECT)
            .gte('created_at', TWO_DAYS_AGO)
            .order('created_at', { ascending: false })
            .limit(50) // we filter by location client-side since location is on users
        : Promise.resolve({ data: [] }),

      // Bucket 5 — General recent (fallback/filler)
      supabase.from('posts').select(SELECT)
        .gte('created_at', TWO_DAYS_AGO)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    // ── Filter bucket 4 by country ──
    const locationPosts = (bucket4Result.data || []).filter(p =>
      p.user?.location && p.user.location.includes(userCountry)
    ).slice(0, 6);

    // ── Build weighted pool ──
    // Assign each post a bucket weight — higher = more likely to appear early
    const WEIGHTS = { b1: 30, b2: 25, b3: 20, b4: 15, b5: 10 };
    const pool = new Map(); // id → { post, score }

    const addToPool = (posts, bucketWeight) => {
      (posts || []).forEach((p, idx) => {
        if (pool.has(p.id)) {
          // Already in pool — boost its score
          pool.get(p.id).score += bucketWeight * 0.5;
        } else {
          // Recency bonus — newer posts score higher within their bucket
          const ageHours = (Date.now() - new Date(p.created_at)) / 3600000;
          const recencyBonus = Math.max(0, 48 - ageHours) / 48; // 0–1
          // Engagement velocity bonus
          const engBonus = Math.min(p.like_count || 0, 100) / 100;
          // Location bonus — extra weight if same country
          const locBonus = userCountry && p.user?.location?.includes(userCountry) ? 8 : 0;
          const score = bucketWeight + (recencyBonus * 10) + (engBonus * 8) + locBonus;
          pool.set(p.id, { post: p, score });
        }
      });
    };

    addToPool(bucket1Result.data, WEIGHTS.b1);
    addToPool(bucket2Result.data, WEIGHTS.b2);
    addToPool(bucket3Result.data, WEIGHTS.b3);
    addToPool(locationPosts,      WEIGHTS.b4);
    addToPool(bucket5Result.data, WEIGHTS.b5);

    // ── Sort pool by score descending ──
    let ranked = Array.from(pool.values())
      .sort((a, b) => b.score - a.score)
      .map(v => v.post);

    // ── Skip already loaded posts ──
    ranked = ranked.filter(p => !loadedPostIds.has(p.id));

    // ── Apply pagination window ──
    const page = ranked.slice(feedOffset, feedOffset + PER_PAGE);

    if (feedOffset === 0) list.innerHTML = '';

    if (!page.length) {
      feedExhausted = true;
      if (feedOffset === 0) {
        list.innerHTML = `<div class="empty-state"><div class="empty-icon">🌙</div><p>Nothing here yet</p><span>Be the first to post!</span></div>`;
      }
      return;
    }

    renderFeedPosts(list, page, PER_PAGE);

  } finally {
    feedLoading = false;
  }
}

// ── Shared render helper ──
function renderFeedPosts(list, posts, PER_PAGE) {
  if (!posts || !posts.length) {
    feedExhausted = true;
    if (feedOffset === 0) list.innerHTML = `<div class="empty-state"><div class="empty-icon">🌙</div><p>Nothing here yet</p><span>Be the first to post!</span></div>`;
    return;
  }

  if (feedOffset === 0) list.innerHTML = '';

  for (const p of posts) {
    if (loadedPostIds.has(p.id)) continue;
    loadedPostIds.add(p.id);
    const el = createFeedPost(p);
    if (el) { list.appendChild(el); observePost(el); }
  }

  feedOffset += posts.length;
  if (posts.length < PER_PAGE) feedExhausted = true;

  const ids = [...loadedPostIds];
  checkLikedPosts(ids);
  checkRepostedPosts(ids);
  checkSavedPosts(ids);
  reObserveAllFeedPosts();

  if (feedOffset <= PER_PAGE) seedDemoMoments(posts);
}

function setFeedTab(tab, btn) {
  currentFeedTab = tab;
  document.querySelectorAll('.feed-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  loadFeed(true);
}

function initFeedTabBar() {
  // tab bar removed
}

function createFeedPost(p, isProfilePage = false, viewingUserId = null) {
  const user = p.user || { username: '@unknown', avatar: '' };
  const isRepost = !!p.reposted_post_id && !!p.reposted_post;
  const orig = isRepost ? p.reposted_post : null;
  const origUser = orig?.user || { username: '@unknown', avatar: '' };
  const isOwnPost = currentUser && p.user_id === currentUser.id;
  // On another user's profile list — tapping their own username should pulse not navigate
  const isViewingUser = viewingUserId && p.user_id === viewingUserId;

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

      <div class="quote-card" data-original-id="${orig.id}" onclick="openDetail('${orig.id}');event.stopPropagation()">
        <div class="quote-card-inner">
          <div class="quote-card-header">
            <img class="quote-card-avatar" src="${origUser.avatar||''}" onerror="this.style.display='none'" alt="">
            <span class="quote-card-name">${escHtml(origUser.username)}</span>
            <span class="quote-card-time">${timeSince(orig.created_at)}</span>
          </div>
          ${orig.content ? `<p class="quote-card-text">${escHtml(orig.content.slice(0,240))}${orig.content.length>240?'…':''}</p>` : ''}
        </div>
        ${orig.image ? `<img class="quote-card-img" src="${orig.image}" alt="" loading="lazy">` : ''}
        ${orig.video && !orig.image ? `
          <div class="quote-card-video-wrap">
            <video class="quote-card-video" preload="metadata"><source src="${orig.video}" type="video/mp4"></video>
            <div class="quote-card-play">
              <svg width="36" height="36" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="22" fill="rgba(0,0,0,0.45)" stroke="white" stroke-width="2"/>
                <path d="M32 24L20 31V17L32 24Z" fill="white"/>
              </svg>
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
      <a class="post-avatar-link" onclick="${(isProfilePage && (isOwnPost || isViewingUser)) ? 'selfTap(this)' : isOwnPost ? 'navTo(\'profile\')' : `showUserProfile('${p.user_id}',this)`};event.stopPropagation()">
        <img class="small-photo" src="${user.avatar || ''}" onerror="this.style.display='none'" alt="">
      </a>
      <div class="post-meta">
        <a class="post-author-link" onclick="${(isProfilePage && (isOwnPost || isViewingUser)) ? 'selfTap(this)' : isOwnPost ? 'navTo(\'profile\')' : `showUserProfile('${p.user_id}',this)`};event.stopPropagation()">
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
            <div class="donate-btn save-btn" data-post-id="${p.id}"><svg xmlns="http://www.w3.org/2000/svg" class="feeling save-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg></div>
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
      handleRepost(p.id, e.target.closest('.repost-btn'), p.user_id);
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
    if (e.target.closest('.save-btn')) {
      toggleSave(p.id, e.target.closest('.save-btn'));
      return;
    }
    if (e.target.closest('.reer')) {
      const tired = e.target.closest('.tired');
      if (tired) { tired.innerHTML = escHtml(text); e.stopPropagation(); return; }
    }
    if (e.target.closest('.post-avatar-link') || e.target.closest('.post-author-link')) return;
    if (e.target.closest('.view-original') || e.target.closest('.quote-card')) {
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

  // Save button — check initial state
  const saveBtn = el.querySelector('.save-btn');
  if (saveBtn && savedPosts.has(p.id)) setSaveBtnState(saveBtn, true);

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
    if (e.target.closest('.heart-ai, .repost-btn, .comment-btn, .donate-btn, .save-btn, .dots, .post-avatar-link, .post-author-link')) return;
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
    /* Avatar ring wrap */
    .avatar-moment-wrap {
      position: relative; flex-shrink: 0;
      width: 38px; height: 38px;
    }
    .avatar-moment-ring {
      position: absolute; inset: -2.5px; border-radius: 50%;
      background: linear-gradient(135deg, var(--accent), #a78bfa);
      z-index: 0; opacity: 0;
      transition: opacity 0.2s;
    }
    .avatar-moment-ring.live    { background: linear-gradient(135deg, var(--red), #ff8c42); }
    .avatar-moment-ring.commerce { background: linear-gradient(135deg, var(--gold), #ff8c42); }
    .avatar-moment-ring.live_commerce { background: linear-gradient(135deg, var(--red), var(--gold)); }
    .avatar-moment-wrap.has-moment .avatar-moment-ring { opacity: 1; }
    .avatar-moment-wrap.has-moment .small-photo { border: 2px solid var(--bg); position: relative; z-index: 1; }

    /* Live pulse on ring */
    .avatar-moment-wrap.has-moment.live .avatar-moment-ring,
    .avatar-moment-wrap.has-moment.live_commerce .avatar-moment-ring {
      animation: ringPulse 2s ease-in-out infinite;
    }
    @keyframes ringPulse {
      0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(255,59,92,0.4); }
      50% { opacity: 0.8; box-shadow: 0 0 0 4px rgba(255,59,92,0); }
    }

    .small-photo {
      width: 38px;
      height: 38px;
      object-fit: cover;
      object-position: center;
      border-radius: 50%;
      display: block;
      transition: filter 0.15s;
    }
    .small-photo:hover { filter: brightness(0.9); }
    .post-meta { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .post-author-link { display: flex; align-items: center; gap: 4px; text-decoration: none; cursor: pointer; width: fit-content; }
    .post-author-link:hover .jerry { text-decoration: none; }
    .jerry { font-weight: 600; font-size: 15px; font-family: 'Noto Sans JP', -apple-system, sans-serif; color: var(--text); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* Consistent username weight across all pages */
    .detail-name, .profile-name, .original-card-name { font-weight: 600; }
    .verif { width: 15px; flex-shrink: 0; display: block; }
    .time { font-size: 12px; color: var(--text2); margin: 0; line-height: 1; }
    .time:hover { text-decoration: none; }
    .dots { display: flex; align-items: center; padding: 4px; flex-shrink: 0; margin-left: auto; }
    .dot { display: block; }

    .tir {
      padding: 10px 5px 8px;
    }
    .tired { width: 100%; font-size: 16px; white-space: pre-wrap; word-break: break-word; color: var(--text); }
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
    .repost-commentary .tir { padding-bottom: 2px; } /* quote-card CSS in style.css */

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
  // Sync masonry tiles
  document.querySelectorAll(`.prf-masonry-like[data-post-id="${postId}"]`).forEach(btn => {
    btn.classList.toggle('liked', liked);
    const svg = btn.querySelector('svg');
    if (svg) { svg.setAttribute('fill', liked ? 'rgb(244,7,82)' : 'none'); svg.setAttribute('stroke', liked ? 'rgb(244,7,82)' : 'currentColor'); }
    if (count !== null) {
      const countEl = btn.querySelector('.prf-masonry-like-count');
      if (countEl) countEl.textContent = count > 0 ? fmtNum(count) : '';
    }
  });
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
  // Masonry tiles
  document.querySelectorAll(`.prf-masonry-like[data-post-id="${postId}"] .prf-masonry-like-count`).forEach(el => {
    el.textContent = count > 0 ? fmtNum(count) : '';
  });
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

async function handleRepost(postId, btn, postUserId) {
  if (!currentUser) { showToast('Sign in to repost'); return; }
  if (postUserId && postUserId === currentUser.id) { showToast("You can't repost your own post"); return; }
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

// ══════════════════════════════════════════
// COMPOSER — clean rewrite
// ══════════════════════════════════════════

function openComposer() {
  const overlay  = document.getElementById('composer-overlay');
  const sheet    = document.getElementById('composer-sheet');
  const previews = document.getElementById('composer-previews');

  overlay.classList.remove('hidden');

  if (currentProfile?.avatar) {
    document.getElementById('composer-avatar').src = currentProfile.avatar;
  }

  requestAnimationFrame(() => {
    sheet.classList.add('open');
    document.getElementById('composer-textarea').focus();
  });

  // Visual Viewport: shrink sheet height when keyboard appears
  // The sheet stays anchored at the bottom, previews area shrinks, textarea stays visible
  function onVP() {
    const vv = window.visualViewport;
    if (!vv) return;
    const vvHeight = vv.height;
    // Cap sheet at viewport height so it sits just above keyboard
    sheet.style.maxHeight = vvHeight * 0.95 + 'px';
    // Scroll previews to bottom so latest content stays visible
    if (previews) previews.scrollTop = previews.scrollHeight;
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onVP);
    overlay._vp = onVP;
  }
}

function closeComposer(instant = false) {
  const overlay = document.getElementById('composer-overlay');
  const sheet   = document.getElementById('composer-sheet');

  if (overlay._vp && window.visualViewport) {
    window.visualViewport.removeEventListener('resize', overlay._vp);
    overlay._vp = null;
  }

  sheet.style.maxHeight = '';

  if (instant) {
    sheet.style.transition = 'none';
    overlay.style.transition = 'none';
  }
  sheet.classList.remove('open');

  const cleanup = () => {
    overlay.classList.add('hidden');
    sheet.style.transition = '';
    overlay.style.transition = '';
    const ta = document.getElementById('composer-textarea');
    if (ta) { ta.value = ''; ta.style.height = ''; }
    document.getElementById('composer-media-preview').innerHTML = '';
    document.getElementById('composer-repost-preview').innerHTML = '';
    selectedFile = null;
    repostTargetId = null;
    repostTargetBtn = null;
    updateComposerBtn();
  };

  instant ? cleanup() : setTimeout(cleanup, 350);
}

function initComposerFile() {
  const fileInput = document.getElementById('composer-file');
  if (!fileInput) return;

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Images only'); return; }

    if (file.size > 2 * 1024 * 1024) {
      showToast('Image must be under 2MB');
      fileInput.value = '';
      return;
    }

    selectedFile = file;
    updateComposerBtn();

    const preview = document.getElementById('composer-media-preview');

    const reader = new FileReader();
    reader.onload = ev => {
      preview.innerHTML = `
        <div class="media-preview-item">
          <img src="${ev.target.result}" alt="" style="max-height:220px;width:100%;object-fit:cover;border-radius:12px;">
          <button class="media-preview-remove" onclick="removeMedia()">×</button>
        </div>`;
    };
    reader.onerror = () => {
      preview.innerHTML = `<div style="padding:12px;color:var(--text3);font-size:13px">📷 Image ready to post</div>`;
    };
    reader.readAsDataURL(file);
  });

  const ta = document.getElementById('composer-textarea');
  ta?.addEventListener('input', () => {
    updateComposerBtn();
    updateCharCount(ta.value.length);
    // Auto-grow textarea up to max-height defined in CSS
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  });
}

function removeMedia() {
  selectedFile = null;
  document.getElementById('composer-media-preview').innerHTML = '';
  document.getElementById('composer-file').value = '';
  updateComposerBtn();
}

function updateComposerBtn() {
  const ta  = document.getElementById('composer-textarea');
  const btn = document.getElementById('composer-post-btn');
  const hasText   = ta?.value?.trim().length > 0;
  const hasMedia  = !!selectedFile;
  const hasRepost = !!repostTargetId;
  if (btn) btn.disabled = !(hasText || hasMedia || hasRepost);
}

function updateCharCount(len) {
  const el = document.getElementById('composer-char-count');
  if (!el) return;
  const rem = MAX_CHARS - len;
  el.textContent = rem;
  el.className = 'composer-char-count' + (rem < 20 ? ' critical' : rem < 60 ? ' low' : '');
}

function insertEmoji() { showToast('Emoji picker coming soon!'); }

// ── Feed prepend ──
function prependPostToFeed(newPost) {
  if (!newPost) return;
  const adapted = { ...newPost, comments: [{ count: 0 }] };
  const el = createFeedPost(adapted);
  const list = document.getElementById('feed-list');
  if (list && el) {
    list.prepend(el);
    loadedPostIds.add(newPost.id);
    el.classList.add('fade-up');
    observePost(el);
  }
  if (newPost.reposted_post_id) {
    repostedPosts.set(newPost.reposted_post_id, newPost.id);
    setRepostUI(newPost.reposted_post_id, true);
    supabase.rpc('increment_repost_count', { post_id: newPost.reposted_post_id }).catch(() => {});
    supabase.from('posts').select('user_id').eq('id', newPost.reposted_post_id).single().then(({ data: orig }) => {
      if (orig && orig.user_id !== currentUser.id) {
        supabase.from('notifications').insert({
          user_id: orig.user_id, actor_id: currentUser.id,
          post_id: newPost.reposted_post_id, type: 'repost', read: false
        }).catch(() => {});
      }
    });
  }
  if (document.getElementById('page-profile')?.classList.contains('active')) {
    renderMyProfile();
  }
}

// ── Image → JPEG blob via canvas, with FileReader fallback ──
// ── Upload: compress → retry loop → return public URL ──
async function uploadToStorage(file, onProgress) {
  onProgress(5);

  // No compression — upload raw file directly
  const blob = file;
  onProgress(25);

  const path = `${currentUser.id}_${Date.now()}_${Math.random().toString(36).slice(2,7)}.jpg`;
  const bucket = 'post-images';

  // Retry up to 4 times with exponential backoff — built for bad networks
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      onProgress(25 + attempt * 14); // 39 / 53 / 67 / 81

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000); // 45s per attempt

      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });

      clearTimeout(timer);
      if (error) throw error;

      onProgress(90);
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      onProgress(100);
      return data.publicUrl;

    } catch (err) {
      if (attempt === 4) throw err;
      // Wait before retry: 2s, 4s, 8s
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
}

// ── Submit post ──
async function submitPost() {
  const ta      = document.getElementById('composer-textarea');
  const content = ta?.value?.trim() || '';
  const btn     = document.getElementById('composer-post-btn');

  if (!content && !selectedFile && !repostTargetId) return;
  if (!currentUser) { showToast('Please sign in'); return; }

  if (btn) btn.disabled = true;

  // Snapshot state before composer clears it
  const fileToUpload = selectedFile;
  const postContent  = content;
  const targetId     = repostTargetId;

  // Dismiss composer immediately
  closeComposer(true);

  // ── Text-only post (instant) ──
  if (!fileToUpload) {
    try {
      const { data: post, error } = await supabase.from('posts').insert({
        user_id: currentUser.id,
        content: postContent || null,
        image: null,
        reposted_post_id: targetId || null
      }).select(`
        id,content,image,video,created_at,like_count,comment_count,repost_count,views,user_id,reposted_post_id,
        user:users(id,username,avatar),
        reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar))
      `).single();
      if (error) throw error;
      prependPostToFeed(post);
    } catch(e) {
      showToast('Post failed — check your connection');
    }
    return;
  }

  // ── Image post — ring shows progress ──
  setComposeRing('uploading', 5);

  const doUpload = async () => {
    try {
      // 1. Upload image
      const imageUrl = await uploadToStorage(fileToUpload, pct => setComposeRing('uploading', pct));

      setComposeRing('uploading', 92);

      // 2. Insert post record
      const { data: post, error } = await supabase.from('posts').insert({
        user_id: currentUser.id,
        content: postContent || null,
        image: imageUrl,
        reposted_post_id: targetId || null
      }).select(`
        id,content,image,video,created_at,like_count,comment_count,repost_count,views,user_id,reposted_post_id,
        user:users(id,username,avatar),
        reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar))
      `).single();

      if (error) throw error;

      // 3. Done
      setComposeRing('success');
      prependPostToFeed(post);
      uploadState.retryFn = null;

    } catch(e) {
      setComposeRing('failed');
      uploadState.retryFn = doUpload;
    }
  };

  doUpload(); // fire and forget — ring handles state
}

// ══════════════════════════════════════════
// POST DETAIL
// ══════════════════════════════════════════

async function openDetail(postId, scrollToComments = false) {
  if (!postId) return;
  detailPostId = postId;
  detailCommentParentId = null;
  pushRoute('/post/' + postId);

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
      .dp-avatar-wrap {
        position: relative; flex-shrink: 0;
        width: 46px; height: 46px;
      }
      .dp-avatar-ring {
        position: absolute; inset: -2.5px; border-radius: 50%;
        background: linear-gradient(135deg, var(--accent), #a78bfa);
        z-index: 0; opacity: 0; transition: opacity 0.2s;
      }
      .dp-avatar-ring.live    { background: linear-gradient(135deg, var(--red), #ff8c42); animation: ringPulse 2s ease-in-out infinite; }
      .dp-avatar-ring.commerce { background: linear-gradient(135deg, var(--gold), #ff8c42); }
      .dp-avatar-ring.live_commerce { background: linear-gradient(135deg, var(--red), var(--gold)); animation: ringPulse 2s ease-in-out infinite; }
      .dp-avatar-wrap.has-moment .dp-avatar-ring { opacity: 1; }
      .dp-avatar {
        width: 46px; height: 46px; border-radius: 50%;
        object-fit: cover; object-position: top;
        cursor: pointer; position: relative; z-index: 1;
        border: 2px solid var(--bg);
        transition: opacity .15s;
      }
      .dp-avatar-wrap:not(.has-moment) .dp-avatar { border-color: var(--border, #e5e7eb); }
      .dp-avatar:active { opacity: .7; }
      .dp-author-info { flex: 1; min-width: 0; }
      .dp-name {
        font-size: 15px; font-weight: 600; color: var(--text);
        cursor: pointer; white-space: nowrap;
        max-width: 180px;
        line-height: 1.2;
      }
      .dp-name span { display: inline-block; }
      .dp-name:hover { text-decoration: none; }
      .dp-follow-btn {
        height: 32px; padding: 0 18px;
        border-radius: 20px; font-size: 13px; font-weight: 700;
        border: 1.5px solid #6C47FF;
        background: #6C47FF; color: #fff;
        cursor: pointer; transition: all .2s; flex-shrink: 0;
        letter-spacing: -.01em;
      }
      .dp-follow-btn.following,
      .dp-follow-btn.prf-btn-following {
        background: transparent; color: #6C47FF; border-color: #6C47FF;
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
      /* quote-card CSS lives in style.css */

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
        text-transform: uppercase; letter-spacing: .06em;
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
        background: #6C47FF; color: #fff; border-radius: 50%;
      }
      .cb-send-btn:disabled { opacity: .4; cursor: not-allowed; background: #6C47FF; }
      .cb-send-btn:not(:disabled):active { transform: scale(.88); }
    `;
    document.head.appendChild(s);
  }

  slideTo('detail', async () => {
    const body = document.getElementById('detail-body');
    body.innerHTML = `<div class="dp-wrap">${skeletonPost()}</div>`;

    // Clear stale header identity immediately — don't show previous post's author
    const _hdrIdentity = document.getElementById('dp-header-identity');
    const _hdrAvatar   = document.getElementById('dp-header-avatar');
    const _hdrUsername = document.getElementById('dp-header-username');
    if (_hdrIdentity) { _hdrIdentity.style.opacity = '0'; _hdrIdentity.style.pointerEvents = 'none'; }
    if (_hdrAvatar)   { _hdrAvatar.style.visibility = 'hidden'; _hdrAvatar.src = ''; }
    if (_hdrUsername) _hdrUsername.textContent = '';

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

    // Pre-fetch follow state before render — eliminates the Follow→Following flash
    const isFollowingAuthor = (!isOwn && currentUser) ? await checkFollowState(p.user_id) : false;

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
        <div class="quote-card" onclick="openDetail('${orig.id}')">
          <div class="quote-card-inner">
            <div class="quote-card-header">
              <img class="quote-card-avatar" src="${origUser.avatar||''}" onerror="this.style.display='none'">
              <span class="quote-card-name">${escHtml(origUser.username)}</span>
              <span class="quote-card-time">${timeSince(orig.created_at)}</span>
            </div>
            ${orig.content ? `<p class="quote-card-text">${escHtml(orig.content.slice(0,240))}${orig.content.length>240?'…':''}</p>` : ''}
          </div>
          ${orig.image ? `<img class="quote-card-img" src="${orig.image}" alt="">` : ''}
          ${orig.video && !orig.image ? `
            <div class="quote-card-video-wrap">
              <video class="quote-card-video" preload="metadata"><source src="${orig.video}" type="video/mp4"></video>
              <div class="quote-card-play"><svg width="36" height="36" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="22" fill="rgba(0,0,0,0.45)" stroke="white" stroke-width="2"/><path d="M32 24L20 31V17L32 24Z" fill="white"/></svg></div>
            </div>
          ` : ''}
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
          ${getDpAvatarRing(p.user_id, user.avatar||'', isOwn)}
          <div class="dp-author-info">
            <div class="dp-name">
              <span onclick="${isOwn ? 'selfTap(this)' : `showUserProfile('${p.user_id}',this)`}">${escHtml(user.username)}</span>
            </div>
          </div>
          ${!isOwn
            ? `<button class="dp-follow-btn ${isFollowingAuthor ? 'prf-btn-following' : ''}" id="dp-follow-${postId}" onclick="toggleDetailFollow(this,'${p.user_id}')">${isFollowingAuthor ? 'Following' : 'Follow'}</button>`
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

    // ── Mini identity in detail header (fades in when author avatar scrolls out) ──
    const dpHeaderIdentity = document.getElementById('dp-header-identity');
    const dpHeaderAvatar   = document.getElementById('dp-header-avatar');
    const dpHeaderUsername = document.getElementById('dp-header-username');

    dpHeaderAvatar.src = user.avatar || '';
    dpHeaderAvatar.style.visibility = 'visible';
    dpHeaderUsername.textContent = user.username || '';

    // IntersectionObserver on author avatar — show mini identity when avatar scrolls out
    const detailPage = document.getElementById('page-detail');
    if (detailPage._dpAvatarObs) detailPage._dpAvatarObs.disconnect();
    const dpAuthorAvatar = detailPage.querySelector('.dp-avatar-wrap') || detailPage.querySelector('.dp-avatar');
    detailPage._dpAvatarObs = new IntersectionObserver(([entry]) => {
      const visible = entry.isIntersecting;
      dpHeaderIdentity.style.opacity       = visible ? '0' : '1';
      dpHeaderIdentity.style.pointerEvents = visible ? 'none' : 'auto';
    }, { root: detailPage, threshold: 0 });
    if (dpAuthorAvatar) detailPage._dpAvatarObs.observe(dpAuthorAvatar);


    // Comment bar placeholder
    document.getElementById('comment-input').placeholder = `Reply to ${user.username}...`;

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
      cbRepost.onclick = () => handleRepost(postId, cbRepost, p.user_id);
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

async function toggleDetailFollow(btn, userId) {
  // Ensure btn uses same classes as setFollowBtnState
  const isCurrentlyFollowing = btn.classList.contains('prf-btn-following') || btn.classList.contains('following');
  // Normalise classes so toggleFollow works correctly
  btn.classList.remove('following');
  if (isCurrentlyFollowing) {
    btn.classList.add('prf-btn-following');
    btn.classList.remove('prf-btn-primary');
  } else {
    btn.classList.remove('prf-btn-following');
    btn.classList.add('prf-btn-primary');
  }
  await toggleFollow(userId, btn);
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

  container.innerHTML = `
    <div class="comments-header">
      <span class="comments-title">Replies</span>
    </div>
    <div class="comments-list" id="comments-list"></div>`;

  const { data: comments } = await supabase
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

  const statEl = document.querySelector('.dp-stat-n[data-type="comments"]');
  if (statEl) statEl.textContent = fmtNum((comments || []).length);

  if (!comments || !comments.length) {
    list.innerHTML = `
      <div class="comments-empty">
        <div class="comments-empty-icon">💬</div>
        <div class="comments-empty-text">No replies yet</div>
        <div class="comments-empty-sub">Be the first to say something</div>
      </div>`;
    return;
  }

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
  const isReply = !!parentId;

  const wrap = document.createElement('div');
  wrap.className = 'comment-item' + (isReply ? ' reply' : '');
  wrap.dataset.commentId = c.id;

  wrap.innerHTML = `
    <div class="comment-thread-col">
      <img class="comment-avatar" src="${u.avatar||''}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(u.username)}'" alt="" onclick="showUserProfile('${c.user_id}',this)">
      <div class="thread-trunk hidden" id="trunk-${c.id}"></div>
    </div>
    <div class="comment-body">
      <div class="comment-meta-row">
        <span class="comment-name" onclick="showUserProfile('${c.user_id}',this)">${escHtml(u.username)}</span>
        <span class="comment-time">${timeSince(c.created_at)}</span>
      </div>
      ${c.content ? `<p class="comment-text">${escHtml(c.content)}</p>` : ''}
      ${c.image_url ? `
        <div class="comment-media">
          <img class="comment-img" src="${c.image_url}" alt="" loading="lazy" onclick="openMediaViewer('${c.image_url}')">
        </div>` : ''}
      ${c.sticker_url ? `
        <div class="comment-sticker-slot" id="sticker-slot-${c.id}">
          <img class="comment-sticker" src="${c.sticker_url}" alt="">
        </div>` : `<div class="comment-sticker-slot" id="sticker-slot-${c.id}"></div>`}
      <div class="comment-actions-row">
        <button class="comment-action like-comment-btn ${liked ? 'liked' : ''}" data-comment-id="${c.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="${liked ? 'var(--red)' : 'none'}" stroke="${liked ? 'var(--red)' : 'currentColor'}" stroke-width="2">
            <path class="cmt-heart-path" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
          <span class="cmt-like-count">${c.like_count > 0 ? c.like_count : ''}</span>
        </button>
        ${!isReply ? `<button class="comment-action reply-btn" data-comment-id="${c.id}">Reply</button>` : ''}
        ${isOwn ? `<button class="comment-action delete-comment-btn" data-comment-id="${c.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>` : ''}
      </div>
      ${!isReply ? `
        <div class="reply-composer" id="reply-composer-${c.id}">
          <div class="reply-composer-inner">
            <img class="reply-composer-avatar" src="${currentProfile?.avatar||''}" onerror="this.style.display='none'">
            <textarea class="reply-textarea" placeholder="Reply to ${escHtml(u.username)}…" rows="1"></textarea>
          </div>
          <div class="reply-composer-footer">
            <button class="reply-sticker-btn" title="Sticker — coming soon" disabled>🎭</button>
            <button class="reply-cancel" onclick="closeReplyComposer('${c.id}')">Cancel</button>
            <button class="reply-submit" disabled onclick="submitReplyInline('${c.id}','${postId}',this)">Reply</button>
          </div>
        </div>
        <div class="replies-ctrl" id="replies-ctrl-${c.id}" style="display:none">
          <button class="expand-replies-btn" id="expand-${c.id}">0 replies</button>
          <button class="collapse-replies-btn hidden" id="collapse-${c.id}" onclick="collapseReplies('${c.id}')">Hide replies</button>
        </div>
        <div class="replies-block" id="replies-${c.id}"></div>
      ` : ''}
    </div>`;

  // Reply btn toggle
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

  // Reply textarea auto-grow
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
    if (!confirm('Delete this reply?')) return;
    await supabase.from('comments').delete().eq('id', c.id).eq('user_id', currentUser.id);
    wrap.style.transition = 'opacity 0.2s, transform 0.2s';
    wrap.style.opacity = '0'; wrap.style.transform = 'translateY(-4px) scale(0.98)';
    setTimeout(() => wrap.remove(), 220);
    await supabase.rpc('increment_post_comment_count', { pid: postId, delta: -1 });
    updateCommentCountDelta(-1);
  });

  // Load replies
  if (!isReply) {
    loadReplyCount(c.id).then(count => {
      const ctrl = document.getElementById(`replies-ctrl-${c.id}`);
      const expandBtn = document.getElementById(`expand-${c.id}`);
      if (count > 0) {
        if (ctrl) ctrl.style.display = '';
        if (expandBtn) {
          expandBtn.textContent = `${count} ${count === 1 ? 'reply' : 'replies'}`;
          expandBtn.onclick = () => expandReplies(c.id, likedSet, postId);
        }
      }
      // If count === 0, ctrl stays hidden — no clutter
    });
  }

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

  // Add optimistic reply — auto-expand if not already open
  const repliesBlock = document.getElementById(`replies-${parentCommentId}`);
  const trunk = document.getElementById(`trunk-${parentCommentId}`);
  const expandBtn = document.getElementById(`expand-${parentCommentId}`);
  const collapseBtn = document.getElementById(`collapse-${parentCommentId}`);
  const ctrl = document.getElementById(`replies-ctrl-${parentCommentId}`);

  // Show ctrl row if hidden
  if (ctrl) ctrl.style.display = '';
  // Show trunk rope
  if (trunk) trunk.classList.remove('hidden');
  if (expandBtn) expandBtn.style.display = 'none';
  if (collapseBtn) collapseBtn.classList.remove('hidden');

  const optimistic = buildCommentEl({
    id: 'opt-' + Date.now(), content, created_at: new Date().toISOString(),
    like_count: 0, parent_id: parentCommentId, user_id: currentUser.id,
    user: currentProfile
  }, parentCommentId, new Set(), postId);
  optimistic.classList.add('fade-up');
  repliesBlock?.appendChild(optimistic);

  // Update expand button count
  loadReplyCount(parentCommentId).then(count => {
    if (expandBtn) expandBtn.textContent = `${count} ${count === 1 ? 'reply' : 'replies'}`;
  });
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

async function expandReplies(parentId, likedSet, postId) {
  const block      = document.getElementById(`replies-${parentId}`);
  const trunk      = document.getElementById(`trunk-${parentId}`);
  const expandBtn  = document.getElementById(`expand-${parentId}`);
  const collapseBtn = document.getElementById(`collapse-${parentId}`);
  if (!block) return;

  // Show trunk rope
  if (trunk) trunk.classList.remove('hidden');
  if (expandBtn)   expandBtn.style.display   = 'none';
  if (collapseBtn) collapseBtn.classList.remove('hidden');

  block.innerHTML = '<div class="loading-pulse" style="height:60px;margin:8px 0"></div>';

  const { data } = await supabase
    .from('comments')
    .select(`id,content,created_at,like_count,parent_id,user_id,user:users(id,username,avatar)`)
    .eq('parent_id', parentId)
    .order('created_at', { ascending: true })
    .limit(20);

  block.innerHTML = '';
  (data || []).forEach((r, i) => {
    const el = buildCommentEl(r, parentId, likedSet, postId);
    el.style.animationDelay = (i * 0.05) + 's';
    el.classList.add('fade-up');
    block.appendChild(el);
  });
}

function collapseReplies(parentId) {
  const block      = document.getElementById(`replies-${parentId}`);
  const trunk      = document.getElementById(`trunk-${parentId}`);
  const expandBtn  = document.getElementById(`expand-${parentId}`);
  const collapseBtn = document.getElementById(`collapse-${parentId}`);

  if (block) {
    block.style.transition = 'opacity .18s';
    block.style.opacity = '0';
    setTimeout(() => { block.innerHTML = ''; block.style.opacity = ''; block.style.transition = ''; }, 200);
  }
  if (trunk)      trunk.classList.add('hidden');
  if (expandBtn)  expandBtn.style.display = '';
  if (collapseBtn) collapseBtn.classList.add('hidden');
}

async function loadReplies(parentId, container, likedSet, postId) {
  // kept for backward compat — routes to expandReplies
  expandReplies(parentId, likedSet, postId);
}

function closeReplyComposer(commentId) {
  document.getElementById(`reply-composer-${commentId}`)?.classList.remove('open');
  detailCommentParentId = null;
}

// ══════════════════════════════════════════
// DISCOVER
// ══════════════════════════════════════════

// ══════════════════════════════════════════
// DISCOVER — full rebuild
// ══════════════════════════════════════════

// ── State ──
const DISC_RECENT_KEY = 'disc_recent_v1';
const DISC_SOCIAL_PROOF = [
  '🔥 Trending now',
  '⭐ Highly rated',
  '🛒 Added to cart by many',
  '💬 Lots of buzz',
  '✅ Frequently repurchased',
  '⚡ Flash deal',
];

let discCurrentTab   = 'posts';
let discCurrentQuery = '';
let discForYouLoaded = false;

function discGetRecent() {
  try { return JSON.parse(localStorage.getItem(DISC_RECENT_KEY) || '[]'); }
  catch { return []; }
}
function discSaveRecent(arr) {
  localStorage.setItem(DISC_RECENT_KEY, JSON.stringify(arr.slice(0,12)));
}
function discAddRecent(term) {
  const arr = discGetRecent().filter(x => x.toLowerCase() !== term.toLowerCase());
  arr.unshift(term);
  discSaveRecent(arr);
}

function discRenderRecent() {
  const arr  = discGetRecent();
  const wrap = document.getElementById('disc-recent-section');
  const box  = document.getElementById('disc-recent-pills');
  if (!wrap || !box) return;
  if (!arr.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  box.innerHTML = arr.map(t => `
    <div class="disc-recent-pill" onclick="discRunSearch('${escHtml(t)}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
        <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      ${escHtml(t)}
      <span class="disc-recent-pill-x" onclick="event.stopPropagation();discRemoveRecent('${escHtml(t)}')">×</span>
    </div>`).join('');
}

function discRemoveRecent(term) {
  discSaveRecent(discGetRecent().filter(x => x !== term));
  discRenderRecent();
}

function discClearAllRecent() {
  discSaveRecent([]);
  discRenderRecent();
}

// ── For You grid ──
async function discLoadForYou() {
  if (discForYouLoaded) return;
  discForYouLoaded = true;
  const grid = document.getElementById('disc-foryou-grid');
  if (!grid) return;

  const { data: posts } = await supabase
    .from('posts')
    .select('id,content,image,like_count,user_id,user:users(id,username,avatar)')
    .not('image','is',null)
    .order('like_count', { ascending: false })
    .limit(24);

  grid.innerHTML = '';
  (posts || []).forEach(p => {
    const tile = document.createElement('div');
    tile.className = 'disc-foryou-tile fade-in';
    tile.innerHTML = `
      <img src="${p.image}" alt="" loading="lazy">
      <div class="disc-foryou-tile-overlay">
        <img class="disc-foryou-tile-av" src="${p.user?.avatar||''}" onerror="this.style.display='none'" alt="">
        <span class="disc-foryou-tile-name">${escHtml(p.user?.username||'')}</span>
      </div>`;
    tile.addEventListener('click', () => openDetail(p.id));
    grid.appendChild(tile);
  });

  if (!posts?.length) {
    grid.innerHTML = '<p class="disc-no-results"><strong>Nothing yet</strong>Posts will appear here as people share</p>';
  }
}

// ── Topic tap ──
function discTopicTap(btn) {
  const raw  = btn.textContent.trim();
  // Strip emoji prefix (first char + space)
  const term = raw.replace(/^\S+\s/, '');
  discRunSearch(term);
}

// ── Run a search ──
function discRunSearch(term) {
  const input = document.getElementById('disc-input');
  if (!input) return;
  input.value = term;
  discOnInput(term);
}

// ── Clear ──
function discClear() {
  const input = document.getElementById('disc-input');
  if (input) input.value = '';
  discOnInput('');
  input?.focus();
}

// ── Tab switch ──
function discTab(tab, btn) {
  discCurrentTab = tab;
  document.querySelectorAll('.disc-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.disc-pane').forEach(p => p.style.display = 'none');
  const pane = document.getElementById('disc-pane-' + tab);
  if (pane) pane.style.display = '';
  // If pane empty, run search again for this tab
  if (pane && !pane.dataset.loaded) {
    discFetchResults(discCurrentQuery, tab);
  }
}

// ── Input handler ──
const discOnInput = debounce(function(val) {
  const q     = (typeof val === 'string' ? val : val?.target?.value || '').trim();
  const xBtn  = document.getElementById('disc-x-btn');
  const tabs  = document.getElementById('disc-tabs');
  const home  = document.getElementById('disc-home');
  const res   = document.getElementById('disc-results');

  discCurrentQuery = q;

  if (xBtn) xBtn.style.display = q ? '' : 'none';

  if (!q) {
    // Back to home state
    if (tabs) tabs.style.display = 'none';
    if (home) home.style.display = '';
    if (res)  res.style.display  = 'none';
    discRenderRecent();
    return;
  }

  // Show results state
  if (tabs) tabs.style.display = 'flex';
  if (home) home.style.display = 'none';
  if (res)  res.style.display  = '';

  // Reset all panes
  ['posts','people','products'].forEach(t => {
    const p = document.getElementById('disc-pane-' + t);
    if (p) { p.dataset.loaded = ''; p.style.display = t === discCurrentTab ? '' : 'none'; }
  });

  discFetchResults(q, discCurrentTab);
}, 380);

// ── Fetch results for active tab ──
async function discFetchResults(q, tab) {
  const pane = document.getElementById('disc-pane-' + tab);
  if (!pane || pane.dataset.loaded === q) return;
  pane.dataset.loaded = q;

  pane.innerHTML = discLoadingHTML();

  if (tab === 'posts')    await discFetchPosts(q, pane);
  if (tab === 'people')   await discFetchPeople(q, pane);
  if (tab === 'products') await discFetchProducts(q || '', pane);

  // Save to recent after successful fetch
  discAddRecent(q);
}

function discLoadingHTML() {
  return `<div style="padding:16px">
    <div style="height:14px;border-radius:8px;background:var(--bg3);margin-bottom:10px;width:60%;animation:shimmer 1.4s infinite;background-size:200% 100%;background-image:linear-gradient(90deg,var(--bg3) 25%,var(--bg2) 50%,var(--bg3) 75%)"></div>
    <div style="height:14px;border-radius:8px;background:var(--bg3);margin-bottom:10px;width:80%;animation:shimmer 1.4s infinite;background-size:200% 100%;background-image:linear-gradient(90deg,var(--bg3) 25%,var(--bg2) 50%,var(--bg3) 75%)"></div>
    <div style="height:14px;border-radius:8px;background:var(--bg3);width:45%;animation:shimmer 1.4s infinite;background-size:200% 100%;background-image:linear-gradient(90deg,var(--bg3) 25%,var(--bg2) 50%,var(--bg3) 75%)"></div>
  </div>`;
}

// ── Posts results ──
async function discFetchPosts(q, pane) {
  const { data } = await supabase
    .from('posts')
    .select('id,content,image,like_count,user_id,user:users(id,username,avatar)')
    .ilike('content', `%${q}%`)
    .order('like_count', { ascending: false })
    .limit(30);

  if (!data?.length) {
    pane.innerHTML = `<div class="disc-no-results"><strong>No posts found</strong>Try different words or check spelling</div>`;
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'disc-posts-grid';

  data.forEach(p => {
    const tile = document.createElement('div');
    tile.className = 'disc-post-tile';
    if (p.image) {
      tile.innerHTML = `<img src="${p.image}" alt="" loading="lazy">`;
    } else {
      tile.innerHTML = `<p class="disc-post-tile-text">${escHtml(p.content||'')}</p>`;
    }
    tile.addEventListener('click', () => openDetail(p.id));
    grid.appendChild(tile);
  });

  pane.innerHTML = '';
  pane.appendChild(grid);
}

// ── People results ──
async function discFetchPeople(q, pane) {
  const { data } = await supabase
    .from('users')
    .select('id,username,avatar,bio,follower_count')
    .or(`username.ilike.%${q}%,bio.ilike.%${q}%`)
    .limit(20);

  if (!data?.length) {
    pane.innerHTML = `<div class="disc-no-results"><strong>No people found</strong>Try searching a username or topic</div>`;
    return;
  }

  // Get who current user follows
  let followingSet = new Set();
  if (currentUser) {
    const { data: fl } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', currentUser.id);
    (fl || []).forEach(r => followingSet.add(r.following_id));
  }

  const list = document.createElement('div');
  list.className = 'disc-people-list';

  data.forEach(u => {
    if (u.id === currentUser?.id) return; // skip self
    const isFollowing = followingSet.has(u.id);
    const row = document.createElement('div');
    row.className = 'disc-person-row';
    row.innerHTML = `
      <img class="disc-person-av" src="${u.avatar||''}" onerror="this.src=''" alt="">
      <div class="disc-person-info">
        <div class="disc-person-name">${escHtml(u.username||'')}</div>
        ${u.bio ? `<div class="disc-person-bio">${escHtml(u.bio)}</div>` : ''}
      </div>
      <button class="disc-follow-btn ${isFollowing ? 'following' : ''}"
        data-uid="${u.id}"
        onclick="event.stopPropagation(); discToggleFollow(this, '${u.id}')">
        ${isFollowing ? 'Following' : 'Follow'}
      </button>`;
    row.addEventListener('click', () => openProfile(u.id));
    list.appendChild(row);
  });

  pane.innerHTML = '';
  pane.appendChild(list);
}

async function discToggleFollow(btn, uid) {
  if (!currentUser) return;
  const isFollowing = btn.classList.contains('following');
  btn.disabled = true;
  if (isFollowing) {
    await supabase.from('follows').delete()
      .eq('follower_id', currentUser.id).eq('following_id', uid);
    btn.classList.remove('following');
    btn.textContent = 'Follow';
  } else {
    await supabase.from('follows').insert({ follower_id: currentUser.id, following_id: uid });
    btn.classList.add('following');
    btn.textContent = 'Following';
  }
  btn.disabled = false;
}

// ── Products results ──
// ── Static demo products — replace with Supabase query when products table is ready ──
const DEMO_PRODUCTS = [
  {
    id: 'demo-1',
    title: 'Ankara Tote Bag — Handmade',
    image: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&q=80',
    price: 18500,
    currency: '₦',
    sold_count: 342,
    social: ['🔥 342 people bought this', '⭐ 4.9 star rating', '🛒 12 added to cart today'],
    seller: { username: '@AdaHandcraft', avatar: 'https://i.pravatar.cc/40?img=1' },
  },
  {
    id: 'demo-2',
    title: 'Natural Shea Butter Body Cream 500ml',
    image: 'https://images.unsplash.com/photo-1607006344380-b6775a0824a7?w=400&q=80',
    price: 5200,
    currency: '₦',
    sold_count: 1289,
    social: ['✅ 1.2K repurchased', '💬 "Best cream ever!"', '⚡ Flash sale — 20% off'],
    seller: { username: '@GlowByNkechi', avatar: 'https://i.pravatar.cc/40?img=5' },
  },
  {
    id: 'demo-3',
    title: "Men's Agbada Set — 3 Piece Custom",
    image: 'https://images.unsplash.com/photo-1594938298603-c8148c4b4f60?w=400&q=80',
    price: 95000,
    currency: '₦',
    sold_count: 87,
    social: ['👑 Premium quality fabric', '📦 Ships in 5 days', '🔥 Trending this week'],
    seller: { username: '@KingsTailors_Abj', avatar: 'https://i.pravatar.cc/40?img=3' },
  },
  {
    id: 'demo-4',
    title: 'Wireless Earbuds — 48hr Battery',
    image: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=400&q=80',
    price: 24000,
    currency: '₦',
    sold_count: 673,
    social: ['📱 Works with all phones', '⚡ Flash sale ends tonight', '🛒 2.1K added to cart'],
    seller: { username: '@TechVaultNG', avatar: 'https://i.pravatar.cc/40?img=8' },
  },
  {
    id: 'demo-5',
    title: 'Homemade Chin Chin 1kg — Crispy',
    image: 'https://images.unsplash.com/photo-1621939514649-280e2ee25f60?w=400&q=80',
    price: 3500,
    currency: '₦',
    sold_count: 2104,
    social: ['🍪 2.1K sold this month', '✅ Fresh baked daily', '💬 Customers keep coming back'],
    seller: { username: '@MamaDeliNG', avatar: 'https://i.pravatar.cc/40?img=9' },
  },
  {
    id: 'demo-6',
    title: 'Luxury Wig — 26" Brazilian Body Wave',
    image: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80',
    price: 145000,
    currency: '₦',
    sold_count: 215,
    social: ['💅 215 happy customers', '⭐ 5-star reviews only', '🔥 Most wished for'],
    seller: { username: '@HairByFavour', avatar: 'https://i.pravatar.cc/40?img=47' },
  },
  {
    id: 'demo-7',
    title: 'Zobo Drink Set — 6 Bottles Premium',
    image: 'https://images.unsplash.com/photo-1546173159-315724a31696?w=400&q=80',
    price: 7800,
    currency: '₦',
    sold_count: 934,
    social: ['🌿 No preservatives', '✅ 934 orders delivered', '⚡ Order before 12pm, ship today'],
    seller: { username: '@ZoboQueenLagos', avatar: 'https://i.pravatar.cc/40?img=32' },
  },
  {
    id: 'demo-8',
    title: 'Afrobeats Drum Lesson — 4 Week Online',
    image: 'https://images.unsplash.com/photo-1519892300165-cb5542fb47c7?w=400&q=80',
    price: 35000,
    currency: '₦',
    sold_count: 156,
    social: ['🎵 156 students enrolled', '📹 Lifetime video access', '🔥 Trending in Music'],
    seller: { username: '@DrumsByEmeka', avatar: 'https://i.pravatar.cc/40?img=15' },
  },
];

async function discFetchProducts(q, pane) {
  // Filter demo products by query
  const filtered = q
    ? DEMO_PRODUCTS.filter(p =>
        p.title.toLowerCase().includes(q.toLowerCase()) ||
        p.seller.username.toLowerCase().includes(q.toLowerCase())
      )
    : DEMO_PRODUCTS;

  // TODO: When products table is ready, replace above with:
  // const { data, error } = await supabase
  //   .from('products')
  //   .select('id,title,image,price,currency,sold_count,user_id,user:users(id,username,avatar)')
  //   .or(`title.ilike.%${q}%,description.ilike.%${q}%`)
  //   .order('sold_count', { ascending: false })
  //   .limit(20);
  // const filtered = data || [];

  if (!filtered.length) {
    pane.innerHTML = `<div class="disc-no-results"><strong>No products found</strong>Try a different search</div>`;
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'disc-products-grid';

  filtered.forEach(prod => {
    const card     = document.createElement('div');
    card.className = 'disc-product-card';

    const socialId  = 'sp-' + Math.random().toString(36).slice(2);
    const price     = Number(prod.price || 0).toLocaleString();
    const sold      = prod.sold_count ? `${Number(prod.sold_count).toLocaleString()} sold` : '';
    const firstProof = prod.social?.[0] || DISC_SOCIAL_PROOF[0];

    card.innerHTML = `
      <div class="disc-product-img-wrap">
        ${prod.image
          ? `<img src="${prod.image}" alt="${escHtml(prod.title)}" loading="lazy">`
          : `<div style="width:100%;height:100%;background:${gradientFor(prod.id)}"></div>`
        }
      </div>
      <div class="disc-product-body">
        <div class="disc-product-title">${escHtml(prod.title||'')}</div>
        <div class="disc-product-social" id="${socialId}">${firstProof}</div>
        <div class="disc-product-price-row">
          <span class="disc-product-currency">${prod.currency||'₦'}</span>
          <span class="disc-product-amount">${price}</span>
          ${sold ? `<span class="disc-product-sold">${sold}</span>` : ''}
        </div>
        <div class="disc-product-seller" onclick="event.stopPropagation()">
          <img class="disc-product-seller-av" src="${prod.seller?.avatar||''}" onerror="this.src=''" alt="">
          <span class="disc-product-seller-name">${escHtml(prod.seller?.username||'')}</span>
        </div>
      </div>`;

    card.addEventListener('click', () => openProduct(prod.id));
    grid.appendChild(card);
    discCycleSocialProof(socialId, prod.social);
  });

  pane.innerHTML = '';
  pane.appendChild(grid);
}

// ── Social proof cycling ──
function discCycleSocialProof(elId, customArr) {
  const arr = customArr || DISC_SOCIAL_PROOF;
  let idx = 0;
  setInterval(() => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => {
      idx = (idx + 1) % arr.length;
      el.textContent = arr[idx];
      el.style.opacity = '1';
    }, 400);
  }, 3000);
}

// ── openProduct placeholder ──
function openProduct(id) {
  // Product page — coming soon
  showToast('Product page coming soon');
}

// ── Main init ──
async function loadDiscover() {
  const input = document.getElementById('disc-input');
  if (!input) return;
  if (input.dataset.init) return;
  input.dataset.init = '1';

  // Render recent searches
  discRenderRecent();

  // Load For You grid
  discLoadForYou();

  // Wire input
  input.addEventListener('input', e => discOnInput(e.target.value));
  input.addEventListener('focus', () => discRenderRecent());
}

// ══════════════════════════════════════════
// MESSAGING
// ══════════════════════════════════════════

// ── State ──
let activeChatId       = null;  // current conversation id
let activeChatUserId   = null;  // the other user's id
let activeChatUser     = null;  // the other user's profile object
let msgRealtimeSub     = null;  // realtime subscription
let msgTypingTimer     = null;
let msgInboxLoaded     = false;

// ── Helpers ──
function msgTimeSince(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60)      return 'now';
  if (diff < 3600)    return Math.floor(diff / 60) + 'm';
  if (diff < 86400)   return Math.floor(diff / 3600) + 'h';
  if (diff < 604800)  return Math.floor(diff / 86400) + 'd';
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}
function msgFormatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
}

// ── Get or create conversation between current user and another user ──
async function msgGetOrCreateConversation(otherUserId) {
  if (!currentUser) return null;

  // Check if conversation already exists between these two users
  const { data: myConvs } = await supabase
    .from('conversation_participants')
    .select('conversation_id')
    .eq('user_id', currentUser.id);

  if (myConvs?.length) {
    const myConvIds = myConvs.map(r => r.conversation_id);
    const { data: sharedConvs } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', otherUserId)
      .in('conversation_id', myConvIds);

    if (sharedConvs?.length) {
      return sharedConvs[0].conversation_id;
    }
  }

  // Create conversation — insert with created_by so RLS can validate
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .insert({ created_by: currentUser.id })
    .select('id')
    .single();

  if (convErr) {
    console.error('Conv create error:', convErr.message, convErr.code);
    return null;
  }
  if (!conv) return null;

  // Insert self as participant
  const { error: p1Err } = await supabase
    .from('conversation_participants')
    .insert({ conversation_id: conv.id, user_id: currentUser.id });

  if (p1Err) {
    console.error('Participant 1 error:', p1Err.message);
    return null;
  }

  // Insert other participant
  const { error: p2Err } = await supabase
    .from('conversation_participants')
    .insert({ conversation_id: conv.id, user_id: otherUserId });

  if (p2Err) {
    console.error('Participant 2 error:', p2Err.message);
    // Still return conv — other user joins when they open
  }

  return conv.id;
}

// ── Open DM from anywhere in the app ──
async function openDM(userId) {
  if (!currentUser) { showToast('Sign in to send messages'); return; }
  if (userId === currentUser.id) { showToast("You can't message yourself"); return; }

  // Get user profile
  const { data: user } = await supabase
    .from('users')
    .select('id,username,avatar,bio,location')
    .eq('id', userId)
    .maybeSingle();

  if (!user) { showToast('User not found'); return; }

  const convId = await msgGetOrCreateConversation(userId);
  if (!convId) { showToast('Could not open chat'); return; }

  openChat(convId, user);
}

// ── Open messages inbox (from feed header DM button) ──
function openMessagesInbox() {
  slideTo('messages', () => {
    loadMessages();
  });
}

// ── Load inbox ──
async function loadMessages() {
  if (!currentUser) return;
  if (msgInboxLoaded) return;
  msgInboxLoaded = true;

  const list  = document.getElementById('msg-inbox-list');
  const empty = document.getElementById('msg-inbox-empty');
  if (!list) return;

  list.innerHTML = '<div class="chat-loading"><div class="chat-loading-dot"></div><div class="chat-loading-dot"></div><div class="chat-loading-dot"></div></div>';

  // Get conversations I'm part of
  const { data: myParts } = await supabase
    .from('conversation_participants')
    .select('conversation_id, last_read_at')
    .eq('user_id', currentUser.id);

  if (!myParts?.length) {
    list.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }

  const convIds = myParts.map(r => r.conversation_id);
  const readMap = {};
  myParts.forEach(r => readMap[r.conversation_id] = r.last_read_at);

  // Get conversations with last message info
  const { data: convs } = await supabase
    .from('conversations')
    .select('id, last_message, last_message_at, last_message_type, updated_at')
    .in('id', convIds)
    .order('updated_at', { ascending: false });

  if (!convs?.length) {
    list.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }

  // Get other participants for each conversation
  const { data: allParts } = await supabase
    .from('conversation_participants')
    .select('conversation_id, user_id, user:users(id,username,avatar)')
    .in('conversation_id', convIds)
    .neq('user_id', currentUser.id);

  const partMap = {};
  (allParts || []).forEach(p => { partMap[p.conversation_id] = p.user; });

  // Count unread messages
  const { data: unreadCounts } = await supabase
    .from('messages')
    .select('conversation_id')
    .in('conversation_id', convIds)
    .neq('sender_id', currentUser.id)
    .is('deleted_at', null);

  const unreadMap = {};
  (unreadCounts || []).forEach(m => {
    const readAt = readMap[m.conversation_id];
    // simplified — count all messages from others as potential unreads
    unreadMap[m.conversation_id] = (unreadMap[m.conversation_id] || 0) + 1;
  });

  list.innerHTML = '';
  if (empty) empty.style.display = 'none';

  convs.forEach(conv => {
    const otherUser = partMap[conv.id];
    if (!otherUser) return;

    const unread  = unreadMap[conv.id] || 0;
    const preview = conv.last_message || 'Start a conversation';
    const timeStr = conv.last_message_at ? msgTimeSince(conv.last_message_at) : '';

    const row = document.createElement('div');
    row.className = 'msg-conv-row';
    row.innerHTML = `
      <div class="msg-conv-av-wrap">
        <img class="msg-conv-av" src="${otherUser.avatar||''}" onerror="this.style.background='var(--bg3)';this.removeAttribute('src')" alt="">
      </div>
      <div class="msg-conv-body">
        <div class="msg-conv-name-row">
          <span class="msg-conv-name">${escHtml(otherUser.username||'')}</span>
          <span class="msg-conv-time">${timeStr}</span>
        </div>
        <div class="msg-conv-preview-row">
          <span class="msg-conv-preview${unread ? ' unread' : ''}">${escHtml(preview)}</span>
          ${unread ? `<div class="msg-conv-unread-badge">${unread > 9 ? '9+' : unread}</div>` : ''}
        </div>
      </div>`;
    row.addEventListener('click', () => openChat(conv.id, otherUser));
    list.appendChild(row);
  });

  // Check message requests
  const { data: requests } = await supabase
    .from('message_requests')
    .select('id')
    .eq('to_user_id', currentUser.id)
    .eq('status', 'pending');

  if (requests?.length) {
    const banner = document.getElementById('msg-requests-banner');
    const badge  = document.getElementById('msg-requests-badge');
    const text   = document.getElementById('msg-requests-count-text');
    if (banner) banner.style.display = 'flex';
    if (badge)  badge.textContent = requests.length;
    if (text)   text.textContent  = `${requests.length} ${requests.length === 1 ? 'person wants' : 'people want'} to chat`;
  }
}

// ── Open a chat ──
function openChat(convId, otherUser) {
  activeChatId     = convId;
  activeChatUserId = otherUser.id;
  activeChatUser   = otherUser;

  // Set topbar
  const nameEl   = document.getElementById('chat-topbar-name');
  const statusEl = document.getElementById('chat-topbar-status');
  const avEl     = document.getElementById('chat-topbar-av');
  if (nameEl)   nameEl.textContent = otherUser.username || '';
  if (statusEl) { statusEl.textContent = 'MistyNote'; statusEl.className = 'chat-topbar-status'; }
  if (avEl) {
    if (otherUser.avatar) {
      avEl.innerHTML = `<img src="${otherUser.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.parentElement.style.background='var(--bg3)'">`;
    } else {
      avEl.style.background = 'var(--accent-soft)';
      avEl.innerHTML = '';
    }
  }

  // Clear and slide in
  const msgsEl = document.getElementById('chat-messages');
  if (msgsEl) msgsEl.innerHTML = '<div class="chat-loading"><div class="chat-loading-dot"></div><div class="chat-loading-dot"></div><div class="chat-loading-dot"></div></div>';

  slideTo('chat', async () => {
    await loadChatMessages(convId);
    subscribeToChat(convId);
    markConvRead(convId);
  });
}

// ── Close chat ──
function closeChat() {
  if (msgRealtimeSub) {
    supabase.removeChannel(msgRealtimeSub);
    msgRealtimeSub = null;
  }
  activeChatId = null;
  activeChatUser = null;

  const el = document.getElementById('page-chat');
  if (el) el.classList.remove('active');
  slideStack.pop();

  // If returning to messages inbox, keep nav hidden
  const returningTo = slideStack[slideStack.length - 1];
  if (returningTo === 'messages') {
    document.getElementById('page-messages')?.classList.add('active');
  } else {
    // Returning all the way back — restore nav
    document.getElementById('bottom-nav').style.display = '';
    const backTo = lastMainPage || 'feed';
    document.getElementById('page-' + backTo)?.classList.add('active');
    document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === backTo);
    });
  }
}

// ── Close messages inbox (back button) ──
function closeMessagesInbox() {
  msgInboxLoaded = false;
  const el = document.getElementById('page-messages');
  if (el) el.classList.remove('active');
  slideStack.pop();
  // Restore nav and main page
  document.getElementById('bottom-nav').style.display = '';
  const backTo = lastMainPage || 'feed';
  document.getElementById('page-' + backTo)?.classList.add('active');
  document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === backTo);
  });
}

// ── Load messages for a conversation ──
async function loadChatMessages(convId) {
  const msgsEl = document.getElementById('chat-messages');
  if (!msgsEl) return;

  const { data: messages, error } = await supabase
    .from('messages')
    .select(`id, type, content, media_url, media_duration,
             cash_amount, cash_currency, cash_note, cash_status,
             product_id, offer_amount, offer_status,
             order_status, reply_to_id, created_at, sender_id,
             sender:users!sender_id(id, username, avatar)`)
    .eq('conversation_id', convId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) {
    msgsEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text3)">Could not load messages</div>';
    return;
  }

  msgsEl.innerHTML = '';

  if (!messages?.length) {
    msgsEl.innerHTML = `<div style="text-align:center;padding:40px 24px;color:var(--text3);font-size:14px">
      <div style="font-size:36px;margin-bottom:10px">👋</div>
      Say hello to ${escHtml(activeChatUser?.username || '')}
    </div>`;
    return;
  }

  let lastDate = null;
  let lastSenderId = null;

  messages.forEach((msg, idx) => {
    const msgDate = new Date(msg.created_at).toDateString();
    if (msgDate !== lastDate) {
      const divider = document.createElement('div');
      divider.className = 'chat-date-divider';
      const today = new Date().toDateString();
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      divider.innerHTML = `<span>${msgDate === today ? 'Today' : msgDate === yesterday ? 'Yesterday' : new Date(msg.created_at).toLocaleDateString('en-GB', {day:'numeric',month:'short'})}</span>`;
      msgsEl.appendChild(divider);
      lastDate = msgDate;
    }

    const el = buildMessageEl(msg, lastSenderId);
    if (el) msgsEl.appendChild(el);
    lastSenderId = msg.sender_id;
  });

  msgsEl.scrollTop = msgsEl.scrollHeight;
}

// ── Build a message element ──
function buildMessageEl(msg, prevSenderId) {
  const isSent     = msg.sender_id === currentUser?.id;
  const isNewSender = prevSenderId !== null && msg.sender_id !== prevSenderId;
  const timeStr    = msgFormatTime(msg.created_at);

  const row = document.createElement('div');
  // Add new-sender class when sender switches — creates 10px gap
  row.className = `chat-msg-row ${isSent ? 'sent' : 'recv'}${isNewSender ? ' new-sender' : ''}`;
  row.dataset.msgId = msg.id;

  // Build bubble based on type
  let bubbleEl;

  if (msg.type === 'cash') {
    bubbleEl = buildCashBubble(msg, isSent, timeStr);
  } else if (msg.type === 'product') {
    bubbleEl = buildProductBubble(msg, isSent, timeStr);
  } else if (msg.type === 'voice') {
    bubbleEl = buildVoiceBubble(msg, isSent, timeStr);
  } else if (msg.type === 'offer') {
    bubbleEl = buildOfferBubble(msg, isSent, timeStr);
  } else if (msg.type === 'order_update') {
    bubbleEl = buildOrderBubble(msg, timeStr);
  } else {
    // Text bubble — timestamp floats inline with last line
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = `${escHtml(msg.content || '')}<span class="chat-bubble-meta">${timeStr}${isSent ? `<span class="chat-tick"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M4 12l5 5L20 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : ''}</span>`;
    bubbleEl = bubble;
  }

  if (bubbleEl) row.appendChild(bubbleEl);
  return row;
}

function buildCashBubble(msg, isSent, timeStr) {
  const currency = msg.cash_currency === 'NGN' ? '₦' : '$';
  const amount   = Number(msg.cash_amount || 0).toLocaleString();
  const div = document.createElement('div');
  div.className = 'chat-cash-bubble';
  div.onclick = () => showToast('Cash transfer details — coming soon');
  div.innerHTML = `
    <div class="chat-cash-shimmer"></div>
    <div class="chat-cash-inner">
      <div class="chat-cash-label">💸 ${isSent ? 'Cash Sent' : 'Cash Received'}</div>
      <div class="chat-cash-amount-row">
        <span class="chat-cash-currency">${currency}</span>
        <span class="chat-cash-amount">${amount}</span>
      </div>
      ${msg.cash_note ? `<div class="chat-cash-note">${escHtml(msg.cash_note)}</div>` : ''}
      <div class="chat-cash-status">
        <div class="chat-cash-status-dot"></div>
        ${msg.cash_status === 'held' ? 'Held in escrow' : msg.cash_status === 'released' ? 'Released ✓' : 'Pending'}
      </div>
      <div style="font-size:10px;color:rgba(255,184,0,0.5);margin-top:8px;text-align:right">${timeStr}</div>
    </div>`;
  return div;
}

function buildProductBubble(msg, isSent, timeStr) {
  const div = document.createElement('div');
  div.className = 'chat-product-bubble';
  div.onclick = () => showToast('Product page — coming soon');
  div.innerHTML = `
    <div class="chat-product-bubble-img" style="background:var(--bg2);display:flex;align-items:center;justify-content:center;font-size:36px">🛒</div>
    <div class="chat-product-bubble-body">
      <div class="chat-product-bubble-title">Product</div>
      <div style="font-size:10px;color:var(--text3);margin-top:6px;text-align:right">${timeStr}</div>
    </div>`;
  return div;
}

function buildVoiceBubble(msg, isSent, timeStr) {
  const waveId = 'wv-' + msg.id.slice(0,8);
  const dur    = msg.media_duration || 0;
  const durStr = dur < 60 ? `0:${String(dur).padStart(2,'0')}` : `${Math.floor(dur/60)}:${String(dur%60).padStart(2,'0')}`;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.innerHTML = `
    <div class="chat-voice-bubble">
      <button class="chat-voice-play" onclick="chatPlayVoice(this,'${waveId}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
      </button>
      <div class="chat-voice-waveform" id="${waveId}"></div>
      <span class="chat-voice-dur">${durStr}</span>
    </div>
    <div class="chat-bubble-meta"><span>${timeStr}</span></div>`;

  // Build waveform bars after insert
  setTimeout(() => {
    const wv = document.getElementById(waveId);
    if (!wv) return;
    const heights = [4,8,14,10,18,12,22,16,20,14,8,18,24,16,12,20,10,16,8,12];
    wv.innerHTML = heights.map(h => `<div class="chat-voice-bar" style="height:${h}px"></div>`).join('');
  }, 0);

  return bubble;
}

function buildOfferBubble(msg, isSent, timeStr) {
  const currency = '₦';
  const amount   = Number(msg.offer_amount || 0).toLocaleString();
  const div = document.createElement('div');
  div.className = 'chat-offer-bubble';
  const isPending = msg.offer_status === 'pending';
  div.innerHTML = `
    <div class="chat-offer-header">
      <div class="chat-offer-label">💬 Price Offer</div>
      <div class="chat-offer-product">Product negotiation</div>
    </div>
    <div class="chat-offer-body">
      <div class="chat-offer-amount-row">
        <span class="chat-offer-currency">${currency}</span>
        <span class="chat-offer-amount">${amount}</span>
      </div>
      ${!isSent && isPending ? `
        <div class="chat-offer-actions">
          <button class="chat-offer-btn chat-offer-accept" onclick="chatRespondOffer('${msg.id}','accepted')">Accept</button>
          <button class="chat-offer-btn chat-offer-counter" onclick="chatRespondOffer('${msg.id}','countered')">Counter</button>
          <button class="chat-offer-btn chat-offer-decline" onclick="chatRespondOffer('${msg.id}','declined')">Decline</button>
        </div>` : `<div style="font-size:12px;color:var(--text3);text-transform:capitalize">${msg.offer_status}</div>`}
      <div style="font-size:10px;color:var(--text3);margin-top:8px;text-align:right">${timeStr}</div>
    </div>`;
  return div;
}

function buildOrderBubble(msg, timeStr) {
  const steps  = ['Confirmed','Packed','Shipped','Delivered'];
  const active = steps.findIndex(s => s.toLowerCase() === (msg.order_status||'').toLowerCase());
  const div = document.createElement('div');
  div.className = 'chat-order-bubble';
  let stepsHtml = '<div class="chat-order-steps">';
  steps.forEach((s, i) => {
    const cls = i < active ? 'done' : i === active ? 'active' : '';
    stepsHtml += `
      <div class="chat-order-step">
        <div class="chat-order-dot ${cls}">${i < active ? '✓' : i === active ? '→' : ''}</div>
        <div class="chat-order-step-label ${cls}">${s}</div>
      </div>`;
    if (i < steps.length - 1) {
      stepsHtml += `<div class="chat-order-line ${i < active ? 'done' : ''}"></div>`;
    }
  });
  stepsHtml += '</div>';
  div.innerHTML = `<div class="chat-order-label">📦 Order Status</div>${stepsHtml}
    <div style="font-size:10px;color:var(--text3);margin-top:10px;text-align:right">${timeStr}</div>`;
  return div;
}

// ── Send a text message ──
async function chatSend() {
  const field = document.getElementById('chat-input-field');
  const text  = field?.value?.trim();
  if (!text || !activeChatId || !currentUser) return;

  field.value = '';
  field.style.height = 'auto';

  // Optimistic UI — append immediately
  const tmpMsg = {
    id: 'tmp-' + Date.now(),
    type: 'text',
    content: text,
    sender_id: currentUser.id,
    created_at: new Date().toISOString(),
    sender: currentProfile,
  };
  const msgsEl = document.getElementById('chat-messages');
  const el = buildMessageEl(tmpMsg, null);
  if (el && msgsEl) {
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  // Send to Supabase
  const { error } = await supabase.from('messages').insert({
    conversation_id: activeChatId,
    sender_id: currentUser.id,
    type: 'text',
    content: text,
  });

  if (error) showToast('Message failed to send');

  // Update last_read
  markConvRead(activeChatId);
}

// ── Subscribe to realtime messages ──
function subscribeToChat(convId) {
  if (msgRealtimeSub) supabase.removeChannel(msgRealtimeSub);

  msgRealtimeSub = supabase
    .channel('chat-' + convId)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `conversation_id=eq.${convId}`,
    }, payload => {
      const msg = payload.new;
      // Don't add if it's our own optimistic message
      if (msg.sender_id === currentUser?.id) return;

      // Fetch sender details
      supabase.from('users').select('id,username,avatar').eq('id', msg.sender_id).maybeSingle()
        .then(({ data: sender }) => {
          msg.sender = sender;
          const msgsEl = document.getElementById('chat-messages');
          if (!msgsEl) return;
          const el = buildMessageEl(msg, null);
          if (el) {
            msgsEl.appendChild(el);
            msgsEl.scrollTop = msgsEl.scrollHeight;
          }
          markConvRead(convId);
        });
    })
    .subscribe();
}

// ── Mark conversation as read ──
async function markConvRead(convId) {
  if (!currentUser) return;
  await supabase
    .from('conversation_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', convId)
    .eq('user_id', currentUser.id)
    .catch(() => {});
}

// ── Input helpers ──
function chatInputResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}
function chatInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatSend();
  }
}

// ── Quick action stubs (to be built out) ──
function chatSendCash() {
  showToast('Cash transfer — coming in next update 💸');
}
function chatTagProduct() {
  showToast('Tag a product — coming soon 🛒');
}
function chatMakeOffer() {
  showToast('Price negotiation — coming soon 💬');
}
function chatSendInvoice() {
  showToast('Invoice generator — coming soon 🧾');
}
function chatRecordVoice() {
  showToast('Voice notes — coming soon 🎙');
}
function chatAttach() {
  showToast('Attach file — coming soon');
}
function chatOpenProfile() {
  if (activeChatUserId) openDM(activeChatUserId);
}
function chatMoreOptions() {
  showToast('More options — coming soon');
}
function chatPlayVoice(btn, waveId) {
  const bars = document.getElementById(waveId)?.querySelectorAll('.chat-voice-bar');
  if (!bars?.length) return;
  let idx = 0;
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>`;
  const iv = setInterval(() => {
    if (idx < bars.length) { bars[idx].classList.add('played'); idx++; }
    else {
      clearInterval(iv);
      bars.forEach(b => b.classList.remove('played'));
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>`;
    }
  }, 200);
}
async function chatRespondOffer(msgId, status) {
  await supabase.from('messages').update({ offer_status: status }).eq('id', msgId);
  showToast(status === 'accepted' ? 'Offer accepted ✓' : status === 'declined' ? 'Offer declined' : 'Counter sent');
  loadChatMessages(activeChatId);
}

function msgShowRequests() {
  showToast('Message requests — coming soon');
}
function msgStartNew() {
  showToast('New message — coming soon');
}
function msgSearch(val) {
  // Filter visible conv rows
  const rows = document.querySelectorAll('.msg-conv-row');
  rows.forEach(r => {
    const name = r.querySelector('.msg-conv-name')?.textContent?.toLowerCase() || '';
    r.style.display = name.includes(val.toLowerCase()) ? '' : 'none';
  });
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
  // Wire up live username sanitization
  setTimeout(() => {
    const unInput = document.getElementById('edit-username');
    const unError = document.getElementById('edit-username-error');
    const bioInput = document.getElementById('edit-bio');
    const bioCount = document.getElementById('edit-bio-count');

    if (unInput) {
      unInput.addEventListener('input', () => {
        const sanitized = sanitizeUsernameInput(unInput.value);
        if (unInput.value !== sanitized) unInput.value = sanitized;
        const check = validateUsername(sanitized);
        if (unError) unError.textContent = sanitized.length > 0 && !check.valid ? check.error : '';
      });
    }

    if (bioInput && bioCount) {
      // Block newlines — bio must be single line
      bioInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') e.preventDefault();
      });
      // Also strip any pasted newlines
      bioInput.addEventListener('input', () => {
        if (bioInput.value.includes('\n')) {
          bioInput.value = bioInput.value.replace(/\n/g, ' ').trim();
        }
      });
      const updateCount = () => {
        const len = bioInput.value.length;
        bioCount.textContent = len + '/100';
        bioCount.style.color = len >= 90 ? 'var(--red, #ff3b5c)' : 'var(--text3)';
      };
      bioInput.addEventListener('input', updateCount);
      updateCount();
    }
  }, 50);
  if (!currentProfile) return;
  const overlay = document.getElementById('edit-profile-overlay');
  overlay.classList.remove('hidden');

  document.getElementById('edit-username').value = currentProfile.username || '';
  document.getElementById('edit-bio').value = currentProfile.bio || '';

  // Location — read-only display
  const locDisplay = document.getElementById('edit-location-display');
  const locHint    = document.getElementById('location-hint');
  if (locDisplay) {
    if (currentProfile.location_denied) {
      locDisplay.textContent = 'Location permission denied';
      locDisplay.style.color = 'var(--red, #ff3b5c)';
      if (locHint) locHint.textContent = 'Location is required for commerce features — please enable in browser settings';
    } else if (currentProfile.location) {
      locDisplay.textContent = currentProfile.location;
      locDisplay.style.color = '';
    } else {
      locDisplay.textContent = 'Detecting…';
      locDisplay.style.color = 'var(--text3)';
    }
  }

  // ── Show rate limit status ──
  const unError  = document.getElementById('edit-username-error');
  const bioCount = document.getElementById('edit-bio-count');

  const unDaysLeft  = daysUntilAllowed(currentProfile.username_last_changed, 90);
  const bioDaysLeft = daysUntilAllowed(currentProfile.bio_last_changed, 7);

  if (unDaysLeft > 0 && unError) {
    unError.textContent = `Locked — can change in ${unDaysLeft} day${unDaysLeft === 1 ? '' : 's'}`;
    unError.style.color = 'var(--text3)';
    document.getElementById('edit-username').disabled = true;
    document.getElementById('edit-username').style.opacity = '0.5';
  } else {
    if (unError) { unError.textContent = ''; unError.style.color = ''; }
    document.getElementById('edit-username').disabled = false;
    document.getElementById('edit-username').style.opacity = '';
  }

  if (bioDaysLeft > 0) {
    const bioInput = document.getElementById('edit-bio');
    bioInput.disabled = true;
    bioInput.style.opacity = '0.5';
    if (bioCount) {
      bioCount.textContent = `Locked — ${bioDaysLeft} day${bioDaysLeft === 1 ? '' : 's'} remaining`;
      bioCount.style.color = 'var(--text3)';
    }
  } else {
    document.getElementById('edit-bio').disabled = false;
    document.getElementById('edit-bio').style.opacity = '';
  }
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

// ── Rate limit helpers ──
function daysUntilAllowed(lastChangedISO, limitDays) {
  if (!lastChangedISO) return 0;
  const last    = new Date(lastChangedISO);
  const now     = new Date();
  const elapsed = (now - last) / (1000 * 60 * 60 * 24); // days elapsed
  const remaining = limitDays - elapsed;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}

// ── Log a profile field change ──
async function logProfileChange(field, oldValue, newValue) {
  if (oldValue === newValue) return; // no change, don't log
  await supabase.from('profile_change_log').insert({
    user_id: currentUser.id,
    field,
    old_value: oldValue || null,
    new_value: newValue || null,
  }).catch(() => {}); // never block the save if logging fails
}

async function saveProfile() {
  const rawUsername = document.getElementById('edit-username').value;
  const bioValue    = document.getElementById('edit-bio').value.trim();
  const unError     = document.getElementById('edit-username-error');

  // ── Validate username ──
  const usernameCheck = validateUsername(rawUsername);
  if (!usernameCheck.valid) {
    if (unError) unError.textContent = usernameCheck.error;
    document.getElementById('edit-username').focus();
    return;
  }

  // Normalise both sides before comparing — prevents false "changed" from whitespace/case
  const usernameChanged = usernameCheck.value.toLowerCase().trim() !== (currentProfile.username || '').toLowerCase().trim();
  const bioChanged      = bioValue !== (currentProfile.bio || '');

  // ── Username rate limit: 90 days ──
  if (usernameChanged) {
    const daysLeft = daysUntilAllowed(currentProfile.username_last_changed, 90);
    if (daysLeft > 0) {
      if (unError) unError.textContent = `Username can't be changed for another ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
      document.getElementById('edit-username').focus();
      return;
    }
    // Check uniqueness
    const { data: existing } = await supabase.from('users').select('id').eq('username', usernameCheck.value).maybeSingle();
    if (existing) {
      if (unError) unError.textContent = 'Username already taken — try another';
      document.getElementById('edit-username').focus();
      return;
    }
  }

  // ── Bio rate limit: 7 days ──
  if (bioChanged) {
    const daysLeft = daysUntilAllowed(currentProfile.bio_last_changed, 7);
    if (daysLeft > 0) {
      showToast(`Bio can't be changed for another ${daysLeft} day${daysLeft === 1 ? '' : 's'}`);
      return;
    }
    if (bioValue.length > 100) {
      showToast('Bio must be 100 characters or less');
      return;
    }
  }

  // ── Build updates ──
  const updates = {
    username: usernameCheck.value,
    bio: bioValue,
    // location is auto-managed by detectAndSaveLocation — not editable here
  };

  const saveBtn = document.querySelector('.modal-save');
  if (saveBtn) { saveBtn.textContent = '…'; saveBtn.style.opacity = '0.5'; }

  try {
    if (editAvatarFile) updates.avatar = await uploadImage(editAvatarFile, 'avatars');
    if (editCoverFile)  updates.cover  = await uploadImage(editCoverFile, 'covers');

    // Try saving with rate limit columns first
    // If it fails (columns don't exist yet), retry without them
    let error;
    const fullUpdates = { ...updates };
    if (usernameChanged) fullUpdates.username_last_changed = new Date().toISOString();
    if (bioChanged)      fullUpdates.bio_last_changed      = new Date().toISOString();

    ({ error } = await supabase.from('users').update(fullUpdates).eq('id', currentUser.id));

    if (error) {
      // Retry without rate limit columns — SQL migration not run yet
      ({ error } = await supabase.from('users').update(updates).eq('id', currentUser.id));
    }

    if (error) throw error;

    // ── Log changes silently — never block save if logging fails ──
    try {
      if (usernameChanged) await logProfileChange('username', currentProfile.username, usernameCheck.value);
      if (bioChanged)      await logProfileChange('bio', currentProfile.bio, bioValue);
      if (updates.avatar)  await logProfileChange('avatar', currentProfile.avatar, updates.avatar);
      if (updates.cover)   await logProfileChange('cover', currentProfile.cover, updates.cover);
    } catch(_) {}

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



// ══════════════════════════════════════════
// SHARE
// ══════════════════════════════════════════

function sharePost(post) {
  const text = post.content ? post.content.slice(0, 100) : 'Check this out on MistyNote';
  const url  = window.location.origin + '/post/' + post.id;
  if (navigator.share) {
    navigator.share({ title: 'MistyNote', text, url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(() => showToast('Link copied!'));
  }
}

function shareMyProfile() {
  const user = currentProfile;
  const text = user?.username ? `Check out ${user.username} on MistyNote` : 'Check out my profile on MistyNote';
  const url  = user?.username ? window.location.origin + '/profile/' + user.username : window.location.origin;
  if (navigator.share) {
    navigator.share({ title: 'MistyNote', text, url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(() => showToast('Profile link copied!'));
  }
}

// ── PROFILE SHARE SHEET ──
let shareSheetProfile = null; // stores the profile being shared

async function openProfileShare(profile) {
  shareSheetProfile = profile;
  const overlay = document.getElementById('profile-share-overlay');
  const sheet   = document.getElementById('profile-share-sheet');
  if (!overlay || !sheet) return;

  overlay.classList.remove('hidden');
  setTimeout(() => sheet.classList.add('open'), 10);

  // Load top followers of current user to share to
  const row = document.getElementById('share-followers-row');
  if (currentUser) {
    try {
      const { data: follows } = await supabase
        .from('follows')
        .select('following_id, following:users!follows_following_id_fkey(id, username, avatar)')
        .eq('follower_id', currentUser.id)
        .limit(6);

      if (follows && follows.length > 0) {
        row.innerHTML = follows.map(f => {
          const u = f.following;
          const avatar = u?.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${u?.username}`;
          return `
            <div class="share-person" onclick="shareToDM('${u.id}', '${escHtml(u.username)}')">
              <img class="share-person-avatar" src="${avatar}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${u?.username}'">
              <span class="share-person-name">${escHtml(u.username)}</span>
            </div>`;
        }).join('');
      } else {
        row.innerHTML = '<span style="font-size:13px;color:var(--text3);padding:8px 0;">No one to show yet</span>';
      }
    } catch(e) {
      row.innerHTML = '<span style="font-size:13px;color:var(--text3);padding:8px 0;">Could not load</span>';
    }
  } else {
    row.innerHTML = '<span style="font-size:13px;color:var(--text3);padding:8px 0;">Sign in to share</span>';
  }
}

function closeProfileShare(e) {
  if (e && e.target !== document.getElementById('profile-share-overlay')) return;
  const overlay = document.getElementById('profile-share-overlay');
  const sheet   = document.getElementById('profile-share-sheet');
  sheet?.classList.remove('open');
  setTimeout(() => overlay?.classList.add('hidden'), 380);
}

function getProfileUrl(profile) {
  return profile?.username
    ? `${window.location.origin}/profile/${profile.username}`
    : window.location.origin;
}

function shareToApp(app) {
  if (!shareSheetProfile) return;
  const url  = getProfileUrl(shareSheetProfile);
  const text = `Check out ${shareSheetProfile.username} on MistyNote`;
  const encoded = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);
  const links = {
    whatsapp:  `https://wa.me/?text=${encodedText}%20${encoded}`,
    facebook:  `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
    twitter:   `https://twitter.com/intent/tweet?text=${encodedText}&url=${encoded}`,
    telegram:  `https://t.me/share/url?url=${encoded}&text=${encodedText}`,
    instagram: null // Instagram has no web share URL — use native share
  };
  if (app === 'instagram') {
    if (navigator.share) {
      navigator.share({ title: 'MistyNote', text, url }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(url).then(() => showToast('Link copied — paste in Instagram'));
    }
    return;
  }
  window.open(links[app], '_blank');
}

function shareToDM(userId, username) {
  if (!shareSheetProfile) return;
  const url = getProfileUrl(shareSheetProfile);
  // DM share — for now copies link and shows toast (DM feature pending)
  navigator.clipboard?.writeText(url).then(() => {
    showToast(`Link copied — send to ${username} 💜`);
  });
  closeProfileShare();
}

function copyProfileLink() {
  if (!shareSheetProfile) return;
  const url = getProfileUrl(shareSheetProfile);
  navigator.clipboard?.writeText(url).then(() => showToast('Profile link copied!'));
  closeProfileShare();
}

async function reportProfile() {
  if (!shareSheetProfile || !currentUser) return;
  try {
    await supabase.from('reports').insert({
      reporter_id: currentUser.id,
      reported_user_id: shareSheetProfile.id,
      type: 'profile',
      created_at: new Date().toISOString()
    });
  } catch(e) { /* table may not exist yet */ }
  showToast('Report submitted. Thank you.');
  closeProfileShare();
}

function blockUser() {
  if (!shareSheetProfile) return;
  const username = shareSheetProfile.username || 'This user';
  closeProfileShare();
  // Confirm before blocking
  const overlay = document.createElement('div');
  overlay.className = 'action-sheet-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'action-sheet';
  sheet.innerHTML = `
    <div style="padding:20px 20px 8px;text-align:center;">
      <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:6px;">Block @${escHtml(username)}?</div>
      <div style="font-size:14px;color:var(--text2);line-height:1.5;">They won't be able to see your posts or interact with you.</div>
    </div>
    <div class="action-sheet-divider"></div>
  `;
  const confirmBtn = document.createElement('div');
  confirmBtn.className = 'action-sheet-item danger';
  confirmBtn.innerHTML = '<span style="font-size:20px">🚫</span><span>Block</span>';
  confirmBtn.addEventListener('click', () => {
    document.body.removeChild(overlay);
    showToast(`@${username} has been blocked.`);
    // TODO: insert into blocks table when available
    slideBack();
  });
  const cancelBtn = document.createElement('div');
  cancelBtn.className = 'action-sheet-item';
  cancelBtn.style.cssText = 'font-weight:700;border-top:1px solid var(--border);';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => document.body.removeChild(overlay));
  sheet.appendChild(confirmBtn);
  sheet.appendChild(cancelBtn);
  overlay.appendChild(sheet);
  overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });
  document.body.appendChild(overlay);
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

// ══════════════════════════════════════════
// FOLLOW LIST MODAL
// ══════════════════════════════════════════

async function openFollowList(type, userId) {
  // type = 'followers' | 'following'
  // userId is always the auth id (users.id column) — used directly in follows table
  const title = type === 'followers' ? 'Followers' : 'Following';

  // Build modal
  const overlay = document.createElement('div');
  overlay.id = 'follow-list-overlay';
  overlay.innerHTML = `
    <div class="follow-list-sheet">
      <div class="follow-list-header">
        <span class="follow-list-title">${title}</span>
        <button class="follow-list-close" onclick="closeFollowList()">✕</button>
      </div>
      <div class="follow-list-body" id="follow-list-body">
        <div class="follow-list-loading">Loading...</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));

  // Close on backdrop tap
  overlay.addEventListener('click', e => { if (e.target === overlay) closeFollowList(); });

  // Fetch list — two step: get follow rows, then fetch user profiles
  const body = document.getElementById('follow-list-body');
  if (!body) return;

  let followRows, fetchError;
  if (type === 'followers') {
    ({ data: followRows, error: fetchError } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('following_id', userId)
      .order('created_at', { ascending: false }));
  } else {
    ({ data: followRows, error: fetchError } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId)
      .order('created_at', { ascending: false }));
  }


  if (fetchError || !followRows || followRows.length === 0) {
    body.innerHTML = `<div class="follow-list-empty">No ${title.toLowerCase()} yet</div>`;
    return;
  }

  const userIds = followRows.map(r => type === 'followers' ? r.follower_id : r.following_id);
  const { data: usersData, error: usersError } = await supabase
    .from('users')
    .select('id, username, avatar, is_verified')
    .in('id', userIds);

  const users = usersData || [];

  // Check which ones current user is already following
  let followingSet = new Set();
  if (currentUser) {
    const authIds = users.map(u => u.id).filter(uid => uid && uid !== currentUser.id);
    if (authIds.length) {
      const { data: myFollows } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', currentUser.id)
        .in('following_id', authIds);
      if (myFollows) myFollows.forEach(f => followingSet.add(f.following_id));
    }
  }

  body.innerHTML = users.map(u => {
    const isMe = currentUser && u.id === currentUser.id;
    const isFollowing = followingSet.has(u.id);
    const avatar = u.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(u.username)}`;
    const verified = u.is_verified ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="#6C47FF"><path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/></svg>` : '';
    return `
      <div class="follow-list-row" onclick="followListTapUser('${u.id}')">
        <img class="follow-list-avatar" src="${avatar}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(u.username)}'">
        <div class="follow-list-info">
          <span class="follow-list-name">${escHtml(u.username)}${verified}</span>
        </div>
        ${!isMe ? `<button class="follow-list-btn ${isFollowing ? 'following' : ''}"
          id="flbtn-${u.id}"
          onclick="event.stopPropagation(); followListToggle('${u.id}', this)">
          ${isFollowing ? 'Following' : 'Follow'}
        </button>` : ''}
      </div>`;
  }).join('');
}

function closeFollowList() {
  const overlay = document.getElementById('follow-list-overlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  setTimeout(() => overlay.remove(), 280);
}

async function followListToggle(userId, btn) {
  const isFollowing = btn.classList.contains('following');
  // Optimistic
  btn.classList.toggle('following', !isFollowing);
  btn.textContent = !isFollowing ? 'Following' : 'Follow';

  if (isFollowing) {
    const { data, error } = await supabase.from('follows').delete()
      .eq('follower_id', currentUser.id).eq('following_id', userId).select();
    if (error || !data?.length) { btn.classList.add('following'); btn.textContent = 'Following'; showToast('Failed'); }
    else { showToast('Unfollowed'); refreshFollowCounts(userId); }
  } else {
    const { error } = await supabase.from('follows').insert({ follower_id: currentUser.id, following_id: userId });
    if (error) { btn.classList.remove('following'); btn.textContent = 'Follow'; showToast('Failed'); }
    else { showToast('Following ✓'); refreshFollowCounts(userId); }
  }
}

async function followListTapUser(userAuthId) {
  closeFollowList();
  // userAuthId is the auth UUID (user_id column) — need to find the profile id
  setTimeout(async () => {
    if (currentUser && userAuthId === currentUser.id) { navTo('profile'); return; }
    // Look up the profile.id from user_id
    const { data } = await supabase.from('users').select('id').eq('user_id', userAuthId).maybeSingle();
    const profileId = data?.id || userAuthId;
    showUserProfile(profileId, null);
  }, 200);
}

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

// ══════════════════════════════════════════
// MOMENTS — ring helper
// ══════════════════════════════════════════

function getDpAvatarRing(userId, avatarSrc, isOwn) {
  const moment = activeMoments.get(userId);
  const src = avatarSrc || `https://api.dicebear.com/7.x/adventurer/svg?seed=${userId}`;
  const onclick = isOwn ? 'selfTap(this)' : `showUserProfile('${userId}',this)`;
  if (!moment) {
    return `<img class="dp-avatar" src="${src}" onerror="this.style.display='none'" onclick="${onclick}">`;
  }
  const type = moment.type;
  return `
    <div class="dp-avatar-wrap has-moment ${type}">
      <div class="dp-avatar-ring ${type}"></div>
      <img class="dp-avatar" src="${src}"
        onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${userId}'"
        onclick="${onclick}">
    </div>`;
}

function getMomentBanner(userId) {
  const moment = activeMoments.get(userId);
  if (!moment) return '';
  const configs = {
    regular:       { label: '● Active Moment',       color: 'var(--accent)',  bg: 'var(--accent-soft)' },
    commerce:      { label: '🛍️ Selling Now',         color: '#b8860b',        bg: 'rgba(255,184,0,0.12)' },
    live:          { label: '● Live Now',             color: 'var(--red)',     bg: 'var(--red-soft)' },
    live_commerce: { label: '● Live Sales Ongoing',    color: 'var(--red)',   bg: 'var(--red-soft)' },
  };
  const c = configs[moment.type] || configs.regular;
  return `
    <div class="prf-moment-banner" style="--mb-color:${c.color};--mb-bg:${c.bg}"
         onclick="openMomentFromAvatar('${userId}')">
      <span class="prf-moment-banner-text">${c.label}</span>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
    </div>`;
}

function getMomentRing(userId, avatarSrc) {
  const moment = activeMoments.get(userId);
  const seed = avatarSrc || `https://api.dicebear.com/7.x/adventurer/svg?seed=${userId}`;
  if (!moment) {
    return `<img class="small-photo" src="${seed}" onerror="this.style.display='none'" alt="">`;
  }
  const type = moment.type; // regular | commerce | live | live_commerce
  return `
    <div class="avatar-moment-wrap has-moment ${type}" onclick="openMomentFromAvatar('${userId}');event.stopPropagation()">
      <div class="avatar-moment-ring ${type}"></div>
      <img class="small-photo" src="${seed}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${userId}'" alt="">
    </div>`;
}

function openMomentFromAvatar(userId) {
  const moment = activeMoments.get(userId);
  if (!moment) return;
  const typeLabel = moment.type === 'live' || moment.type === 'live_commerce' ? 'Live session' : 'Moment';
  showToast(`${typeLabel} — coming soon ✨`);
}

function seedDemoMoments(posts) {
  // Wire demo moment types to real user IDs from loaded posts
  // In production this will be replaced by a DB query
  if (activeMoments.size > 0) return; // already seeded
  const types = ['regular', 'commerce', 'live', 'live_commerce', 'regular'];
  let i = 0;
  const seen = new Set();
  for (const p of posts) {
    if (!seen.has(p.user_id) && i < types.length) {
      activeMoments.set(p.user_id, { type: types[i] });
      seen.add(p.user_id);
      i++;
    }
  }
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function toggleMasonryLike(btn, postId) {
  if (!currentUser) { showToast('Sign in to like'); return; }
  const liked = btn.classList.contains('liked');
  const newLiked = !liked;
  const svg = btn.querySelector('svg');
  const countEl = btn.querySelector('.prf-masonry-like-count');
  const current = parseInt(countEl?.textContent?.replace(/[^0-9]/g,'')) || 0;
  const newCount = Math.max(0, current + (newLiked ? 1 : -1));

  btn.classList.toggle('liked', newLiked);
  if (svg) {
    svg.setAttribute('fill', newLiked ? 'rgb(244,7,82)' : 'none');
    svg.setAttribute('stroke', newLiked ? 'rgb(244,7,82)' : 'currentColor');
  }
  if (countEl) countEl.textContent = newCount > 0 ? fmtNum(newCount) : '';
  if (newLiked) likedPosts.add(postId); else likedPosts.delete(postId);

  // Sync with DB
  if (newLiked) {
    supabase.from('likes').insert({ post_id: postId, user_id: currentUser.id }).then(({ error }) => {
      if (error && error.code !== '23505') { btn.classList.remove('liked'); }
    });
  } else {
    supabase.from('likes').delete().eq('post_id', postId).eq('user_id', currentUser.id);
  }
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