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
let selectedFile = null;
let repostTargetId = null;
let repostTargetBtn = null;
let slideStack = [];           // navigation stack for back button
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

  await loadMyProfile();
  updateNavAvatar();
  loadFeed();
  loadNotifications();
  loadInitialNotifCount();
  subscribeToNotifs();
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
        errorEl.style.color = '#00c48c';
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
  el.textContent = newVal > 0 ? fmtNum(newVal) : '';

  if (newVal === current) return;

  const scale = newVal > current ? 1.35 : 0.75;
  el.style.transition = 'none';
  el.style.transform = `scale(${scale})`;
  void el.offsetWidth; // force reflow
  el.style.transition = 'transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
  el.style.transform = 'scale(1)';
}

function slideTo(pageId, setupFn) {
  slideStack.push(pageId);
  const el = document.getElementById('page-' + pageId);
  if (!el) return;

  // Dim bottom nav pages
  ['feed','discover','notifications','profile'].forEach(id => {
    document.getElementById('page-' + id)?.classList.remove('active');
  });

  if (setupFn) setupFn();

  requestAnimationFrame(() => {
    el.classList.add('active');
    el.scrollTop = 0;
  });
}

function slideBack() {
  const pageId = slideStack.pop();
  if (pageId) {
    const el = document.getElementById('page-' + pageId);
    el?.classList.remove('active');
  }

  // Restore last main page
  const lastMain = slideStack.length > 0 ? slideStack[slideStack.length - 1] : 'feed';
  const mainPages = ['feed','discover','notifications','profile'];
  if (mainPages.includes(lastMain)) {
    document.getElementById('page-' + lastMain)?.classList.add('active');
  } else if (slideStack.length > 0) {
    document.getElementById('page-' + lastMain)?.classList.add('active');
  } else {
    // Go back to feed by default
    document.getElementById('page-feed')?.classList.add('active');
    document.querySelector('.nav-btn[data-page="feed"]')?.classList.add('active');
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

async function renderMyProfile() {
  const container = document.getElementById('my-profile-content');
  if (!container) return;

  await loadMyProfile();
  const profile = currentProfile;
  if (!profile) return;

  // Fetch posts
  const { data: posts } = await supabase
    .from('posts')
    .select(`id, content, image, video, created_at, like_count, reposted_post_id,
             reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar))`)
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(30);

  const hasMedia = (posts || []).some(p => p.image || p.video || (p.reposted_post?.image));

  container.innerHTML = `
    <div class="profile-cover">
      <img class="profile-cover-img" src="${profile.cover || ''}" onerror="this.style.display='none'" alt="">
      ${!profile.cover ? `<div style="height:180px;background:linear-gradient(135deg,var(--accent),#ff3b5c)"></div>` : ''}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;padding:0 16px 0">
      <div class="profile-avatar-outer">
        <img class="profile-avatar" src="${profile.avatar || ''}" onerror="this.src=''" alt="">
      </div>
      <div class="profile-buttons" style="margin-bottom:8px">
        <button class="profile-btn outline" onclick="showSettings()">Settings</button>
        <button class="profile-btn" onclick="openEditProfile()">Edit</button>
      </div>
    </div>
    <div class="profile-info-section">
      <div class="profile-name">${profile.username || 'User'}</div>
      ${profile.bio ? `<div class="profile-bio">${escHtml(profile.bio)}</div>` : ''}
      ${profile.location ? `<div class="profile-location"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="3" stroke="currentColor" stroke-width="2"/></svg>${escHtml(profile.location)}</div>` : ''}
      <div class="profile-stats">
        <div class="profile-stat"><span class="profile-stat-n">${fmtNum(profile.following || 0)}</span><span class="profile-stat-l">Following</span></div>
        <div class="profile-stat"><span class="profile-stat-n">${fmtNum(profile.followers || 0)}</span><span class="profile-stat-l">Followers</span></div>
        <div class="profile-stat"><span class="profile-stat-n">${fmtNum((posts || []).length)}</span><span class="profile-stat-l">Posts</span></div>
      </div>
    </div>
    <div class="profile-tabs" id="my-profile-tabs">
      <button class="profile-tab active" onclick="switchProfileTab('grid',this)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" stroke="currentColor" stroke-width="2" rx="1"/><rect x="14" y="3" width="7" height="7" stroke="currentColor" stroke-width="2" rx="1"/><rect x="3" y="14" width="7" height="7" stroke="currentColor" stroke-width="2" rx="1"/><rect x="14" y="14" width="7" height="7" stroke="currentColor" stroke-width="2" rx="1"/></svg>
      </button>
      <button class="profile-tab" onclick="switchProfileTab('list',this)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div id="my-profile-posts" class="masonry-grid"></div>
    <div class="wing-fab" onclick="openComposer()">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>
    </div>
  `;

  // Add FAB styles if needed
  const fabStyle = document.getElementById('fab-style');
  if (!fabStyle) {
    const s = document.createElement('style');
    s.id = 'fab-style';
    s.textContent = `.wing-fab{position:fixed;bottom:calc(var(--nav-h) + 20px + var(--safe-bottom));right:20px;width:52px;height:52px;border-radius:16px;background:linear-gradient(135deg,var(--accent),#ff3b5c);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(108,71,255,.4);cursor:pointer;z-index:50;transition:transform .2s}.wing-fab:active{transform:scale(.92)}`;
    document.head.appendChild(s);
  }

  renderProfileGrid(posts || [], currentProfile, 'my-profile-posts', true);
}

function switchProfileTab(mode, btn) {
  document.querySelectorAll('#my-profile-tabs .profile-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  const postsContainer = document.getElementById('my-profile-posts');
  if (!postsContainer) return;
  if (mode === 'grid') {
    postsContainer.className = 'masonry-grid';
  } else {
    postsContainer.className = 'profile-posts-list';
  }
}

function renderProfileGrid(posts, profile, containerId, isOwn = false) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!posts.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">✍️</div><p>No posts yet</p><span>Start sharing your world</span></div>';
    return;
  }
  container.innerHTML = '';
  posts.forEach((post, i) => {
    const img = post.image || post.reposted_post?.image || '';
    const text = post.content || post.reposted_post?.content || '';
    const tile = document.createElement('div');
    tile.className = 'masonry-tile fade-up';
    tile.style.animationDelay = (i * 0.04) + 's';
    tile.innerHTML = `
      ${img ? `<img src="${img}" alt="" loading="lazy">` : `<div style="background:${gradientFor(post.id)};width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:12px;"><p style="font-size:13px;line-height:1.4;color:white;text-align:center;font-weight:600;">${escHtml(text.slice(0,80))}</p></div>`}
      <div class="masonry-tile-overlay">
        <div class="masonry-tile-likes">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          ${fmtNum(post.like_count || 0)}
        </div>
        ${text ? `<div class="masonry-tile-text">${escHtml(text.slice(0,50))}</div>` : ''}
      </div>
    `;
    tile.addEventListener('click', () => openDetail(post.id));
    container.appendChild(tile);
  });
}

async function showUserProfile(userId) {
  if (!userId) return;
  if (userId === currentUser?.id) { navTo('profile'); return; }

  slideTo('user-profile', async () => {
    const body = document.getElementById('user-profile-body');
    body.innerHTML = '<div class="loading-pulse" style="height:300px;margin:0"></div>';

    const { data: profile } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
    if (!profile) { body.innerHTML = '<div class="empty-state"><p>User not found</p></div>'; return; }

    const { data: posts } = await supabase
      .from('posts')
      .select(`id,content,image,video,created_at,like_count,reposted_post_id,
               reposted_post:reposted_post_id(id,content,image,video)`)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);

    // Check if following
    body.innerHTML = `
      <div class="profile-cover">
        ${profile.cover ? `<img class="profile-cover-img" src="${profile.cover}" alt="">` : `<div style="height:180px;background:linear-gradient(135deg,var(--accent),#ff3b5c)"></div>`}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;padding:0 16px 0">
        <div class="profile-avatar-outer">
          <img class="profile-avatar" src="${profile.avatar || ''}" onerror="this.src=''" alt="">
        </div>
        <div class="profile-buttons" style="margin-bottom:8px">
          <button class="profile-btn outline follow-btn" id="follow-btn-${userId}" onclick="toggleFollow('${userId}',this)">Follow</button>
        </div>
      </div>
      <div class="profile-info-section">
        <div class="profile-name">${escHtml(profile.username || 'User')}</div>
        ${profile.bio ? `<div class="profile-bio">${escHtml(profile.bio)}</div>` : ''}
        ${profile.location ? `<div class="profile-location">${escHtml(profile.location)}</div>` : ''}
        <div class="profile-stats">
          <div class="profile-stat"><span class="profile-stat-n">${fmtNum(profile.following||0)}</span><span class="profile-stat-l">Following</span></div>
          <div class="profile-stat"><span class="profile-stat-n">${fmtNum(profile.followers||0)}</span><span class="profile-stat-l">Followers</span></div>
        </div>
      </div>
      <div class="masonry-grid" id="user-profile-posts" style="margin-top:12px"></div>
    `;

    renderProfileGrid(posts || [], profile, 'user-profile-posts', false);
  });
}

