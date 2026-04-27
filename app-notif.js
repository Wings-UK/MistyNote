/* ═══════════════════════════════════════════
   MISTYNOTE — app-notif.js
   Notifications, realtime subscription,
   banner, echoes panel, badge
   Requires: app-core.js
═══════════════════════════════════════════ */

// ══════════════════════════════════════════
// NOTIFICATIONS — PREMIUM ENGINE
// ══════════════════════════════════════════

const NOTIF_CONFIG = {
  GROUPING_WINDOW_MS: 24 * 60 * 60 * 1000,
  GROUPING_THRESHOLD: 3,
  BATCH_SIZE: 50,
  BANNER_DURATION: 4500,
  BANNER_SWIPE_THRESHOLD: 60,
};

const NOTIF_TYPES = {
  like:             { emoji: '❤️',  label: 'liked your post',           badgeClass: 'badge-like',    accentColor: '#f0385a' },
  comment:          { emoji: '💬',  label: 'replied to your post',      badgeClass: 'badge-comment', accentColor: '#6c47ff' },
  follow:           { emoji: '👤',  label: 'started following you',     badgeClass: 'badge-follow',  accentColor: '#00b87a' },
  repost:           { emoji: '🔁',  label: 'reposted your post',        badgeClass: 'badge-repost',  accentColor: '#f5a623' },
  mention:          { emoji: '📣',  label: 'mentioned you',             badgeClass: 'badge-mention', accentColor: '#00c4ff' },
  like_comment:     { emoji: '❤️',  label: 'liked your comment',        badgeClass: 'badge-like',    accentColor: '#f0385a' },
  order_placed:     { emoji: '📦',  label: 'placed an order',           badgeClass: 'badge-order',   accentColor: '#ff6b35' },
  order_shipped:    { emoji: '🚚',  label: 'Your order has shipped',    badgeClass: 'badge-order',   accentColor: '#ff6b35' },
  order_delivered:  { emoji: '✅',  label: 'Order delivered!',          badgeClass: 'badge-order',   accentColor: '#00b87a' },
  payment_received: { emoji: '💰',  label: 'Payment received',          badgeClass: 'badge-wallet',  accentColor: '#00b87a' },
  wallet_credit:    { emoji: '💳',  label: 'Wallet credited',           badgeClass: 'badge-wallet',  accentColor: '#00b87a' },
  mp_gift:          { emoji: '🎁',  label: 'sent you MistyPoints',       badgeClass: 'badge-wallet',  accentColor: '#6c47ff' },
  system:           { emoji: '📢',  label: '',                           badgeClass: 'badge-system',  accentColor: '#5e5e5a' },
};

const NOTIF_FILTERS = [
  { id: 'all',      label: 'All',      types: null },
  { id: 'social',   label: 'Social',   types: ['like','comment','repost','mention','like_comment'] },
  { id: 'follows',  label: 'Follows',  types: ['follow'] },
  { id: 'commerce', label: 'Commerce', types: ['order_placed','order_shipped','order_delivered'] },
  { id: 'wallet',   label: 'Wallet',   types: ['payment_received','wallet_credit','mp_gift'] },
];

let notifCurrentFilter = 'all';
let notifRawData = [];
let bannerQueue = [];
let bannerShowing = false;
let bannerTimer = null;

// ── LOAD & RENDER ─────────────────────────

async function loadNotifications() {
  if (!currentUser) return;
  const container = document.getElementById('notif-list');
  if (!container) return;

  renderNotifSkeletons(container, 5);

  const { data, error } = await supabase
    .from('notifications')
    .select(`id,created_at,read,type,actor_id,post_id,comment_text,
             actor:users!actor_id(id,username,avatar),
             post:posts!fk_notifications_post_id(id,image,user_id,user:users!user_id(username,avatar))`)
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(NOTIF_CONFIG.BATCH_SIZE);

  if (error) { container.innerHTML = renderNotifEmpty('Something went wrong', 'Pull down to try again.'); return; }

  notifRawData = data || [];
  renderNotifList(notifCurrentFilter);
  updateNotifTabCounts();
}

