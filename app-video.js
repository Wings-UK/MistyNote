/* ═══════════════════════════════════════════════════════════════
   MISTYNOTE — app-video.js  (full replacement)
   Full-screen video player
   Modes: video | video_product | live_commerce
   Requires: app-core.js, app-social.js
═══════════════════════════════════════════════════════════════ */

let _vp = {
  postId:       null,
  videoType:    null,
  liked:        false,
  likeCount:    0,
  bookmarked:   false,
  reposted:     false,
  repostCount:  0,
  postUserId:   null,
  postContent:  '',
  postUser:     null,
  floatTimer:   null,
};

/* ──────────────────────────────────────────────
   OPEN
────────────────────────────────────────────── */
async function openVideoPlayer(postId, videoType) {
  _vp.postId     = postId;
  _vp.videoType  = videoType || 'video';
  _vp.liked      = likedPosts.has(postId);
  _vp.bookmarked = savedPosts.has(postId);
  _vp.reposted   = repostedPosts.has(postId);
  _vp.likeCount  = 0;

  slideTo('video', async () => {
    _vpReset();

    const { data: p } = await supabase
      .from('posts')
      .select('id, content, video, like_count, comment_count, repost_count, user_id, user:users(id, username, avatar)')
      .eq('id', postId)
      .single();

    if (!p) { slideBack(); return; }

    const user       = p.user || {};
    _vp.likeCount    = p.like_count    || 0;
    _vp.repostCount  = p.repost_count  || 0;
    _vp.postUserId   = p.user_id;
    _vp.postContent  = p.content || '';
    _vp.postUser     = user;

    const vid = document.getElementById('vp-video');
    if (vid) { vid.src = p.video || ''; vid.muted = false; vid.play().catch(() => {}); }

    _vpStartProgress();

    const avEl   = document.getElementById('vp-creator-av');
    const nameEl = document.getElementById('vp-creator-name');
    if (avEl)   avEl.src = user.avatar || '';
    if (nameEl) nameEl.textContent = user.username || '';

    const capEl = document.getElementById('vp-caption');
    if (capEl)  capEl.textContent = p.content || '';

    _vpPaintLike();
    _vpPaintBookmark();
    _vpPaintRepost();

    const lc = document.getElementById('vp-like-count');
    const cc = document.getElementById('vp-comment-count');
    const rc = document.getElementById('vp-repost-count');
    if (lc) lc.textContent = _vp.likeCount    > 0 ? fmtNum(_vp.likeCount)   : '';
    if (cc) cc.textContent = p.comment_count  > 0 ? fmtNum(p.comment_count) : '';
    if (rc) rc.textContent = _vp.repostCount  > 0 ? fmtNum(_vp.repostCount) : '';

    _vpApplyMode(_vp.videoType);
    recordView(postId);
  });
}

/* ──────────────────────────────────────────────
   MODE
────────────────────────────────────────────── */
function _vpApplyMode(mode) {
  const liveBadge   = document.getElementById('vp-live-badge');
  const viewerCount = document.getElementById('vp-viewer-count');
  const bellBtn     = document.getElementById('vp-bell-btn');
  const productCard = document.getElementById('vp-product-card');
  const floatHearts = document.getElementById('vp-float-hearts');

  if (liveBadge)   liveBadge.style.display   = 'none';
  if (viewerCount) viewerCount.style.display  = 'none';
  if (bellBtn)     bellBtn.style.display      = 'none';
  if (productCard) productCard.style.display  = 'none';
  if (floatHearts) floatHearts.innerHTML      = '';

  if (mode === 'video_product') {
    if (productCard) productCard.style.display = 'flex';
  }

  if (mode === 'live_commerce') {
    if (liveBadge)   liveBadge.style.display   = 'inline-flex';
    if (bellBtn)     bellBtn.style.display      = 'flex';
    if (productCard) productCard.style.display  = 'flex';

    const count = Math.floor(Math.random() * 4800) + 200;
    if (viewerCount) {
      viewerCount.style.display = 'block';
      viewerCount.textContent   = fmtNum(count) + ' watching';
    }
    _vp.floatTimer = setInterval(_vpSpawnHeart, 2200);
    setTimeout(_vpSpawnHeart, 600);
  }
}

