/* ═══════════════════════════════════════════
   MISTYNOTE — app-social.js
   Profile, feed, likes, composer, post detail,
   mentions, discover, profile suggestions
   Requires: app-core.js
═══════════════════════════════════════════ */

// ══════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════

function navTo(pageId) {
  if (pageId === 'market') { showMarket(); return; }
  // Stop market countdown when leaving market
  if (_mktCountdownInterval) { clearInterval(_mktCountdownInterval); _mktCountdownInterval = null; }
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

  const pages = ['feed','discover','notifications','profile','market'];
  pages.forEach(id => {
    const el = document.getElementById('page-' + id);
    if (el) el.classList.toggle('active', id === pageId);
    document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === pageId);
    });
  });

  if (pageId === 'notifications') {
    onNotifPageOpen();
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

  // Block all post taps during slide — prevents ghost clicks
  document.querySelectorAll('[data-post-id]').forEach(post => {
    post.dataset.blockNavigation = 'true';
    setTimeout(() => { post.dataset.blockNavigation = 'false'; }, 600);
  });

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
  const slidePages = ['detail','user-profile','settings','wallet','storefront','messages','chat','legal-terms','legal-privacy'];
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

  // Clean up wallet when navigating away
  if (pageId === 'wallet') {
    onWalletClose();
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
    .prf-masonry-like { display:flex; align-items:center; gap:3px; background:none; border:none; cursor:pointer; flex-shrink:0; padding:2px 0; color:#000000; -webkit-tap-highlight-color:transparent; }
    .prf-masonry-like.liked { color:rgb(244,7,82); }
    .prf-masonry-like-count { font-size:11px; font-weight:400; color:inherit; }
    .prf-masonry-like.liked .prf-masonry-like-count { font-weight:600; }

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
               user:users(id,username,avatar,location),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar,location))`)
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

  likedPostsArr.forEach(p => {
    if (p?.id) {
      likedPosts.add(p.id);
      LikeStore.seed(p.id, p.like_count || 0, true); // these ARE liked posts — always true
    }
  });

  container.innerHTML = `
    <div class="prf-wrap">

      <!-- COVER -->
      <div class="prf-cover" onclick="viewProfilePhoto('${escHtml(profile.cover||'')}','cover','${escHtml(profile.username||'')}')" style="cursor:${profile.cover ? 'pointer' : 'default'}">
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
        <div class="prf-avatar-wrap" title="View profile photo" onclick="viewProfilePhoto('${escHtml(profile.avatar||`https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(profile.id)}`)}','avatar','${escHtml(profile.username||'')}')" style="cursor:pointer">
          <div class="prf-avatar-ring"></div>
          <img class="prf-avatar" src="${escHtml(profile.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(profile.id)}`)}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(profile.id)}'" alt="">
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
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

    <div class="wing-fab" id="profile-compose-fab" onclick="composeOrRetry()">
      <svg id="profile-fab-icon" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>
      <svg id="profile-fab-ring" viewBox="0 0 48 48" style="position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg);display:none">
        <circle cx="24" cy="24" r="22" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="3"/>
        <circle id="profile-fab-ring-fill" cx="24" cy="24" r="22" fill="none" stroke="white" stroke-width="3"
          stroke-dasharray="138.2" stroke-dashoffset="138.2" stroke-linecap="round"/>
      </svg>
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
  if (tab === 'likes') {
    // renderPrfPosts already seeds each post after appendChild.
    // Force liked=true for ALL posts in this tab since they are by definition liked.
    renderPrfPosts(likedArr || [], 'prf-panel-likes', false, true);
    (likedArr || []).forEach(p => {
      if (p?.id) {
        likedPosts.add(p.id);
        LikeStore.seed(p.id, p.like_count || 0, true); // always true in likes tab
      }
    });
  }
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
    if (el) {
      container.appendChild(el); // DOM exists now — seed and paint correctly
      observePost(el);
      if (p?.id) {
        const isLiked = likedPosts.has(p.id);
        LikeStore.seed(p.id, p.like_count || 0, isLiked);
      }
    }
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
    // Seed store so masonry taps have correct base count
    LikeStore.seed(post.id, likes, liked);

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
        <button class="prf-masonry-like ${liked ? 'liked' : ''}" data-post-id="${post.id}" data-liked="${liked ? 'true' : 'false'}" onclick="event.stopPropagation(); toggleMasonryLike(this, '${post.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path class="heart-path" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
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
    if (el) { c.appendChild(el); observePost(el); LikeStore.seed(p.id, p.like_count || 0, likedPosts.has(p.id)); }
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
    if (el) { c.appendChild(el); observePost(el); LikeStore.seed(p.id, p.like_count || 0, likedPosts.has(p.id)); }
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
               user:users(id,username,avatar,location),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar,location))`)
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
        <div class="prf-cover" onclick="viewProfilePhoto('${escHtml(profile.cover||'')}','cover','${escHtml(profile.username||'')}')" style="cursor:${profile.cover ? 'pointer' : 'default'}">
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
          <div class="prf-avatar-wrap" onclick="viewProfilePhoto('${escHtml(profile.avatar||`https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(profile.id)}`)}','avatar','${escHtml(profile.username||'')}')" style="cursor:pointer">
            <div class="prf-avatar-ring"></div>
            <img class="prf-avatar" src="${escHtml(profile.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(profile.id)}`)}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(profile.id)}'" alt="">
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
    // Check which posts we've liked and repaint
    const allIds = allPosts.map(p => p.id).filter(Boolean);
    if (allIds.length) checkLikedPosts(allIds);

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
      miniIdentity.style.opacity       = visible ? '0' : '1';
      miniIdentity.style.pointerEvents = visible ? 'none' : 'auto';

      // Check current follow state to decide which button to show
      const nowFollowing = mainFollowBtn?.classList.contains('prf-btn-following');
      if (nowFollowing) {
        // Show Message, hide Follow
        miniFollow.style.display         = 'none';
        miniFollow.style.opacity         = '0';
        miniFollow.style.pointerEvents   = 'none';
        if (miniMsgBtn) {
          miniMsgBtn.style.display       = visible ? 'none' : 'flex';
          miniMsgBtn.style.opacity       = visible ? '0' : '1';
          miniMsgBtn.style.pointerEvents = visible ? 'none' : 'auto';
        }
      } else {
        // Show Follow, hide Message
        miniFollow.style.display         = 'block';
        miniFollow.style.opacity         = visible ? '0' : '1';
        miniFollow.style.pointerEvents   = visible ? 'none' : 'auto';
        if (miniMsgBtn) {
          miniMsgBtn.style.display       = 'none';
          miniMsgBtn.style.opacity       = '0';
          miniMsgBtn.style.pointerEvents = 'none';
        }
      }
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

  // Update follower count on any suggestion card for this user
  document.querySelectorAll(`.prf-suggest-card[data-uid="${userId}"] .prf-suggest-followers`).forEach(el => {
    el.textContent = fmtNum(data.followers || 0) + ' followers';
  });

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
  feedLoading = true; // set synchronously — prevents concurrent calls

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
    // Deduplicate before render
    const uniquePosts = [];
    const seenIds = new Set();
    for (const p of posts || []) {
      if (!seenIds.has(p.id)) { seenIds.add(p.id); uniquePosts.push(p); }
    }
    renderFeedPosts(list, uniquePosts, PER_PAGE);
  } finally {
    feedLoading = false;
  }
}

