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

  like:             { emoji: '❤️',  label: 'loved your note',           badgeClass: 'badge-like',    accentColor: '#f0385a' },

  comment:          { emoji: '💬',  label: 'replied to your note',      badgeClass: 'badge-comment', accentColor: '#6c47ff' },

  follow:           { emoji: '👤',  label: 'started following you',     badgeClass: 'badge-follow',  accentColor: '#00b87a' },

  repost:           { emoji: '🔁',  label: 'reposted your note',        badgeClass: 'badge-repost',  accentColor: '#f5a623' },

  mention:          { emoji: '📣',  label: 'mentioned you',             badgeClass: 'badge-mention', accentColor: '#00c4ff' },

  like_comment:     { emoji: '❤️',  label: 'loved your reply',          badgeClass: 'badge-like',    accentColor: '#f0385a' },

  order_placed:     { emoji: '📦',  label: 'placed an order',           badgeClass: 'badge-order',   accentColor: '#ff6b35' },

  order_shipped:    { emoji: '🚚',  label: 'Your order has shipped',    badgeClass: 'badge-order',   accentColor: '#ff6b35' },

  order_delivered:  { emoji: '✅',  label: 'Order delivered!',          badgeClass: 'badge-order',   accentColor: '#00b87a' },

  new_order:        { emoji: '🛍️',  label: 'placed a new order',        badgeClass: 'badge-order',   accentColor: '#ff6b35' },

  delivery_confirmed: { emoji: '✅', label: 'confirmed delivery',       badgeClass: 'badge-order',   accentColor: '#00b87a' },

  payment_received: { emoji: '💰',  label: 'Payment received',          badgeClass: 'badge-wallet',  accentColor: '#00b87a' },

  wallet_credit:    { emoji: '💳',  label: 'Wallet credited',           badgeClass: 'badge-wallet',  accentColor: '#00b87a' },

  mp_gift:          { emoji: '🎁',  label: 'sent you MistyPoints',       badgeClass: 'badge-wallet',  accentColor: '#6c47ff' },

  system:           { emoji: '📢',  label: '',                           badgeClass: 'badge-system',  accentColor: '#5e5e5a' },

};