/* ──────────────────────────────────────────────
   FLOATING HEARTS (live)
────────────────────────────────────────────── */
function _vpSpawnHeart() {
  const container = document.getElementById('vp-float-hearts');
  if (!container) return;
  const emojis = ['❤️','🧡','💛','💜','🩷'];
  const em = document.createElement('div');
  em.className = 'vp-float-heart';
  em.textContent = emojis[Math.floor(Math.random() * emojis.length)];
  em.style.right = (8 + Math.random() * 20) + 'px';
  em.style.animationDuration = (2 + Math.random() * 1.2) + 's';
  container.appendChild(em);
  setTimeout(() => em.remove(), 3500);
}

/* ──────────────────────────────────────────────
   LIKE
────────────────────────────────────────────── */
function vpToggleLike() {
  if (!currentUser) { showToast('Sign in to love this'); return; }

  _vp.liked     = !_vp.liked;
  _vp.likeCount = _vp.liked ? _vp.likeCount + 1 : Math.max(0, _vp.likeCount - 1);
  _vpPaintLike();

  const svg = document.querySelector('#vp-like-btn .vp-heart-svg');
  if (svg) animateHeart(svg, _vp.liked);

  if (_vp.videoType === 'live_commerce') _vpSpawnHeart();

  LikeStore.toggle(_vp.postId);
}

function _vpPaintLike() {
  const btn  = document.getElementById('vp-like-btn');
  const path = document.querySelector('#vp-like-btn .vp-heart-path');
  const svg  = document.querySelector('#vp-like-btn .vp-heart-svg');
  const cnt  = document.getElementById('vp-like-count');
  const RED  = 'rgb(244,7,82)';

  if (btn)  btn.classList.toggle('liked', _vp.liked);
  if (path) {
    path.setAttribute('fill',   _vp.liked ? RED   : 'white');
    path.setAttribute('stroke', _vp.liked ? RED   : 'white');
  }
  if (svg) {
    svg.setAttribute('fill',   _vp.liked ? RED   : 'white');
    svg.setAttribute('stroke', _vp.liked ? RED   : 'white');
  }
  if (cnt) cnt.textContent = _vp.likeCount > 0 ? fmtNum(_vp.likeCount) : '';
}

/* ──────────────────────────────────────────────
   BOOKMARK
────────────────────────────────────────────── */
function vpToggleBookmark() {
  if (!currentUser) { showToast('Sign in to save this'); return; }

  const btn = document.getElementById('vp-bookmark-btn');
  const svg = btn?.querySelector('.vp-bookmark-svg');

  // Animate first
  if (svg) {
    svg.classList.remove('vp-bookmark-pop');
    void svg.offsetWidth;
    svg.classList.add('vp-bookmark-pop');
    svg.addEventListener('animationend', () => svg.classList.remove('vp-bookmark-pop'), { once: true });
  }

  // Delegate to the same toggleSave used everywhere else
  toggleSave(_vp.postId, btn);

  // Mirror state
  _vp.bookmarked = savedPosts.has(_vp.postId);
  _vpPaintBookmark();
}

function _vpPaintBookmark() {
  const btn  = document.getElementById('vp-bookmark-btn');
  const path = document.querySelector('#vp-bookmark-btn .vp-bookmark-path');
  const PURPLE = '#6C47FF';

  if (btn)  btn.classList.toggle('bookmarked', _vp.bookmarked);
  if (path) {
    path.setAttribute('fill',   _vp.bookmarked ? PURPLE : 'white');
    path.setAttribute('stroke', _vp.bookmarked ? PURPLE : 'white');
  }
}