function renderNotifList(filter) {
  const container = document.getElementById('notif-list');
  if (!container) return;

  const filterDef = NOTIF_FILTERS.find(f => f.id === filter);
  let items = notifRawData;
  if (filterDef && filterDef.types) items = items.filter(n => filterDef.types.includes(n.type));

  if (!items.length) {
    container.innerHTML = renderNotifEmpty(
      filter === 'all' ? 'All caught up! 🎉' : `No ${filterDef?.label?.toLowerCase()} notifications`,
      filter === 'all' ? "When people interact with your posts, you'll see it here." : ''
    );
    return;
  }

  const grouped = groupNotifications(items);
  const now = Date.now();
  const sections = {
    new:     { label: 'New',        items: [] },
    today:   { label: 'Today',      items: [] },
    week:    { label: 'This week',  items: [] },
    earlier: { label: 'Earlier',    items: [] },
  };

  grouped.forEach(g => {
    const age = now - new Date(g.latestAt).getTime();
    if (!g.read && age < 1000 * 60 * 60 * 3) sections.new.items.push(g);
    else if (age < 1000 * 60 * 60 * 24) sections.today.items.push(g);
    else if (age < 1000 * 60 * 60 * 24 * 7) sections.week.items.push(g);
    else sections.earlier.items.push(g);
  });

  let html = '';
  let delay = 0;
  Object.entries(sections).forEach(([, section]) => {
    if (!section.items.length) return;
    html += `<div class="notif-section-header">${section.label}</div>`;
    section.items.forEach(g => { html += renderNotifItem(g, delay); delay += 25; });
  });

  container.innerHTML = html;
  container.querySelectorAll('.notif-item').forEach(el => attachSwipeDismiss(el));
}

function groupNotifications(items) {
  const groups = [];
  const usedIds = new Set();

  items.forEach(item => {
    if (usedIds.has(item.id)) return;

    // Only group: same type + same post_id + DIFFERENT actors within time window
    // One actor liking 3 different posts = 3 separate notifications (never group same actor)
    const canGroup = item.post_id && ['like','repost','comment'].includes(item.type);

    if (canGroup) {
      const siblings = items.filter(s =>
        s.id !== item.id &&
        !usedIds.has(s.id) &&
        s.type === item.type &&
        s.post_id === item.post_id &&
        // CRITICAL: only group DIFFERENT actors on the SAME post
        s.actor_id !== item.actor_id &&
        Math.abs(new Date(s.created_at) - new Date(item.created_at)) < NOTIF_CONFIG.GROUPING_WINDOW_MS
      );

      if (siblings.length >= NOTIF_CONFIG.GROUPING_THRESHOLD - 1) {
        const all = [item, ...siblings];
        // Deduplicate actors by id — never show same username twice
        const seenActorIds = new Set();
        const uniqueActors = all
          .map(s => s.actor)
          .filter(a => {
            if (!a?.id || seenActorIds.has(a.id)) return false;
            seenActorIds.add(a.id);
            return true;
          });
        all.forEach(s => usedIds.add(s.id));
        groups.push({
          grouped: true, type: item.type, post: item.post, post_id: item.post_id,
          actors: uniqueActors,
          actor_id: item.actor_id,
          count: uniqueActors.length, read: all.every(s => s.read),
          latestAt: item.created_at, ids: all.map(s => s.id),
        });
        return;
      }
    }

    usedIds.add(item.id);
    groups.push({ grouped: false, ...item, actors: [item.actor], latestAt: item.created_at, ids: [item.id] });
  });
  return groups;
}