// ── EXPLORE / FOR YOU FEED ── more like X For You (2025 style)
async function loadExploreFeed(list, PER_PAGE) {
  try {
    const SELECT = `id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
      user:users(id,username,avatar,location),
      reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar)),
      comments(count)`;

    // ── Time windows ────────────────────────────────────────
    const NOW               = new Date();
    const MAX_AGE_DAYS      = 7;                    // X shows older viral content
    const HIGH_VELOCITY_HRS = 36;                   // very recent → strong boost
    const MEDIUM_VELOCITY_HRS = 96;                 // still "hot" up to ~4 days

    const MAX_AGE_MS        = MAX_AGE_DAYS * 86400000;
    const HIGH_VEL_MS       = HIGH_VELOCITY_HRS * 3600000;
    const MED_VEL_MS        = MEDIUM_VELOCITY_HRS * 3600000;

    const HIGH_VEL_CUTOFF   = new Date(NOW - HIGH_VEL_MS).toISOString();
    const MED_VEL_CUTOFF    = new Date(NOW - MED_VEL_MS).toISOString();
    const MAX_AGE_CUTOFF    = new Date(NOW - MAX_AGE_MS).toISOString();

    // ── Get social graph ────────────────────────────────────
    let followingIds = [];
    let userCountry  = null;

    if (currentUser) {
      const { data: fl } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', currentUser.id);
      followingIds = fl?.map(r => r.following_id) || [];

      if (currentProfile?.location) {
        const parts = currentProfile.location.split(',');
        userCountry = parts[parts.length - 1]?.trim() || null;
      }
    }

    // ── Friends-of-friends (small graph boost) ──────────────
    let fofIds = [];
    if (followingIds.length > 0) {
      const { data: fof } = await supabase
        .from('follows')
        .select('following_id')
        .in('follower_id', followingIds)
        .not('following_id', 'in', `(${[currentUser?.id, ...followingIds].filter(Boolean).join(',') || 'null'})`)
        .limit(80);
      fofIds = [...new Set(fof?.map(r => r.following_id) || [])];
    }

    // ── Parallel fetches ────────────────────────────────────
    const [
      followingPosts,       // people you follow
      fofPosts,             // friends of friends
      trendingHighVelocity, // very hot right now
      trendingMedium,       // still hot last ~4 days
      localPostsRaw,        // same country
      generalFresh,         // general recent content
    ] = await Promise.all([

      // 1. Following (strongest signal)
      followingIds.length > 0
        ? supabase.from('posts').select(SELECT)
            .in('user_id', followingIds)
            .gte('created_at', MAX_AGE_CUTOFF)
            .order('created_at', { ascending: false })
            .limit(30)
        : { data: [] },

      // 2. Friends-of-friends (social proof)
      fofIds.length > 0
        ? supabase.from('posts').select(SELECT)
            .in('user_id', fofIds)
            .gte('created_at', MAX_AGE_CUTOFF)
            .order('created_at', { ascending: false })
            .limit(25)
        : { data: [] },

      // 3. Very high velocity (last 36 h)
      supabase.from('posts').select(SELECT)
        .gte('created_at', HIGH_VEL_CUTOFF)
        .order('like_count', { ascending: false })
        .limit(12),

      // 4. Medium velocity (last ~4 days)
      supabase.from('posts').select(SELECT)
        .gte('created_at', MED_VEL_CUTOFF)
        .lt('created_at', HIGH_VEL_CUTOFF)
        .order('like_count', { ascending: false })
        .limit(15),

      // 5. Location-based (same country)
      userCountry
        ? supabase.from('posts').select(SELECT)
            .gte('created_at', MAX_AGE_CUTOFF)
            .order('created_at', { ascending: false })
            .limit(60)
        : { data: [] },

      // 6. General recent content (discovery / cold-start filler)
      supabase.from('posts').select(SELECT)
        .gte('created_at', MAX_AGE_CUTOFF)
        .order('created_at', { ascending: false })
        .limit(40),
    ]);

    // Filter local posts client-side
    const localPosts = (localPostsRaw?.data || []).filter(p =>
      p.user?.location && p.user.location.includes(userCountry)
    ).slice(0, 12);

    // ── Scoring function ────────────────────────────────────
    const nowMs = Date.now();

    function scorePost(p) {
      const ageMs     = nowMs - new Date(p.created_at).getTime();
      const ageHours  = ageMs / 3600000;

      // Recency decay — very sharp after 48h, slower after
      let recency = 1;
      if (ageHours > 48) {
        recency = Math.max(0.15, 1 - (ageHours - 48) / 120); // floor at 15% after ~1 week
      }

      // Engagement score — likes + reposts
      const engagement = (p.like_count || 0) + (p.repost_count || 0) * 1.6;

      // Velocity bonus — very recent high-engagement gets huge boost
      let velocityBonus = 0;
      if (ageMs < HIGH_VEL_MS) {
        velocityBonus = Math.min(80, engagement * 2.5);
      } else if (ageMs < MED_VEL_MS) {
        velocityBonus = Math.min(45, engagement * 1.2);
      }

      // Social graph multipliers
      let graphBonus = 0;
      if (followingIds.includes(p.user_id))          graphBonus += 100;   // huge boost
      else if (fofIds.includes(p.user_id))           graphBonus += 45;    // good boost
      else if (localPosts.some(lp => lp.id === p.id)) graphBonus += 18;   // mild local preference

      // Media bonus (social commerce tilt)
      const hasMedia = !!(p.image || p.video);
      const mediaBonus = hasMedia ? 12 : 0;

      // Final score
      return (recency * 100) + graphBonus + velocityBonus + engagement * 0.8 + mediaBonus;
    }

    // ── Build pool ──────────────────────────────────────────
    const pool = new Map(); // post.id → {post, score}

    const add = (posts, sourceBoost = 0) => {
      (posts || []).forEach(p => {
        if (loadedPostIds.has(p.id)) return;
        const s = scorePost(p) + sourceBoost;
        if (!pool.has(p.id) || s > pool.get(p.id).score) {
          pool.set(p.id, { post: p, score: s });
        }
      });
    };

    add(followingPosts?.data, 80);       // strongest source
    add(fofPosts?.data, 35);
    add(trendingHighVelocity?.data, 60);
    add(trendingMedium?.data, 25);
    add(localPosts, 18);
    add(generalFresh?.data, 0);

    // ── Rank & paginate ─────────────────────────────────────
    let ranked = Array.from(pool.values())
      .sort((a, b) => b.score - a.score)
      .map(v => v.post);

    // Final deduplication safety
    const seen = new Set();
    ranked = ranked.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    const page = ranked.slice(feedOffset, feedOffset + PER_PAGE);

    if (page.length === 0) {
      feedExhausted = true;
      if (feedOffset === 0) {
        list.innerHTML = `<div class="empty-state"><div class="empty-icon">🌙</div><p>Nothing new right now</p><span>Follow more people or post something!</span></div>`;
      }
      return;
    }

    renderFeedPosts(list, page, PER_PAGE);

  } catch (err) {
    console.error('Explore feed error:', err);
    if (feedOffset === 0) {
      list.innerHTML = `<div class="empty-state"><p style="color:var(--red)">Couldn't load explore feed</p><small>${err.message}</small></div>`;
    }
  } finally {
    feedLoading = false;
  }
}