/* ──────────────────────────────────────────────
   REPOST SHEET
────────────────────────────────────────────── */
async function vpOpenRepostSheet() {
  if (!currentUser) { showToast('Sign in to repost'); return; }
  if (_vp.postUserId === currentUser.id) { showToast("Can't repost your own post"); return; }

  // If already reposted — show undo option
  if (_vp.reposted) {
    showActionSheet([{
      label: 'Undo Repost',
      icon: '🔄',
      action: async () => {
        const fakeBtn = { dataset: { reposted: 'true' } };
        await undoRepost(_vp.postId, fakeBtn);
        _vp.reposted = false;
        _vp.repostCount = Math.max(0, _vp.repostCount - 1);
        _vpPaintRepost();
        const rc = document.getElementById('vp-repost-count');
        if (rc) rc.textContent = _vp.repostCount > 0 ? fmtNum(_vp.repostCount) : '';
      }
    }]);
    return;
  }

  // Build card preview
  const card = document.getElementById('vp-repost-card');
  if (card) {
    const user = _vp.postUser || {};
    const vid  = document.getElementById('vp-video');
    const thumbSrc = vid?.src || '';
    card.innerHTML = `
      <div class="vp-repost-card-thumb-placeholder">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.8">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      </div>
      <div class="vp-repost-card-info">
        <div class="vp-repost-card-user">@${user.username || 'unknown'}</div>
        <div class="vp-repost-card-caption">${_vp.postContent || ''}</div>
        <div class="vp-repost-card-video-icon">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="rgba(255,255,255,0.4)"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Video
        </div>
      </div>
    `;
  }

  // Clear textarea
  const ta = document.getElementById('vp-repost-textarea');
  if (ta) ta.value = '';

  // Open
  const backdrop = document.getElementById('vp-repost-backdrop');
  const sheet    = document.getElementById('vp-repost-sheet');
  if (backdrop) backdrop.classList.add('open');
  if (sheet)    sheet.classList.add('open');

  // Focus textarea after animation
  setTimeout(() => { if (ta) ta.focus(); }, 380);
}

function vpCloseRepostSheet() {
  const backdrop = document.getElementById('vp-repost-backdrop');
  const sheet    = document.getElementById('vp-repost-sheet');
  if (backdrop) backdrop.classList.remove('open');
  if (sheet)    sheet.classList.remove('open');
}

async function vpSubmitRepost() {
  const btn = document.getElementById('vp-repost-submit');
  if (btn) btn.disabled = true;

  const ta = document.getElementById('vp-repost-textarea');
  const commentary = ta ? ta.value.trim() : '';

  // Wire into the existing repost system
  // Store the repost target so handleRepost / openComposer path works
  repostTargetId  = _vp.postId;

  // Use existing composer submit if commentary exists, else direct repost
  if (commentary) {
    // Set up composer state and submit silently
    _c.repostId  = _vp.postId;
    _c.draftText = commentary;
    // Call the internal submit — composer will pick up repostId + draftText
    // We need to open composer in background and trigger submit
    // Simplest safe path: open composer pre-filled, user sees it and posts
    vpCloseRepostSheet();
    setTimeout(() => {
      repostTargetId  = _vp.postId;
      repostTargetBtn = null;
      openComposer();
      // Pre-fill the text
      setTimeout(() => {
        const composerInput = document.querySelector('#mn-composer [data-role="text"], #mn-composer textarea, #mn-composer .composer-input');
        if (composerInput) {
          composerInput.value     = commentary;
          composerInput.innerHTML = commentary;
          composerInput.dispatchEvent(new Event('input'));
        }
      }, 120);
    }, 350);
  } else {
    // Direct repost with no commentary — use handleRepost
    vpCloseRepostSheet();
    // Give the sheet time to close then fire
    setTimeout(async () => {
      const fakeBtn = document.createElement('button');
      fakeBtn.dataset.reposted = 'false';
      await handleRepost(_vp.postId, fakeBtn, _vp.postUserId);
      _vp.reposted    = true;
      _vp.repostCount = _vp.repostCount + 1;
      _vpPaintRepost();
      const rc = document.getElementById('vp-repost-count');
      if (rc) rc.textContent = _vp.repostCount > 0 ? fmtNum(_vp.repostCount) : '';
    }, 380);
  }

  if (btn) btn.disabled = false;
}