function renderNotifItem(g, animDelay = 0) {
  const cfg = NOTIF_TYPES[g.type] || NOTIF_TYPES.system;
  const isUnread = !g.read;

  let avatarHtml;
  if (g.grouped && g.actors.length > 1) {
    const shown = g.actors.slice(0, 3);
    const extra = g.count - shown.length;
    let imgs = shown.map((a, i) => {
      const src = a?.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${a?.id || i}`;
      return `<img src="${escHtml(src)}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${i}'" alt="">`;
    }).join('');
    if (extra > 0) imgs += `<span class="stack-more">+${extra > 99 ? '99' : extra}</span>`;
    avatarHtml = `
      <div class="notif-avatar-wrap" style="width:52px;height:48px;">
        <div class="notif-avatar-stack">${imgs}</div>
        <div class="notif-type-badge ${cfg.badgeClass}">${cfg.emoji}</div>
      </div>`;
  } else {
    const actor = g.actors[0] || {};
    const src = actor.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${actor.id || 'x'}`;
    avatarHtml = `
      <div class="notif-avatar-wrap">
        <img class="notif-avatar" src="${escHtml(src)}"
          onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=fallback'" alt="">
        <div class="notif-type-badge ${cfg.badgeClass}">${cfg.emoji}</div>
      </div>`;
  }

  // Build text
  const actors = g.actors.filter(Boolean);
  let who = '';
  if (g.grouped && actors.length > 1) {
    const names = actors.slice(0, 2).map(a => `<strong>${escHtml(a.username)}</strong>`).join(', ');
    const rest = g.count - 2;
    who = rest > 0 ? `${names} <span class="and-others">and ${fmtNum(rest)} others</span>` : names;
  } else if (actors[0]) {
    who = `<strong>${escHtml(actors[0].username)}</strong>`;
  } else {
    who = '<strong>Someone</strong>';
  }

  const commentPreview = (g.type === 'mp_gift' && g.comment_text)
    ? `<div class="notif-comment-preview notif-mp-preview">🎁 ${escHtml(g.comment_text)}</div>`
    : (g.type === 'comment' && g.comment_text)
    ? `<div class="notif-comment-preview">"${escHtml(g.comment_text.slice(0,120))}${g.comment_text.length > 120 ? '…' : ''}"</div>`
    : '';

  const followBtn = (g.type === 'follow' && !g.grouped)
    ? `<button class="notif-follow-btn" id="nfb-${g.actor_id}" onclick="notifFollowToggle('${g.actor_id}',this);event.stopPropagation()">Follow</button>`
    : '';
  if (g.type === 'follow' && !g.grouped) setTimeout(() => loadNotifFollowState(g.actor_id), 100);

  const thumbHtml = (g.post?.image && g.type !== 'follow')
    ? `<div class="notif-thumb-wrap"><img class="notif-thumb" src="${escHtml(g.post.image)}" alt=""></div>`
    : '';

  const clickActorId = g.actor_id || (g.actors[0]?.id) || '';

  return `
    <div class="notif-item${isUnread ? ' unread' : ''}${g.grouped ? ' grouped' : ''}"
         data-ids="${g.ids.join(',')}"
         data-post-id="${g.post_id || ''}"
         data-actor-id="${clickActorId}"
         data-type="${g.type}"
         style="animation-delay:${animDelay}ms">
      ${avatarHtml}
      <div class="notif-body">
        <p class="notif-text">${who} ${cfg.label}</p>
        ${commentPreview}
        ${followBtn}
        <div class="notif-meta">
          <span class="notif-time">${timeSince(g.latestAt)}</span>
          ${isUnread ? '<span class="notif-unread-dot"></span>' : ''}
        </div>
      </div>
      ${thumbHtml}
    </div>`;
}

function renderNotifEmpty(title, sub) {
  return `<div class="notif-empty">
    <div class="notif-empty-icon">🔔</div>
    <div class="notif-empty-title">${escHtml(title)}</div>
    ${sub ? `<p class="notif-empty-sub">${escHtml(sub)}</p>` : ''}
  </div>`;
}

function renderNotifSkeletons(container, count) {
  container.innerHTML = Array.from({ length: count }, () => `
    <div class="notif-skeleton">
      <div class="notif-skeleton-avatar loading-pulse"></div>
      <div class="notif-skeleton-body">
        <div class="notif-skeleton-line w80 loading-pulse"></div>
        <div class="notif-skeleton-line w55 loading-pulse"></div>
      </div>
    </div>`).join('');
}

function updateNotifTabCounts() {
  NOTIF_FILTERS.forEach(f => {
    const tab = document.getElementById(`ntab-${f.id}`);
    const countEl = tab?.querySelector('.tab-count');
    if (!countEl) return;
    let items = notifRawData;
    if (f.types) items = items.filter(n => f.types.includes(n.type));
    const unread = items.filter(n => !n.read).length;
    countEl.textContent = unread > 0 ? (unread > 99 ? '99+' : unread) : '';
    countEl.style.display = unread > 0 ? '' : 'none';
  });
}

function switchNotifFilter(filterId) {
  notifCurrentFilter = filterId;
  document.querySelectorAll('.notif-filter-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.filter === filterId);
  });
  renderNotifList(filterId);
}

async function notifItemClick(postId, actorId, idsStr, type) {
  // ── Mark read (fire-and-forget, must NOT crash navigation) ──
  const ids = idsStr.split(',').filter(Boolean);
  if (ids.length) {
    (async () => {
      try { await supabase.from('notifications').update({ read: true }).in('id', ids); } catch(e) {}
    })();
    ids.forEach(id => {
      const el = document.querySelector(`.notif-item[data-ids="${id}"], .notif-item[data-ids^="${id},"], .notif-item[data-ids*=",${id},"], .notif-item[data-ids$=",${id}"]`);
      if (el) { el.classList.remove('unread'); el.querySelector('.notif-unread-dot')?.remove(); }
    });
    unreadCount = Math.max(0, unreadCount - ids.length);
    updateNotifBadge();
    updateNotifTabCounts();
  }

  // CRITICAL: tell slideTo we're coming from notifications
  // so the back button returns here correctly
  lastMainPage = 'notifications';

  if (type === 'mp_gift') {
    openWallet();
  } else if (postId && postId !== 'null' && postId !== 'undefined') {
    await openDetail(postId);
  } else if (actorId && actorId !== 'null' && actorId !== 'undefined') {
    await showUserProfile(actorId, null);
  }
}

async function loadNotifFollowState(actorId) {
  if (!currentUser) return;
  const btn = document.getElementById(`nfb-${actorId}`);
  if (!btn) return;
  const { data } = await supabase.from('follows')
    .select('id').eq('follower_id', currentUser.id).eq('following_id', actorId).maybeSingle();
  if (data) { btn.classList.add('following'); btn.textContent = 'Following'; }
}

async function notifFollowToggle(actorId, btn) {
  if (!currentUser) { showToast('Sign in to follow'); return; }
  const isFollowing = btn.classList.contains('following');
  btn.classList.toggle('following', !isFollowing);
  btn.textContent = !isFollowing ? 'Following' : 'Follow';
  if (isFollowing) {
    const { error } = await supabase.from('follows').delete().eq('follower_id', currentUser.id).eq('following_id', actorId);
    if (error) { btn.classList.add('following'); btn.textContent = 'Following'; }
  } else {
    const { error } = await supabase.from('follows').insert({ follower_id: currentUser.id, following_id: actorId });
    if (error) { btn.classList.remove('following'); btn.textContent = 'Follow'; }
  }
}

async function markAllNotifsRead() {
  if (!currentUser) return;
  await supabase.from('notifications').update({ read: true }).eq('user_id', currentUser.id).eq('read', false);
  unreadCount = 0;
  updateNotifBadge();
  notifRawData.forEach(n => n.read = true);
  renderNotifList(notifCurrentFilter);
  updateNotifTabCounts();
}

// kept as alias so any old internal calls still work
async function markAllRead() { return markAllNotifsRead(); }

// ── BADGE ──────────────────────────────────

async function loadInitialNotifCount() {
  if (!currentUser) return;
  const { count } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id).eq('read', false);
  unreadCount = count || 0;
  updateNotifBadge();
}