function toggleFollow(userId, btn) {
  const isFollowing = btn.classList.contains('following');
  btn.classList.toggle('following', !isFollowing);
  btn.textContent = !isFollowing ? 'Following' : 'Follow';
  showToast(!isFollowing ? 'Following' : 'Unfollowed');
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
      if (el) list.appendChild(el);
    }

    feedOffset += posts.length;
    if (posts.length < PER_PAGE) feedExhausted = true;

    // Batch check likes
    checkLikedPosts([...loadedPostIds]);

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
          <div class="heading">
            <div class="small-photo1">
              <a class="lino" onclick="showUserProfile('${orig.user_id}');event.stopPropagation()">
                <img class="small-photo" src="${origUser.avatar || ''}" onerror="this.style.display='none'" alt="">
              </a>
            </div>
            <div class="pos">
              <div class="link-wrapper">
                <a class="home-click" onclick="showUserProfile('${orig.user_id}');event.stopPropagation()">
                  <div class="post1">
                    <div class="jerr"><p class="jerry">${escHtml(origUser.username)}</p></div>
                    <div><img class="verif" src="pics/very.svg"></div>
                  </div>
                </a>
              </div>
              <div class="comp1">
                <div class="cll"><p class="time">${timeSince(orig.created_at)}</p></div>
              </div>
            </div>
          </div>
        </div>

        ${orig.content ? `<div class="tir" style="margin:0 10px;"><p class="tired">${origDisplay}</p></div>` : ''}

        ${orig.image ? `<div class="laptop1"><img src="${orig.image}" class="laptop" alt="" loading="lazy"></div>` : ''}

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

        <div class="view-original" style="padding:8px 12px;color:#1d9bf0;font-size:13px;cursor:pointer;">
          View original post →
        </div>
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
      <div class="heading">
        <div class="small-photo1">
          <a class="lino" onclick="${isOwnPost ? 'navTo(\'profile\')' : `showUserProfile('${p.user_id}')`};event.stopPropagation()">
            <img class="small-photo" src="${user.avatar || ''}" onerror="this.style.display='none'" alt="">
          </a>
        </div>
        <div class="pos">
          <div class="link-wrapper">
            <a class="home-click" onclick="${isOwnPost ? 'navTo(\'profile\')' : `showUserProfile('${p.user_id}')`};event.stopPropagation()">
              <div class="post1">
                <div class="jerr"><p class="jerry">${escHtml(user.username)}</p></div>
                <div><img class="verif" src="pics/very.svg"></div>
              </div>
            </a>
          </div>
          <div class="comp1">
            <div class="cll">
              <p class="time">${timeSince(p.created_at)}</p>
            </div>
          </div>
        </div>
      </div>
      <div class="dots">
        <img class="dot" src="pics/dots.svg">
      </div>
    </div>

    ${mainContentHTML}

    <div class="lefto">
      <div class="dick">
        <div><svg xmlns="http://www.w3.org/2000/svg" class="lefti" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></div>
        <div><p class="viewe">View all ${commentCount || 0} discuss</p></div>
      </div>
      <div class="twits">
        <div><img class="lefti" src="pics/stats.svg"></div>
        <div><p class="viewe">${p.views || 0} views</p></div>
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
            <div class="donate-btn"><img class="feeling" src="pics/bookmark.svg" alt="Bookmark"></div>
            <div class="donate-btn share-action" data-post-id="${p.id}"><img class="feeling" src="pics/share.svg" alt="Share"></div>
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
    if (e.target.closest('.lino') || e.target.closest('.home-click')) return;
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
    if (e.target.closest('.heart-ai, .repost-btn, .comment-btn, .donate-btn, .dots, a')) return;
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
    #feed-list { display: flex; flex-direction: column; gap: 5px; }

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
      justify-content: space-between;
      align-items: flex-start;
      margin-top: 5px;
    }
    .heading { display: flex; align-items: flex-start; }
    .small-photo1 { width: 50px; vertical-align: middle; position: relative; flex-shrink: 0; }
    .lino, .lino:active { text-decoration: none; color: inherit; }
    .small-photo {
      width: 40px;
      height: 40px;
      object-fit: cover;
      object-position: center;
      border-radius: 10px;
      transition: filter 0.15s;
    }
    .small-photo:hover { filter: brightness(0.9); }
    .pos { display: flex; flex-direction: column; gap: 1px; }
    .link-wrapper { display: inline-block; cursor: pointer; }
    .post1 { display: flex; margin-left: 5px; font-size: 15px; align-items: center; }
    .jerr {}
    .jerry { display: flex; font-weight: 600; font-size: 16px; cursor: pointer; font-family: 'Noto Sans JP', -apple-system, sans-serif; color: var(--text); }
    .post1:hover .jerry { text-decoration: underline; text-decoration-thickness: 2px; }
    .verif { width: 15px; display: block; margin-left: 3px; }
    .comp1 {}
    .cll { position: relative; }
    .time { font-size: 14px; margin-left: 5px; color: var(--text2); cursor: pointer; }
    .time:hover { text-decoration: underline; }
    .dots { display: flex; align-items: center; padding: 4px; }
    .dot { width: 14px; vertical-align: middle; opacity: 0.5; }

    .tir {
      padding: 10px 5px 8px;
      border-bottom: 1px solid rgb(220,220,220);
    }
    .tired { width: 100%; font-size: 15px; white-space: pre-wrap; word-break: break-word; color: var(--text); }
    .reer { color: rgba(244,7,82,0.7); cursor: pointer; }

    .laptop1 { max-width: 100%; margin-top: 10px; padding: 0; overflow: hidden; border-radius: 12px; }
    .laptop { max-height: 700px; margin: 0; width: 100%; object-fit: contain; height: 100%; display: block; }

    /* Video */
    .video-container { position: relative; background: #000; border-radius: 12px; overflow: hidden; margin-top: 10px; }
    .video-thumbnail { width: 100%; display: block; max-height: 400px; }
    .video-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.15); }
    .play-button { display: flex; align-items: center; justify-content: center; }

    /* Stats row */
    .lefto {
      display: flex;
      flex-direction: row;
      gap: 5px;
      width: 100%;
      justify-content: space-between;
      margin-top: 10px;
      padding-bottom: 10px;
      border-bottom: 0.5px solid rgb(220,220,220);
    }
    .dick { display: flex; gap: 5px; margin-left: 10px; align-items: center; }
    .twits { display: flex; align-items: center; gap: 5px; margin-right: 10px; }
    .lefti { width: 18px; }
    .viewe { font-size: 13px; color: var(--text2); }
    .werey { font-weight: 600; }

    /* Reaction bar */
    .reaction {
      display: flex;
      justify-content: space-between;
      padding: 3px 10px 3px;
    }
    .reaction-container { width: 100%; display: flex; align-items: center; }
    .call { width: 100%; display: flex; justify-content: space-between; }
    .mee { display: flex; gap: 20px; align-items: center; }
    .feeling { width: 22px; }

    .comment-btn { display: flex; width: 55px; align-items: center; gap: 5px; cursor: pointer; font-size: 15px; font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; color: var(--text2); }
    .comment-btn:hover { color: var(--text); }

    .repost-btn { display: flex; width: 55px; align-items: center; gap: 5px; cursor: pointer; font-size: 15px; font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; color: var(--text2); }
    .repost-btn:hover { color: var(--text); }
    .repost-icon { transition: filter 0.2s ease; }
    .repost-btn.reposted .repost-icon {
      filter: invert(29%) sepia(89%) saturate(400%) hue-rotate(110deg) brightness(90%) contrast(130%) drop-shadow(0 0 0.6px #065f46);
    }
    .repost-btn.reposted span { color: #065f46; font-weight: 500; }

    .heart-ai { width: 55px; gap: 5px; display: flex; align-items: center; cursor: pointer; }
    .heart-clickable { cursor: pointer; }
    .heart-icon { transition: all 0.3s ease; }
    .heart-icon .heart-path { stroke: var(--text); fill: none; transition: all 0.3s ease; }
    .heart-icon.liked .heart-path { fill: rgb(244,7,82); stroke: rgb(244,7,82); }
    .like-count { font-size: 14px; font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; color: var(--text2); }
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
    .repost-commentary .tir { border-bottom: none; padding-bottom: 2px; }

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

// ── INTERSECTION OBSERVER (infinite scroll + views) ──
let viewObserver;
function initIntersectionObserver() {
  viewObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      if (el.id === 'feed-load-trigger') { loadFeed(); return; }
      const postId = el.dataset.postId;
      if (!postId || el.dataset.viewed) return;
      el.dataset.viewed = '1';
      setTimeout(() => {
        if (!document.contains(el)) return;
        recordView(postId);
      }, 1500);
    });
  }, { threshold: 0.6 });

  const trigger = document.getElementById('feed-load-trigger');
  if (trigger) viewObserver.observe(trigger);
}