function _vpPaintRepost() {
  const btn = document.getElementById('vp-repost-btn');
  const svg = btn?.querySelector('.vp-repost-svg');
  if (btn) btn.classList.toggle('reposted', _vp.reposted);
  if (svg) {
    svg.style.stroke = _vp.reposted ? '#22c55e' : 'white';
  }
}

/* ──────────────────────────────────────────────
   COMMENT SHEET
────────────────────────────────────────────── */
function vpOpenCommentSheet() {
  if (!_vp.postId) return;

  const sheet = document.getElementById('vp-comment-sheet');
  if (!sheet) {
    // Fallback: just open detail page
    openDetail(_vp.postId, true);
    return;
  }

  // Mirror the main video into the PiP
  const mainVid = document.getElementById('vp-video');
  const pipVid  = document.getElementById('vp-pip-video');
  if (mainVid && pipVid) {
    pipVid.src         = mainVid.src;
    pipVid.currentTime = mainVid.currentTime;
    pipVid.muted       = true;
    pipVid.play().catch(() => {});
    // Pause the main video so there's no audio overlap
    mainVid.pause();
  }

  sheet.classList.add('open');
  _vpLoadCommentSheetComments();
}

function vpCloseCommentSheet() {
  const sheet   = document.getElementById('vp-comment-sheet');
  const mainVid = document.getElementById('vp-video');
  const pipVid  = document.getElementById('vp-pip-video');

  if (sheet) sheet.classList.remove('open');

  // Resume main video, stop PiP
  if (pipVid)  { pipVid.pause();  pipVid.src = ''; }
  if (mainVid) mainVid.play().catch(() => {});
}

async function _vpLoadCommentSheetComments() {
  const list = document.getElementById('vp-comment-sheet-list');
  if (!list) return;

  list.innerHTML = '<div class="vp-comment-sheet-loading">Loading comments…</div>';

  const { data: comments } = await supabase
    .from('comments')
    .select('id, content, created_at, user_id, user:users(id, username, avatar)')
    .eq('post_id', _vp.postId)
    .is('parent_id', null)
    .order('created_at', { ascending: false })
    .limit(40);

  if (!comments || !comments.length) {
    list.innerHTML = '<div class="vp-comment-sheet-loading">No comments yet. Be the first!</div>';
    return;
  }

  list.innerHTML = comments.map(c => {
    const u   = c.user || {};
    const av  = u.avatar ? `<img src="${u.avatar}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0">` : `<div style="width:32px;height:32px;border-radius:50%;background:#333;flex-shrink:0"></div>`;
    const ago = _vpTimeAgo(c.created_at);
    return `
      <div style="display:flex;gap:10px;margin-bottom:16px;align-items:flex-start">
        ${av}
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:3px">
            <span style="font-size:13px;font-weight:700;color:rgba(255,255,255,0.9)">@${u.username||'user'}</span>
            <span style="font-size:11px;color:rgba(255,255,255,0.35)">${ago}</span>
          </div>
          <div style="font-size:13px;color:rgba(255,255,255,0.75);line-height:1.4">${c.content||''}</div>
        </div>
      </div>`;
  }).join('');
}

function _vpTimeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60)   return 'now';
  if (diff < 3600) return Math.floor(diff/60)   + 'm';
  if (diff < 86400)return Math.floor(diff/3600)  + 'h';
  return Math.floor(diff/86400) + 'd';
}

/* ──────────────────────────────────────────────
   PLAY / PAUSE / SEEK / PROGRESS
────────────────────────────────────────────── */
function vpTogglePlay() {
  const vid = document.getElementById('vp-video');
  if (!vid) return;

  const indicator = document.getElementById('vp-play-indicator');
  const iconPath  = document.getElementById('vp-play-indicator-icon');

  if (vid.paused) {
    vid.play();
    if (iconPath) iconPath.setAttribute('d', 'M5 3l14 9L5 21V3z');
  } else {
    vid.pause();
    if (iconPath) iconPath.setAttribute('d', 'M6 4h4v16H6zM14 4h4v16h-4z');
  }

  if (indicator) {
    indicator.classList.remove('show');
    void indicator.offsetWidth;
    indicator.classList.add('show');
  }
}