function updateNotifDot() { updateNotifBadge(); }

function updateNotifBadge() {
  const dot = document.getElementById('notif-dot');
  if (dot) dot.style.display = unreadCount > 0 ? 'block' : 'none';
  const badge = document.getElementById('notif-count-badge');
  if (badge) {
    if (unreadCount > 0) { badge.classList.add('visible'); badge.textContent = unreadCount > 99 ? '99+' : unreadCount; }
    else badge.classList.remove('visible');
  }
}

// ── REAL-TIME SUBSCRIPTION ────────────────

// ── Safe notification insert — logs errors, never throws ──
async function insertNotification(payload) {
  try {
    // Build clean payload — omit post_id entirely if null/undefined (avoids NOT NULL constraint issues)
    const row = {
      user_id:      payload.user_id,
      actor_id:     payload.actor_id,
      type:         payload.type,
      read:         false,
    };
    if (payload.post_id)      row.post_id      = payload.post_id;
    if (payload.comment_text) row.comment_text = payload.comment_text;

    const { error } = await supabase.from('notifications').insert(row);
    if (error) console.warn(`[notif:${payload.type}] Insert failed:`, error.message, error.details || '', error.hint || '');
    return !error;
  } catch(e) {
    console.warn('[notif] Unexpected error:', e.message);
    return false;
  }
}