function renderFeedPosts(list, posts, PER_PAGE) {
  if (!posts || !posts.length) {
    feedExhausted = true;
    if (feedOffset === 0) list.innerHTML = `<div class="empty-state"><div class="empty-icon">🌙</div><p>Nothing here yet</p><span>Be the first to post!</span></div>`;
    return;
  }

  if (feedOffset === 0) list.innerHTML = '';

  let blocked = 0;
  for (const p of posts) {
    if (loadedPostIds.has(p.id)) {
      blocked++;
      continue; // already rendered — skip
    }
    loadedPostIds.add(p.id);
    const el = createFeedPost(p);
    if (el) {
      list.appendChild(el); // DOM exists — seed immediately after
      observePost(el);
      LikeStore.seed(p.id, p.like_count || 0, likedPosts.has(p.id));
    }
  }

  feedOffset += posts.length;
  if (posts.length < PER_PAGE) feedExhausted = true;

  const ids = [...loadedPostIds];
  checkLikedPosts(ids);
  checkRepostedPosts(ids);
  checkSavedPosts(ids);
  reObserveAllFeedPosts();

  // moment rings removed from feed
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
  // NOTE: do NOT seed LikeStore here — the DOM element doesn't exist yet.
  // Seeding happens in renderPrfPosts / feed loader AFTER appendChild.

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
    ? linkifyText(text.slice(0, textLimit).trimEnd()) + `...<br><span class="reer">see more</span>`
    : linkifyText(text);

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
    // Detect URL in post — hide raw URL, show preview card in place of image
    const postUrl    = extractFirstUrl(text);
    const textWithoutUrl = postUrl ? text.replace(postUrl, '').trim() : text;
    const hasMedia   = !!(p.image || p.video);

    // Build text display — strip URL from visible text if no other media
    const cleanText  = (!hasMedia && postUrl) ? textWithoutUrl : text;
    const cleanLimit = (hasMedia || (!hasMedia && postUrl)) ? 150 : 300;
    const cleanTrunc = cleanText.length > cleanLimit;
    const cleanDisplay = cleanTrunc
      ? linkifyText(cleanText.slice(0, cleanLimit).trimEnd()) + `...<br><span class="reer">see more</span>`
      : linkifyText(cleanText);

    // URL preview placeholder — only when no real image/video
    const urlPreviewHtml = (!hasMedia && postUrl)
      ? `<div class="post-og-wrap">
           <div class="post-og-shimmer">
             <div class="post-og-shimmer-img"></div>
             <div class="post-og-shimmer-body"><div></div><div></div></div>
           </div>
         </div>`
      : '';

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

      ${urlPreviewHtml}

      ${cleanDisplay || cleanText ? `<div class="tir"><p class="tired">${cleanDisplay}</p></div>` : ''}
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
                <path class="heart-path" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
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
  // Store post ID on element — read from DOM not closure to prevent stale ID bug
  el.dataset.postId = p.id;

  // Fetch OG preview AFTER innerHTML is set — so el.querySelector works
  if (!p.image && !p.video && !isRepost) {
    const postUrl = extractFirstUrl(p.content || '');
    if (postUrl) {
      const wrap = el.querySelector('.post-og-wrap');
      if (wrap) {
        fetchOgPreview(postUrl).then(og => {
          if (!el.isConnected) return;
          const w = el.querySelector('.post-og-wrap');
          if (!w) return;
          if (!og) { w.remove(); return; }
          w.innerHTML = buildPostOgCard(og, postUrl);
        }).catch(() => {
          const w = el.querySelector('.post-og-wrap');
          if (w) w.remove();
        });
      }
    }
  }

  el.addEventListener('click', e => {
    // ── Avatar/author FIRST — before anything else ──
    if (e.target.closest('.post-avatar-link') || e.target.closest('.post-author-link')) {
      e.stopPropagation();
      return;
    }

    if (el.dataset.blockNavigation === 'true') return;

    // Always read post ID from the DOM element, never from closure
    const postId = el.dataset.postId;

    // Log EVERY click on ANY post
    if (!postId) return;

    if (e.target.closest('.dots')) {
      showPostMenu(p, el, e.target.closest('.dots'));
      return;
    }
    if (e.target.closest('.heart-ai')) {
      toggleLike(postId, e.target.closest('.heart-ai'));
      return;
    }
    if (e.target.closest('.repost-btn')) {
      handleRepost(postId, e.target.closest('.repost-btn'), p.user_id);
      return;
    }
    if (e.target.closest('.comment-btn')) {
      openDetail(postId, true);
      return;
    }
    if (e.target.closest('.share-action')) {
      sharePost(p);
      return;
    }
    if (e.target.closest('.save-btn')) {
      toggleSave(postId, e.target.closest('.save-btn'));
      return;
    }
    if (e.target.closest('.reer')) {
      const tired = e.target.closest('.tired');
      if (tired) { tired.innerHTML = escHtml(text); e.stopPropagation(); return; }
    }
    // Block navigation for any interactive element
    if (e.target.closest('.mention-link')) {
      e.stopPropagation();
      handleMentionTap(e.target.closest('.mention-link').dataset.username);
      return;
    }
    if (e.target.closest('.post-author-link'))  return;
    if (e.target.closest('.post-link'))         return;
    if (e.target.closest('a'))                  return;
    if (e.target.closest('input, textarea, button, select')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.target.closest('.comment-bar'))       return;
    if (e.target.closest('.view-original') || e.target.closest('.quote-card')) {
      openDetail(e.target.closest('[data-original-id]')?.dataset.originalId || orig?.id);
      return;
    }
    openDetail(postId);
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

  // NOTE: LikeStore.seed/_paint is called by the caller AFTER appendChild
  // so the element is in the document when _paint queries for it.

  // Long-press for post menu
  let lpTimer;
  el.addEventListener('touchstart', e => {
    if (e.target.closest('.heart-ai, .repost-btn, .comment-btn, .donate-btn, .save-btn, .dots, .post-avatar-link, .post-author-link, .post-link, .mention-link, input, textarea, button, a')) return;
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
      touch-action: manipulation;
    }
    .poster:hover { background-color: rgb(250,250,250); }

    .cust-name {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      position: relative;
      z-index: 5;
    }
    .post-avatar-link {
      flex-shrink: 0; text-decoration: none;
      position: relative; z-index: 10;
      display: block;
      -webkit-tap-highlight-color: transparent;
    }
    .small-photo { pointer-events: none; }
    /* Avatar ring wrap */
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
    .post-meta { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
    .post-location { font-size: 11px; color: var(--text3); display:flex; align-items:center; gap:2px; }
    .post-author-link { display: flex; align-items: center; gap: 4px; text-decoration: none; cursor: pointer; width: fit-content; }
    .post-author-link:hover .jerry { text-decoration: none; }
    .jerry { font-weight: 600; font-size: 15px; font-family: 'Roboto', -apple-system, sans-serif; color: var(--text); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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

    .laptop1 { max-width: 100%; margin-top: 10px; padding: 0; overflow: hidden; border-radius: 14px; background: #f4f3f0; max-height: 400px; display: flex; align-items: center; justify-content: center; }
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

    .comment-btn { display: flex; width: 55px; align-items: center; gap: 10px; cursor: pointer; font-size: 15px; font-family: 'Roboto', -apple-system, sans-serif; color: #000000; }
    .comment-btn:hover { color: var(--text); }

    .repost-btn { display: flex; width: 55px; align-items: center; gap: 10px; cursor: pointer; font-size: 15px; font-family: 'Roboto', -apple-system, sans-serif; color: #000000; }
    .repost-btn:hover { color: var(--text); }
    .repost-icon { transition: stroke 0.2s ease; }
    .repost-btn.reposted .repost-icon { stroke: #6C47FF; stroke-width: 2.5; }
    .repost-btn.reposted span { color: #6C47FF; font-weight: 600; }

    .heart-ai { width: 55px; gap: 10px; display: flex; align-items: center; cursor: pointer; }
    .heart-clickable { cursor: pointer; }
    .heart-icon { transition: all 0.3s ease; }
    .heart-path { fill: none; stroke: #000000; transition: fill 0.2s ease, stroke 0.2s ease; }
    .heart-ai[data-liked="true"] .heart-path { fill: rgb(244,7,82); stroke: rgb(244,7,82); }
    .prf-masonry-like[data-liked="true"] .heart-path { fill: rgb(244,7,82); stroke: rgb(244,7,82); }
    .cb-like-btn[data-liked="true"] .cb-heart-path { fill: rgb(244,7,82); stroke: rgb(244,7,82); }
    .like-count { font-size: 14px; font-family: 'Roboto', -apple-system, sans-serif; color: #000000; font-weight: 400; transition: color 0.15s, font-weight 0.15s; }
    .like-count.liked { color: rgb(244,7,82); font-weight: 600; }
    .like-count:empty { display: none; }

    @keyframes heartLike {
      0%   { transform: scale(1); }
      40%  { transform: scale(1.5); }
      70%  { transform: scale(1.2); }
      100% { transform: scale(1); }
    }
    @keyframes heartUnlike {
      0%   { transform: scale(1); }
      35%  { transform: scale(0.65); }
      70%  { transform: scale(1.1); }
      100% { transform: scale(1); }
    }
    .heart-anim-like   { animation: heartLike   0.35s cubic-bezier(0.34,1.56,0.64,1) forwards; }
    .heart-anim-unlike { animation: heartUnlike 0.3s  cubic-bezier(0.34,1.56,0.64,1) forwards; }

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

// ── Debug: find duplicate TOP-LEVEL post elements within feed-list ──
function debugFindDuplicatePosts() {
  const feedList = document.getElementById('feed-list');
  if (!feedList) return;
  // Only check direct .poster children — not child elements that also have data-post-id
  const all = feedList.querySelectorAll(':scope > .poster[data-post-id]');
  const seen = {};
  let dupes = 0;
  all.forEach(el => {
    const id = el.dataset.postId;
    if (!id) return;
    if (seen[id]) {
      dupes++;
      console.error('[DUPLICATE IN FEED]', id,
        'owner1:', seen[id].querySelector('.jerry')?.textContent,
        'owner2:', el.querySelector('.jerry')?.textContent
      );
    }
    seen[id] = el;
  });
  if (dupes === 0) console.log('[NO DUPLICATES IN FEED] Feed is clean');
  else console.warn('[FOUND ' + dupes + ' REAL DUPLICATE(S) IN FEED]');
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

// ══════════════════════════════════════════
// LIKE STORE — single source of truth
// Never reads count or state from the DOM.
// All surfaces read from this store only.
// ══════════════════════════════════════════

const LikeStore = (() => {
  // postId → { count: number, liked: boolean }
  const _db      = new Map();
  // postId → debounce timer
  const _timers  = new Map();
  // postId → bool (request in-flight)
  const _flying  = new Map();
  const RED      = 'rgb(244,7,82)';
  const GREY     = '#000000';

  // ── Called once per post when it's loaded from DB ─────────
  function seed(postId, count, liked) {
    if (_db.has(postId)) {
      // Already in store — update count+liked only if no tap is pending
      if (!_timers.has(postId) && !_flying.get(postId)) {
        const s = _db.get(postId);
        s.count = Math.max(0, count || 0);
        s.liked = !!liked;
        _paint(postId); // always repaint so DOM reflects fresh DB values
      }
      return;
    }
    _db.set(postId, { count: Math.max(0, count || 0), liked: !!liked });
    // Paint immediately so heart/count render correctly from first render
    _paint(postId);
  }

  // ── Check if a post has been seeded (without creating a default) ──
  function _has(postId) { return _db.has(postId); }

  // ── Check if a tap is pending or in-flight for this post ──
  function _pending(postId) { return _timers.has(postId) || !!_flying.get(postId); }

  // ── Get state. Only creates a default if not seeded yet ───
  // Use _has() first if you don't want auto-creation.
  function get(postId) {
    if (!_db.has(postId)) _db.set(postId, { count: 0, liked: likedPosts.has(postId) });
    return _db.get(postId);
  }

  // ── Main toggle — called by any like button anywhere ──────
  function toggle(postId) {
    if (!currentUser) { showToast('Sign in to like'); return; }

    const s      = get(postId);
    s.liked      = !s.liked;
    s.count      = s.liked ? s.count + 1 : Math.max(0, s.count - 1);

    // Keep global Set in sync (other parts of app read it)
    if (s.liked) likedPosts.add(postId); else likedPosts.delete(postId);

    // Paint every surface instantly
    _paint(postId);

    // Animate hearts
    document.querySelectorAll(`.heart-ai[data-post-id="${postId}"] svg`).forEach(svg => animateHeart(svg, s.liked));
    const cbBtn = document.getElementById('cb-like-btn');
    if (cbBtn?.dataset.postId === postId) animateHeart(cbBtn.querySelector('svg'), s.liked);

    // Debounce: collapse rapid taps into one DB call
    if (_timers.has(postId)) clearTimeout(_timers.get(postId));
    const snap = { liked: s.liked, count: s.count };
    _timers.set(postId, setTimeout(() => {
      _timers.delete(postId);
      _commit(postId, snap.liked, snap.count);
    }, 350));
  }

  // ── Paint every DOM surface for this post ─────────────────
  function _paint(postId) {
    const s       = get(postId);
    const liked   = s.liked;
    const countTx = s.count > 0 ? fmtNum(s.count) : '';

    // 1. Feed + explore cards (.heart-ai)
    document.querySelectorAll(`.heart-ai[data-post-id="${postId}"]`).forEach(c => {
      c.dataset.liked = liked ? 'true' : 'false';
      const path = c.querySelector('.heart-path');
      if (path) { path.setAttribute('fill', liked ? RED : 'none'); path.setAttribute('stroke', liked ? RED : GREY); }
      const cnt = c.querySelector('.like-count');
      if (cnt) { cnt.textContent = countTx; cnt.classList.toggle('liked', liked); }
    });

    // 2. Detail comment-bar heart
    const cbBtn = document.getElementById('cb-like-btn');
    if (cbBtn?.dataset.postId === postId) {
      cbBtn.dataset.liked = liked ? 'true' : 'false';
      cbBtn.classList.toggle('cb-liked', liked);
      const cbPath = cbBtn.querySelector('.cb-heart-path');
      if (cbPath) { cbPath.setAttribute('fill', liked ? RED : 'none'); cbPath.setAttribute('stroke', liked ? RED : 'currentColor'); }
      const cbCnt = document.getElementById('cb-like-count');
      if (cbCnt) { cbCnt.textContent = countTx; cbCnt.classList.toggle('liked', liked); }
    }

    // 3. Detail stat bar (large number above actions)
    if (typeof detailPostId !== 'undefined' && detailPostId === postId) {
      const stat = document.querySelector('.detail-stat-n[data-type="likes"]');
      if (stat) stat.textContent = fmtNum(s.count);
    }

    // 4. Profile masonry tiles
    document.querySelectorAll(`.prf-masonry-like[data-post-id="${postId}"]`).forEach(btn => {
      btn.classList.toggle('liked', liked);
      btn.dataset.liked = liked ? 'true' : 'false';
      const mc = btn.querySelector('.prf-masonry-like-count');
      if (mc) mc.textContent = countTx;
    });
  }

  // ── Commit to Supabase with retry ─────────────────────────
  async function _commit(postId, liked, optimisticCount, attempt = 0) {
    if (_flying.get(postId)) {
      setTimeout(() => _commit(postId, liked, optimisticCount, attempt), 400);
      return;
    }
    _flying.set(postId, true);
    try {
      if (liked) {
        const { error } = await supabase.from('likes').insert({ post_id: postId, user_id: currentUser.id });
        if (error && error.code !== '23505') throw error;
        // Fire-and-forget notification
        supabase.from('posts').select('user_id').eq('id', postId).single().then(({ data: post }) => {
          if (post?.user_id && post.user_id !== currentUser.id)
            insertNotification({ user_id: post.user_id, actor_id: currentUser.id, post_id: postId, type: 'like' });
        });
      } else {
        await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', currentUser.id);
      }
      _flying.set(postId, false);

      // Reconcile with server — only apply if no tap is pending
      if (!_timers.has(postId)) {
        const { data } = await supabase.from('posts').select('like_count').eq('id', postId).single();
        if (data && !_timers.has(postId)) {
          const s = get(postId);
          // Only accept server count if liked state still matches what we committed
          if (s.liked === liked) {
            s.count = Math.max(0, data.like_count);
            _paint(postId);
          }
        }
      }
    } catch(e) {
      _flying.set(postId, false);
      if (attempt < 3) {
        // Exponential backoff: 1s, 2s, 4s
        setTimeout(() => _commit(postId, liked, optimisticCount, attempt + 1), 1000 * Math.pow(2, attempt));
      } else {
        // All retries failed — revert to pre-tap state
        const s    = get(postId);
        s.liked    = !liked;
        s.count    = Math.max(0, optimisticCount + (liked ? -1 : 1));
        if (s.liked) likedPosts.add(postId); else likedPosts.delete(postId);
        _paint(postId);
        showToast('Like failed — check your connection');
      }
    }
  }

  // ── External: force-sync a server count (e.g. realtime) ───
  function serverSync(postId, serverCount) {
    if (_timers.has(postId) || _flying.get(postId)) return; // tap in progress — ignore
    const s = get(postId);
    s.count = Math.max(0, serverCount);
    _paint(postId);
  }

  return { seed, get, toggle, serverSync, _paint, _has, _pending };
})();

// ── Entry points called from every surface ─────────────────
function toggleLike(postId, _btn)       { LikeStore.toggle(postId); }
function toggleMasonryLike(btn, postId) { LikeStore.toggle(postId); }
function syncLikeCount(postId, count)   { LikeStore.serverSync(postId, count); }

// Kept for backwards compat (checkLikedPosts calls this)
function setLikeUI(postId, liked, count) {
  const s = LikeStore.get(postId);
  if (liked !== null && liked !== undefined) s.liked = !!liked;
  if (count !== null && count !== undefined) s.count = Math.max(0, count);
  LikeStore._paint(postId);
}

async function checkLikedPosts(postIds) {
  if (!currentUser || !postIds.length) return;
  const { data } = await supabase.from('likes').select('post_id').eq('user_id', currentUser.id).in('post_id', postIds);
  const liked = new Set((data || []).map(r => r.post_id));
  postIds.forEach(id => {
    // Update global set
    liked.has(id) ? likedPosts.add(id) : likedPosts.delete(id);
    // Only update the store if the entry already exists (seeded at render time)
    // Never create a new entry here — count would be wrong (0)
    if (LikeStore._has(id)) {
      const s = LikeStore.get(id);
      // Don't overwrite if user has a tap in progress
      if (!LikeStore._pending(id)) {
        s.liked = liked.has(id);
        LikeStore._paint(id);
      }
    }
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


// ── Universal heart animation ──────────────
function animateHeart(svg, toLike) {
  if (!svg) return;
  svg.style.transition = 'none';
  svg.style.transform = 'scale(1)';
  void svg.offsetWidth; // force reflow
  if (toLike) {
    svg.style.transition = 'transform 0.12s ease-out';
    svg.style.transform = 'scale(1.5)';
    setTimeout(() => {
      svg.style.transition = 'transform 0.1s ease-in';
      svg.style.transform = 'scale(0.88)';
      setTimeout(() => {
        svg.style.transition = 'transform 0.08s ease-out';
        svg.style.transform = 'scale(1)';
      }, 100);
    }, 120);
  } else {
    svg.style.transition = 'transform 0.1s ease-in';
    svg.style.transform = 'scale(0.65)';
    setTimeout(() => {
      svg.style.transition = 'transform 0.15s cubic-bezier(0.34,1.56,0.64,1)';
      svg.style.transform = 'scale(1)';
    }, 100);
  }
}

// ── REPOSTS ────────────────────────────────

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
    if (span) span.classList.toggle('reposted', reposted);
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


// ═══════════════════════════════════════════════════════════════
// MISTYNOTE COMPOSER v2 — Complete Rebuild
// Drop-in replacement. Find the old composer block in app.js
// (from "// ═══ COMPOSER — World-Class Redesign" to the end of
//  "function prependPostToFeed") and replace with this entire file.
// ═══════════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────────
const _c = {
  file: null,         // selected File object
  preview: null,      // object URL for preview
  repostId: null,     // post id being quoted
  repostBtn: null,    // the repost button el
  busy: false,        // upload in progress
};

// ── Open ───────────────────────────────────────────────────────
function openComposer() {
  if (!currentUser) { showToast('Sign in to post'); return; }
  if (document.getElementById('mn-composer')) return;

  const el = document.createElement('div');
  el.id = 'mn-composer';
  el.innerHTML = `
    <div class="mnc-scrim" id="mnc-scrim"></div>
    <div class="mnc-sheet" id="mnc-sheet">
      <div class="mnc-pill"></div>

      <div class="mnc-topbar">
        <button class="mnc-x" id="mnc-x" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
        <button class="mnc-post-btn" id="mnc-post-btn" disabled>Post</button>
      </div>

      <div class="mnc-body" id="mnc-body">
        <textarea
          class="mnc-textarea"
          id="mnc-textarea"
          placeholder="What's happening?"
          maxlength="280"
          autocomplete="off"
          autocorrect="on"
          spellcheck="true"
        ></textarea>

        <div class="mnc-media-wrap" id="mnc-media-wrap" style="display:none">
          <img  id="mnc-img"   class="mnc-preview-img" style="display:none" alt="">
          <video id="mnc-vid"  class="mnc-preview-vid" controls playsinline style="display:none"></video>
          <button class="mnc-remove-media" id="mnc-remove-media" aria-label="Remove">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div class="mnc-quote-wrap" id="mnc-quote-wrap" style="display:none">
          <div class="mnc-quote-bar"></div>
          <div class="mnc-quote-body">
            <span class="mnc-quote-who" id="mnc-quote-who"></span>
            <p class="mnc-quote-text" id="mnc-quote-text"></p>
          </div>
          <button class="mnc-remove-quote" id="mnc-remove-quote" aria-label="Remove quote">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="mnc-footer" id="mnc-footer">
        <div class="mnc-tools">
          <button class="mnc-tool" id="mnc-attach" aria-label="Photo / Video">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="1.8">
              <rect x="3" y="3" width="18" height="18" rx="3"/>
              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/>
              <path d="M21 15l-5-5L5 21" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="mnc-tool" id="mnc-emoji-btn" aria-label="Emoji">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="1.8">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 14s1.5 2 4 2 4-2 4-2" stroke-linecap="round"/>
              <circle cx="9" cy="9.5" r="1.2" fill="currentColor" stroke="none"/>
              <circle cx="15" cy="9.5" r="1.2" fill="currentColor" stroke="none"/>
            </svg>
          </button>
        </div>
        <div class="mnc-ring-wrap">
          <svg class="mnc-ring-svg" viewBox="0 0 32 32">
            <circle class="mnc-ring-bg" cx="16" cy="16" r="12" fill="none" stroke-width="2.5"/>
            <circle class="mnc-ring-fill" id="mnc-ring" cx="16" cy="16" r="12" fill="none"
              stroke-width="2.5" stroke-dasharray="75.4" stroke-dashoffset="75.4"
              stroke-linecap="round" transform="rotate(-90 16 16)"/>
          </svg>
          <span class="mnc-char-num" id="mnc-char-num"></span>
        </div>
      </div>

      <div class="mnc-emoji-tray" id="mnc-emoji-tray" style="display:none"></div>
    </div>
  `;

  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';

  // Animate in
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.classList.add('mnc-open');
  }));

  _cWire(el);

  setTimeout(() => {
    const ta = document.getElementById('mnc-textarea');
    if (ta) { ta.focus(); _cAutoGrow(ta); }
    if (_c.repostId) _cLoadQuote(_c.repostId);
    _cSync();
  }, 60);
}

// ── Wire all events ────────────────────────────────────────────
function _cWire(root) {
  const ta      = root.querySelector('#mnc-textarea');
  const postBtn = root.querySelector('#mnc-post-btn');
  const scrim   = root.querySelector('#mnc-scrim');
  const xBtn    = root.querySelector('#mnc-x');
  const attach  = root.querySelector('#mnc-attach');
  const emojiB  = root.querySelector('#mnc-emoji-btn');
  const rmMedia = root.querySelector('#mnc-remove-media');
  const rmQuote = root.querySelector('#mnc-remove-quote');
  const footer  = root.querySelector('#mnc-footer');
  const sheet   = root.querySelector('#mnc-sheet');
  const pill    = root.querySelector('.mnc-pill');

  // Textarea — the most critical event
  ta.addEventListener('input', () => {
    _cAutoGrow(ta);
    _cUpdateRing(ta.value.length);
    _cSync();
  });
  ta.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') _cSubmit();
  });

  // Buttons
  postBtn.addEventListener('click', _cSubmit);
  scrim.addEventListener('click', closeComposer);
  xBtn.addEventListener('click', closeComposer);
  attach.addEventListener('click', _cPickFile);
  emojiB.addEventListener('click', _cToggleEmoji);
  rmMedia.addEventListener('click', _cRemoveMedia);
  rmQuote.addEventListener('click', _cRemoveQuote);

  // Keyboard push (visual viewport)
  if (window.visualViewport) {
    const onVP = () => {
      const offset = window.innerHeight - window.visualViewport.height;
      footer.style.transform = `translateY(-${Math.max(0, offset)}px)`;
    };
    window.visualViewport.addEventListener('resize', onVP);
    window.visualViewport.addEventListener('scroll', onVP);
    root._vpClean = () => {
      window.visualViewport.removeEventListener('resize', onVP);
      window.visualViewport.removeEventListener('scroll', onVP);
    };
  }

  // Drag-to-dismiss on the pill / topbar
  let sy = 0, dragging = false;
  const startDrag = e => {
    sy = (e.touches ? e.touches[0] : e).clientY;
    dragging = false;
    sheet.style.transition = 'none';
  };
  const moveDrag = e => {
    const dy = (e.touches ? e.touches[0] : e).clientY - sy;
    if (dy < 0) return;
    dragging = true;
    sheet.style.transform = `translateY(${Math.min(dy * 0.6, 220)}px)`;
    root.querySelector('.mnc-scrim').style.opacity = String(Math.max(0, 1 - dy / 300));
    if (e.cancelable) e.preventDefault();
  };
  const endDrag = e => {
    sheet.style.transition = '';
    const dy = (e.changedTouches ? e.changedTouches[0] : e).clientY - sy;
    if (dragging && dy > 110) { closeComposer(); }
    else { sheet.style.transform = ''; root.querySelector('.mnc-scrim').style.opacity = ''; }
    dragging = false;
  };

  [pill, root.querySelector('.mnc-topbar')].forEach(el => {
    el.addEventListener('touchstart', startDrag, { passive: true });
    el.addEventListener('touchmove', moveDrag, { passive: false });
    el.addEventListener('touchend', endDrag, { passive: true });
  });
}

// ── File picker — bulletproof ──────────────────────────────────
function _cPickFile() {
  // Remove any stale input
  const old = document.getElementById('mnc-file-input');
  if (old) old.remove();

  const inp = document.createElement('input');
  inp.id = 'mnc-file-input';
  inp.type = 'file';
  inp.accept = 'image/*,video/*';
  // NO capture attribute — always gallery
  Object.assign(inp.style, {
    position: 'fixed', top: '0', left: '0',
    width: '1px', height: '1px',
    opacity: '0', pointerEvents: 'none', zIndex: '-1'
  });
  document.body.appendChild(inp);

  inp.addEventListener('change', async () => {
    const file = inp.files[0];
    inp.remove();
    if (!file) return;
    await _cHandleFile(file);
  });

  // Focus composer textarea first to keep keyboard from hiding, then trigger
  setTimeout(() => inp.click(), 10);
}

async function _cHandleFile(file) {
  const isImg = file.type.startsWith('image/');
  const isVid = file.type.startsWith('video/');
  if (!isImg && !isVid) { showToast('Please select an image or video'); return; }

  const maxMB = isVid ? 100 : 20;
  if (file.size > maxMB * 1024 * 1024) {
    showToast(`Max ${maxMB}MB for ${isVid ? 'videos' : 'images'}`);
    return;
  }

  // Revoke old preview URL
  if (_c.preview) URL.revokeObjectURL(_c.preview);

  _c.file = file;
  _c.preview = URL.createObjectURL(file);

  const wrap = document.getElementById('mnc-media-wrap');
  const img  = document.getElementById('mnc-img');
  const vid  = document.getElementById('mnc-vid');

  img.style.display = 'none';
  vid.style.display = 'none';

  if (isImg) {
    img.src = _c.preview;
    img.style.display = 'block';
  } else {
    vid.src = _c.preview;
    vid.style.display = 'block';
  }

  wrap.style.display = 'block';

  // Scroll body down so preview is visible
  setTimeout(() => {
    const body = document.getElementById('mnc-body');
    if (body) body.scrollTop = body.scrollHeight;
  }, 80);

  _cSync();
}

function _cRemoveMedia() {
  if (_c.preview) { URL.revokeObjectURL(_c.preview); _c.preview = null; }
  _c.file = null;

  const wrap = document.getElementById('mnc-media-wrap');
  const img  = document.getElementById('mnc-img');
  const vid  = document.getElementById('mnc-vid');
  if (wrap) wrap.style.display = 'none';
  if (img)  { img.src = ''; img.style.display = 'none'; }
  if (vid)  { vid.src = ''; vid.style.display = 'none'; }

  document.getElementById('mnc-textarea')?.focus();
  _cSync();
}

// ── Quote / repost ─────────────────────────────────────────────
async function _cLoadQuote(postId) {
  try {
    const { data } = await supabase.from('posts')
      .select('id,content,user:users(id,username)')
      .eq('id', postId).single();
    if (!data) return;

    const wrap = document.getElementById('mnc-quote-wrap');
    const who  = document.getElementById('mnc-quote-who');
    const text = document.getElementById('mnc-quote-text');
    if (!wrap) return;

    who.textContent  = '@' + (data.user?.username || 'user');
    text.textContent = (data.content || '').slice(0, 120) + (data.content?.length > 120 ? '…' : '');
    wrap.style.display = 'flex';
    _cSync();
  } catch (e) { /* silent */ }
}

function _cRemoveQuote() {
  _c.repostId  = null;
  _c.repostBtn = null;
  repostTargetId  = null;
  repostTargetBtn = null;
  const wrap = document.getElementById('mnc-quote-wrap');
  if (wrap) wrap.style.display = 'none';
  _cSync();
}

// ── Emoji tray ─────────────────────────────────────────────────
const _EMOJIS = [
  '😀','😂','🥹','😍','🥰','😎','🤩','🥳','😭','😤',
  '🔥','❤️','💯','✨','🎉','🙏','👏','🫶','💪','💀',
  '🤝','👀','💬','🫠','😮','🤔','💅','🫡','⚡','🌟',
  '🇳🇬','🎵','🍕','🍔','⚽','🏆','💰','📱','🛍️','😩'
];

function _cToggleEmoji() {
  const tray = document.getElementById('mnc-emoji-tray');
  if (!tray) return;

  if (tray.style.display === 'none') {
    // Build grid once
    if (!tray.children.length) {
      _EMOJIS.forEach(em => {
        const b = document.createElement('button');
        b.className = 'mnc-emoji';
        b.textContent = em;
        b.type = 'button';
        b.addEventListener('mousedown', e => e.preventDefault());
        b.addEventListener('click', () => {
          const ta = document.getElementById('mnc-textarea');
          if (!ta) return;
          const s = ta.selectionStart ?? ta.value.length;
          const e2 = ta.selectionEnd ?? ta.value.length;
          ta.value = ta.value.slice(0, s) + em + ta.value.slice(e2);
          ta.setSelectionRange(s + em.length, s + em.length);
          ta.focus();
          ta.dispatchEvent(new Event('input'));
        });
        tray.appendChild(b);
      });
    }
    tray.style.display = 'grid';
    // Click outside to close
    setTimeout(() => {
      const close = e => {
        if (!tray.contains(e.target) && e.target.id !== 'mnc-emoji-btn') {
          tray.style.display = 'none';
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 50);
  } else {
    tray.style.display = 'none';
  }
}

// ── Ring + sync ────────────────────────────────────────────────
function _cUpdateRing(len) {
  const MAX = 280;
  const ring    = document.getElementById('mnc-ring');
  const numEl   = document.getElementById('mnc-char-num');
  if (!ring || !numEl) return;

  const pct    = Math.min(1, len / MAX);
  const circ   = 75.4;
  ring.style.strokeDashoffset = String(circ * (1 - pct));

  const rem = MAX - len;
  if (rem <= 30) {
    numEl.textContent = String(rem);
    numEl.style.display = '';
    ring.style.stroke = rem < 0 ? '#ff3b5c' : rem <= 10 ? '#ff3b5c' : '#f59e0b';
    numEl.style.color = ring.style.stroke;
  } else {
    numEl.textContent = '';
    numEl.style.display = 'none';
    ring.style.stroke = '#6C47FF';
  }

  ring.style.opacity = len > 0 ? '1' : '0';
}

function _cSync() {
  const ta  = document.getElementById('mnc-textarea');
  const btn = document.getElementById('mnc-post-btn');
  if (!ta || !btn) return;

  const hasText   = ta.value.trim().length > 0;
  const hasMedia  = !!_c.file;
  const hasQuote  = !!_c.repostId;
  const underLimit = ta.value.length <= 280;
  const ok = (hasText || hasMedia || hasQuote) && underLimit;

  btn.disabled = !ok;
  btn.classList.toggle('mnc-post-ready', ok);
}

function _cAutoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 260) + 'px';
}

// ── Submit ─────────────────────────────────────────────────────
async function _cSubmit() {
  const ta = document.getElementById('mnc-textarea');
  if (!ta || _c.busy || !currentUser) return;

  const text = ta.value.trim();
  if (!text && !_c.file && !_c.repostId) return;
  if (text.length > 280) return;

  _c.busy = true;
  const btn = document.getElementById('mnc-post-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="mnc-spinner"></span>';
  }

  try {
    let imageUrl = null;
    let videoUrl = null;

    if (_c.file) {
      const isVid = _c.file.type.startsWith('video/');
      console.log(`[MistyNote] uploading ${isVid ? 'video' : 'image'}:`, _c.file.name, _c.file.type);

      if (isVid) {
        // Video: upload raw to avatars bucket under posts/ subfolder
        const rawExt = (_c.file.name || '').split('.').pop().toLowerCase();
        const safeExt = (rawExt && rawExt.length >= 2 && rawExt.length <= 5) ? rawExt : 'mp4';
        const path = `${currentUser.id}/post_${Date.now()}.${safeExt}`;
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(path, _c.file, { upsert: true, contentType: _c.file.type || 'video/mp4', cacheControl: '3600' });
        if (upErr) throw new Error('Video upload failed: ' + upErr.message);
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
        videoUrl = urlData.publicUrl;
        console.log('[MistyNote] ✅ video uploaded:', videoUrl);
      } else {
        // Compress via canvas using the preview img element directly —
        // no new object URLs, no FileReader, works on all mobile browsers
        const path = `${currentUser.id}/post_${Date.now()}.jpg`;
        console.log('[MistyNote] compressing via canvas...');

        const blob = await new Promise((resolve, reject) => {
          // Grab the already-rendered img element in the composer preview
          const previewImg = document.getElementById('mnc-img');
          if (!previewImg || !previewImg.complete || !previewImg.naturalWidth) {
            reject(new Error('Preview image not ready')); return;
          }
          const maxPx = 1200;
          const scale = Math.min(1, maxPx / Math.max(previewImg.naturalWidth, previewImg.naturalHeight));
          const w = Math.max(1, Math.round(previewImg.naturalWidth * scale));
          const h = Math.max(1, Math.round(previewImg.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('No canvas context')); return; }
          ctx.drawImage(previewImg, 0, 0, w, h);
          canvas.toBlob(
            b => b ? resolve(b) : reject(new Error('canvas.toBlob returned null')),
            'image/jpeg', 0.82
          );
        });

        console.log('[MistyNote] compressed to', (blob.size/1024).toFixed(0)+'KB, uploading...');
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
        if (upErr) {
          console.error('[MistyNote] ❌ upload error:', upErr.statusCode, upErr.message);
          throw new Error('Upload failed: ' + upErr.message);
        }
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
        imageUrl = urlData.publicUrl;
        console.log('[MistyNote] ✅ uploaded:', imageUrl);
      }
    }

    // STEP 4: Insert post row
    console.log('[upload] inserting post...', { imageUrl, videoUrl });
    const { data: post, error: postErr } = await supabase
      .from('posts')
      .insert({
        user_id:          currentUser.id,
        content:          text || null,
        image:            imageUrl,
        video:            videoUrl,
        reposted_post_id: _c.repostId || null,
      })
      .select(`id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
               user:users(id,username,avatar,location),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar,location))`)
      .single();

    if (postErr) {
      console.error('[upload] DB insert failed:', postErr);
      throw new Error('DB error: ' + (postErr.message || postErr.code || 'unknown'));
    }

    console.log('[upload] post ok, id:', post.id);

    if (btn) {
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
      btn.style.background = '#00b87a';
    }

    if (_c.repostId) {
      repostedPosts.set(_c.repostId, post.id);
      setRepostUI(_c.repostId, true);
      setTimeout(() => syncRepostCount(_c.repostId), 1200);
    }

    if (text) {
      const mentions = text.match(/@([a-zA-Z0-9_]+)/g);
      if (mentions) {
        const names = [...new Set(mentions.map(m => m.slice(1).toLowerCase()))];
        supabase.from('users').select('id,username').in('username', names).then(({ data: users }) => {
          (users || []).forEach(u => {
            if (u.id !== currentUser.id) {
              insertNotification({ user_id: u.id, actor_id: currentUser.id, post_id: post.id, type: 'mention' });
            }
          });
        });
      }
    }

    setTimeout(() => { closeComposer(); prependPostToFeed(post); showToast('Posted ✓'); }, 380);

  } catch (err) {
    console.error('[composer] FINAL ERROR:', err);
    console.error('[MistyNote] 💥 POST ERROR:', err?.message, err);
    showToast('Post failed: ' + (err?.message || 'unknown error'), 4000);
    if (btn) { btn.disabled = false; btn.textContent = 'Post'; btn.classList.add('mnc-post-ready'); }
  } finally {
    _c.busy = false;
  }
}

// ── Compress using existing preview URL (avoids double object-URL on Android) ──
function _cCompressFromPreview(file, existingPreviewUrl, maxPx) {
  return new Promise((resolve, reject) => {
    // If we already have a valid preview URL, reuse it — don't create another
    const useUrl = existingPreviewUrl || URL.createObjectURL(file);
    const createdNew = !existingPreviewUrl;

    const img = new Image();

    img.onerror = () => {
      // Only revoke if WE created it
      if (createdNew) URL.revokeObjectURL(useUrl);
      // Fallback: try direct FileReader approach
      console.warn('[compress] img.onerror on preview URL, trying FileReader fallback');
      _cCompressViaFileReader(file, maxPx).then(resolve).catch(reject);
    };

    img.onload = () => {
      try {
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas not supported')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          blob => blob ? resolve(blob) : reject(new Error('toBlob returned null')),
          'image/jpeg', 0.85
        );
      } catch (err) {
        reject(err);
      }
    };

    img.src = useUrl;
  });
}

// ── FileReader fallback for stubborn Android WebViews ──────────
function _cCompressViaFileReader(file, maxPx) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image load failed even via FileReader'));
      img.onload = () => {
        try {
          const scale = Math.min(1, maxPx / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('No canvas context')); return; }
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(
            blob => blob ? resolve(blob) : reject(new Error('toBlob null')),
            'image/jpeg', 0.85
          );
        } catch (err) { reject(err); }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Image compression ──────────────────────────────────────────
function _cCompress(file, maxPx) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load fail')); };
    img.onload  = () => {
      URL.revokeObjectURL(url);
      let { naturalWidth: w, naturalHeight: h } = img;
      if (w > maxPx || h > maxPx) {
        if (w >= h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else        { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('no ctx')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob fail')), 'image/jpeg', 0.85);
    };
    img.src = url;
  });
}

// ── Close ──────────────────────────────────────────────────────
function closeComposer() {
  const root = document.getElementById('mn-composer');
  if (!root) return;

  if (root._vpClean) root._vpClean();

  root.classList.remove('mnc-open');

  // Revoke preview blob
  if (_c.preview) { URL.revokeObjectURL(_c.preview); _c.preview = null; }

  setTimeout(() => {
    root.remove();
    document.body.style.overflow = '';
    _c.busy = false;
    _c.file = null;
    _c.repostId  = null;
    _c.repostBtn = null;
    repostTargetId  = null;
    repostTargetBtn = null;
  }, 340);
}

// ── Repost handler (called from feed) ─────────────────────────
function handleRepost(postId, btn, postUserId) {
  if (!currentUser) { showToast('Sign in to repost'); return; }
  if (postUserId === currentUser.id) { showToast("Can't repost your own post"); return; }

  if (btn?.dataset.reposted === 'true') {
    showActionSheet([{ label: 'Undo Repost', icon: '🔄', action: () => undoRepost(postId, btn) }]);
    return;
  }

  _c.repostId  = postId;
  _c.repostBtn = btn;
  repostTargetId  = postId;
  repostTargetBtn = btn;
  openComposer();
}

// ── Feed prepend ───────────────────────────────────────────────
function prependPostToFeed(newPost) {
  if (!newPost) return;
  const adapted = { ...newPost, comments: [{ count: 0 }] };
  const el = createFeedPost(adapted);
  const list = document.getElementById('feed-list');
  if (!list || !el) return;

  list.querySelector('.empty-state')?.remove();
  feedExhausted = false;

  list.prepend(el);
  loadedPostIds.add(newPost.id);
  LikeStore.seed(newPost.id, 0, false);
  el.classList.add('fade-up');
  observePost(el);

  if (newPost.reposted_post_id) {
    repostedPosts.set(newPost.reposted_post_id, newPost.id);
    setRepostUI(newPost.reposted_post_id, true);
    setTimeout(() => syncRepostCount(newPost.reposted_post_id), 1200);
    supabase.from('posts').select('user_id').eq('id', newPost.reposted_post_id).single()
      .then(({ data: orig }) => {
        if (orig?.user_id && orig.user_id !== currentUser.id) {
          insertNotification({ user_id: orig.user_id, actor_id: currentUser.id, post_id: newPost.reposted_post_id, type: 'repost' });
        }
      });
  }

  if (document.getElementById('page-profile')?.classList.contains('active')) {
    renderMyProfile();
  }

  if (newPost.content) {
    const mentions = newPost.content.match(/@([a-zA-Z0-9_]+)/g);
    if (mentions) {
      const names = [...new Set(mentions.map(m => m.slice(1).toLowerCase()))];
      supabase.from('users').select('id,username').in('username', names).then(({ data: users }) => {
        (users || []).forEach(u => {
          if (u.id !== currentUser.id) {
            insertNotification({ user_id: u.id, actor_id: currentUser.id, post_id: newPost.id, type: 'mention' });
          }
        });
      });
    }
  }
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
      .dp-location {
        font-size: 12px; color: var(--text3);
        display: flex; align-items: center; gap: 3px;
        margin-top: 2px;
      }
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
      .cb-like-count { font-size: 14px; font-weight: 400; color: #000000; transition: color 0.25s, font-weight 0.25s; }
      .cb-action-btn.cb-liked { color: rgb(244,7,82); }
      .cb-action-btn.cb-liked .cb-heart-path { fill: rgb(244,7,82); stroke: rgb(244,7,82); }
      .cb-action-btn.cb-liked .cb-like-count { color: rgb(244,7,82); font-weight: 600; }
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
      .select(`id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
               user:users(id,username,avatar,location),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar,location))`)
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
    } else if (p.content) {
      // URL preview — same as feed
      const dpUrl = extractFirstUrl(p.content);
      if (dpUrl) {
        mediaHtml = `<div class="post-og-wrap" id="dp-og-${p.id}">
          <div class="post-og-shimmer">
            <div class="post-og-shimmer-img"></div>
            <div class="post-og-shimmer-body"><div></div><div></div></div>
          </div>
        </div>`;
        fetchOgPreview(dpUrl).then(og => {
          const wrap = document.getElementById(`dp-og-${p.id}`);
          if (!wrap) return;
          if (!og) { wrap.remove(); return; }
          wrap.innerHTML = buildPostOgCard(og, dpUrl);
        }).catch(() => document.getElementById(`dp-og-${p.id}`)?.remove());
      }
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
            ${user.location ? `<div class="dp-location"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>${escHtml(user.location)}</div>` : ''}
          </div>
          ${!isOwn
            ? `<button class="dp-follow-btn ${isFollowingAuthor ? 'prf-btn-following' : ''}" id="dp-follow-${postId}" onclick="toggleDetailFollow(this,'${p.user_id}')">${isFollowingAuthor ? 'Following' : 'Follow'}</button>`
            : ''}
        </div>

        <!-- TEXT — strip bare URL if it's the whole post or has no media -->
        ${p.content ? (() => {
          const dpUrl = extractFirstUrl(p.content);
          const dpClean = (!p.image && !p.video && dpUrl) ? p.content.replace(dpUrl, '').trim() : p.content;
          return dpClean ? `<p class="dp-text">${linkifyText(dpClean)}</p>` : '';
        })() : ''}

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
    const commentInput = document.getElementById('comment-input');
    commentInput.placeholder = `Reply to ${user.username}...`;
    // Reset and re-wire mention autocomplete each time detail opens
    commentInput._mentionWired = false;
    wireMentionInput(commentInput, postId);

    // Comment bar — wire like button
    const cbLike = document.getElementById('cb-like-btn');
    if (cbLike) {
      // Seed store with real DB values — this is the authoritative count source
      LikeStore.seed(postId, p.like_count || 0, isLiked);
      cbLike.dataset.postId = postId;
      cbLike.onclick = () => LikeStore.toggle(postId);
      // Paint all surfaces from store
      LikeStore._paint(postId);
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

// ══════════════════════════════════════════
// MENTION AUTOCOMPLETE
// ══════════════════════════════════════════

let mentionDebounceTimer = null;
let mentionActiveInput   = null; // which textarea is being typed in
let mentionPostId        = null; // for comment priority

function insertMentionInComposer() {
  // Try new composer textarea first, fall back to old id if somehow present
  const input = document.getElementById('cmp-textarea') || document.getElementById('composer-textarea');
  if (!input) return;
  const pos = input.selectionStart;
  input.value = input.value.slice(0, pos) + '@' + input.value.slice(pos);
  input.setSelectionRange(pos + 1, pos + 1);
  input.focus();
  input.dispatchEvent(new Event('input'));
}

function insertMention() {
  // Called by @ button — insert @ and trigger tray
  const input = document.getElementById('comment-input');
  if (!input) return;
  const pos = input.selectionStart;
  input.value = input.value.slice(0, pos) + '@' + input.value.slice(pos);
  input.setSelectionRange(pos + 1, pos + 1);
  input.focus();
  input.dispatchEvent(new Event('input'));
}

// Wire mention autocomplete to a textarea
function wireMentionInput(inputEl, postId = null) {
  if (!inputEl || inputEl._mentionWired) return;
  inputEl._mentionWired = true;

  inputEl.addEventListener('input', () => {
    mentionActiveInput = inputEl;
    mentionPostId = postId;
    clearTimeout(mentionDebounceTimer);
    const trigger = getMentionTrigger(inputEl);
    if (!trigger || trigger.query.length < 1) {
      hideMentionTray();
      return;
    }
    mentionDebounceTimer = setTimeout(() => fetchMentionSuggestions(trigger.query, inputEl), 180);
  });

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideMentionTray();
  });

  inputEl.addEventListener('blur', () => {
    // Delay so tap on tray item registers first
    setTimeout(hideMentionTray, 200);
  });
}

// Get current @query from cursor position
function getMentionTrigger(input) {
  const val = input.value;
  const pos = input.selectionStart;
  const before = val.slice(0, pos);
  const match = before.match(/@([a-zA-Z0-9_]*)$/);
  if (!match) return null;
  return { query: match[1], start: pos - match[0].length };
}

// Fetch users matching query with priority order
async function fetchMentionSuggestions(query, inputEl) {
  if (!query && query !== '') return;

  const tray = document.getElementById('mention-tray');
  const list = document.getElementById('mention-tray-list');
  if (!tray || !list) return;

  // Show tray with loading state
  list.innerHTML = '<div class="mention-loading">Searching…</div>';
  positionMentionTray(inputEl);
  tray.classList.remove('hidden');

  try {
    const results = [];
    const seen = new Set();

    const add = (users) => {
      (users || []).forEach(u => {
        if (!seen.has(u.id)) { seen.add(u.id); results.push(u); }
      });
    };

    // Priority 1 — commenters on this post (comment context only)
    if (mentionPostId && query.length >= 1) {
      const { data: commenters } = await supabase
        .from('comments')
        .select('user:users(id,username,avatar,followers)')
        .eq('post_id', mentionPostId)
        .limit(30);
      const commentUsers = (commenters || [])
        .map(c => c.user).filter(Boolean)
        .filter(u => u.username?.toLowerCase().startsWith(query.toLowerCase()));
      add(commentUsers);
    }

    // Priority 2 — people I follow
    if (currentUser && query.length >= 1) {
      const { data: following } = await supabase
        .from('follows')
        .select('user:users!following_id(id,username,avatar,followers)')
        .eq('follower_id', currentUser.id)
        .limit(50);
      const followUsers = (following || [])
        .map(f => f.user).filter(Boolean)
        .filter(u => u.username?.toLowerCase().startsWith(query.toLowerCase()));
      add(followUsers);
    }

    // Priority 3 — platform search (only if 2+ chars)
    if (query.length >= 2 && results.length < 6) {
      const { data: platformUsers } = await supabase
        .from('users')
        .select('id,username,avatar,followers')
        .ilike('username', query + '%')
        .order('followers', { ascending: false })
        .limit(6);
      add(platformUsers || []);
    }

    const top = results.slice(0, 6);

    if (!top.length) {
      list.innerHTML = '<div class="mention-empty">No users found</div>';
      return;
    }

    list.innerHTML = '';
    top.forEach(user => {
      const item = document.createElement('div');
      item.className = 'mention-item';
      item.innerHTML = `
        <img class="mention-av" src="${escHtml(user.avatar||'')}" onerror="this.style.background='var(--bg3)';this.removeAttribute('src')" alt="">
        <div class="mention-info">
          <span class="mention-username">@${escHtml(user.username)}</span>
          <span class="mention-followers">${fmtNum(user.followers||0)} followers</span>
        </div>`;
      item.onmousedown = item.ontouchstart = (e) => {
        e.preventDefault();
        completeMention(user.username, inputEl);
      };
      list.appendChild(item);
    });

    positionMentionTray(inputEl);

  } catch(err) {
    list.innerHTML = '<div class="mention-empty">Could not load</div>';
  }
}

function positionMentionTray(inputEl) {
  const tray = document.getElementById('mention-tray');
  if (!tray || !inputEl) return;
  const rect = inputEl.getBoundingClientRect();
  // Position just above the input
  tray.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
  tray.style.left   = '0';
  tray.style.right  = '0';
}

function completeMention(username, inputEl) {
  if (!inputEl) return;
  const trigger = getMentionTrigger(inputEl);
  if (!trigger) return;
  const before = inputEl.value.slice(0, trigger.start);
  const after  = inputEl.value.slice(inputEl.selectionStart);
  const insert = '@' + username + ' ';
  inputEl.value = before + insert + after;
  const newPos = before.length + insert.length;
  inputEl.setSelectionRange(newPos, newPos);
  inputEl.focus();
  inputEl.dispatchEvent(new Event('input'));
  hideMentionTray();
}

function hideMentionTray() {
  const tray = document.getElementById('mention-tray');
  if (tray) tray.classList.add('hidden');
  mentionActiveInput = null;
}

// Wire mention to composer textarea
function wireMentionToComposer() {
  const textarea = document.getElementById('cmp-textarea') || document.getElementById('composer-textarea');
  if (textarea) wireMentionInput(textarea, null);
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

// ── Detect MistyNote profile URL ──
function extractMistyNoteProfile(text) {
  const match = text.match(/https?:\/\/mistynote\.pages\.dev\/profile\/([a-zA-Z0-9_]+)/);
  return match ? match[1] : null;
}

// ── Build compact comment link preview (external URLs only) ──
// MistyNote profile URLs are handled inline by linkifyText as @mentions
async function buildCommentLinkPreview(text) {
  const url = extractFirstUrl(text);
  if (!url || url.includes('mistynote.pages.dev')) return null;

  const og = await fetchOgPreview(url).catch(() => null);
  if (!og) return null;

  const card = document.createElement('div');
  card.className = 'comment-link-card';
  card.onclick = (e) => { e.stopPropagation(); window.open(url, '_blank'); };
  card.innerHTML = `
    ${og.image ? `<img class="comment-link-img" src="${escHtml(og.image)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
    <div class="comment-link-body">
      <div class="comment-link-domain">${escHtml(og.siteName || og.domain || '')}</div>
      <div class="comment-link-title">${escHtml((og.title || '').slice(0, 80))}</div>
    </div>`;
  return card;
}

// ── Strip URLs from comment text for display ──
// linkifyText handles @mentions and profile URLs inline,
// so we only need to strip external URLs that have a separate preview card
function commentDisplayText(text) {
  // Profile URLs are converted to @mentions by linkifyText — no strip needed
  // Only strip external non-mistynote URLs (they get a card below)
  const url = extractFirstUrl(text);
  if (url && !url.includes('mistynote.pages.dev')) {
    return text.replace(url, '').trim();
  }
  return text;
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
      ${c.content ? `<p class="comment-text">${linkifyText(commentDisplayText(c.content))}</p>` : ''}
      <div class="comment-link-preview-wrap" id="clp-${c.id}"></div>
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

  // Trigger link preview for URLs in comment
  if (c.content && extractFirstUrl(c.content)) {
    const previewWrap = wrap.querySelector(`[id="clp-${c.id}"]`);
    if (previewWrap) {
      buildCommentLinkPreview(c.content).then(previewEl => {
        if (!previewEl || !previewWrap.isConnected) return;
        previewWrap.appendChild(previewEl);
      });
    }
  }

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
      // Notify post owner
      supabase.from('posts').select('user_id').eq('id', postId).single().then(({ data: post }) => {
        if (post && post.user_id !== currentUser.id) {
          insertNotification({ user_id: post.user_id, actor_id: currentUser.id, post_id: postId, type: 'comment', comment_text: content });
        }
      });
    } else {
      // Reply — notify parent comment author
      supabase.from('comments').select('user_id').eq('id', parentId).single().then(({ data: parent }) => {
        if (parent && parent.user_id !== currentUser.id) {
          insertNotification({ user_id: parent.user_id, actor_id: currentUser.id, post_id: postId, type: 'comment', comment_text: content });
        }
      });
    }

    // Mention notifications — scan for @username in content
    const mentionMatches = content.match(/@([a-zA-Z0-9_]+)/g);
    if (mentionMatches) {
      const mentioned = [...new Set(mentionMatches.map(m => m.slice(1).toLowerCase()))];
      supabase.from('users').select('id,username').in('username', mentioned).then(({ data: users }) => {
        (users || []).forEach(u => {
          if (u.id !== currentUser.id) {
            insertNotification({ user_id: u.id, actor_id: currentUser.id, post_id: postId, type: 'mention', comment_text: content });
          }
        });
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
  animateHeart(btn?.querySelector('svg'), btn?.dataset.liked !== 'true');
  const sp = btn.querySelector('span');
  const cnt = parseInt(sp?.textContent || '0') || 0;
  if (sp) sp.textContent = newLiked ? cnt + 1 : Math.max(0, cnt - 1) || '';

  if (newLiked) {
    supabase.from('comment_likes').insert({ comment_id: commentId, user_id: currentUser.id }).then(({ error }) => {
      if (!error) {
        supabase.rpc('increment_comment_like', { cid: commentId, delta: 1 });
        // Notify comment author
        supabase.from('comments').select('user_id, post_id').eq('id', commentId).single().then(({ data: cmt }) => {
          if (cmt && cmt.user_id !== currentUser.id) {
            insertNotification({ user_id: cmt.user_id, actor_id: currentUser.id, post_id: cmt.post_id, type: 'like_comment' });
          }
        });
      }
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
    .select(`id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
             user:users(id,username,avatar),
             reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar)),
             comments(count)`)
    .order('like_count', { ascending: false })
    .limit(20);

  grid.innerHTML = '';

  if (!posts?.length) {
    grid.innerHTML = '<p class="disc-no-results"><strong>Nothing yet</strong>Posts will appear here as people share</p>';
    return;
  }

  (posts || []).forEach(p => {
    const el = createFeedPost(p, false);
    if (el) {
      el.classList.add('fade-in');
      grid.appendChild(el);
      observePost(el);
      LikeStore.seed(p.id, p.like_count || 0, likedPosts.has(p.id));
    }
  });

  const ids = posts.map(p => p.id);
  checkLikedPosts(ids);
  checkRepostedPosts(ids);
  checkSavedPosts(ids);
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
    .select(`id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
             user:users(id,username,avatar),
             reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar)),
             comments(count)`)
    .ilike('content', `%${q}%`)
    .order('like_count', { ascending: false })
    .limit(30);

  if (!data?.length) {
    pane.innerHTML = `<div class="disc-no-results"><strong>No posts found</strong>Try different words or check spelling</div>`;
    return;
  }

  pane.innerHTML = '';
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:10px 0';

  data.forEach(p => {
    const el = createFeedPost(p, false);
    if (el) { list.appendChild(el); LikeStore.seed(p.id, p.like_count || 0, likedPosts.has(p.id)); }
  });

  pane.appendChild(list);

  const ids = data.map(p => p.id);
  checkLikedPosts(ids);
  checkRepostedPosts(ids);
  checkSavedPosts(ids);
}

// ── People results ──
async function discFetchPeople(q, pane) {
  const { data } = await supabase
    .from('users')
    .select('id,username,avatar,bio,followers')
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
    row.addEventListener('click', () => showUserProfile(u.id));
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
    const { error: fe } = await supabase.from('follows').insert({ follower_id: currentUser.id, following_id: uid });
    if (!fe) {
      btn.classList.add('following');
      btn.textContent = 'Following';
      if (uid !== currentUser.id) {
        insertNotification({ user_id: uid, actor_id: currentUser.id, post_id: null, type: 'follow' });
      }
    }
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
// PROFILE SUGGESTIONS
// ══════════════════════════════════════════

// ── Dismiss a suggestion box for the session ──
function dismissSuggestBox(boxId) {
  const box = document.getElementById(boxId);
  if (box) {
    box.style.transition = 'opacity 0.2s, max-height 0.3s';
    box.style.opacity = '0';
    box.style.maxHeight = '0';
    box.style.overflow = 'hidden';
    setTimeout(() => box.style.display = 'none', 300);
  }
  sessionStorage.setItem('dismissed_' + boxId, '1');
}

// ── Build a suggestion user card ──
function buildSuggestCard(user, isFollowing) {
  const card = document.createElement('div');
  card.className = 'prf-suggest-card';
  card.dataset.uid = user.id;
  card.innerHTML = `
    <div class="prf-suggest-av-wrap" onclick="showUserProfile('${user.id}')">
      <img class="prf-suggest-av" src="${user.avatar||''}" onerror="this.style.background='var(--bg3)';this.removeAttribute('src')" alt="">
    </div>
    <div class="prf-suggest-name" onclick="showUserProfile('${user.id}')">${escHtml(user.username||'')}</div>
    <div class="prf-suggest-followers">${fmtNum(user.followers||user.follower_count||0)} followers</div>
    <button class="prf-suggest-follow-btn ${isFollowing ? 'following' : ''}"
      data-uid="${user.id}"
      onclick="suggestFollow(this,'${user.id}')">
      ${isFollowing ? 'Following' : 'Follow'}
    </button>`;
  return card;
}

async function suggestFollow(btn, uid) {
  if (!currentUser) return;
  const isFollowing = btn.classList.contains('following');
  btn.disabled = true;

  // Optimistic UI — update button instantly
  btn.classList.toggle('following', !isFollowing);
  btn.textContent = isFollowing ? 'Follow' : 'Following';

  // Optimistic — update the follower count on the card instantly
  const card = btn.closest('.prf-suggest-card');
  const followerEl = card?.querySelector('.prf-suggest-followers');
  if (followerEl) {
    const current = parseInt(followerEl.textContent.replace(/[^0-9]/g, '')) || 0;
    const newCount = isFollowing ? Math.max(0, current - 1) : current + 1;
    followerEl.textContent = fmtNum(newCount) + ' followers';
  }

  // Optimistic — update my Following count in my profile stats instantly
  const myFollowingEl = document.querySelector('#prf-following-count');
  if (myFollowingEl) {
    const current = parseInt(myFollowingEl.textContent.replace(/[^0-9]/g, '')) || 0;
    const newCount = isFollowing ? Math.max(0, current - 1) : current + 1;
    myFollowingEl.textContent = fmtNum(newCount);
    if (currentProfile) currentProfile.following = newCount;
  }

  if (isFollowing) {
    const { error } = await supabase.from('follows').delete()
      .eq('follower_id', currentUser.id).eq('following_id', uid);
    if (error) {
      // Revert on failure
      btn.classList.add('following'); btn.textContent = 'Following';
      if (followerEl) followerEl.textContent = fmtNum((parseInt(followerEl.textContent)||0)+1) + ' followers';
    }
  } else {
    const { error } = await supabase.from('follows').insert({ follower_id: currentUser.id, following_id: uid });
    if (error) {
      // Revert on failure
      btn.classList.remove('following'); btn.textContent = 'Follow';
      if (followerEl) followerEl.textContent = fmtNum(Math.max(0,(parseInt(followerEl.textContent)||0)-1)) + ' followers';
    }
  }

  btn.disabled = false;

  // Confirm real counts from DB after action (non-blocking)
  setTimeout(() => refreshFollowCounts(uid), 500);
}

// ── Load "People you might vibe with" on own profile ──
async function loadSuggestedForMe() {
  if (!currentUser) return;
  const boxId = 'prf-suggest-own';
  if (sessionStorage.getItem('dismissed_' + boxId)) return;

  const box  = document.getElementById(boxId);
  const list = document.getElementById('prf-suggest-own-list');
  if (!box || !list) return;

  // Get who I already follow
  const { data: following } = await supabase
    .from('follows').select('following_id').eq('follower_id', currentUser.id);
  const followingIds = (following || []).map(r => r.following_id);
  const excludeIds   = [...followingIds, currentUser.id];

  // Fetch a batch of users then filter client-side — avoids .not('id','in') syntax issues
  const { data: allUsers, error } = await supabase
    .from('users')
    .select('id,username,avatar,followers,location')
    .neq('id', currentUser.id)
    .order('followers', { ascending: false })
    .limit(50);

  if (error) console.error('Suggest error:', error.message);

  const users = (allUsers || []).filter(u => !excludeIds.includes(u.id)).slice(0, 10);

  if (!users.length) return;

  list.innerHTML = '';
  users.forEach(u => list.appendChild(buildSuggestCard(u, false)));
  box.style.display = '';
}

// ── Load "People who follow @X also follow" on other profile ──
async function renderSuggestedForOtherProfile(userId, username) {
  if (!currentUser) return;
  const boxId = `prf-suggest-other-${userId}`;
  if (sessionStorage.getItem('dismissed_' + boxId)) return;

  // Find existing box or create it
  let box = document.getElementById(boxId);
  if (!box) {
    // Insert after prf-btn-row in user profile body
    const body = document.getElementById('user-profile-body');
    if (!body) return;
    const tabBar = body.querySelector('.prf-icon-tabs');
    if (!tabBar) return;

    box = document.createElement('div');
    box.className = 'prf-suggest-box';
    box.id = boxId;
    box.innerHTML = `
      <div class="prf-suggest-header">
        <span class="prf-suggest-title">People who follow ${escHtml(username)} also follow</span>
        <button class="prf-suggest-close" onclick="dismissSuggestBox('${boxId}')" aria-label="Dismiss">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="prf-suggest-scroll" id="${boxId}-list">
        <div style="padding:20px;text-align:center;color:var(--text3)">Loading…</div>
      </div>`;
    tabBar.parentNode.insertBefore(box, tabBar);

    // Animate in
    box.style.opacity = '0';
    box.style.maxHeight = '0';
    box.style.overflow = 'hidden';
    setTimeout(() => {
      box.style.transition = 'opacity 0.3s, max-height 0.4s';
      box.style.opacity = '1';
      box.style.maxHeight = '300px';
    }, 50);
  }

  const list = document.getElementById(`${boxId}-list`);
  if (!list) return;

  // Get who I already follow
  const { data: myFollowing } = await supabase
    .from('follows').select('following_id').eq('follower_id', currentUser.id);
  const myFollowingIds = new Set((myFollowing || []).map(r => r.following_id));
  myFollowingIds.add(currentUser.id);
  myFollowingIds.add(userId); // exclude the profile owner

  // Strategy: show who this user follows that I don't follow yet
  // More useful than their followers when there are few users
  const { data: theyFollow } = await supabase
    .from('follows').select('following_id').eq('follower_id', userId).limit(50);
  let candidates = (theyFollow || []).map(r => r.following_id).filter(id => !myFollowingIds.has(id));

  // Fallback: if they don't follow many people, show popular users I don't follow
  if (candidates.length < 3) {
    const { data: popular } = await supabase
      .from('users')
      .select('id')
      .neq('id', currentUser.id)
      .neq('id', userId)
      .order('followers', { ascending: false })
      .limit(30);
    const popularIds = (popular || []).map(r => r.id).filter(id => !myFollowingIds.has(id));
    candidates = [...new Set([...candidates, ...popularIds])];
  }

  if (!candidates.length) { box.style.display = 'none'; return; }

  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id,username,avatar,followers')
    .in('id', candidates.slice(0, 20))
    .order('followers', { ascending: false })
    .limit(8);

  if (uErr) console.error('Suggest other error:', uErr.message);
  if (!users?.length) {
    box.style.display = 'none';
    return;
  }

  list.innerHTML = '';
  users.forEach(u => list.appendChild(buildSuggestCard(u, myFollowingIds.has(u.id))));
  console.log('suggest: rendered', users.length, 'cards');
}