const NOTIF_FILTERS = [

  { id: 'all',      label: 'All',      types: null },

  { id: 'social',   label: 'Social',   types: ['like','comment','repost','mention','like_comment'] },

  { id: 'follows',  label: 'Follows',  types: ['follow'] },

  { id: 'commerce', label: 'Commerce', types: ['new_order','order_placed','order_shipped','order_delivered','delivery_confirmed','payment_received'] },

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

      filter === 'all' ? "When people interact with your notes, you'll see it here." : ''

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

    : (['new_order','order_shipped','delivery_confirmed','order_placed','order_delivered'].includes(g.type) && g.comment_text)

    ? `<div class="notif-comment-preview">${escHtml(g.comment_text)}</div>`

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

// All notification types flow through here — push is fired automatically.

async function insertNotification(payload) {

  try {

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

    // ── Fire push for every notification type ──

    // Non-blocking — never delays the UI action that triggered it

    dispatchPush(payload).catch(e => console.warn('[push] dispatch error:', e));

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

// ═══════════════════════════════════════════

// POST SHARE SHEET — rich 3-row menu

// ═══════════════════════════════════════════

const SHARE_APPS = [

  { id: 'whatsapp',  label: 'WhatsApp',  color: '#25D366', icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.553 4.103 1.523 5.828L0 24l6.341-1.498A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.8 9.8 0 01-5.001-1.368l-.36-.214-3.762.888.939-3.658-.235-.374A9.787 9.787 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/></svg>` },

  { id: 'telegram',  label: 'Telegram',  color: '#2AABEE', icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.19 13.238l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.958.321z"/></svg>` },

  { id: 'twitter',   label: 'X',         color: '#000000', icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>` },

  { id: 'facebook',  label: 'Facebook',  color: '#1877F2', icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>` },

  { id: 'instagram', label: 'Instagram', color: '#E1306C', icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>` },

  { id: 'copy',      label: 'Copy link', color: '#6C47FF', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>` },

];

// Logo SVG for watermark

const MISTYNOTE_LOGO_SVG = `<svg width="22" height="11" viewBox="0 0 470 230" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="wm1" x1="62" y1="115" x2="408" y2="115" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FF1080"/><stop offset="28%" stop-color="#F030B8"/><stop offset="58%" stop-color="#C040E0"/><stop offset="100%" stop-color="#7722EE"/></linearGradient></defs><path d="M 235,40 C 235,40 330,36 370,50 C 408,64 408,100 408,114 C 408,148 398,164 382,174 C 374,180 362,184 350,184 C 340,184 330,180 324,172 C 318,164 314,154 308,143 C 302,132 294,120 284,114 C 276,109 266,107 258,109 C 250,111 244,116 240,122 C 237,127 235,134 235,142 C 235,134 233,127 230,122 C 226,116 220,111 212,109 C 204,107 194,109 186,114 C 176,120 168,132 162,143 C 156,154 152,164 146,172 C 140,180 130,184 120,184 C 108,184 96,180 88,174 C 72,164 62,148 62,114 C 62,100 62,64 100,50 C 140,36 235,40 235,40 Z" fill="none" stroke="url(#wm1)" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/><path d="M 355,93 C 356,103 365,111 375,113 C 365,115 356,123 355,133 C 354,123 345,115 335,113 C 345,111 354,103 355,93 Z" fill="url(#wm1)"/></svg>`;

async function showPostMenu(post, el, triggerBtn, fromLongPress = false) {

  const isOwn    = currentUser && post.user_id === currentUser.id;

  const postUrl  = `${window.location.origin}/post/${post.id}`;

  const hasImage = !!(post.image);

  // ── Build overlay ──

  const overlay = document.createElement('div');

  overlay.className = 'psm-overlay';

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const sheet = document.createElement('div');

  sheet.className = 'psm-sheet';

  // ── Handle bar ──

  const handle = document.createElement('div');

  handle.className = 'psm-handle';

  sheet.appendChild(handle);

  // ════════════════════════════

  // ROW 1 — People

  // ════════════════════════════

  const row1Label = document.createElement('div');

  row1Label.className = 'psm-row-label';

  row1Label.textContent = 'Send to';

  sheet.appendChild(row1Label);

  const row1 = document.createElement('div');

  row1.className = 'psm-people-row';

  // Invite Friends pill

  const inviteBtn = document.createElement('div');

  inviteBtn.className = 'psm-person-pill';

  inviteBtn.innerHTML = `

    <div class="psm-person-av psm-invite-av">

      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">

        <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/>

        <circle cx="9" cy="7" r="4"/>

        <line x1="19" y1="8" x2="19" y2="14"/>

        <line x1="16" y1="11" x2="22" y2="11"/>

      </svg>

    </div>

    <span class="psm-person-name">Invite</span>`;

  inviteBtn.addEventListener('click', () => {

    overlay.remove();

    if (typeof openInvitePage === 'function') openInvitePage();

  });

  row1.appendChild(inviteBtn);

  // Top followers (async load)

  _psmLoadFollowers(row1, post, postUrl, overlay);

  sheet.appendChild(row1);

  // ════════════════════════════

  // ROW 2 — Apps

  // ════════════════════════════

  const row2Label = document.createElement('div');

  row2Label.className = 'psm-row-label';

  row2Label.textContent = 'Share via';

  sheet.appendChild(row2Label);

  const row2 = document.createElement('div');

  row2.className = 'psm-apps-row';

  SHARE_APPS.forEach(app => {

    const btn = document.createElement('div');

    btn.className = 'psm-app-pill';

    btn.innerHTML = `

      <div class="psm-app-icon" style="background:${app.color}20;color:${app.color}">

        ${app.icon}

      </div>

      <span class="psm-app-name">${app.label}</span>`;

    btn.addEventListener('click', () => {

      overlay.remove();

      _psmShareToApp(app.id, post, postUrl);

    });

    row2.appendChild(btn);

  });

  sheet.appendChild(row2);

  // ════════════════════════════

  // ROW 3 — Actions

  // ════════════════════════════

  const row3 = document.createElement('div');

  row3.className = 'psm-actions-row';

  // Copy link — always shown

  _psmActionBtn(row3, `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`, 'Copy link', () => {

    overlay.remove();

    navigator.clipboard?.writeText(postUrl).then(() => showToast('Link copied! 🔗'));

  });

  // Save image — only if post has image

  if (hasImage) {

    _psmActionBtn(row3, `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`, 'Save image', () => {

      overlay.remove();

      _psmSaveImageWithWatermark(post.image, post);

    });

  }

  if (isOwn) {

    // Edit — dormant

    _psmActionBtn(row3, `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`, 'Edit', () => {

      overlay.remove();

      showToast('Edit post coming soon ✏️');

    });

    // Boost — dormant monetisation

    _psmActionBtn(row3, `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`, 'Boost post', () => {

      overlay.remove();

      showToast('Boost is coming soon ⚡ — stay tuned!');

    }, 'psm-action-boost');

    // Delete — danger

    _psmActionBtn(row3, `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>`, 'Delete post', () => {

      overlay.remove();

      deletePost(post.id, el);

    }, 'psm-action-danger');

  } else {

    // Dislike

    _psmActionBtn(row3, `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17"/></svg>`, 'Dislike', () => {

      overlay.remove();

      showToast('Noted — you won\'t see more like this');

    });

    // Report

    _psmActionBtn(row3, `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`, 'Report post', () => {

      overlay.remove();

      showToast('Post reported 🚩');

    }, 'psm-action-danger');

  }

  sheet.appendChild(row3);

  // Cancel

  const cancelBtn = document.createElement('button');

  cancelBtn.className = 'psm-cancel';

  cancelBtn.textContent = 'Cancel';

  cancelBtn.addEventListener('click', () => overlay.remove());

  sheet.appendChild(cancelBtn);

  overlay.appendChild(sheet);

  document.body.appendChild(overlay);

  // Animate in

  requestAnimationFrame(() => {

    requestAnimationFrame(() => sheet.classList.add('psm-sheet-open'));

  });

}

// ── Helper: action button in row 3 ──

function _psmActionBtn(container, iconSvg, label, onClick, extraClass = '') {

  const btn = document.createElement('div');

  btn.className = `psm-action-btn ${extraClass}`.trim();

  btn.innerHTML = `<div class="psm-action-icon">${iconSvg}</div><span>${label}</span>`;

  btn.addEventListener('click', onClick);

  container.appendChild(btn);

  return btn;

}

// ── Helper: load top followers async ──

async function _psmLoadFollowers(row1, post, postUrl, overlay) {

  if (!currentUser) return;

  try {

    const { data } = await supabase

      .from('follows')

      .select('follower_id, user:follower_id(id, username, avatar)')

      .eq('following_id', currentUser.id)

      .order('created_at', { ascending: false })

      .limit(6);

    if (!data?.length) return;

    data.forEach(f => {

      const u = f.user;

      if (!u) return;

      const pill = document.createElement('div');

      pill.className = 'psm-person-pill';

      pill.innerHTML = `

        <img class="psm-person-av" src="${escHtml(u.avatar || '')}"

             onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(u.id)}'" alt="">

        <span class="psm-person-name">${escHtml((u.username || '').slice(0, 9))}</span>`;

      pill.addEventListener('click', async () => {

        overlay.remove();

        showToast(`Sending to @${u.username}...`);

        const convId = await msgGetOrCreateConversation(u.id);

        if (!convId) { showToast('Could not open chat'); return; }

        const postText = post.content

          ? `${post.content.slice(0, 80)}${post.content.length > 80 ? '…' : ''}\n${postUrl}`

          : postUrl;

        await supabase.from('messages').insert({

          conversation_id: convId,

          sender_id: currentUser.id,

          content: postText,

          type: 'text',

        });

        showToast(`Sent to @${u.username} 📩`);

        updateDmBadge();

      });

      row1.appendChild(pill);

    });

  } catch (e) {

    console.warn('[PostMenu] followers load failed:', e);

  }

}

// ── Helper: share to external app ──

function _psmShareToApp(appId, post, postUrl) {

  const text  = post.content ? post.content.slice(0, 100) : 'Check this out on MistyNote';

  const encoded = encodeURIComponent(`${text}\n${postUrl}`);

  const encodedUrl = encodeURIComponent(postUrl);

  const urls = {

    whatsapp:  `https://wa.me/?text=${encoded}`,

    telegram:  `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(text)}`,

    twitter:   `https://twitter.com/intent/tweet?text=${encoded}`,

    facebook:  `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,

    instagram: null, // Instagram has no web share URL — use native share

    copy:      null,

  };

  if (appId === 'copy') {

    navigator.clipboard?.writeText(postUrl).then(() => showToast('Link copied! 🔗'));

    return;

  }

  if (appId === 'instagram') {

    // Fall back to native share for Instagram

    navigator.share?.({ text: `${text}\n${postUrl}` })

      .catch(() => navigator.clipboard?.writeText(postUrl).then(() => showToast('Link copied — paste into Instagram 📋')));

    return;

  }

  const url = urls[appId];

  if (url) window.open(url, '_blank', 'noopener,noreferrer');

}

// ── Helper: save image with watermark ──

async function _psmSaveImageWithWatermark(imageUrl, post) {

  showToast('Preparing image...');

  try {

    const img = new Image();

    img.crossOrigin = 'anonymous';

    await new Promise((res, rej) => {

      img.onload = res;

      img.onerror = rej;

      img.src = imageUrl;

    });

    const W   = img.naturalWidth;

    const H   = img.naturalHeight;

    // Canvas = exact image size, no strip added

    const canvas = document.createElement('canvas');

    canvas.width  = W;

    canvas.height = H;

    const ctx = canvas.getContext('2d');

    // Draw original image at full size

    ctx.drawImage(img, 0, 0);

    // ── Watermark sizing — scale to image width ──

    const SCALE    = W / 390;                          // baseline 390px phone width

    const PAD      = Math.round(12 * SCALE);           // margin from edges

    const logoH    = Math.round(16 * SCALE);           // small — wallet-icon size

    const logoW    = Math.round(logoH * (470 / 230));

    const fontSize = Math.round(11 * SCALE);

    const gap      = Math.round(5 * SCALE);            // gap between logo and text

    const font     = `500 ${fontSize}px 'Inter', 'Helvetica Neue', Arial, sans-serif`;

    // ── Render logo SVG in light grey ──

    const svgStr = `<svg width="${logoW}" height="${logoH}" viewBox="0 0 470 230" fill="none" xmlns="http://www.w3.org/2000/svg">

      <path d="M 235,40 C 235,40 330,36 370,50 C 408,64 408,100 408,114 C 408,148 398,164 382,174 C 374,180 362,184 350,184 C 340,184 330,180 324,172 C 318,164 314,154 308,143 C 302,132 294,120 284,114 C 276,109 266,107 258,109 C 250,111 244,116 240,122 C 237,127 235,134 235,142 C 235,134 233,127 230,122 C 226,116 220,111 212,109 C 204,107 194,109 186,114 C 176,120 168,132 162,143 C 156,154 152,164 146,172 C 140,180 130,184 120,184 C 108,184 96,180 88,174 C 72,164 62,148 62,114 C 62,100 62,64 100,50 C 140,36 235,40 235,40 Z"

        fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>

      <path d="M 355,93 C 356,103 365,111 375,113 C 365,115 356,123 355,133 C 354,123 345,115 335,113 C 345,111 354,103 355,93 Z"

        fill="rgba(255,255,255,0.55)"/>

    </svg>`;

    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml' });

    const logoUrl = URL.createObjectURL(svgBlob);

    const logoImg = new Image();

    await new Promise((res, rej) => { logoImg.onload = res; logoImg.onerror = rej; logoImg.src = logoUrl; });

    URL.revokeObjectURL(logoUrl);

    // ── Measure text width ──

    ctx.font = font;

    const textW = ctx.measureText('mistynote.com').width;

    // ── Total watermark block width ──

    const totalW = logoW + gap + textW;

    // ── Position: bottom right with padding ──

    const blockX = W - PAD - totalW;

    const blockY = H - PAD - logoH;

    // Subtle dark shadow so it's legible on both light and dark images

    ctx.shadowColor   = 'rgba(0,0,0,0.35)';

    ctx.shadowBlur    = Math.round(4 * SCALE);

    ctx.shadowOffsetX = 0;

    ctx.shadowOffsetY = Math.round(1 * SCALE);

    // Draw logo

    ctx.drawImage(logoImg, blockX, blockY, logoW, logoH);

    // Draw "mistynote.com" vertically centred with logo

    ctx.font         = font;

    ctx.fillStyle    = 'rgba(255,255,255,0.55)';

    ctx.textBaseline = 'middle';

    ctx.fillText('mistynote.com', blockX + logoW + gap, blockY + logoH / 2);

    // Reset shadow

    ctx.shadowColor = 'transparent';

    ctx.shadowBlur  = 0;

    // ── Download ──

    const a    = document.createElement('a');

    a.href     = canvas.toDataURL('image/jpeg', 0.93);

    a.download = `mistynote-${post.id?.slice(0, 8) || Date.now()}.jpg`;

    a.click();

    showToast('Image saved! 🖼️');

  } catch (e) {

    console.error('[SaveImage]', e);

    showToast('Could not save image — try again');

  }

}

// ── Inject post share menu styles ──

function _injectPsmStyles() {

  if (document.getElementById('psm-styles')) return;

  const s = document.createElement('style');

  s.id = 'psm-styles';

  s.textContent = `

  .psm-overlay {

    position: fixed; inset: 0; z-index: 9999;

    background: rgba(0,0,0,0.55);

    display: flex; align-items: flex-end;

    backdrop-filter: blur(2px);

    -webkit-backdrop-filter: blur(2px);

  }

  .psm-sheet {

    width: 100%; background: var(--bg);

    border-radius: 24px 24px 0 0;

    padding: 0 0 max(env(safe-area-inset-bottom), 16px);

    transform: translateY(100%);

    transition: transform 0.32s cubic-bezier(0.32,0.72,0,1);

    max-height: 88vh; overflow-y: auto;

  }

  .psm-sheet-open { transform: translateY(0) !important; }

  .psm-handle {

    width: 36px; height: 4px; border-radius: 2px;

    background: var(--border); margin: 12px auto 16px; 

  }

  .psm-row-label {

    font-size: 11px; font-weight: 700; letter-spacing: .07em;

    text-transform: uppercase; color: var(--text3);

    padding: 0 18px; margin-bottom: 10px;

  }

  /* ── Row 1: People ── */

  .psm-people-row {

    display: flex; gap: 14px; padding: 0 18px 18px;

    overflow-x: auto; -webkit-overflow-scrolling: touch;

    scrollbar-width: none;

  }

  .psm-people-row::-webkit-scrollbar { display: none; }

  .psm-person-pill {

    display: flex; flex-direction: column; align-items: center;

    gap: 6px; flex-shrink: 0; cursor: pointer;

    -webkit-tap-highlight-color: transparent;

  }

  .psm-person-pill:active { opacity: 0.7; transform: scale(0.93); }

  .psm-person-av {

    width: 52px; height: 52px; border-radius: 50%;

    object-fit: cover; background: var(--bg3);

    border: 2px solid var(--border);

  }

  .psm-invite-av {

    display: flex; align-items: center; justify-content: center;

    background: linear-gradient(135deg, #6C47FF, #a855f7);

    color: white; border: none;

  }

  .psm-person-name {

    font-size: 11px; color: var(--text2); font-weight: 500;

    max-width: 56px; overflow: hidden; text-overflow: ellipsis;

    white-space: nowrap; text-align: center;

  }

  /* ── Row 2: Apps ── */

  .psm-apps-row {

    display: flex; gap: 6px; padding: 0 18px 18px;

    overflow-x: auto; -webkit-overflow-scrolling: touch;

    scrollbar-width: none;

  }

  .psm-apps-row::-webkit-scrollbar { display: none; }

  .psm-app-pill {

    display: flex; flex-direction: column; align-items: center;

    gap: 6px; flex-shrink: 0; cursor: pointer; min-width: 58px;

    -webkit-tap-highlight-color: transparent;

  }

  .psm-app-pill:active { opacity: 0.7; transform: scale(0.93); }

  .psm-app-icon {

    width: 48px; height: 48px; border-radius: 14px;

    display: flex; align-items: center; justify-content: center;

    padding: 11px; box-sizing: border-box;

  }

  .psm-app-icon svg { width: 100%; height: 100%; }

  .psm-app-name {

    font-size: 11px; color: var(--text2); font-weight: 500;

    white-space: nowrap;

  }

  /* ── Row 3: Actions ── */

  .psm-actions-row {

    display: grid; grid-template-columns: 1fr 1fr;

    gap: 8px; padding: 0 18px 14px;

  }

  .psm-action-btn {

    display: flex; align-items: center; gap: 10px;

    background: var(--bg2); border: 1px solid var(--border);

    border-radius: 14px; padding: 13px 14px;

    cursor: pointer; font-size: 13px; font-weight: 600;

    color: var(--text);

    -webkit-tap-highlight-color: transparent;

    transition: all .15s;

  }

  .psm-action-btn:active { transform: scale(0.96); background: var(--bg3); }

  .psm-action-icon {

    width: 18px; height: 18px; flex-shrink: 0; color: var(--text2);

  }

  .psm-action-boost .psm-action-icon { color: #f59e0b; }

  .psm-action-boost { border-color: rgba(245,158,11,0.25); }

  .psm-action-danger { color: rgb(244,7,82) !important; }

  .psm-action-danger .psm-action-icon { color: rgb(244,7,82); }

  .psm-action-danger { border-color: rgba(244,7,82,0.25); }

  /* ── Cancel ── */

  .psm-cancel {

    display: block; width: calc(100% - 36px); margin: 0 18px;

    background: var(--bg2); border: 1.5px solid var(--border);

    border-radius: 14px; padding: 14px;

    font-size: 15px; font-weight: 700; color: var(--text);

    cursor: pointer; font-family: inherit;

    -webkit-tap-highlight-color: transparent;

    transition: all .15s;

  }

  .psm-cancel:active { background: var(--bg3); transform: scale(0.98); }

  `;

  document.head.appendChild(s);

}

// Auto-inject styles when this file loads

_injectPsmStyles();

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

// ════════════════════════════════

// ONESIGNAL PUSH NOTIFICATIONS

// App ID: 913a9816-aa82-4607-a168-66a80c0c5cb3

// ════════════════════════════════

const ONESIGNAL_APP_ID = '913a9816-aa82-4607-a168-66a80c0c5cb3';

// ── Init OneSignal — called from bootApp() in app-core.js ────────

async function initOneSignal() {

  try {

    window.OneSignalDeferred = window.OneSignalDeferred || [];

    await new Promise(resolve => {

      window.OneSignalDeferred.push(async function(OneSignal) {

        await OneSignal.init({

          appId: ONESIGNAL_APP_ID,

          notifyButton: { enable: false },

          allowLocalhostAsSecureOrigin: true,

        });

        // Link this device token to the logged-in user's UUID

        if (currentUser) {

          try { await OneSignal.login(currentUser.id); } catch(e) {}

        }

        resolve();

      });

    });

    console.log('[OneSignal] Ready');

  } catch (e) {

    console.warn('[OneSignal] Init failed:', e);

  }

}

// ── Request permission — call after onboarding, not on load ───

async function requestPushPermission() {

  try {

    window.OneSignalDeferred?.push(async function(OneSignal) {

      const granted = await OneSignal.Notifications.permission;

      if (!granted) await OneSignal.Notifications.requestPermission();

    });

  } catch (e) {}

}

// ── Push message map — every notification type has a message template ──

function buildPushPayload(type, actorName, extras) {

  const name = actorName ? '@' + actorName : 'Someone';

  const note = extras.comment_text ? ' · ' + extras.comment_text.slice(0, 60) : '';

  const map = {

    like:         { title: '❤️ New Heart',         message: name + ' loved your note' },

    comment:      { title: '💬 New Comment',      message: name + ':' + note },

    reply:        { title: '💬 New Reply',        message: name + ' replied:' + note },

    follow:       { title: '✨ New Follower',       message: name + ' started following you' },

    repost:       { title: '🔁 Repost',              message: name + ' reposted your note' },

    mention:      { title: '📣 You were mentioned', message: name + ' mentioned you:' + note },

    like_comment: { title: '❤️ Comment liked',   message: name + ' liked your comment' },

    mp_gift:      { title: '🎁 MistyPoints Received', message: name + ' sent you' + (extras.comment_text ? ' ' + extras.comment_text : ' MistyPoints') },

    payment_received: { title: '💰 Payment Received',  message: name + ' paid you' },

    new_order:          { title: '🛍️ New Order',          message: extras.comment_text || name + ' placed an order' },

    order_shipped:      { title: '🚚 Order Shipped',      message: extras.comment_text || 'Your order has shipped!' },

    delivery_confirmed: { title: '✅ Delivery Confirmed', message: extras.comment_text || name + ' confirmed delivery' },

    system:       { title: '📢 MistyNote',            message: extras.comment_text || 'You have a new notification' },

  };

  return map[type] || { title: 'MistyNote', message: 'You have a new notification' };

}

// ── Central push dispatcher — called from insertNotification for every type ──

async function dispatchPush(payload) {

  if (!payload.user_id || !payload.type) return;

  // Never push to yourself

  if (payload.user_id === currentUser?.id) return;

  try {

    // Fetch actor name for the message

    let actorName = '';

    if (payload.actor_id && currentProfile && payload.actor_id === currentUser?.id) {

      actorName = currentProfile.username || '';

    } else if (payload.actor_id) {

      const { data } = await supabase

        .from('users').select('username').eq('id', payload.actor_id).maybeSingle();

      actorName = data?.username || '';

    }

    const push = buildPushPayload(payload.type, actorName, payload);

    // Call Supabase edge function which hits OneSignal REST API server-side

    await supabase.functions.invoke('send-push', {

      body: {

        recipient_user_id: payload.user_id,

        title:   push.title,

        message: push.message,

        url:     'https://mistynote.pages.dev',

        data:    { type: payload.type, post_id: payload.post_id || null },

      }

    });

  } catch(e) {

    // Silent — push failure never interrupts the user action

    console.warn('[push] dispatchPush error:', e);

  }

}