function subscribeToNotifs() {
  if (!currentUser || notifChannel) return;
  notifChannel = supabase
    .channel(`notifs-${currentUser.id}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'notifications',
      filter: `user_id=eq.${currentUser.id}`
    }, async (payload) => {
      const n = payload.new;
      if (!n.read) { unreadCount++; updateNotifBadge(); }
      if (navigator.vibrate) navigator.vibrate([40, 20, 40]);

      // Enrich with actor and post in parallel
      const [{ data: actor }, { data: postData }] = await Promise.all([
        supabase.from('users').select('id,username,avatar').eq('id', n.actor_id).maybeSingle(),
        n.post_id ? supabase.from('posts').select('image').eq('id', n.post_id).maybeSingle() : Promise.resolve({ data: null })
      ]);

      const enriched = { ...n, actor, post: postData, actors: [actor], latestAt: n.created_at, ids: [n.id] };
      notifRawData.unshift(enriched);

      queueNotifBanner({ type: n.type, actor, comment_text: n.comment_text, post_image: postData?.image, post_id: n.post_id, actor_id: n.actor_id, id: n.id });

      const notifPage = document.getElementById('page-notifications');
      if (notifPage?.classList.contains('active')) { renderNotifList(notifCurrentFilter); updateNotifTabCounts(); }
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.warn('Notif channel error — retrying in 3s');
        notifChannel = null;
        setTimeout(subscribeToNotifs, 3000);
      }
    });
}

// ── BANNER ────────────────────────────────

function queueNotifBanner(data) {
  bannerQueue.push(data);
  if (!bannerShowing) showNextBanner();
}

function showNextBanner() {
  if (!bannerQueue.length) { bannerShowing = false; return; }
  bannerShowing = true;
  showNotifBanner(bannerQueue.shift());
}

function showNotifBanner(data) {
  const cfg = NOTIF_TYPES[data.type] || NOTIF_TYPES.system;
  const actor = data.actor || {};
  const src = actor.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${actor.id || 'x'}`;
  const title = actor.username ? `@${actor.username}` : 'MistyNote';
  const subtitle = (data.type === 'mp_gift' && data.comment_text)
    ? data.comment_text.slice(0, 70)
    : (data.type === 'comment' && data.comment_text)
    ? data.comment_text.slice(0, 60) + (data.comment_text.length > 60 ? '…' : '')
    : cfg.label;

  const banner = document.getElementById('notif-banner');
  if (!banner) return;

  banner.style.setProperty('--notif-accent', cfg.accentColor);
  banner.innerHTML = `
    <div class="notif-banner-inner"
         data-notif-type="${data.type || ''}" data-post-id="${data.post_id || ''}"
         data-actor-id="${data.actor_id || ''}"
         data-notif-id="${data.id}">
      <img class="notif-banner-avatar" src="${escHtml(src)}"
        onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=fallback'" alt="">
      <div class="notif-banner-content">
        <div class="notif-banner-title">${escHtml(title)}</div>
        <div class="notif-banner-subtitle">${escHtml(subtitle)}</div>
      </div>
      ${data.post_image ? `<img class="notif-banner-thumb" src="${escHtml(data.post_image)}" alt="">` : `<span class="notif-banner-time">now</span>`}
    </div>`;
  const inner = banner.querySelector('.notif-banner-inner');
  if (inner) {
    inner.addEventListener('click', () => {
      notifBannerClick(inner.dataset.postId, inner.dataset.actorId, inner.dataset.notifId, inner.dataset.notifType);
    }, { once: true });
  }

  requestAnimationFrame(() => { banner.classList.remove('hide'); banner.classList.add('show'); });
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(dismissNotifBanner, NOTIF_CONFIG.BANNER_DURATION);
  attachBannerSwipe(banner);
}

function dismissNotifBanner() {
  const banner = document.getElementById('notif-banner');
  if (!banner) return;
  banner.classList.remove('show');
  banner.classList.add('hide');
  clearTimeout(bannerTimer);
  setTimeout(showNextBanner, 400);
}

function notifBannerClick(postId, actorId, notifId, notifType) {
  dismissNotifBanner();
  if (notifType === 'mp_gift') { openWallet(); return; }
  if (postId && postId !== 'null' && postId !== 'undefined') openDetail(postId);
  else if (actorId && actorId !== 'null' && actorId !== 'undefined') showUserProfile(actorId, null);
  if (notifId) (async () => { try { await supabase.from('notifications').update({ read: true }).eq('id', notifId); } catch(e){} })();
}

function attachBannerSwipe(banner) {
  let startY = 0, currentY = 0, dragging = false;
  banner.addEventListener('touchstart', e => { startY = e.touches[0].clientY; dragging = true; clearTimeout(bannerTimer); }, { passive: true });
  banner.addEventListener('touchmove', e => {
    if (!dragging) return;
    currentY = e.touches[0].clientY - startY;
    if (currentY < 0) { banner.style.transform = `translateY(${currentY}px)`; banner.style.opacity = String(1 + currentY / 120); }
  }, { passive: true });
  banner.addEventListener('touchend', () => {
    dragging = false;
    if (currentY < -NOTIF_CONFIG.BANNER_SWIPE_THRESHOLD) { dismissNotifBanner(); }
    else { banner.style.transform = ''; banner.style.opacity = ''; bannerTimer = setTimeout(dismissNotifBanner, NOTIF_CONFIG.BANNER_DURATION); }
    currentY = 0;
  });
}

function attachSwipeDismiss(el) {
  let startX = 0, currentX = 0, dragging = false;
  el.addEventListener('touchstart', e => { startX = e.touches[0].clientX; dragging = true; el.classList.add('swiping'); }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!dragging) return;
    currentX = e.touches[0].clientX - startX;
    if (currentX < 0) el.style.transform = `translateX(${currentX}px)`;
  }, { passive: true });
  el.addEventListener('touchend', () => {
    dragging = false; el.classList.remove('swiping');
    if (currentX < -80) {
      const ids = (el.dataset.ids || '').split(',').filter(Boolean);
      el.classList.add('dismissed');
      setTimeout(() => el.remove(), 300);
      if (ids.length) {
        (async () => { try { await supabase.from('notifications').delete().in('id', ids); } catch(e){} })();
        notifRawData = notifRawData.filter(n => !ids.includes(String(n.id)));
        updateNotifTabCounts();
      }
    } else { el.style.transform = ''; }
    currentX = 0;
  });
}