function observePost(el) {
  if (viewObserver && el) viewObserver.observe(el);
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
  document.querySelectorAll(`.detail-action.like-action[data-post-id="${postId}"]`).forEach(btn => {
    btn.dataset.liked = liked ? 'true' : 'false';
    btn.classList.toggle('liked', liked);
    if (count !== null) {
      const sp = btn.querySelector('span');
      if (sp) animateCount(sp, count);
    }
    const path = btn.querySelector('.heart-path');
    if (path) {
      path.setAttribute('fill', liked ? 'var(--red)' : 'none');
      path.setAttribute('stroke', liked ? 'var(--red)' : 'currentColor');
    }
  });
}

function syncLikeCount(postId, count) {
  // Feed hearts
  document.querySelectorAll(`.heart-ai[data-post-id="${postId}"] .like-count`).forEach(sp => {
    animateCount(sp, count);
  });
  // Detail view stat
  const statEl = document.querySelector(`.detail-stat-n[data-type="likes"]`);
  if (statEl && detailPostId === postId) {
    animateCount(statEl, count);
  }
}

// ══════════════════════════════════════════
// REPOSTS
// ══════════════════════════════════════════

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
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#00c48c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
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
  const myRepostId = repostedPosts.get(postId);
  if (!myRepostId) return;

  btn.dataset.reposted = 'false';
  btn.classList.remove('reposted');

  await supabase.from('posts').delete().eq('id', myRepostId).eq('user_id', currentUser.id);
  await supabase.rpc('decrement_repost_count', { post_id: postId }).catch(() => {});
  repostedPosts.delete(postId);

  // Remove from feed
  document.querySelector(`.poster[data-post-id="${myRepostId}"]`)?.remove();
  showToast('Repost removed');
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

  btn.disabled = true;

  let imageUrl = null;
  if (selectedFile) {
    try {
      imageUrl = await uploadImage(selectedFile, 'post-images');
    } catch (e) {
      showToast('Image upload failed: ' + e.message);
      btn.disabled = false;
      return;
    }
  }

  const payload = {
    user_id: currentUser.id,
    content: content || null,
    image: imageUrl || null,
    reposted_post_id: repostTargetId || null
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
    btn.disabled = false;
    return;
  }

  // Handle repost
  if (repostTargetId) {
    await supabase.rpc('increment_repost_count', { post_id: repostTargetId }).catch(() => {});
    if (repostTargetBtn) {
      repostTargetBtn.dataset.reposted = 'true';
      repostTargetBtn.classList.add('reposted');
    }
    repostedPosts.set(repostTargetId, newPost.id);

    // Notify
    const { data: orig } = await supabase.from('posts').select('user_id').eq('id', repostTargetId).single();
    if (orig && orig.user_id !== currentUser.id) {
      await supabase.from('notifications').insert({ user_id: orig.user_id, actor_id: currentUser.id, post_id: repostTargetId, type: 'repost', read: false });
    }
  }

  closeComposer();
  showToast('Posted! 🎉');

  // Prepend to feed
  const adapted = { ...newPost, comments: [{ count: 0 }] };
  const el = createFeedPost(adapted);
  const list = document.getElementById('feed-list');
  if (list && el) {
    list.prepend(el);
    loadedPostIds.add(newPost.id);
    el.classList.add('fade-up');
  }

  // Update profile if on that page
  if (document.getElementById('page-profile').classList.contains('active')) {
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

  slideTo('detail', async () => {
    const body = document.getElementById('detail-body');
    body.innerHTML = `<div class="detail-post">${skeletonPost()}</div>`;

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

    const user = p.user || { username: '@unknown', avatar: '' };
    const isOwn = currentUser && p.user_id === currentUser.id;
    const isLiked = likedPosts.has(postId);
    const isRepost = !!p.reposted_post_id && !!p.reposted_post;
    const orig = isRepost ? p.reposted_post : null;
    const origUser = orig?.user || { username: '@unknown', avatar: '' };

    let mediaHtml = '';
    if (p.image) mediaHtml = `<div class="detail-media"><img src="${p.image}" alt=""></div>`;
    else if (p.video) {
      mediaHtml = `<div class="detail-media"><div class="video-thumb-wrap" onclick="openVideoFS('${p.video}')"><video preload="metadata"><source src="${p.video}#t=0.5" type="video/mp4"></video><div class="video-play-overlay"><div class="play-circle"><svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M5 3l14 9L5 21V3z"/></svg></div></div></div></div>`;
    }

    let origCardHtml = '';
    if (isRepost && orig) {
      origCardHtml = `<div class="original-card" style="margin-left:0;cursor:pointer" onclick="openDetail('${orig.id}')">
        <div class="original-card-inner">
          <div class="original-card-header"><img class="original-card-avatar" src="${origUser.avatar||''}" onerror="this.style.display='none'"><span class="original-card-name">${escHtml(origUser.username)}</span></div>
          ${orig.content ? `<p class="original-card-text">${escHtml(orig.content.slice(0,200))}</p>` : ''}
        </div>
        ${orig.image ? `<img class="original-card-img" src="${orig.image}">` : ''}
      </div>`;
    }

    body.innerHTML = `
      <div class="detail-post">
        <div class="detail-header">
          <img class="detail-avatar" src="${user.avatar||''}" onerror="this.style.display='none'" onclick="showUserProfile('${p.user_id}')">
          <div class="detail-meta">
            <div class="detail-name" onclick="showUserProfile('${p.user_id}')">${escHtml(user.username)}</div>
            <div class="detail-username">${timeSince(p.created_at)}</div>
          </div>
          ${!isOwn ? `<button class="detail-follow-btn" id="detail-follow-${postId}" onclick="toggleDetailFollow(this,'${p.user_id}')">Follow</button>` : ''}
        </div>

        ${p.content ? `<p class="detail-text">${escHtml(p.content)}</p>` : ''}
        ${mediaHtml}
        ${origCardHtml}

        <div class="detail-stats">
          <div class="detail-stat"><span class="detail-stat-n" data-type="likes">${fmtNum(p.like_count||0)}</span><span class="detail-stat-l">Likes</span></div>
          <div class="detail-stat"><span class="detail-stat-n repost-count-display">${fmtNum(p.repost_count||0)}</span><span class="detail-stat-l">Reposts</span></div>
          <div class="detail-stat"><span class="detail-stat-n">${fmtNum(p.views||0)}</span><span class="detail-stat-l">Views</span></div>
        </div>

        <div class="detail-actions">
          <button class="detail-action comment-action" data-post-id="${postId}" onclick="focusCommentBar()">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            Reply
          </button>
          <button class="detail-action repost-action" data-post-id="${postId}" data-reposted="false" onclick="handleRepost('${postId}',this)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M17 1l4 4-4 4M7 23l-4-4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3 11V9a4 4 0 014-4h14M21 13v2a4 4 0 01-4 4H3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            Repost
          </button>
          <button class="detail-action like-action ${isLiked ? 'liked' : ''}" data-post-id="${postId}" data-liked="${isLiked}" onclick="toggleLike('${postId}',this)">
            <svg class="action-heart" width="20" height="20" viewBox="0 0 24 24" fill="none"><path class="heart-path" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" stroke="currentColor" stroke-width="2" ${isLiked ? `fill="var(--red)" stroke="var(--red)"` : ''}/></svg>
            Like
          </button>
        </div>
      </div>

      <div class="separator"></div>
      <div id="comments-container"></div>
    `;

    // Share btn
    document.getElementById('detail-share-btn').onclick = () => sharePost(p);

    // Comment bar avatar
    if (currentProfile?.avatar) {
      document.getElementById('comment-bar-avatar').src = currentProfile.avatar;
    }

    // Update placeholder
    document.getElementById('comment-input').placeholder = `Reply to ${user.username}…`;

    // Track view
    recordView(postId);

    // Load comments
    await loadComments(postId);

    if (scrollToComments) {
      setTimeout(() => {
        const cc = document.getElementById('comments-container');
        cc?.scrollIntoView({ behavior: 'smooth' });
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

  container.innerHTML = `<div class="comments-header"><span class="comments-title">Replies</span><span class="comments-count" id="comments-count-pill">…</span></div><div id="comments-list"></div>`;

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

  if (!comments || !comments.length) {
    list.innerHTML = '<div class="comments-empty">No replies yet — be the first!</div>';
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
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path class="heart-path" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" stroke="${liked ? 'var(--red)' : 'currentColor'}" fill="${liked ? 'var(--red)' : 'none'}" stroke-width="2"/></svg>
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
    supabase.rpc('increment_post_comment_count', { pid: postId, delta: -1 }).catch(() => {});
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
  updateCommentCountDelta(1);
}

async function submitComment(postId, parentId, content) {
  const { data, error } = await supabase.from('comments').insert({
    post_id: postId, user_id: currentUser.id, parent_id: parentId || null, content
  }).select(`id,content,created_at,like_count,parent_id,user_id,user:users(id,username,avatar)`).single();

  if (!error) {
    supabase.rpc('increment_post_comment_count', { pid: postId, delta: 1 }).catch(() => {});
    if (!parentId) {
      updateCommentCountDelta(1);
      const list = document.getElementById('comments-list');
      if (list) {
        const el = buildCommentEl(data, null, new Set(), postId);
        el.classList.add('fade-up');
        list.prepend(el);
        const emptyEl = list.querySelector('.comments-empty');
        if (emptyEl) emptyEl.remove();
      }
      // Notify post author
      supabase.from('posts').select('user_id').eq('id', postId).single().then(({ data: post }) => {
        if (post && post.user_id !== currentUser.id) {
          supabase.from('notifications').insert({ user_id: post.user_id, actor_id: currentUser.id, post_id: postId, type: 'comment', comment_text: content, read: false });
        }
      });
    }
  }
}

function updateCommentCountDelta(delta) {
  const pill = document.getElementById('comments-count-pill');
  if (pill) {
    const v = parseInt(pill.textContent) || 0;
    pill.textContent = Math.max(0, v + delta);
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
      if (!error) supabase.rpc('increment_comment_like', { cid: commentId, delta: 1 }).catch(() => {});
    });
  } else {
    supabase.from('comment_likes').delete().eq('comment_id', commentId).eq('user_id', currentUser.id).then(() => {
      supabase.rpc('increment_comment_like', { cid: commentId, delta: -1 }).catch(() => {});
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
  const { error } = await supabase.from('posts').delete().eq('id', postId).eq('user_id', currentUser.id);
  if (error) { showToast('Delete failed'); return; }
  el.style.transition = 'opacity .3s, transform .3s';
  el.style.opacity = '0'; el.style.transform = 'scale(0.96)';
  setTimeout(() => el.remove(), 300);
  loadedPostIds.delete(postId);
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
  supabase.rpc('record_post_view', { p_post_id: postId, p_user_id: currentUser.id }).catch(() => {});
}

// ══════════════════════════════════════════
// IMAGE UPLOAD
// ══════════════════════════════════════════

async function uploadImage(file, bucket) {
  const compressed = await compressImage(file);
  const ext = 'jpg';
  const path = `${currentUser.id}_${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(bucket).upload(path, compressed, { upsert: false });
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

async function compressImage(file, maxW = 1200, quality = 0.8) {
  if (file.size < 300 * 1024) return file;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Read failed'));
    reader.onload = ev => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image load failed'));
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(img.width * scale);
        canvas.height = Math.floor(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const byteString = atob(dataUrl.split(',')[1]);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
        const blob = new Blob([ab], { type: 'image/jpeg' });
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
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
  if (!n || n === 0) return '';
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