function vpSeek(e) {
  const vid  = document.getElementById('vp-video');
  const wrap = document.getElementById('vp-progress-wrap');
  if (!vid || !wrap || !vid.duration) return;
  const r = wrap.getBoundingClientRect();
  vid.currentTime = ((e.clientX - r.left) / r.width) * vid.duration;
}

function _vpStartProgress() {
  const vid  = document.getElementById('vp-video');
  const fill = document.getElementById('vp-progress-fill');
  if (!vid || !fill) return;
  vid.addEventListener('timeupdate', () => {
    if (vid.duration) fill.style.width = (vid.currentTime / vid.duration * 100) + '%';
  });
}

/* ──────────────────────────────────────────────
   SHARE (kept for vpShare — can still be called)
────────────────────────────────────────────── */
function vpShare() { if (_vp.postId) sharePost({ id: _vp.postId, content: _vp.postContent || '' }); }

/* ──────────────────────────────────────────────
   RESET / CLOSE
────────────────────────────────────────────── */
function _vpReset() {
  if (_vp.floatTimer) { clearInterval(_vp.floatTimer); _vp.floatTimer = null; }

  const vid = document.getElementById('vp-video');
  if (vid) { vid.pause(); vid.src = ''; }

  // Close any open sheets
  vpCloseCommentSheet();
  vpCloseRepostSheet();

  // Reset like button
  const btn  = document.getElementById('vp-like-btn');
  const path = document.querySelector('#vp-like-btn .vp-heart-path');
  if (btn)  btn.classList.remove('liked');
  if (path) { path.setAttribute('fill','white'); path.setAttribute('stroke','white'); }

  // Reset bookmark
  const bBtn  = document.getElementById('vp-bookmark-btn');
  const bPath = document.querySelector('#vp-bookmark-btn .vp-bookmark-path');
  if (bBtn)  bBtn.classList.remove('bookmarked');
  if (bPath) { bPath.setAttribute('fill','white'); bPath.setAttribute('stroke','white'); }

  // Reset repost
  const rBtn = document.getElementById('vp-repost-btn');
  const rSvg = rBtn?.querySelector('.vp-repost-svg');
  if (rBtn) rBtn.classList.remove('reposted');
  if (rSvg) rSvg.style.stroke = 'white';

  ['vp-like-count','vp-comment-count','vp-repost-count','vp-caption'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });

  const fh = document.getElementById('vp-float-hearts');
  if (fh) fh.innerHTML = '';
}

function closeVideoPlayer() { _vpReset(); slideBack(); }

/* ──────────────────────────────────────────────
   FEED VIDEO THUMBNAIL
────────────────────────────────────────────── */
function createFeedVideoThumb(p) {
  const isLive = p.video_type === 'live_commerce';
  const wrap   = document.createElement('div');
  wrap.className = 'feed-video-thumb';
  wrap.dataset.postId = p.id;

  wrap.innerHTML = `
    <video preload="metadata" muted playsinline>
      <source src="${p.video}#t=0.5" type="video/mp4">
    </video>
    ${isLive ? `<div class="feed-video-live-badge"><span style="width:6px;height:6px;border-radius:50%;background:#fff;display:inline-block;margin-right:4px"></span>LIVE</div>` : ''}
    <div class="feed-video-play-wrap">
      <div class="feed-video-play-circle">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="white" style="margin-left:3px">
          <path d="M5 3l14 9L5 21V3z"/>
        </svg>
      </div>
    </div>
    <div class="feed-video-duration" id="fvd-${p.id}"></div>
  `;

  const videoEl = wrap.querySelector('video');
  if (videoEl) {
    videoEl.addEventListener('loadedmetadata', () => {
      const dur   = videoEl.duration;
      const durEl = document.getElementById('fvd-' + p.id);
      if (durEl && dur && isFinite(dur)) {
        const m = Math.floor(dur / 60);
        const s = Math.floor(dur % 60).toString().padStart(2, '0');
        durEl.textContent = m + ':' + s;
      }
    });
  }

  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    openVideoPlayer(p.id, p.video_type || 'video');
  });

  return wrap;
}