// ── PAGE ENTRY ────────────────────────────

function onNotifPageOpen() {
  buildNotifFilterTabs();

  // ── Delegated tap handler — one listener on the static container.
  // Survives innerHTML re-renders. Uses capture phase so swipe handlers can't block it.
  const notifList = document.getElementById('notif-list');
  if (notifList && !notifList._notifListenerAttached) {
    notifList._notifListenerAttached = true;

    // Record finger start position to distinguish tap from scroll
    notifList.addEventListener('touchstart', e => {
      const item = e.target.closest('.notif-item');
      if (!item) return;
      item._touchStartX = e.touches[0].clientX;
      item._touchStartY = e.touches[0].clientY;
    }, true);

    const handleNotifTap = e => {
      if (e.target.closest('.notif-follow-btn, .notif-type-badge')) return;
      const item = e.target.closest('.notif-item');
      if (!item) return;

      // If finger moved more than 8px it's a scroll — ignore
      if (e.type === 'touchend') {
        const touch = e.changedTouches[0];
        const dx = Math.abs(touch.clientX - (item._touchStartX || 0));
        const dy = Math.abs(touch.clientY - (item._touchStartY || 0));
        if (dx > 8 || dy > 8) return;
      }

      e.stopImmediatePropagation();
      // Prevent double-fire when both touchend and click fire on same tap
      if (e.type === 'click' && item._notifTapHandled) { item._notifTapHandled = false; return; }
      if (e.type === 'touchend') item._notifTapHandled = true;

      const postId  = item.dataset.postId  || null;
      const actorId = item.dataset.actorId || null;
      const idsStr  = item.dataset.ids     || '';
      const type    = item.dataset.type    || '';
      notifItemClick(
        postId  && postId  !== 'null' && postId  !== 'undefined' ? postId  : null,
        actorId && actorId !== 'null' && actorId !== 'undefined' ? actorId : null,
        idsStr,
        type
      );
    };

    notifList.addEventListener('click',    handleNotifTap, true);
    notifList.addEventListener('touchend', handleNotifTap, true);
  }

  loadNotifications();
  setTimeout(async () => {
    if (unreadCount > 0) {
      await supabase.from('notifications').update({ read: true }).eq('user_id', currentUser.id).eq('read', false);
      unreadCount = 0;
      updateNotifBadge();
    }
  }, 1200);
}

function buildNotifFilterTabs() {
  const wrap = document.getElementById('notif-filter-tabs');
  if (!wrap || wrap.dataset.built) return;
  wrap.dataset.built = '1';
  wrap.innerHTML = NOTIF_FILTERS.map(f => `
    <button id="ntab-${f.id}" class="notif-filter-tab${f.id === 'all' ? ' active' : ''}"
      data-filter="${f.id}" onclick="switchNotifFilter('${f.id}')">
      ${f.label}
      <span class="tab-count" style="display:none"></span>
    </button>`).join('');
}

// ── DEMO HELPER (remove in production) ────
window.demoNotif = function(type = 'like') {
  queueNotifBanner({ type, actor: { username: 'amara.lagos', avatar: `https://api.dicebear.com/7.x/adventurer/svg?seed=amara` }, comment_text: type === 'comment' ? 'This is so beautiful! 🔥' : null, post_image: null, post_id: null, actor_id: null, id: 'demo-' + Date.now() });
};

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

      // ── Like count — plain update, no animation ──
      document.querySelectorAll(`.heart-ai[data-post-id="${postId}"] .like-count`)
        .forEach(el => { el.textContent = likeCount > 0 ? fmtNum(likeCount) : ''; });

      // Detail page like stat — plain update
      if (detailPostId === postId) {
        const statEl = document.querySelector(`.detail-stat-n[data-type="likes"]`);
        if (statEl) statEl.textContent = fmtNum(likeCount);
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
        <span class="echoes-title">echoes</span>
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

