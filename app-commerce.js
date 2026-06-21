/* ═══════════════════════════════════════════

   MISTYNOTE — app-commerce.js

   Sidepane, Storefront, Products, Cart,

   Orders, My Bag, Merchant Dashboard,

   Discount Codes, Reviews

   Requires: app-core.js, app-wallet.js

═══════════════════════════════════════════ */

'use strict';

// ══════════════════════════════════════════
// SENDBOX — Shipping & Logistics (Nigeria)
// ══════════════════════════════════════════
const SENDBOX_SECRET_KEY    = 'cb50a8737b93487477058966fadeceb88012814481210aee0de38e59a450c8b18cdd88e02f1a3dc921cd6413b8c342fc92fc0332cdca4336dedfd2877cc58dec';
const SENDBOX_ACCESS_TOKEN  = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1aWQiOiI2YTE5ZTQ1YmEyOGIyYTAwMjI3ZTQ0ZGMiLCJhaWQiOiI2YTFjZDFhNWEyOGIyYTAwMWY2ODAzNmQiLCJ0d29fZmEiOmZhbHNlLCJpbnN0YW5jZV9pZCI6IjYxMzZkZmE2YTFhYjlkMzE4YmNmY2I5NCIsImVudGl0eV9pZCI6bnVsbCwiaXNzIjoic2VuZGJveC5hcHBzLmF1dGgtNjEzNmRmYTZhMWFiOWQzMThiY2ZjYjk0IiwiZXhwIjoxNzg1NzQ1NTA3fQ.VI6gJBxjq2ow7GSmsg-Hm1DWMy3u9haNVBrS9omxNOo';
const SENDBOX_REFRESH_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhcHBsaWNhdGlvbiI6eyJwayI6IjZhMWNkMWE1YTI4YjJhMDAxZjY4MDM2ZCIsImRlc2NyaXB0b24iOiJUaGUgdmlyYWwgcGxhdGZvcm0uLi4iLCJuYW1lIjoiTWlzdHlOb3RlICJ9LCJhcHBfaWQiOiI2YTFjZDFhNWEyOGIyYTAwMWY2ODAzNmQiLCJpc3MiOiJzZW5kYm94LmFwcHMuYXV0aCIsImV4cCI6MTgxNTIwNzkwN30.hTK-539CK5MlzQCmlXHjkxvjc_wLrOwML-6mlqVJLBY';
const SENDBOX_BASE          = 'https://ship.sendbox.co';
// Webhook already registered: https://mistynote.pages.dev/api/sendbox-webhook

const SENDBOX_EDGE_URL = 'https://rhmknjlxddxkfybcfgjj.supabase.co/functions/v1/sendbox';

let _sendboxToken = SENDBOX_ACCESS_TOKEN;

async function sendboxRequest(method, path, body, _isRetry = false) {
  try {
    const res  = await fetch(SENDBOX_EDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, method, body, token: _sendboxToken }),
    });

    const json = await res.json();

    if (res.status === 401 && !_isRetry) {
      const ok = await _sendboxRefreshToken();
      if (ok) return sendboxRequest(method, path, body, true);
    }

    if (!res.ok) {
      console.error('[Sendbox] Full error response:', JSON.stringify(json));
      const msg = json.message || json.error || json.detail || json.msg || JSON.stringify(json);
      throw new Error(msg);
    }
    return json;
  } catch (e) { throw e; }
}

async function _sendboxRefreshToken() {
  try {
    const res  = await fetch(SENDBOX_EDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path:   '/apps/auth/token/refresh',
        method: 'POST',
        body:   { refresh_token: SENDBOX_REFRESH_TOKEN },
        token:  '',
      }),
    });
    const json = await res.json();
    console.log('[Sendbox] Refresh response:', JSON.stringify(json));
    const t = json?.data?.access_token || json?.access_token || json?.token || json?.data?.token;
    if (t) { _sendboxToken = t; return true; }
    return false;
  } catch (e) {
    console.error('[Sendbox] Refresh failed:', e);
    return false;
  }
}

// ── COMMERCE STATE ────────────────────────────────────────

let currentStorefront = null;

let cartCount = 0;

let cartItems = [];

let currentProductId = null;

let currentStorefrontId = null;

let editingProductId = null;

// Product prices use BASE_RATE (real KWD→NGN, no fee markup).

// BUY_RATE (BASE_RATE × 1.04) is only used in app-wallet.js for wallet top-up.

function mktNgnToMp(ngn) { var r = (typeof BASE_RATE !== 'undefined' && BASE_RATE > 0) ? BASE_RATE : 4400; return Math.ceil((ngn / r) * 100) / 100; }

function mktMpToNgn(mp)  { var r = (typeof BASE_RATE !== 'undefined' && BASE_RATE > 0) ? BASE_RATE : 4400; return Math.round(mp * r); }

function mktFmtNgn(n)    { return '₦' + Number(n).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

// ══════════════════════════════════════════

// SIDEPANE

// ══════════════════════════════════════════

async function openSidePanel(section) {

  if (!currentUser) { showToast('Sign in to continue'); return; }

  const pane     = document.getElementById('sidepane');

  const backdrop = document.getElementById('sidepane-backdrop');

  const avEl     = document.getElementById('sidepane-avatar');

  const unEl     = document.getElementById('sidepane-username');

  const snEl     = document.getElementById('sidepane-store-name');

  if (avEl) { avEl.src = currentProfile?.avatar || ''; avEl.className = currentStorefront ? 'sidepane-avatar square' : 'sidepane-avatar'; }

  if (unEl) unEl.textContent = '@' + (currentProfile?.username || '');

  if (snEl) { snEl.textContent = currentStorefront?.store_name || ''; snEl.style.display = currentStorefront ? 'block' : 'none'; }

  const merchantSection  = document.getElementById('sidepane-merchant-section');

  const openStoreSection = document.getElementById('sidepane-open-store-section');

  if (merchantSection)  merchantSection.style.display  = currentStorefront ? 'block' : 'none';

  if (openStoreSection) openStoreSection.style.display = currentStorefront ? 'none'  : 'block';

  await syncCartCount();

  if (pane)     pane.classList.add('open');

  if (backdrop) backdrop.classList.add('open');

  if (section === 'cart') setTimeout(() => { closeSidePanel(); openSidePaneSection('cart'); }, 300);

}

function closeSidePanel() {

  document.getElementById('sidepane')?.classList.remove('open');

  document.getElementById('sidepane-backdrop')?.classList.remove('open');

}

function openSidePaneSection(section) {

  if (section === 'cart') slideTo('cart', loadCartPage);

}

// ══════════════════════════════════════════

// LOAD STOREFRONT STATE ON BOOT

// ══════════════════════════════════════════

async function loadMyStorefrontState() {

  if (!currentUser) return;

  try {

    const { data } = await supabase.from('storefronts').select('*').eq('user_id', currentUser.id).maybeSingle();

    currentStorefront = data || null;

    renderStorefrontBanner();

  } catch(e) { /* silent */ }

}

function renderStorefrontBanner() {

  // Update the existing beautiful banner in app-social.js — don't replace it

  const icon  = document.getElementById('prf-storefront-banner-icon');

  const title = document.getElementById('prf-storefront-banner-title');

  const sub   = document.getElementById('prf-storefront-banner-sub');

  const pill  = document.getElementById('prf-storefront-banner-pill');

  if (currentStorefront) {

    if (icon)  icon.textContent  = '🏪';

    if (title) title.textContent = currentStorefront.store_name;

    if (sub)   sub.textContent   = currentStorefront.category + ' · Tap to manage';

    if (pill)  { pill.textContent = 'Dashboard'; pill.style.background = 'var(--accent)'; pill.style.color = 'white'; }

  } else {

    if (icon)  icon.textContent  = '🛍️';

    if (title) title.textContent = 'Open your storefront';

    if (sub)   sub.textContent   = 'Sell anything. Get paid safely.';

    if (pill)  { pill.textContent = 'Open'; pill.style.background = ''; pill.style.color = ''; }

  }

}

// Called when logged-in user taps their own storefront banner

function handleStorefrontBannerTap() {

  if (currentStorefront) {

    openMyStorefront();

  } else {

    openCreateStorefront();

  }

}

// Called when viewing another user's profile and tapping their store banner

async function openStorefrontByUserId(userId) {

  const { data: sf } = await supabase

    .from('storefronts')

    .select('id')

    .eq('user_id', userId)

    .maybeSingle();

  if (sf) {

    openStorefront(sf.id);

  } else {

    showToast('This user has no active store');

  }

}

// ══════════════════════════════════════════

// CREATE STOREFRONT

// ══════════════════════════════════════════

let csfLogoFile = null;

let csfBannerFile = null;

function openCreateStorefront() {

  if (!currentUser) { showToast('Sign in to open a store'); return; }

  if (currentStorefront) { openMyStorefront(); return; }

  slideTo('create-storefront');

}

function csfPreviewLogo(input) {

  const file = input.files?.[0];

  if (!file) return;

  csfLogoFile = file;

  const preview = document.getElementById('csf-logo-preview');

  if (preview) {

    const img = document.createElement('img');

    img.src = URL.createObjectURL(file);

    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:16px';

    preview.innerHTML = '';

    preview.appendChild(img);

  }

}

function csfPreviewBanner(input) {

  const file = input.files?.[0];

  if (!file) return;

  csfBannerFile = file;

  const wrap = document.getElementById('csf-banner-wrap');

  if (wrap) {

    const img = document.createElement('img');

    img.src = URL.createObjectURL(file);

    img.style.cssText = 'width:100%;height:100%;object-fit:cover';

    wrap.innerHTML = '';

    wrap.appendChild(img);

  }

}

let csfNameDebounce = null;

function csfValidateName(input) {

  const val   = input.value.trim();

  const wrap  = document.getElementById('csf-name-wrap');

  const hint  = document.getElementById('csf-name-hint');

  const error = document.getElementById('csf-name-error');

  const btn   = document.getElementById('csf-submit-btn');

  wrap.classList.remove('error', 'valid');

  error.classList.add('hidden');

  btn.disabled = true;

  if (!val) { if (hint) hint.textContent = 'This will be your brand name on MistyNote'; return; }

  if (val.length < 2) { wrap.classList.add('error'); error.textContent = 'Store name too short'; error.classList.remove('hidden'); return; }

  if (hint) hint.textContent = 'Checking availability…';

  clearTimeout(csfNameDebounce);

  csfNameDebounce = setTimeout(async () => {

    const { data } = await supabase.from('storefronts').select('id').ilike('store_name', val).maybeSingle();

    if (data) {

      wrap.classList.add('error'); error.textContent = 'Store name already taken — try another'; error.classList.remove('hidden');

      if (hint) hint.textContent = '';

    } else {

      wrap.classList.add('valid'); if (hint) hint.textContent = 'Great name! ✓'; btn.disabled = false;

    }

  }, 500);

}

async function submitCreateStorefront() {

  const storeName   = document.getElementById('csf-store-name')?.value.trim();

  const description = document.getElementById('csf-description')?.value.trim();

  const category    = document.getElementById('csf-category')?.value;

  const phone       = document.getElementById('csf-phone')?.value.trim();

  const state       = document.getElementById('csf-state')?.value;

  const btn         = document.getElementById('csf-submit-btn');

  if (!storeName) { showToast('Enter your store name'); return; }

  if (!category)  { showToast('Select a business category'); return; }

  if (!phone)     { showToast('Enter your business phone'); return; }

  if (!state)     { showToast('Select your state'); return; }

  if (walletState.points < 1) { showToast('You need at least MP 1 to open a store'); return; }

  btn.disabled = true; btn.textContent = 'Opening your store…';

  try {

    let logoUrl = '';

    if (csfLogoFile) {

      showToast('Uploading logo…');

      const path = `storefronts/${currentUser.id}/logo.jpg`;

      const compressed = await compressImage(csfLogoFile, 400);

      await supabase.storage.from('avatars').upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);

      logoUrl = urlData.publicUrl + '?t=' + Date.now();

    }

    let bannerUrl = '';

    if (csfBannerFile) {

      showToast('Uploading banner…');

      const path = `storefronts/${currentUser.id}/banner.jpg`;

      const compressed = await compressImage(csfBannerFile, 1200);

      await supabase.storage.from('avatars').upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);

      bannerUrl = urlData.publicUrl + '?t=' + Date.now();

    }

    const slug = storeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const pinOk = await walletPinCheck();

    if (!pinOk) { btn.disabled = false; btn.textContent = 'Open My Store — MP 1/month'; return; }

    const expiry = new Date(); expiry.setMonth(expiry.getMonth() + 1);

    const { data: sf, error } = await supabase.from('storefronts').insert({

      user_id: currentUser.id, store_name: storeName, slug, description, category, phone, state,

      logo_url: logoUrl, banner_url: bannerUrl, subscription_expires_at: expiry.toISOString(), is_active: true,

    }).select().single();

    if (error) throw error;

    currentStorefront = sf;

    renderStorefrontBanner();

    showToast('Your store is open! 🎉');

    slideBack();

    setTimeout(() => openMyStorefront(), 400);

  } catch(e) {

    showToast('Failed to create store: ' + (e.message || 'Try again'));

    btn.disabled = false; btn.textContent = 'Open My Store — MP 1/month';

  }

}

// ══════════════════════════════════════════

// MY STOREFRONT (Merchant view)

// ══════════════════════════════════════════

function openMyStorefront() {

  if (!currentStorefront) { openCreateStorefront(); return; }

  slideTo('my-storefront', renderMyStorefront);

}

async function renderMyStorefront() {

  const el = document.getElementById('my-storefront-content');

  if (!el) return;

  el.innerHTML = `<div class="loading-pulse" style="height:300px"></div>`;

  const [sfRes, productsRes, ordersRes] = await Promise.all([

    supabase.from('storefronts').select('*').eq('id', currentStorefront.id).maybeSingle(),

    supabase.from('products').select('id', { count: 'exact', head: true }).eq('storefront_id', currentStorefront.id).neq('status', 'archived'),

    supabase.from('orders').select('id,price_ngn', { count: 'exact' }).eq('seller_id', currentUser.id).eq('status', 'paid'),

  ]);

  const sf            = sfRes.data || currentStorefront;

  const productCount  = productsRes.count || 0;

  const paidOrders    = ordersRes.data || [];

  const pendingOrders = paidOrders.length;

  const totalRevenue  = paidOrders.reduce((s, o) => s + (Number(o.price_ngn) || 0), 0);

  const totalSales    = pendingOrders;

  const badge = document.getElementById('sidepane-orders-badge');

  if (badge) { badge.textContent = pendingOrders; badge.style.display = pendingOrders > 0 ? 'flex' : 'none'; }

  el.innerHTML = `

    <div class="msf-banner-wrap">

      ${sf.banner_url ? `<img src="${sf.banner_url}" class="msf-banner-img" alt="">` : `<div class="msf-banner-placeholder"></div>`}

      <div class="msf-banner-overlay">

        <button class="msf-edit-banner-btn" onclick="document.getElementById('msf-banner-input').click()">

          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>

          Edit Banner

        </button>

      </div>

      <input type="file" id="msf-banner-input" accept="image/*" style="display:none" onchange="updateStorefrontBanner(this)">

    </div>

    <div class="msf-info-wrap">

      <div class="msf-logo-wrap">

        <img class="msf-logo" src="${sf.logo_url || ''}" onerror="this.style.display='none'" alt="">

        <button class="msf-edit-logo-btn" onclick="document.getElementById('msf-logo-input').click()">

          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>

        </button>

        <input type="file" id="msf-logo-input" accept="image/*" style="display:none" onchange="updateStorefrontLogo(this)">

      </div>

      <div class="msf-store-details">

        <div class="msf-store-name">${escHtml(sf.store_name)}</div>

        <div class="msf-store-cat">${escHtml(sf.category)}</div>

        ${sf.rating > 0 ? `<div class="msf-store-rating">★ ${sf.rating} · ${sf.review_count} reviews</div>` : ''}

      </div>

      <button class="msf-edit-btn" onclick="openEditStorefront()">Edit Store</button>

    </div>

    <div class="msf-stats-row">

      <div class="msf-stat" onclick="openMyProducts()">

        <div class="msf-stat-num">${productCount}</div>

        <div class="msf-stat-label">Products</div>

      </div>

      <div class="msf-stat" onclick="openShopOrders()">

        <div class="msf-stat-num">${totalSales}</div>

        <div class="msf-stat-label">Sales</div>

      </div>

      <div class="msf-stat" onclick="openMerchantDashboard()">

        <div class="msf-stat-num">${mktFmtNgn(totalRevenue)}</div>

        <div class="msf-stat-label">Revenue</div>

      </div>

    </div>

    ${pendingOrders > 0 ? `

    <div class="msf-alert" onclick="openShopOrders()">

      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>

      ${pendingOrders} new order${pendingOrders > 1 ? 's' : ''} waiting · Tap to manage

    </div>` : ''}

    <div class="msf-actions">

      <button class="msf-action-btn" onclick="slideTo('add-product', buildAddProductForm)">

        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>

        Add Product

      </button>

      <button class="msf-action-btn" onclick="openMyProducts()">

        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>

        My Products

      </button>

      <button class="msf-action-btn" onclick="openShopOrders()">

        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>

        Shop Orders

      </button>

      <button class="msf-action-btn" onclick="openMerchantDashboard()">

        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>

        Analytics

      </button>

    </div>

    <div class="msf-subscription">

      <div class="msf-subscription-info">

        <span class="msf-subscription-label">Basic Plan</span>

        <span class="msf-subscription-expiry">Renews ${new Date(sf.subscription_expires_at).toLocaleDateString('en-NG', {day:'numeric',month:'short',year:'numeric'})}</span>

      </div>

      <button class="msf-renew-btn" onclick="renewStorefrontSubscription()">Renew</button>

    </div>

    <div style="padding:0 16px 24px">

      <button class="msf-view-public-btn" onclick="openStorefront('${sf.id}')">View Public Storefront</button>

    </div>`;

}

// ══════════════════════════════════════════

// PUBLIC STOREFRONT PAGE

// ══════════════════════════════════════════

async function openStorefront(storefrontId) {

  currentStorefrontId = storefrontId;

  slideTo('storefront', () => renderStorefront(storefrontId));

}

async function renderStorefront(storefrontId) {

  const el = document.getElementById('storefront-content');

  if (!el) return;

  el.innerHTML = `<div class="loading-pulse" style="height:400px"></div>`;

  const [sfRes, productsRes, reviewsRes] = await Promise.all([

    supabase.from('storefronts').select('*').eq('id', storefrontId).single(),

    supabase.from('products').select('*').eq('storefront_id', storefrontId).eq('status','active').order('created_at', { ascending: false }).limit(30),

    supabase.from('product_reviews').select('*, reviewer:users(username,avatar)').eq('storefront_id', storefrontId).order('created_at', { ascending: false }).limit(5),

  ]);

  const sf = sfRes.data;

  // Fetch store owner profile separately — avoids foreign key join issues

  let sfUser = {};

  if (sf?.user_id) {

    const { data: u } = await supabase.from('users').select('id,username,avatar,followers').eq('id', sf.user_id).maybeSingle();

    sfUser = u || {};

  }

  const products = productsRes.data || [];

  const reviews  = reviewsRes.data || [];

  if (!sf) { el.innerHTML = `<div class="empty-state"><p>Store not found</p></div>`; return; }

  const isOwner   = currentUser && sf.user_id === currentUser.id;

  const followers = sfUser.followers || 0;

  el.innerHTML = `

    <div class="sf-banner-wrap">

      ${sf.banner_url ? `<img src="${sf.banner_url}" class="sf-banner-img" alt="">` : `<div class="sf-banner-placeholder" style="background:${gradientFor(sf.id)}"></div>`}

      <div class="sf-banner-gradient"></div>

      <button class="sf-back-btn" onclick="slideBack()">

        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>

      </button>

    </div>

    <div class="sf-header">

      <img class="sf-logo merchant-avatar" src="${sf.logo_url || ''}" onerror="this.style.background='var(--bg2)';this.removeAttribute('src')" alt="">

      <div class="sf-header-info">

        <div class="sf-store-name">${escHtml(sf.store_name)}</div>

        <div class="sf-store-meta">

          ${sf.rating > 0 ? `<span>★ ${sf.rating}</span> · ` : ''}

          <span>${fmtNum(followers)} followers</span> · <span>${sf.category}</span>

        </div>

        ${sf.description ? `<div class="sf-store-desc">${escHtml(sf.description)}</div>` : ''}

      </div>

      ${!isOwner ? `<button class="sf-follow-btn" id="sf-follow-btn" onclick="toggleStorefrontFollow('${sf.user_id}',this)">Follow</button>`

        : `<button class="sf-follow-btn" onclick="openMyStorefront()">Manage</button>`}

    </div>

    <div class="sf-section">

      <div class="sf-section-title">Products <span style="color:var(--text3);font-weight:400">(${products.length})</span></div>

      ${products.length === 0 ? `<div class="sf-empty">No products yet</div>`

        : `<div class="sf-products-grid">${products.map(p => renderProductCard(p, sf)).join('')}</div>`}

    </div>

    ${reviews.length > 0 ? `

    <div class="sf-section">

      <div class="sf-section-title">Reviews</div>

      <div class="sf-reviews">

        ${reviews.map(r => `

          <div class="sf-review">

            <div class="sf-review-header">

              <img class="sf-review-avatar" src="${r.reviewer?.avatar || ''}" alt="">

              <div><div class="sf-review-name">@${escHtml(r.reviewer?.username||'')}</div>

              <div class="sf-review-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</div></div>

              <div class="sf-review-time">${timeSince(r.created_at)}</div>

            </div>

            ${r.review ? `<div class="sf-review-text">${escHtml(r.review)}</div>` : ''}

          </div>`).join('')}

      </div>

    </div>` : ''}`;

  if (!isOwner && currentUser) {

    const { data: followData } = await supabase.from('follows').select('id')

      .eq('follower_id', currentUser.id).eq('following_id', sf.user_id).maybeSingle();

    const followBtn = document.getElementById('sf-follow-btn');

    if (followBtn && followData) { followBtn.textContent = 'Following'; followBtn.classList.add('following'); }

  }

}

function renderProductCard(p, sf) {

  const img     = p.images?.[0] || '';

  const price   = mktFmtNgn(p.price_ngn);

  const mp      = fmtPts(mktNgnToMp(p.price_ngn));

  const orig    = p.compare_price_ngn > p.price_ngn ? `<span class="prd-card-orig">${mktFmtNgn(p.compare_price_ngn)}</span>` : '';

  const badge   = p.compare_price_ngn > p.price_ngn ? `<div class="prd-card-discount-badge">${Math.round((1-p.price_ngn/p.compare_price_ngn)*100)}% OFF</div>` : '';

  return `

    <div class="prd-card" onclick="openProductPage('${p.id}')">

      <div class="prd-card-img-wrap">

        ${img ? `<img src="${img}" class="prd-card-img" alt="" loading="lazy">` : `<div class="prd-card-img-placeholder" style="background:${gradientFor(p.id)}"></div>`}

        ${badge}

        ${p.stock === 0 ? `<div class="prd-card-sold-out">Sold Out</div>` : ''}

      </div>

      <div class="prd-card-body">

        <div class="prd-card-title">${escHtml(p.title)}</div>

        <div class="prd-card-price-row"><span class="prd-card-price">${price}</span>${orig}</div>

        <div class="prd-card-mp">${mp}</div>

        ${p.rating > 0 ? `<div class="prd-card-rating">★ ${p.rating} (${p.review_count})</div>` : ''}

      </div>

    </div>`;

}

async function toggleStorefrontFollow(userId, btn) {

  if (!currentUser) { showToast('Sign in to follow'); return; }

  const isFollowing = btn.classList.contains('following');

  btn.disabled = true;

  if (isFollowing) {

    const { error } = await supabase.from('follows').delete().eq('follower_id', currentUser.id).eq('following_id', userId);

    if (!error) { btn.textContent = 'Follow'; btn.classList.remove('following'); }

  } else {

    const { error } = await supabase.from('follows').insert({ follower_id: currentUser.id, following_id: userId });

    if (!error) { btn.textContent = 'Following'; btn.classList.add('following'); }

  }

  btn.disabled = false;

}

// ══════════════════════════════════════════

// PRODUCT PAGE

// ══════════════════════════════════════════

function pdpShowBars() {

  var t = document.getElementById('pdp-top-bar');

  var c = document.getElementById('pdp-cta-bar');

  if (t) t.style.display = 'flex';

  if (c) c.style.display = 'flex';

}

function pdpHideBars() {

  var t = document.getElementById('pdp-top-bar');

  var c = document.getElementById('pdp-cta-bar');

  if (t) t.style.display = 'none';

  if (c) c.style.display = 'none';

}

async function openProductPage(productId) {

  currentProductId = productId;

  pdpQty = 1;

  selectedVariants = {};

  slideTo('product', () => renderProductPage(productId));

}

async function renderProductPage(productId) {

  const el = document.getElementById('product-content');

  if (!el) return;

  el.innerHTML = `<div class="loading-pulse" style="height:400px"></div>`;

  // Fetch all separately to avoid foreign key join issues

  const [pRes, variantsRes, reviewsRes] = await Promise.all([

    supabase.from('products').select('*').eq('id', productId).maybeSingle(),

    supabase.from('product_variants').select('*').eq('product_id', productId),

    supabase.from('product_reviews').select('*, reviewer:users(username,avatar)').eq('product_id', productId).order('created_at', { ascending: false }).limit(10),

  ]);

  const p = pRes.data;

  if (!p) { el.innerHTML = `<div class="empty-state"><p>Product not found</p></div>`; return; }

  // Fetch storefront separately

  let sf = {};

  if (p.storefront_id) {

    const { data: sfData } = await supabase.from('storefronts').select('*').eq('id', p.storefront_id).maybeSingle();

    sf = sfData || {};

  }

  const images   = p.images || [];

  const variants = variantsRes.data || [];

  const reviews  = reviewsRes.data || [];

  const discount = p.compare_price_ngn > p.price_ngn ? Math.round((1 - p.price_ngn / p.compare_price_ngn) * 100) : 0;

  pdpCurrentImage = 0;

  el.innerHTML = `

    <!-- SPACER below fixed top bar (bar lives outside this scroll container) -->

    <div class="pdp-header-spacer"></div>

    <!-- PRODUCT IMAGE (square, full-width) -->

    <div class="pdp-images" id="pdp-images">

      ${images.length > 0

        ? images.map((img, i) => `<div class="pdp-img-slide ${i===0?'active':''}" data-index="${i}"><img src="${img}" class="pdp-img" alt="" loading="${i===0?'eager':'lazy'}"></div>`).join('')

        : `<div class="pdp-img-placeholder" style="background:${gradientFor(p.id)}"></div>`}

      ${images.length > 1

        ? `<div class="pdp-img-dots">${images.map((_,i) => `<div class="pdp-img-dot ${i===0?'active':''}" onclick="pdpGoToImage(${i})"></div>`).join('')}</div>`

        : ''}

      ${discount > 0 ? `<div class="pdp-discount-badge">${discount}%</div>` : ''}

    </div>

    <!-- MAIN INFO BLOCK -->

    <div class="pdp-info-block">

      <!-- Title -->

      <div class="pdp-title">${escHtml(p.title)}</div>

      <!-- Rating row: star + score + (recent 6mo score) + pipe + review count -->

      ${p.rating > 0 ? `

      <div class="pdp-rating-row">

        <span class="pdp-star">★</span>

        <span class="pdp-rating-score">${Number(p.rating).toFixed(2)}</span>

        <span class="pdp-rating-recent">(last 6 months ${Number(p.rating).toFixed(2)})</span>

        <span class="pdp-rating-pipe">|</span>

        <span class="pdp-rating-link">${p.review_count || 0} reviews</span>

      </div>` : ''}

      <!-- Discount % + strikethrough original price -->

      ${p.compare_price_ngn > p.price_ngn ? `

      <div class="pdp-discount-row">

        <span class="pdp-discount-pct">${discount}%</span>

        <span class="pdp-compare-price">${mktFmtNgn(p.compare_price_ngn)}</span>

      </div>` : ''}

      <!-- Big red price -->

      <div class="pdp-price-big">${mktFmtNgn(p.price_ngn)}</div>

      <!-- Free delivery row -->

      <div class="pdp-free-delivery">

        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>

        Free delivery

      </div>

    </div><!-- /pdp-info-block -->

    <!-- INFO ROWS: Points · Benefits · Shipping -->

    <div class="pdp-info-rows">

      <!-- Points row -->

      <div class="pdp-info-row">

        <span class="pdp-row-label">Earn</span>

        <div class="pdp-row-content">

          <div class="pdp-points-amount" onclick="this.closest('.pdp-info-row').querySelector('.pdp-points-card').style.display=this.closest('.pdp-info-row').querySelector('.pdp-points-card').style.display==='none'?'block':'none'">

            Up to ${fmtPts(mktNgnToMp(p.price_ngn))} MistyPoints

            <span class="pdp-points-chevron">

              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>

            </span>

          </div>

          <!-- Expandable points card -->

          <div class="pdp-points-card" style="display:none">

            <div class="pdp-points-card-top">

              <span class="pdp-points-badge">M+</span>

              <span class="pdp-points-card-desc">Up to 5% extra MP back</span>

              <span class="pdp-points-card-val">${fmtPts(Math.round(mktNgnToMp(p.price_ngn)*0.05))}</span>

            </div>

            <button class="pdp-points-card-btn">

              Pay with MP and earn more

              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>

            </button>

          </div>

        </div>

      </div>

      <!-- Benefits row -->

      <div class="pdp-info-row">

        <span class="pdp-row-label">Perks</span>

        <div class="pdp-row-content">

          <div class="pdp-benefit-line">

            <span>Pay with MP · earn up to ${fmtPts(Math.round(mktNgnToMp(p.price_ngn)*0.02))} back (2%)</span>

            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>

          </div>

          <div class="pdp-benefit-line">

            <span>Instalment available · Escrow protected</span>

            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>

          </div>

        </div>

      </div>

      <!-- Shipping row -->

      <div class="pdp-info-row">

        <span class="pdp-row-label">Delivery</span>

        <div class="pdp-row-content">

          <div class="pdp-ship-detail">

            <strong>Ships today</strong><span class="pdp-ship-dot">·</span>estimated delivery date available<br>

            Order now for fastest dispatch<br>

            Free delivery

          </div>

          <div class="pdp-ship-more">

            See more

            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>

          </div>

        </div>

      </div>

    </div><!-- /pdp-info-rows -->

    <!-- REVIEW SUMMARY -->

    ${reviews.length > 0 || (p.review_count > 0) ? `

    <div class="pdp-review-summary">

      <div class="pdp-review-summary-title">

        <span>94%</span> of reviews are 4 stars or above

        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:middle;margin-left:4px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>

      </div>

      <div class="pdp-review-cards">

        ${reviews.slice(0,5).map(r => `

          <div class="pdp-review-card">

            <img class="pdp-review-card-img" src="${r.reviewer?.avatar||''}" onerror="this.style.background='var(--bg3)';this.src=''" alt="">

            <div class="pdp-review-card-body">

              <div class="pdp-review-card-top">

                <span class="pdp-review-card-star">★</span>

                <span class="pdp-review-card-score">${r.rating}</span>

                <span class="pdp-review-card-tag">True to size</span>

              </div>

              <div class="pdp-review-card-text">${escHtml(r.review||'')}</div>

            </div>

          </div>`).join('')}

        ${reviews.length === 0 ? `

          <div class="pdp-review-card">

            <div class="pdp-review-card-img" style="background:var(--bg3)"></div>

            <div class="pdp-review-card-body">

              <div class="pdp-review-card-top"><span class="pdp-review-card-star">★</span><span class="pdp-review-card-score">5</span><span class="pdp-review-card-tag">True to size</span></div>

              <div class="pdp-review-card-text">Great quality, looks exactly as shown. Highly recommend!</div>

            </div>

          </div>` : ''}

      </div>

    </div>` : ''}

    <!-- RELATED PRODUCTS -->

    <div class="pdp-related-section">

      <div class="pdp-related-header">

        <div class="pdp-related-title">More colours &amp; styles</div>

      </div>

      <div class="pdp-related-scroll" id="pdp-related-scroll">

        <div class="pdp-related-card">

          <div class="pdp-related-img-wrap">

            <div class="pdp-related-img" style="background:var(--bg2)"></div>

            <button class="pdp-related-wish">

              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>

            </button>

          </div>

          <button class="pdp-related-add-btn">

            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>

            Add

          </button>

          <div class="pdp-related-name">Related item</div>

          <div class="pdp-related-price-row">

            <span class="pdp-related-price">${mktFmtNgn(p.price_ngn)}</span>

          </div>

          <div class="pdp-related-ship">Free delivery</div>

        </div>

      </div>

    </div>

    <!-- TAB BAR -->

    <div class="pdp-tab-bar" id="pdp-tab-bar">

      <button class="pdp-tab-btn active" onclick="pdpSwitchTab('details',this)">Details</button>

      <button class="pdp-tab-btn" onclick="pdpSwitchTab('reviews',this)">Reviews ${p.review_count||0}</button>

      <button class="pdp-tab-btn" onclick="pdpSwitchTab('qa',this)">Q&amp;A</button>

      <button class="pdp-tab-btn" onclick="pdpSwitchTab('seller',this)">Seller Info</button>

      <button class="pdp-tab-btn" onclick="pdpSwitchTab('related',this)">Recommended</button>

    </div>

    <!-- TAB: DETAILS (default active) -->

    <div class="pdp-tab-panel active" id="pdp-panel-details">

      <div class="pdp-detail-panel">

        ${variants.length > 0 ? `

        <div class="pdp-variants" id="pdp-variants">

          ${variants.map(v => `

            <div class="pdp-variant-group">

              <div class="pdp-variant-label">${escHtml(v.name)}</div>

              <div class="pdp-variant-options">

                ${(v.options||[]).map((opt,i) => `

                  <button class="pdp-variant-opt ${i===0?'selected':''} ${opt.stock===0?'out-of-stock':''}"

                    data-variant-id="${v.id}" data-option-index="${i}"

                    onclick="selectVariantOption(this,'${v.id}',${i})" ${opt.stock===0?'disabled':''}>

                    ${escHtml(opt.name)}

                    ${opt.price_ngn && opt.price_ngn !== p.price_ngn ? `<span style="font-size:10px;opacity:0.7;display:block">${mktFmtNgn(opt.price_ngn)}</span>` : ''}

                  </button>`).join('')}

              </div>

            </div>`).join('')}

        </div>` : ''}

        <div class="pdp-qty-row">

          <span class="pdp-qty-label">Quantity</span>

          <div class="pdp-qty-ctrl">

            <button class="pdp-qty-btn" onclick="pdpChangeQty(-1)">−</button>

            <span class="pdp-qty-val" id="pdp-qty">1</span>

            <button class="pdp-qty-btn" onclick="pdpChangeQty(1)">+</button>

          </div>

          <span class="pdp-stock-hint">${p.stock > 0 ? p.stock + ' in stock' : 'Out of stock'}</span>

        </div>

        ${p.description ? `

        <div class="pdp-detail-section-title">Description</div>

        <div class="pdp-description">${escHtml(p.description)}</div>` : ''}

        <div class="pdp-detail-section-title">Product Info</div>

        <div class="pdp-details">

          <div class="pdp-detail-row"><span>Condition</span><span>${p.condition||'—'}</span></div>

          ${p.sku ? `<div class="pdp-detail-row"><span>SKU</span><span>${escHtml(p.sku)}</span></div>` : ''}

          ${p.weight_kg ? `<div class="pdp-detail-row"><span>Weight</span><span>${p.weight_kg}kg</span></div>` : ''}

          <div class="pdp-detail-row"><span>Category</span><span>${escHtml(p.category||'—')}</span></div>

        </div>

      </div>

      <!-- Safety notice -->

      <div class="pdp-safety-card">

        <svg class="pdp-safety-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" fill="#ff3b5c" opacity="0.15"/><circle cx="12" cy="12" r="10" fill="none" stroke="#ff3b5c" stroke-width="2"/><line x1="12" y1="8" x2="12" y2="12" stroke="#ff3b5c" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16" r="1" fill="#ff3b5c"/></svg>

        <div class="pdp-safety-text">

          If a seller directs you to pay outside MistyNote or asks for personal details via external links,

          <a>do not pay</a> and report them immediately via <a>Help &amp; Support</a>.

        </div>

      </div>

    </div>

    <!-- TAB: REVIEWS -->

    <div class="pdp-tab-panel" id="pdp-panel-reviews">

      <div class="pdp-reviews-panel">

        ${reviews.length > 0

          ? `<div class="pdp-reviews-top"><span>94%</span> of reviews are 4 stars or above</div>

             ${reviews.map(r => `

               <div class="sf-review">

                 <div class="sf-review-header">

                   <img class="sf-review-avatar" src="${r.reviewer?.avatar||''}" onerror="this.src=''" alt="">

                   <div>

                     <div class="sf-review-name">@${escHtml(r.reviewer?.username||'User')}</div>

                     <div class="sf-review-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</div>

                   </div>

                   <div class="sf-review-time">${timeSince(r.created_at)}</div>

                 </div>

                 ${r.review ? `<div class="sf-review-text">${escHtml(r.review)}</div>` : ''}

               </div>`).join('')}`

          : `<div style="padding:40px 0;text-align:center;color:var(--text3);font-size:14px;">No reviews yet — be the first!</div>`}

      </div>

    </div>

    <!-- TAB: Q&A -->

    <div class="pdp-tab-panel" id="pdp-panel-qa">

      <div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:14px;">Q&amp;A coming soon</div>

    </div>

    <!-- TAB: SELLER INFO -->

    <div class="pdp-tab-panel" id="pdp-panel-seller">

      ${sf.id ? `

      <div style="padding:16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border2);cursor:pointer" onclick="openStorefront('${sf.id}')">

        <img style="width:48px;height:48px;border-radius:10px;object-fit:cover;background:var(--bg2)" src="${sf.logo_url||''}" onerror="this.style.background='var(--bg2)'" alt="">

        <div style="flex:1">

          <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:2px">${escHtml(sf.store_name||'')}</div>

          <div style="font-size:12px;color:var(--text3)">${escHtml(sf.category||'')} · Visit store</div>

        </div>

        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>

      </div>` : `<div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:14px;">No seller info available</div>`}

    </div>

    <!-- TAB: RECOMMENDED -->

    <div class="pdp-tab-panel" id="pdp-panel-related">

      <div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:14px;">Recommended products coming soon</div>

    </div>

    <!-- Bottom spacer so last content clears fixed CTA -->

    <div style="height:calc(72px + var(--safe-bottom))"></div>`;

  // ── Show & populate the fixed bars that live outside #page-product ──

  var topBar   = document.getElementById('pdp-top-bar');

  var ctaBar   = document.getElementById('pdp-cta-bar');

  var storeName = document.getElementById('pdp-top-store-name');

  var buyBtn   = document.getElementById('pdp-buy-now-btn');

  var giftBtn  = document.getElementById('pdp-gift-btn');

  var soldBtn  = document.getElementById('pdp-sold-out-btn');

  // Set store name in top bar

  if (storeName) storeName.textContent = sf.store_name || 'MistyNote';

  // Wire buy button to this product

  if (buyBtn)  buyBtn.onclick  = function() { buyNow(p.id); };

  if (giftBtn) giftBtn.onclick = function() { /* gift flow */ };

  // Show/hide sold out vs active buttons

  if (p.stock > 0) {

    if (giftBtn) giftBtn.style.display = '';

    if (buyBtn)  buyBtn.style.display  = '';

    if (soldBtn) soldBtn.style.display = 'none';

  } else {

    if (giftBtn) giftBtn.style.display = 'none';

    if (buyBtn)  buyBtn.style.display  = 'none';

    if (soldBtn) soldBtn.style.display = '';

  }

  // Show both bars

  if (topBar) topBar.style.display = 'flex';

  if (ctaBar) ctaBar.style.display = 'flex';

  initPdpSwipe();

  // Record view

  if (currentUser) { try { await supabase.rpc('record_product_view', { p_product_id: productId }); } catch(e) {} }

}

let pdpCurrentImage = 0;

function pdpGoToImage(index) {

  document.querySelectorAll('.pdp-img-slide').forEach((s,i) => s.classList.toggle('active', i===index));

  document.querySelectorAll('.pdp-img-dot').forEach((d,i)   => d.classList.toggle('active', i===index));

  pdpCurrentImage = index;

}

function pdpSwitchTab(tab, btn) {

  // Switch panels

  document.querySelectorAll('.pdp-tab-panel').forEach(function(p) { p.classList.remove('active'); });

  var panel = document.getElementById('pdp-panel-' + tab);

  if (panel) panel.classList.add('active');

  // Switch active tab button

  document.querySelectorAll('.pdp-tab-btn').forEach(function(b) { b.classList.remove('active'); });

  if (btn) btn.classList.add('active');

  // Scroll tab bar so active tab is visible

  // Scroll the tab bar so active tab is visible — scroll the bar itself, not the page

  if (btn) {

    var bar = document.getElementById('pdp-tab-bar');

    if (bar) {

      var btnLeft   = btn.offsetLeft;

      var btnWidth  = btn.offsetWidth;

      var barWidth  = bar.offsetWidth;

      var target    = btnLeft - (barWidth / 2) + (btnWidth / 2);

      bar.scrollTo({ left: target, behavior: 'smooth' });

    }

  }

}

function initPdpSwipe() {

  const container = document.getElementById('pdp-images');

  if (!container) return;

  let startX = 0;

  container.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });

  container.addEventListener('touchend', e => {

    const diff  = startX - e.changedTouches[0].clientX;

    const total = document.querySelectorAll('.pdp-img-slide').length;

    if (Math.abs(diff) > 50) {

      if (diff > 0 && pdpCurrentImage < total - 1) pdpGoToImage(pdpCurrentImage + 1);

      if (diff < 0 && pdpCurrentImage > 0)         pdpGoToImage(pdpCurrentImage - 1);

    }

  }, { passive: true });

}

let pdpQty = 1;

function pdpChangeQty(delta) {

  pdpQty = Math.max(1, pdpQty + delta);

  const el = document.getElementById('pdp-qty');

  if (el) el.textContent = pdpQty;

}

let selectedVariants = {};

function selectVariantOption(btn, variantId, optionIndex) {

  document.querySelectorAll(`.pdp-variant-opt[data-variant-id="${variantId}"]`).forEach(b => b.classList.remove('selected'));

  btn.classList.add('selected');

  selectedVariants[variantId] = optionIndex;

}

// ══════════════════════════════════════════

// CART

// ══════════════════════════════════════════

async function syncCartCount() {

  if (!currentUser) return;

  try {

    const { count } = await supabase.from('cart_items').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id);

    cartCount = count || 0;

    updateCartBadges();

  } catch(e) { /* silent */ }

}

function updateCartBadges() {

  ['mkt-cart-badge','sidepane-cart-badge'].forEach(id => {

    const el = document.getElementById(id);

    if (el) { el.textContent = cartCount; el.style.display = cartCount > 0 ? 'flex' : 'none'; }

  });

}

async function addToCart(productId) {

  if (!currentUser) { showToast('Sign in to add to cart'); return; }

  const btn = document.getElementById('pdp-cart-btn');

  if (btn) btn.disabled = true;

  try {

    const { error } = await supabase.from('cart_items').upsert({

      user_id: currentUser.id, product_id: productId, quantity: pdpQty,

    }, { onConflict: 'user_id,product_id,variant_id' });

    if (error) throw error;

    cartCount++;

    updateCartBadges();

    if (btn) { btn.textContent = 'Added to Cart ✓'; btn.style.background = '#00c48c'; }

    showToast('Added to cart ✓');

  } catch(e) {

    showToast('Failed to add to cart');

    if (btn) btn.disabled = false;

  }

}

async function loadCartPage() {

  const el = document.getElementById('cart-content');

  if (!el) return;

  el.innerHTML = `<div class="loading-pulse" style="height:300px"></div>`;

  if (!currentUser) { el.innerHTML = `<div class="empty-state"><p>Sign in to view cart</p></div>`; return; }

  const { data: items } = await supabase.from('cart_items')

    .select('*, product:products(*, storefront:storefronts(store_name,logo_url))')

    .eq('user_id', currentUser.id).order('created_at', { ascending: false });

  cartItems = items || [];

  if (!cartItems.length) {

    el.innerHTML = `<div class="empty-state"><div style="font-size:48px;margin-bottom:12px">🛒</div><p>Your cart is empty</p><span>Browse the market to find products</span><button class="btn-primary" style="margin-top:16px" onclick="slideBack();navTo('market')">Browse Market</button></div>`;

    return;

  }

  const byStore = {};

  cartItems.forEach(item => {

    const key = item.product?.storefront?.store_name || 'Unknown Store';

    if (!byStore[key]) byStore[key] = [];

    byStore[key].push(item);

  });

  let subtotal = 0;

  cartItems.forEach(item => { subtotal += (item.product?.price_ngn || 0) * item.quantity; });

  el.innerHTML = `

    <div class="cart-body">

      ${Object.entries(byStore).map(([storeName, storeItems]) => `

        <div class="cart-store-group">

          <div class="cart-store-header">

            <img class="cart-store-logo merchant-avatar" src="${storeItems[0].product?.storefront?.logo_url||''}" onerror="this.style.display='none'" alt="">

            <span class="cart-store-name">${escHtml(storeName)}</span>

          </div>

          ${storeItems.map(item => `

            <div class="cart-item" id="cart-item-${item.id}">

              <div class="cart-item-img-wrap">

                ${item.product?.images?.[0] ? `<img src="${item.product.images[0]}" class="cart-item-img" alt="">` : `<div class="cart-item-img" style="background:${gradientFor(item.product_id)}"></div>`}

              </div>

              <div class="cart-item-info">

                <div class="cart-item-title">${escHtml(item.product?.title||'')}</div>

                <div class="cart-item-price">${mktFmtNgn(item.product?.price_ngn||0)}</div>

                <div class="cart-item-mp">${fmtPts(mktNgnToMp(item.product?.price_ngn||0))}</div>

              </div>

              <div class="cart-item-actions">

                <div class="cart-qty-ctrl">

                  <button class="cart-qty-btn" onclick="updateCartQty('${item.id}','${item.product_id}',-1)">−</button>

                  <span class="cart-qty-val" id="cart-qty-${item.id}">${item.quantity}</span>

                  <button class="cart-qty-btn" onclick="updateCartQty('${item.id}','${item.product_id}',1)">+</button>

                </div>

                <button class="cart-remove-btn" onclick="removeFromCart('${item.id}')">

                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>

                </button>

              </div>

            </div>`).join('')}

        </div>`).join('')}

      <div class="cart-summary">

        <div class="cart-summary-row"><span>Subtotal</span><span>${mktFmtNgn(subtotal)}</span></div>

        <div class="cart-summary-row"><span>Shipping</span><span>Calculated at checkout</span></div>

        <div class="cart-summary-total"><span>Total</span><span>${mktFmtNgn(subtotal)}</span></div>

        <div class="cart-summary-mp">Pay with ${fmtPts(mktNgnToMp(subtotal))}</div>

      </div>

      <div style="padding:0 16px 32px">

        <button class="cart-checkout-btn" onclick="openCheckout()">Proceed to Checkout</button>

      </div>

    </div>`;

}

async function updateCartQty(itemId, productId, delta) {

  const qtyEl  = document.getElementById(`cart-qty-${itemId}`);

  const newQty = Math.max(1, parseInt(qtyEl?.textContent || '1') + delta);

  if (qtyEl) qtyEl.textContent = newQty;

  await supabase.from('cart_items').update({ quantity: newQty }).eq('id', itemId);

}

async function removeFromCart(itemId) {

  const el = document.getElementById(`cart-item-${itemId}`);

  if (el) { el.style.opacity = '0.4'; el.style.pointerEvents = 'none'; }

  await supabase.from('cart_items').delete().eq('id', itemId);

  cartCount = Math.max(0, cartCount - 1);

  updateCartBadges();

  if (el) el.remove();

}

async function clearCart() {

  if (!currentUser) return;

  showActionSheet([{ label: 'Clear Cart', danger: true, action: async () => {

    await supabase.from('cart_items').delete().eq('user_id', currentUser.id);

    cartCount = 0; updateCartBadges(); loadCartPage();

  }}]);

}

async function buyNow(productId) {

  await addToCart(productId);

  openCheckout();

}

// ══════════════════════════════════════════

// CHECKOUT

// ══════════════════════════════════════════

async function openCheckout() { slideTo('checkout', loadCheckoutPage); }

async function loadCheckoutPage() {

  const el = document.getElementById('checkout-content');

  if (!el) return;

  el.innerHTML = `<div class="loading-pulse" style="height:300px"></div>`;

  if (!currentUser) { el.innerHTML = `<div class="empty-state"><p>Sign in to checkout</p></div>`; return; }

  // ── Sync wallet balance FIRST before rendering so the displayed balance is accurate ──

  await syncWalletBalance();

  const { data: items } = await supabase.from('cart_items')

    .select('*, product:products(*, storefront:storefronts(id,store_name,logo_url,user_id))')

    .eq('user_id', currentUser.id);

  if (!items?.length) { slideBack(); return; }

  const byStore = {};

  items.forEach(item => {

    const sfId = item.product?.storefront?.id;

    if (!byStore[sfId]) byStore[sfId] = { storefront: item.product?.storefront, items: [] };

    byStore[sfId].items.push(item);

  });

  const subtotal = items.reduce((s, i) => s + (i.product?.price_ngn||0) * i.quantity, 0);

  const { data: states } = await supabase.from('ng_states').select('name').order('name');

  el.innerHTML = `

    <div class="co-body">

      <div class="co-section">

        <div class="co-section-title">Order Summary</div>

        ${items.map(item => `

          <div class="co-item">

            <div class="co-item-img-wrap">

              ${item.product?.images?.[0] ? `<img src="${item.product.images[0]}" class="co-item-img" alt="">` : `<div class="co-item-img" style="background:${gradientFor(item.product_id)}"></div>`}

            </div>

            <div class="co-item-info">

              <div class="co-item-title">${escHtml(item.product?.title||'')}</div>

              <div class="co-item-qty">Qty: ${item.quantity}</div>

            </div>

            <div class="co-item-price">${mktFmtNgn((item.product?.price_ngn||0)*item.quantity)}</div>

          </div>`).join('')}

      </div>

      <div class="co-section">

        <div class="co-section-title">Delivery Information</div>

        <div class="co-field"><label class="co-label">Full Name</label><input class="co-input" id="co-name" placeholder="Recipient name" value="${currentProfile?.display_name||''}"></div>

        <div class="co-field"><label class="co-label">Phone Number</label><input class="co-input" id="co-phone" type="tel" placeholder="08012345678"></div>

        <div class="co-field"><label class="co-label">State</label>

          <select class="co-input" id="co-state" onchange="loadShippingRates()">

            <option value="">Select delivery state…</option>

            ${(states||[]).map(s => `<option>${s.name}</option>`).join('')}

          </select>

        </div>

        <div class="co-field"><label class="co-label">Delivery Address</label><textarea class="co-input" id="co-address" placeholder="Street address, area, landmark…" rows="2"></textarea></div>

      </div>

      <div class="co-section">

        <div class="co-section-title">Discount Code</div>

        <div class="co-discount-row">

          <input class="co-input" id="co-discount-code" placeholder="Enter code" style="flex:1">

          <button class="co-apply-btn" onclick="applyDiscountCode()">Apply</button>

        </div>

        <div class="co-discount-result" id="co-discount-result" style="display:none"></div>

      </div>

      <div class="co-section co-summary">

        <div class="co-summary-row"><span>Subtotal</span><span id="co-subtotal">${mktFmtNgn(subtotal)}</span></div>

        <div class="co-summary-row"><span>Shipping</span><span id="co-shipping">Select state above</span></div>

        <div class="co-summary-row" id="co-discount-row" style="display:none;color:var(--red)"><span>Discount</span><span id="co-discount-amount">-₦0</span></div>

        <div class="co-summary-total"><span>Total</span><span id="co-total">${mktFmtNgn(subtotal)}</span></div>

        <div class="co-wallet-balance">Wallet: ${fmtPts(walletState.points)}<span id="co-balance-status" style="margin-left:8px"></span></div>

      </div>

      <div class="co-pin-notice">

        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>

        Payment secured by your Wallet PIN

      </div>

      <button class="co-place-order-btn" id="co-place-btn" onclick="placeOrder()">Place Order</button>

      <div style="height:32px"></div>

    </div>`;

  window._coItems    = items;

  window._coByStore  = byStore;

  window._coSubtotal = subtotal;

  window._coDiscount = 0;

  window._coShipping = 0;

}

let _shippingByStore = {};

async function loadShippingRates() {

  const state      = document.getElementById('co-state')?.value;

  const streetEl   = document.getElementById('co-street');

  const shippingEl = document.getElementById('co-shipping');

  const totalEl    = document.getElementById('co-total');

  const balEl      = document.getElementById('co-balance-status');

  if (!state || !shippingEl) return;

  shippingEl.textContent = 'Getting rate…';

  const storeIds = Object.keys(window._coByStore || {});

  let totalShipping = 0;

  _shippingByStore  = {};

  for (const sfId of storeIds) {

    let rateNgn = 0;

    try {

      const { data: sf } = await supabase.from('storefronts').select('pickup_state, pickup_address').eq('id', sfId).maybeSingle();

      const rateRes = await sendboxRequest('POST', '/shipping/rates', {
        origin:      { state: sf?.pickup_state || 'Lagos', address: sf?.pickup_address || '', country: 'NG' },
        destination: { state, address: streetEl?.value?.trim() || '', country: 'NG' },
        weight: 1, length: 10, width: 10, height: 10, type: 'parcel',
      });

      const rates = rateRes?.data || rateRes?.rates || [];

      if (rates.length > 0) {
        rateNgn = rates.reduce((a, b) => (a.amount < b.amount ? a : b)).amount || 0;
      } else {
        const { data: dbRate } = await supabase.from('shipping_rates').select('rate_ngn').eq('storefront_id', sfId).eq('state', state).maybeSingle();
        rateNgn = dbRate?.rate_ngn || 0;
      }

    } catch (err) {

      console.warn('[Sendbox] Rate fetch failed, using DB fallback:', err.message);
      const { data: dbRate } = await supabase.from('shipping_rates').select('rate_ngn').eq('storefront_id', sfId).eq('state', state).maybeSingle();
      rateNgn = dbRate?.rate_ngn || 0;

    }

    _shippingByStore[sfId] = rateNgn;

    totalShipping += rateNgn;

  }

  window._coShipping = totalShipping;

  shippingEl.textContent = totalShipping > 0 ? mktFmtNgn(totalShipping) : 'Free';

  const total  = (window._coSubtotal||0) + totalShipping - (window._coDiscount||0);

  if (totalEl) totalEl.textContent = mktFmtNgn(total);

  const needed = mktNgnToMp(total);

  if (balEl) {

    balEl.textContent = walletState.points >= needed ? '✓ Sufficient' : `Need ${fmtPts(needed - walletState.points)} more`;

    balEl.style.color = walletState.points >= needed ? '#00c48c' : 'var(--red)';

  }

}

let _appliedDiscount = null;

async function applyDiscountCode() {

  const code     = document.getElementById('co-discount-code')?.value.trim().toUpperCase();

  const resultEl = document.getElementById('co-discount-result');

  if (!code || !resultEl) return;

  const storeIds = Object.keys(window._coByStore || {});

  let found = null;

  for (const sfId of storeIds) {

    const { data } = await supabase.from('discount_codes').select('*').eq('storefront_id', sfId).ilike('code', code).eq('is_active', true).maybeSingle();

    if (data) { found = data; break; }

  }

  if (!found) { resultEl.style.display='block'; resultEl.style.color='var(--red)'; resultEl.textContent='Invalid or expired code'; return; }

  if (found.expires_at && new Date(found.expires_at) < new Date()) { resultEl.style.display='block'; resultEl.style.color='var(--red)'; resultEl.textContent='This code has expired'; return; }

  if (found.max_uses && found.uses_count >= found.max_uses) { resultEl.style.display='block'; resultEl.style.color='var(--red)'; resultEl.textContent='This code has reached its usage limit'; return; }

  const subtotal = window._coSubtotal || 0;

  if (subtotal < (found.min_order_ngn||0)) { resultEl.style.display='block'; resultEl.style.color='var(--red)'; resultEl.textContent=`Minimum order ${mktFmtNgn(found.min_order_ngn)} required`; return; }

  const discount = found.type === 'percentage' ? Math.round(subtotal * found.value / 100) : found.value;

  window._coDiscount = discount;

  _appliedDiscount   = found;

  const discountRow = document.getElementById('co-discount-row');

  const discountAmt = document.getElementById('co-discount-amount');

  if (discountRow) discountRow.style.display = 'flex';

  if (discountAmt) discountAmt.textContent   = '-' + mktFmtNgn(discount);

  const total   = subtotal + (window._coShipping||0) - discount;

  const totalEl = document.getElementById('co-total');

  if (totalEl) totalEl.textContent = mktFmtNgn(total);

  resultEl.style.display='block'; resultEl.style.color='#00c48c';

  resultEl.textContent = `${found.type==='percentage' ? found.value+'%' : mktFmtNgn(found.value)} discount applied ✓`;

}

async function placeOrder() {

  const name    = document.getElementById('co-name')?.value.trim();

  const phone   = document.getElementById('co-phone')?.value.trim();

  const state   = document.getElementById('co-state')?.value.trim();

  const address = document.getElementById('co-address')?.value.trim();

  const btn     = document.getElementById('co-place-btn');

  if (!name)    { showToast('Enter recipient name'); return; }

  if (!phone)   { showToast('Enter phone number'); return; }

  if (!state)   { showToast('Select delivery state'); return; }

  if (!address) { showToast('Enter delivery address'); return; }

  const items = window._coItems || [];

  if (!items.length) { showToast('Your cart is empty'); return; }

  const totalMp = items.reduce((s, i) => s + Math.ceil(mktNgnToMp((i.product?.price_ngn||0) * i.quantity) * 100) / 100, 0);

  if (walletState.points < totalMp) { showToast('Insufficient MistyPoints — top up your wallet'); openWallet(); return; }

  const pinOk = await walletPinCheck();

  if (!pinOk) return;

  btn.disabled = true; btn.textContent = 'Placing order…';

  try {

    for (const item of items) {

      const sellerId  = item.product?.storefront?.user_id;

      const productId = item.product_id;

      const priceNgn  = (item.product?.price_ngn || 0) * item.quantity;

      const priceMp   = Math.ceil(mktNgnToMp(priceNgn) * 100) / 100;

      if (!sellerId) throw new Error('Seller not found for: ' + (item.product?.title || productId));

      if (sellerId === currentUser.id) throw new Error('You cannot buy your own product');

      // Auto-cancel if seller doesn't respond in 48 hours

      const autoCancel = new Date(Date.now() + 48 * 60 * 60 * 1000);

      const { data: order, error: orderErr } = await supabase.from('orders').insert({

        buyer_id:         currentUser.id,

        seller_id:        sellerId,

        product_id:       productId,

        title:            item.product?.title || '',

        quantity:         item.quantity,

        price_ngn:        priceNgn,

        price_mp:         priceMp,

        status:           'pending',

        shipping_address: `${name} · ${phone} · ${state} · ${address}`,

        auto_cancel_at:   autoCancel.toISOString(),

      }).select().single();

      if (orderErr) throw new Error('Order failed: ' + orderErr.message);

      // Hold MP in escrow immediately

      const { error: escrowErr } = await supabase.rpc('escrow_hold_points', {

        buyer_id: currentUser.id, seller_id: sellerId, order_id: order.id, points: priceMp,

      });

      if (escrowErr) console.log('[placeOrder] escrow note:', escrowErr.message);

      // Notify seller with accept/decline prompt

      insertNotification({ user_id: sellerId, actor_id: currentUser.id, type: 'new_order',

        comment_text: `New order: ${item.product?.title || 'your product'} · ${mktFmtNgn(priceNgn)} — Accept or decline within 48hrs` });

      try { await supabase.rpc('decrement_stock', { p_product_id: productId, p_qty: item.quantity }); } catch(e) {}

    }

    await supabase.from('cart_items').delete().eq('user_id', currentUser.id);

    cartCount = 0; updateCartBadges(); syncWalletBalance();

    showToast('Order placed! Waiting for seller to accept 🎉');

    slideBack();

    setTimeout(() => openMyBag(), 400);

  } catch(e) {

    btn.disabled = false; btn.textContent = 'Place Order';

    showToast('Order failed: ' + (e.message || 'Please try again'));

  }

}

// ══════════════════════════════════════════

// MY BAG (Buyer orders)

// ══════════════════════════════════════════

function openMyBag() { slideTo('my-bag', loadMyBag); }

async function loadMyBag() {

  const el = document.getElementById('my-bag-content');

  if (!el) return;

  el.innerHTML = `<div class="loading-pulse" style="height:300px"></div>`;

  if (!currentUser) { el.innerHTML = `<div class="empty-state"><p>Sign in to view your bag</p></div>`; return; }

  const { data: orders } = await supabase.from('orders')

    .select('*').eq('buyer_id', currentUser.id).order('created_at', { ascending: false });

  if (!orders?.length) {

    el.innerHTML = `<div class="empty-state"><div style="font-size:48px;margin-bottom:12px">🛍️</div><p>No orders yet</p><span>Your purchases will appear here</span><button class="btn-primary" style="margin-top:16px" onclick="slideBack();navTo('market')">Start Shopping</button></div>`;

    return;

  }

  const statusMeta = {

    pending:    { color:'#ff9500', bg:'rgba(255,149,0,0.1)',    icon:'⏳', label:'Awaiting seller' },

    accepted:   { color:'#007aff', bg:'rgba(0,122,255,0.1)',    icon:'✓',  label:'Accepted' },

    processing: { color:'#007aff', bg:'rgba(0,122,255,0.1)',    icon:'⚙️', label:'Processing' },

    shipping_requested: { color:'#ff9500', bg:'rgba(255,149,0,0.1)', icon:'📦', label:'Pickup Requested' },

    shipped:    { color:'#6C47FF', bg:'rgba(108,71,255,0.1)',   icon:'🚚', label:'Shipped' },

    delivered:  { color:'#00c48c', bg:'rgba(0,196,140,0.1)',    icon:'✅', label:'Delivered' },

    cancelled:  { color:'#ff3b5c', bg:'rgba(255,59,92,0.1)',    icon:'✕',  label:'Cancelled' },

    declined:   { color:'#ff3b5c', bg:'rgba(255,59,92,0.1)',    icon:'✕',  label:'Declined' },

    refunded:   { color:'#8e8e93', bg:'rgba(142,142,147,0.1)',  icon:'↩',  label:'Refunded' },

  };

  el.innerHTML = `<div class="bag-list">${orders.map(order => {

    const meta = statusMeta[order.status] || { color:'var(--text3)', bg:'var(--bg2)', icon:'•', label: order.status };

    const addrParts = (order.shipping_address||'').split(' · ');

    const storeLabel = escHtml(order.title || '—');

    return `

      <div class="bag-order-card" onclick="openOrderDetail('${order.id}','buyer')">

        <div style="display:flex;gap:14px;align-items:flex-start">

          <div style="width:58px;height:58px;border-radius:14px;background:${gradientFor(order.product_id||order.id)};flex-shrink:0;position:relative">

            <span style="position:absolute;bottom:-6px;right:-6px;width:22px;height:22px;border-radius:50%;background:${meta.color};color:white;font-size:11px;display:flex;align-items:center;justify-content:center;border:2px solid var(--surface)">${meta.icon}</span>

          </div>

          <div style="flex:1;min-width:0">

            <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px">${storeLabel}</div>

            <div style="font-size:12px;color:var(--text3);margin-bottom:6px">Qty ${order.quantity||1} · ${timeSince(order.created_at)}</div>

            <div style="display:inline-flex;align-items:center;gap:5px;background:${meta.bg};padding:3px 10px;border-radius:20px">

              <span style="font-size:12px;font-weight:700;color:${meta.color}">${meta.label}</span>

            </div>

          </div>

          <div style="text-align:right;flex-shrink:0">

            <div style="font-size:14px;font-weight:800;color:var(--text)">${mktFmtNgn(order.price_ngn||0)}</div>

            <div style="font-size:11px;color:var(--accent);margin-top:2px">${fmtPts(order.price_mp||0)}</div>

          </div>

        </div>

        ${order.status==='pending' ? `

        <div style="margin-top:12px;padding:10px 12px;background:rgba(255,149,0,0.08);border-radius:10px;border-left:3px solid #ff9500;font-size:12px;color:#ff9500">

          ⏳ Waiting for seller to accept · MP held in escrow

        </div>` : ''}

        ${order.status==='declined' ? `

        <div style="margin-top:12px;padding:10px 12px;background:rgba(255,59,92,0.08);border-radius:10px;border-left:3px solid #ff3b5c;font-size:12px;color:#ff3b5c">

          ✕ Seller declined · ${order.decline_reason ? escHtml(order.decline_reason) : 'MP will be refunded automatically'}

        </div>` : ''}

        ${order.status==='shipped' ? `

        <div style="margin-top:12px">

          <button class="bag-confirm-btn" onclick="event.stopPropagation();confirmDelivery('${order.id}')">

            ✓ Confirm Delivery

          </button>

        </div>` : ''}

      </div>`;

  }).join('')}</div>`;

}

async function confirmDelivery(orderId) {

  showActionSheet([{ label: '✓ Confirm Delivery', action: async () => {

    showToast('Confirming delivery…');

    const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();

    if (!order) { showToast('Order not found'); return; }

    try { await supabase.rpc('escrow_release_points', { seller_id: order.seller_id, buyer_id: order.buyer_id, order_id: order.id, points: order.price_mp }); } catch(e) {}

    await supabase.from('orders').update({ status: 'delivered', confirmed_at: new Date().toISOString() }).eq('id', orderId);

    try { await supabase.rpc('increment_storefront_stats', { p_seller_id: order.seller_id, p_revenue: order.price_ngn||0 }); } catch(e) {}

    insertNotification({ user_id: order.seller_id, actor_id: currentUser.id, type: 'delivery_confirmed',

      comment_text: `Delivery confirmed for "${order.title||'your product'}" — MP released to your wallet ✓` });

    showToast('Delivery confirmed! Payment released ✓');

    loadMyBag();

    setTimeout(() => promptReview(orderId), 1000);

  }}, { label: 'Cancel', action: () => {} }]);

}

async function promptReview(orderId) {

  const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();

  if (!order?.product_id) return;

  showActionSheet([{ label: '⭐ Leave a Review', action: () => openLeaveReview(order) }, { label: 'Maybe later', action: () => {} }]);

}

// ══════════════════════════════════════════

// SHOP ORDERS (Seller incoming orders)

// ══════════════════════════════════════════

function openShopOrders() { slideTo('shop-orders', loadShopOrders); }

async function loadShopOrders() {

  const el = document.getElementById('shop-orders-content');

  if (!el || !currentStorefront) return;

  el.innerHTML = `<div class="loading-pulse" style="height:300px"></div>`;

  const sellerId = currentStorefront.user_id || currentUser.id;

  const { data: orders } = await supabase.from('orders')

    .select('*').eq('seller_id', sellerId).order('created_at', { ascending: false });

  if (!orders?.length) {

    el.innerHTML = `<div class="empty-state"><div style="font-size:48px;margin-bottom:12px">📦</div><p>No orders yet</p><span>Orders from customers will appear here</span></div>`;

    return;

  }

  // Count pending needing action

  const pendingCount = orders.filter(o => o.status === 'pending').length;

  const tabs = [

    { id:'all',        label:'All',         count: orders.length },

    { id:'pending',    label:'New',          count: orders.filter(o=>o.status==='pending').length },

    { id:'accepted',   label:'Accepted',     count: orders.filter(o=>o.status==='accepted').length },

    { id:'processing', label:'Processing',   count: orders.filter(o=>o.status==='processing').length },

    { id:'shipping_requested', label:'Pickup Requested', count: orders.filter(o=>o.status==='shipping_requested').length },

    { id:'shipped',    label:'Shipped',      count: orders.filter(o=>o.status==='shipped').length },

    { id:'delivered',  label:'Delivered',    count: orders.filter(o=>o.status==='delivered').length },

  ].filter(t => t.id === 'all' || t.count > 0);

  el.innerHTML = `

    ${pendingCount > 0 ? `

    <div style="margin:16px 16px 0;padding:14px;background:rgba(255,149,0,0.08);border-radius:14px;border:1px solid rgba(255,149,0,0.25);display:flex;align-items:center;gap:10px">

      <span style="font-size:24px">⏳</span>

      <div>

        <div style="font-size:13px;font-weight:700;color:#ff9500">${pendingCount} order${pendingCount>1?'s':''} waiting for your response</div>

        <div style="font-size:12px;color:var(--text3)">Accept or decline within 48hrs to avoid auto-cancellation</div>

      </div>

    </div>` : ''}

    <div class="so-tabs" style="padding:12px 16px 0;display:flex;gap:8px;overflow-x:auto;scrollbar-width:none">

      ${tabs.map((t,i) => `

        <button class="so-tab ${i===0?'active':''}" onclick="filterShopOrders('${t.id}',this)"

          style="flex-shrink:0;padding:7px 14px;border-radius:20px;border:1.5px solid ${i===0?'var(--accent)':'var(--border)'};background:${i===0?'var(--accent-soft)':'none'};font-size:12px;font-weight:600;color:${i===0?'var(--accent)':'var(--text3)'};cursor:pointer;font-family:var(--font);white-space:nowrap">

          ${t.label}${t.count > 0 ? ` <span style="opacity:0.7">(${t.count})</span>` : ''}

        </button>`).join('')}

    </div>

    <div class="so-list" id="so-list" style="padding:12px 16px;display:flex;flex-direction:column;gap:10px">

      ${orders.map(order => renderShopOrderCard(order)).join('')}

    </div>`;

}

function renderShopOrderCard(order) {

  const statusMeta = {

    pending:    { color:'#ff9500', bg:'rgba(255,149,0,0.1)',   label:'New Order',   urgent: true },

    accepted:   { color:'#007aff', bg:'rgba(0,122,255,0.1)',   label:'Accepted' },

    processing: { color:'#007aff', bg:'rgba(0,122,255,0.1)',   label:'Processing' },

    shipped:    { color:'#6C47FF', bg:'rgba(108,71,255,0.1)',  label:'Shipped' },

    delivered:  { color:'#00c48c', bg:'rgba(0,196,140,0.1)',   label:'Delivered' },

    cancelled:  { color:'#8e8e93', bg:'rgba(142,142,147,0.1)', label:'Cancelled' },

    declined:   { color:'#ff3b5c', bg:'rgba(255,59,92,0.1)',   label:'Declined' },

  };

  const meta = statusMeta[order.status] || { color:'var(--text3)', bg:'var(--bg2)', label: order.status };

  const addrParts = (order.shipping_address||'').split(' · ');

  const shipState = addrParts[2] || '';

  return `

    <div class="so-order-card" data-status="${order.status}" onclick="openOrderDetail('${order.id}','seller')"

      style="background:var(--surface);border-radius:16px;padding:16px;border:1.5px solid ${meta.urgent ? 'rgba(255,149,0,0.4)' : 'var(--border)'};cursor:pointer;-webkit-tap-highlight-color:transparent;${meta.urgent ? 'box-shadow:0 0 0 3px rgba(255,149,0,0.08)' : ''}">

      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px">

        <div>

          <div style="font-size:11px;color:var(--text3);font-weight:500;margin-bottom:2px">#${order.id.slice(0,8).toUpperCase()} · ${timeSince(order.created_at)}</div>

          <div style="font-size:15px;font-weight:700;color:var(--text)">${escHtml(order.title||'—')}</div>

        </div>

        <span style="flex-shrink:0;background:${meta.bg};color:${meta.color};font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;margin-left:8px">${meta.label}</span>

      </div>

      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">

        <div style="width:52px;height:52px;border-radius:12px;background:${gradientFor(order.product_id||order.id)};flex-shrink:0"></div>

        <div style="flex:1">

          <div style="font-size:13px;color:var(--text2)">Qty: ${order.quantity||1}</div>

          ${shipState ? `<div style="font-size:12px;color:var(--text3)">📍 ${escHtml(shipState)}</div>` : ''}

        </div>

        <div style="text-align:right">

          <div style="font-size:15px;font-weight:800;color:var(--text)">${mktFmtNgn(order.price_ngn||0)}</div>

          <div style="font-size:11px;color:var(--accent)">${fmtPts(order.price_mp||0)}</div>

        </div>

      </div>

      ${order.status === 'pending' ? `

      <div style="display:flex;gap:8px" onclick="event.stopPropagation()">

        <button onclick="acceptOrder('${order.id}')"

          style="flex:1;height:44px;border-radius:12px;background:var(--accent);color:white;border:none;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font)">

          ✓ Accept

        </button>

        <button onclick="declineOrder('${order.id}')"

          style="flex:1;height:44px;border-radius:12px;background:none;color:#ff3b5c;border:1.5px solid #ff3b5c;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font)">

          ✕ Decline

        </button>

      </div>` : ''}

      ${order.status === 'accepted' ? `

      <div style="display:flex;gap:8px" onclick="event.stopPropagation()">

        <button onclick="updateOrderStatus('${order.id}','processing')"

          style="flex:1;height:44px;border-radius:12px;background:var(--bg2);color:var(--text);border:1px solid var(--border);font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font)">

          ⚙️ Mark Processing

        </button>

        <button onclick="openShipOrder('${order.id}')"

          style="flex:1;height:44px;border-radius:12px;background:var(--accent);color:white;border:none;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font)">

          📦 Request Pickup

        </button>

      </div>` : ''}

      ${order.status === 'processing' ? `

      <div onclick="event.stopPropagation()">

        <button onclick="openShipOrder('${order.id}')"

          style="width:100%;height:44px;border-radius:12px;background:var(--accent);color:white;border:none;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font)">

          📦 Request Pickup

        </button>

      </div>` : ''}

      ${order.status === 'shipping_requested' ? `

      <div style="padding:10px;background:rgba(255,149,0,0.08);border-radius:12px;font-size:12px;color:#ff9500;text-align:center">

        📦 Pickup requested — booking in progress

      </div>` : ''}

    </div>`;

}

function filterShopOrders(status, btn) {

  document.querySelectorAll('.so-tab').forEach(t => {

    t.classList.remove('active');

    t.style.borderColor = 'var(--border)';

    t.style.background  = 'none';

    t.style.color       = 'var(--text3)';

  });

  btn.classList.add('active');

  btn.style.borderColor = 'var(--accent)';

  btn.style.background  = 'var(--accent-soft)';

  btn.style.color       = 'var(--accent)';

  document.querySelectorAll('.so-order-card').forEach(card => {

    card.style.display = (status==='all' || card.dataset.status===status) ? 'block' : 'none';

  });

}

async function acceptOrder(orderId) {

  await supabase.from('orders').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', orderId);

  const { data: order } = await supabase.from('orders').select('buyer_id,title,price_ngn').eq('id', orderId).single();

  if (order) insertNotification({ user_id: order.buyer_id, actor_id: currentUser.id, type: 'order_accepted',

    comment_text: `Your order "${order.title||'your product'}" has been accepted! Seller is preparing your order.` });

  showToast('Order accepted ✓');

  loadShopOrders();

}

async function declineOrder(orderId) {

  // Show reason picker

  const reasons = ['Out of stock', 'Cannot deliver to this location', 'Pricing issue', 'Other'];

  showActionSheet([

    ...reasons.map(r => ({

      label: r,

      action: async () => {

        await supabase.from('orders').update({

          status: 'declined', declined_at: new Date().toISOString(), decline_reason: r,

        }).eq('id', orderId);

        // Refund MP back to buyer

        const { data: order } = await supabase.from('orders').select('buyer_id,seller_id,price_mp,title').eq('id', orderId).single();

        if (order) {

          try { await supabase.rpc('escrow_refund_points', { buyer_id: order.buyer_id, seller_id: order.seller_id, order_id: orderId, points: order.price_mp }); } catch(e) {}

          insertNotification({ user_id: order.buyer_id, actor_id: currentUser.id, type: 'order_declined',

            comment_text: `"${order.title||'Your order'}" was declined: ${r}. Your MP has been refunded.` });

        }

        showToast('Order declined. Buyer will be refunded.');

        loadShopOrders();

      }

    })),

    { label: 'Cancel', action: () => {} }

  ]);

}

async function updateOrderStatus(orderId, status) {

  await supabase.from('orders').update({ status }).eq('id', orderId);

  showToast('Order updated to ' + status);

  loadShopOrders();

}

async function openShipOrder(orderId) {

  const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();

  if (!order) { showToast('Order not found'); return; }

  const { data: sf } = await supabase.from('storefronts').select('store_name, pickup_state, pickup_address, pickup_name, pickup_phone').eq('user_id', order.seller_id).maybeSingle();

  const addrParts  = (order.shipping_address || '').split(' · ');
  const shipName   = addrParts[0] || '';
  const shipPhone  = addrParts[1] || '';
  const shipState  = addrParts[2] || '';
  const shipStreet = addrParts.slice(3).join(' · ') || '';

  const sheet = document.createElement('div');
  sheet.style.cssText = 'position:fixed;inset:0;z-index:950;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end';

  sheet.innerHTML = `
    <div style="width:100%;background:var(--surface);border-radius:28px 28px 0 0;padding:0 0 calc(var(--safe-bottom)+24px);overflow:hidden">

      <div style="display:flex;justify-content:center;padding:12px 0 0">
        <div style="width:36px;height:4px;background:var(--border);border-radius:2px"></div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px">
        <div>
          <div style="font-size:18px;font-weight:800;color:var(--text);letter-spacing:-0.3px">Request Pickup</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px">Our logistics team will book your courier</div>
        </div>
        <div style="width:44px;height:44px;border-radius:14px;background:rgba(108,71,255,0.1);display:flex;align-items:center;justify-content:center;font-size:22px">📦</div>
      </div>

      <div style="height:1px;background:var(--border);margin:0 20px"></div>

      <div style="margin:16px 20px;background:var(--bg2);border-radius:16px;padding:14px 16px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.7px;margin-bottom:10px">Deliver To</div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <div style="width:32px;height:32px;border-radius:10px;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">👤</div>
          <div>
            <div style="font-size:14px;font-weight:700;color:var(--text)">${escHtml(shipName)}</div>
            <div style="font-size:12px;color:var(--text3)">${escHtml(shipPhone)}</div>
          </div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:10px;margin-top:8px">
          <div style="width:32px;height:32px;border-radius:10px;background:rgba(0,196,140,0.12);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">📍</div>
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text)">${escHtml(shipState)}</div>
            <div style="font-size:12px;color:var(--text3);margin-top:2px">${escHtml(shipStreet) || '—'}</div>
          </div>
        </div>
      </div>

      <div style="margin:0 20px 16px;background:var(--bg2);border-radius:16px;padding:14px 16px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.7px;margin-bottom:10px">Pickup From</div>
        <div style="font-size:13px;font-weight:600;color:var(--text)">${escHtml(sf?.pickup_name || currentProfile?.username || '')}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px">${escHtml(sf?.pickup_address || 'No pickup address set')} · ${escHtml(sf?.pickup_state || '')}</div>
      </div>

      <div style="padding:0 20px;display:flex;flex-direction:column;gap:12px">

        <div>
          <div style="font-size:12px;font-weight:600;color:var(--text3);margin-bottom:6px">Package Weight (kg)</div>
          <input id="ship-weight" class="co-input" type="number" min="0.1" step="0.1" value="0.5"
            style="width:100%;box-sizing:border-box">
        </div>

        <div>
          <div style="font-size:12px;font-weight:600;color:var(--text3);margin-bottom:6px">Note for our logistics team (optional)</div>
          <input id="ship-note" class="co-input" placeholder="e.g. Fragile, call before pickup"
            style="width:100%;box-sizing:border-box">
        </div>

        <button id="ship-request-btn" onclick="submitShipOrder('${orderId}',this.closest('div[style*=fixed]'))"
          style="width:100%;height:56px;border-radius:16px;background:var(--accent);color:white;border:none;font-size:16px;font-weight:800;cursor:pointer;font-family:var(--font);letter-spacing:-0.2px;margin-top:4px">
          📦 Request Pickup
        </button>

        <button onclick="this.closest('div[style*=fixed]').remove()"
          style="width:100%;height:44px;border-radius:14px;background:none;color:var(--text3);border:none;font-size:14px;cursor:pointer;font-family:var(--font)">
          Cancel
        </button>

      </div>
    </div>`;

  sheet._orderData = { order, sf, shipName, shipPhone, shipState, shipStreet };
  document.body.appendChild(sheet);

}

async function submitShipOrder(orderId, sheetEl) {

  const weight   = parseFloat(document.getElementById('ship-weight')?.value) || 0.5;
  const noteText = document.getElementById('ship-note')?.value.trim() || '';
  const btn      = document.getElementById('ship-request-btn');
  const { order, sf, shipName, shipPhone, shipState, shipStreet } = sheetEl?._orderData || {};

  if (!order) { showToast('Order data missing — please retry'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Sending request…'; }

  try {

    // Write a pickup request record for the admin/logistics team to action manually
    await supabase.from('pickup_requests').insert({
      order_id:        orderId,
      seller_id:       order.seller_id,
      buyer_id:        order.buyer_id,
      store_name:      sf?.store_name || '',
      pickup_name:     sf?.pickup_name  || currentProfile?.username || '',
      pickup_phone:    sf?.pickup_phone || '',
      pickup_address:  sf?.pickup_address || '',
      pickup_state:    sf?.pickup_state || '',
      delivery_name:   shipName,
      delivery_phone:  shipPhone,
      delivery_state:  shipState,
      delivery_address: shipStreet,
      weight_kg:       weight,
      note:            noteText,
      item_title:      order.title || '',
      item_value_ngn:  order.price_ngn || order.total_ngn || 0,
      status:          'pending',
      requested_at:    new Date().toISOString(),
    });

    // Mark the order as awaiting pickup booking
    await supabase.from('orders').update({
      status:               'shipping_requested',
      shipping_requested_at: new Date().toISOString(),
    }).eq('id', orderId);

    sheetEl?.remove();

    showToast('Pickup requested ✓ Our team will book your courier shortly');

    loadShopOrders();

  } catch (err) {

    console.error('[Pickup Request] Failed:', err);
    if (btn) { btn.disabled = false; btn.textContent = '📦 Request Pickup'; }
    showToast('Could not send request — try again');

  }

}

// ══════════════════════════════════════════

// MY PRODUCTS

// ══════════════════════════════════════════

function openMyProducts() { slideTo('my-products', loadMyProducts); }

async function loadMyProducts() {

  const el = document.getElementById('my-products-content');

  if (!el || !currentStorefront) return;

  el.innerHTML = `<div class="loading-pulse" style="height:300px"></div>`;

  const { data: products } = await supabase.from('products').select('*')

    .eq('storefront_id', currentStorefront.id).neq('status','archived').order('created_at', { ascending: false });

  if (!products?.length) {

    el.innerHTML = `<div class="empty-state"><div style="font-size:48px;margin-bottom:12px">📦</div><p>No products yet</p><span>Add your first product to start selling</span><button class="btn-primary" style="margin-top:16px" onclick="slideTo('add-product',buildAddProductForm)">Add Product</button></div>`;

    return;

  }

  el.innerHTML = `

    <div class="mp-list">

      ${products.map(p => `

        <div class="mp-product-row" onclick="slideTo('add-product',()=>buildAddProductForm('${p.id}'))">

          <div class="mp-product-img-wrap">

            ${p.images?.[0] ? `<img src="${p.images[0]}" class="mp-product-img" alt="">` : `<div class="mp-product-img" style="background:${gradientFor(p.id)}"></div>`}

          </div>

          <div class="mp-product-info">

            <div class="mp-product-title">${escHtml(p.title)}</div>

            <div class="mp-product-price">${mktFmtNgn(p.price_ngn)}</div>

            <div class="mp-product-meta">

              <span class="mp-product-stock ${p.stock===0?'out':''}">${p.stock} in stock</span>

              <span class="mp-product-status ${p.status}">${p.status}</span>

            </div>

          </div>

          <div class="mp-product-stats">

            <div class="mp-product-stat">${p.views} views</div>

            <div class="mp-product-stat">${p.sales_count} sold</div>

          </div>

        </div>`).join('')}

    </div>`;

}

// ══════════════════════════════════════════

// ADD / EDIT PRODUCT

// ══════════════════════════════════════════

let productImages  = [];

let productVariants = [];

async function buildAddProductForm(productId) {

  editingProductId = productId || null;

  const el      = document.getElementById('add-product-content');

  const titleEl = document.getElementById('add-product-title');

  if (titleEl) titleEl.textContent = productId ? 'Edit Product' : 'Add Product';

  if (!el) return;

  let p = null;

  if (productId) {

    const { data } = await supabase.from('products').select('*, variants:product_variants(*)').eq('id', productId).single();

    p = data;

  }

  productImages   = p?.images || [];

  productVariants = p?.variants || [];

  const categories = ['Fashion & Clothing','Beauty & Skincare','Food & Beverages','Electronics & Gadgets','Home & Living','Health & Wellness','Kids & Baby','Sports & Fitness','Art & Crafts','Books & Education','Automotive','Agriculture & Farm','Services','Other'];

  el.innerHTML = `

    <div class="ap-body">

      <div class="ap-section">

        <div class="ap-section-title">Product Images <span style="color:var(--text3);font-weight:400">(up to 6)</span></div>

        <div class="ap-images-grid" id="ap-images-grid">

          ${productImages.map((img,i) => `<div class="ap-img-item" id="ap-img-${i}"><img src="${img}" class="ap-img-preview" alt=""><button class="ap-img-remove" onclick="removeProductImage(${i})">✕</button></div>`).join('')}

          ${productImages.length < 6 ? `<div class="ap-img-add" onclick="document.getElementById('ap-img-input').click()"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 5v14M5 12h14"/></svg></div>` : ''}

        </div>

        <input type="file" id="ap-img-input" accept="image/*" multiple style="display:none" onchange="addProductImages(this)">

      </div>

      <div class="ap-section">

        <div class="ap-field"><label class="ap-label">Product Title <span class="csf-required">*</span></label><input class="ap-input" id="ap-title" placeholder="e.g. Men's Leather Belt" maxlength="100" value="${escHtml(p?.title||'')}"></div>

        <div class="ap-field"><label class="ap-label">Description</label><textarea class="ap-textarea" id="ap-description" placeholder="Describe your product…" rows="4" maxlength="2000">${escHtml(p?.description||'')}</textarea></div>

        <div class="ap-field-row">

          <div class="ap-field" style="flex:1"><label class="ap-label">Price (₦) <span class="csf-required">*</span></label><input class="ap-input" id="ap-price" type="number" placeholder="0" min="0" value="${p?.price_ngn||''}"></div>

          <div class="ap-field" style="flex:1"><label class="ap-label">Compare Price (₦)</label><input class="ap-input" id="ap-compare-price" type="number" placeholder="Original price" min="0" value="${p?.compare_price_ngn||''}"></div>

        </div>

        <div class="ap-field-row">

          <div class="ap-field" style="flex:1"><label class="ap-label">Category <span class="csf-required">*</span></label>

            <select class="ap-input" id="ap-category"><option value="">Select…</option>${categories.map(c => `<option ${p?.category===c?'selected':''}>${c}</option>`).join('')}</select>

          </div>

          <div class="ap-field" style="flex:1"><label class="ap-label">Condition</label>

            <select class="ap-input" id="ap-condition">

              <option value="new" ${(!p?.condition||p?.condition==='new')?'selected':''}>New</option>

              <option value="used" ${p?.condition==='used'?'selected':''}>Used</option>

              <option value="refurbished" ${p?.condition==='refurbished'?'selected':''}>Refurbished</option>

            </select>

          </div>

        </div>

        <div class="ap-field-row">

          <div class="ap-field" style="flex:1"><label class="ap-label">Stock Quantity</label><input class="ap-input" id="ap-stock" type="number" placeholder="0" min="0" value="${p?.stock??1}"></div>

          <div class="ap-field" style="flex:1"><label class="ap-label">SKU</label><input class="ap-input" id="ap-sku" placeholder="Optional" value="${escHtml(p?.sku||'')}"></div>

        </div>

        <div class="ap-field"><label class="ap-label">Weight (kg)</label><input class="ap-input" id="ap-weight" type="number" placeholder="0.5" min="0" step="0.1" value="${p?.weight_kg||''}"></div>

      </div>

      <div class="ap-section">

        <div class="ap-section-header"><div class="ap-section-title">Variants</div><button class="ap-add-variant-btn" onclick="addVariantGroup()">+ Add Variant</button></div>

        <div id="ap-variants-list">${productVariants.map((v,vi) => renderVariantGroup(v,vi)).join('')}</div>

      </div>

      <div class="ap-section">

        <div class="ap-section-title">Shipping Rates</div>

        <button class="ap-shipping-btn" onclick="openShippingRates()">Manage Shipping by State →</button>

      </div>

      <div class="ap-section">

        <div class="ap-field"><label class="ap-label">Product Status</label>

          <select class="ap-input" id="ap-status">

            <option value="active" ${(!p?.status||p?.status==='active')?'selected':''}>Active</option>

            <option value="paused" ${p?.status==='paused'?'selected':''}>Paused</option>

          </select>

        </div>

      </div>

      ${productId ? `<button class="ap-delete-btn" onclick="archiveProduct('${productId}')">Delete Product</button>` : ''}

      <div style="height:32px"></div>

    </div>`;

}

function renderVariantGroup(v, vi) {

  return `

    <div class="ap-variant-group" id="ap-variant-${vi}">

      <div class="ap-variant-header">

        <input class="ap-input" placeholder="Variant name (e.g. Size)" value="${escHtml(v.name||'')}" id="ap-vname-${vi}">

        <button class="ap-remove-variant" onclick="removeVariantGroup(${vi})">✕</button>

      </div>

      <div class="ap-variant-options" id="ap-vopts-${vi}">

        ${(v.options||[]).map((opt,oi) => renderVariantOption(vi,oi,opt)).join('')}

      </div>

      <button class="ap-add-opt-btn" onclick="addVariantOption(${vi})">+ Add Option</button>

    </div>`;

}

function renderVariantOption(vi, oi, opt) {

  return `

    <div class="ap-variant-opt-row" id="ap-vopt-${vi}-${oi}">

      <input class="ap-input" placeholder="Option (e.g. XL)" value="${escHtml(opt?.name||'')}" style="flex:2" id="ap-vopt-name-${vi}-${oi}">

      <input class="ap-input" type="number" placeholder="Price ₦" value="${opt?.price_ngn||''}" style="flex:1" id="ap-vopt-price-${vi}-${oi}">

      <input class="ap-input" type="number" placeholder="Stock" value="${opt?.stock||''}" style="flex:1" id="ap-vopt-stock-${vi}-${oi}">

      <button class="ap-remove-variant" onclick="removeVariantOption(${vi},${oi})">✕</button>

    </div>`;

}

function addVariantGroup() {

  const idx  = document.querySelectorAll('.ap-variant-group').length;

  const list = document.getElementById('ap-variants-list');

  if (list) { const div = document.createElement('div'); div.innerHTML = renderVariantGroup({name:'',options:[]},idx); list.appendChild(div.firstElementChild); }

}

function removeVariantGroup(vi)        { document.getElementById(`ap-variant-${vi}`)?.remove(); }

function addVariantOption(vi)          { const opts = document.getElementById(`ap-vopts-${vi}`); if (!opts) return; const oi = opts.children.length; const div = document.createElement('div'); div.innerHTML = renderVariantOption(vi,oi,{}); opts.appendChild(div.firstElementChild); }

function removeVariantOption(vi, oi)   { document.getElementById(`ap-vopt-${vi}-${oi}`)?.remove(); }

async function addProductImages(input) {

  const files = Array.from(input.files||[]);

  if (!files.length) return;

  if (productImages.length + files.length > 6) { showToast('Maximum 6 images'); return; }

  showToast('Uploading images…');

  for (const file of files) {

    try {

      const path = `products/${currentUser.id}/${Date.now()}.jpg`;

      const compressed = await compressImage(file, 800);

      await supabase.storage.from('avatars').upload(path, compressed, { upsert: false, contentType: 'image/jpeg' });

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);

      productImages.push(urlData.publicUrl);

    } catch(e) { console.warn('Image upload failed', e); }

  }

  refreshImagesGrid(); input.value = '';

}

function removeProductImage(index) { productImages.splice(index, 1); refreshImagesGrid(); }

function refreshImagesGrid() {

  const grid = document.getElementById('ap-images-grid');

  if (!grid) return;

  grid.innerHTML = productImages.map((img,i) => `<div class="ap-img-item" id="ap-img-${i}"><img src="${img}" class="ap-img-preview" alt=""><button class="ap-img-remove" onclick="removeProductImage(${i})">✕</button></div>`).join('') +

    (productImages.length < 6 ? `<div class="ap-img-add" onclick="document.getElementById('ap-img-input').click()"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 5v14M5 12h14"/></svg></div>` : '');

}

async function saveProduct() {

  const title        = document.getElementById('ap-title')?.value.trim();

  const description  = document.getElementById('ap-description')?.value.trim();

  const price        = parseFloat(document.getElementById('ap-price')?.value||'0');

  const comparePrice = parseFloat(document.getElementById('ap-compare-price')?.value||'0');

  const category     = document.getElementById('ap-category')?.value;

  const condition    = document.getElementById('ap-condition')?.value||'new';

  const stock        = parseInt(document.getElementById('ap-stock')?.value||'0');

  const sku          = document.getElementById('ap-sku')?.value.trim();

  const weight       = parseFloat(document.getElementById('ap-weight')?.value||'0');

  const status       = document.getElementById('ap-status')?.value||'active';

  const btn          = document.getElementById('add-product-save-btn');

  if (!title)    { showToast('Enter product title'); return; }

  if (!price)    { showToast('Enter product price'); return; }

  if (!category) { showToast('Select a category'); return; }

  if (!currentStorefront) { showToast('No storefront found'); return; }

  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  try {

    const variantGroups = document.querySelectorAll('.ap-variant-group');

    const variants = Array.from(variantGroups).map((group, vi) => {

      const name    = document.getElementById(`ap-vname-${vi}`)?.value.trim();

      const optRows = group.querySelectorAll('.ap-variant-opt-row');

      const options = Array.from(optRows).map((_,oi) => ({

        name:      document.getElementById(`ap-vopt-name-${vi}-${oi}`)?.value.trim(),

        price_ngn: parseFloat(document.getElementById(`ap-vopt-price-${vi}-${oi}`)?.value||'0')||price,

        stock:     parseInt(document.getElementById(`ap-vopt-stock-${vi}-${oi}`)?.value||'0'),

      })).filter(o => o.name);

      return { name, options };

    }).filter(v => v.name && v.options.length);

    const productData = {

      storefront_id: currentStorefront.id, seller_id: currentUser.id,

      title, description, category, condition, images: productImages,

      price_ngn: price, compare_price_ngn: comparePrice||null,

      sku: sku||null, weight_kg: weight||null, stock, has_variants: variants.length>0, status,

      updated_at: new Date().toISOString(),

    };

    let productId = editingProductId;

    if (editingProductId) {

      await supabase.from('products').update(productData).eq('id', editingProductId);

      await supabase.from('product_variants').delete().eq('product_id', editingProductId);

    } else {

      const { data: newProduct, error } = await supabase.from('products').insert(productData).select().single();

      if (error) throw error;

      productId = newProduct.id;

    }

    if (variants.length > 0 && productId) {

      await supabase.from('product_variants').insert(variants.map(v => ({ product_id: productId, name: v.name, options: v.options })));

    }

    showToast(editingProductId ? 'Product updated ✓' : 'Product listed ✓');

    slideBack();

  } catch(e) {

    showToast('Failed to save: ' + (e.message||'Try again'));

    if (btn) { btn.textContent = 'Save'; btn.disabled = false; }

  }

}

async function archiveProduct(productId) {

  showActionSheet([{ label: 'Delete Product', danger: true, action: async () => {

    await supabase.from('products').update({ status: 'archived' }).eq('id', productId);

    showToast('Product deleted'); slideBack();

  }}]);

}

// ══════════════════════════════════════════

// SHIPPING RATES MANAGER

// ══════════════════════════════════════════

async function openShippingRates() {

  if (!currentStorefront) return;

  const overlay = document.createElement('div');

  overlay.id    = 'shipping-rates-overlay';

  overlay.style.cssText = 'position:fixed;inset:0;z-index:900;background:var(--bg);overflow-y:auto;padding:0 0 80px';

  const { data: rates }  = await supabase.from('shipping_rates').select('*').eq('storefront_id', currentStorefront.id);

  const { data: states } = await supabase.from('ng_states').select('name').order('name');

  const rateMap = {};

  (rates||[]).forEach(r => { rateMap[r.state] = r; });

  overlay.innerHTML = `

    <div style="padding:calc(var(--safe-top)+16px) 16px 0;display:flex;align-items:center;gap:12px;margin-bottom:16px">

      <button onclick="document.getElementById('shipping-rates-overlay').remove()" style="background:none;border:none;cursor:pointer">

        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>

      </button>

      <h2 style="font-size:17px;font-weight:700;color:var(--text);margin:0">Shipping Rates</h2>

    </div>

    <div style="padding:0 16px 12px;font-size:13px;color:var(--text3)">Set your shipping fee per state. Leave blank or 0 for free shipping.</div>

    <div id="sr-list">

      ${(states||[]).map(s => `

        <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border)">

          <span style="flex:1;font-size:14px;color:var(--text)">${s.name}</span>

          <span style="font-size:13px;color:var(--text3);margin-right:4px">₦</span>

          <input type="number" class="ap-input" placeholder="0 = Free" style="width:100px;padding:8px 10px;font-size:13px"

            value="${rateMap[s.name]?.rate_ngn||''}" id="sr-${s.name.replace(/\s/g,'-')}">

        </div>`).join('')}

    </div>

    <div style="padding:20px 16px">

      <button onclick="saveShippingRates()" style="width:100%;height:48px;border-radius:24px;background:var(--accent);color:white;border:none;font-size:15px;font-weight:700;cursor:pointer">Save Shipping Rates</button>

    </div>`;

  document.body.appendChild(overlay);

  window._srStates = (states||[]).map(s => s.name);

}

async function saveShippingRates() {

  if (!currentStorefront || !window._srStates) return;

  showToast('Saving rates…');

  const upserts = window._srStates.map(state => ({

    storefront_id: currentStorefront.id, state,

    rate_ngn: parseFloat(document.getElementById('sr-'+state.replace(/\s/g,'-'))?.value||'0')||0,

  }));

  const { error } = await supabase.from('shipping_rates').upsert(upserts, { onConflict: 'storefront_id,state' });

  if (error) { showToast('Failed to save rates'); return; }

  showToast('Shipping rates saved ✓');

  document.getElementById('shipping-rates-overlay')?.remove();

}

// ══════════════════════════════════════════

// MERCHANT ANALYTICS

// ══════════════════════════════════════════

function openMerchantDashboard() { slideTo('merchant-dashboard', loadMerchantDashboard); }

async function loadMerchantDashboard() {

  const el = document.getElementById('merchant-dashboard-content');

  if (!el || !currentStorefront) return;

  el.innerHTML = `<div class="loading-pulse" style="height:300px"></div>`;

  const [ordersRes, productsRes] = await Promise.all([

    supabase.from('orders').select('id,total_ngn,points_amount,status,created_at').eq('storefront_id', currentStorefront.id),

    supabase.from('products').select('id,title,views,sales_count,price_ngn,images').eq('storefront_id', currentStorefront.id).neq('status','archived').order('sales_count', { ascending: false }).limit(5),

  ]);

  const orders   = ordersRes.data   || [];

  const products = productsRes.data || [];

  const revenue  = orders.filter(o => o.status==='delivered').reduce((s,o) => s+o.total_ngn, 0);

  const totalOrders     = orders.length;

  const pendingOrders   = orders.filter(o => o.status==='paid'||o.status==='processing').length;

  const shippedOrders   = orders.filter(o => o.status==='shipped').length;

  const deliveredOrders = orders.filter(o => o.status==='delivered').length;

  const weekAgo    = new Date(Date.now() - 7*86400000);

  const weekOrders = orders.filter(o => new Date(o.created_at) > weekAgo && o.status==='delivered');

  const weekRevenue = weekOrders.reduce((s,o) => s+o.total_ngn, 0);

  el.innerHTML = `

    <div class="dash-body">

      <div class="dash-cards">

        <div class="dash-card" style="background:linear-gradient(135deg,#6C47FF,#a78bfa)">

          <div class="dash-card-label">Total Revenue</div>

          <div class="dash-card-value">${mktFmtNgn(revenue)}</div>

          <div class="dash-card-sub">All time</div>

        </div>

        <div class="dash-card" style="background:linear-gradient(135deg,#00c48c,#34d399)">

          <div class="dash-card-label">This Week</div>

          <div class="dash-card-value">${mktFmtNgn(weekRevenue)}</div>

          <div class="dash-card-sub">${weekOrders.length} orders</div>

        </div>

      </div>

      <div class="dash-order-stats">

        <div class="dash-order-stat"><div class="dash-order-stat-num">${totalOrders}</div><div class="dash-order-stat-label">Total</div></div>

        <div class="dash-order-stat" style="color:#ff9500" onclick="openShopOrders()"><div class="dash-order-stat-num">${pendingOrders}</div><div class="dash-order-stat-label">Pending</div></div>

        <div class="dash-order-stat" style="color:#6C47FF"><div class="dash-order-stat-num">${shippedOrders}</div><div class="dash-order-stat-label">Shipped</div></div>

        <div class="dash-order-stat" style="color:#00c48c"><div class="dash-order-stat-num">${deliveredOrders}</div><div class="dash-order-stat-label">Delivered</div></div>

      </div>

      ${currentStorefront.rating > 0 ? `

      <div class="dash-section">

        <div class="dash-section-title">Store Rating</div>

        <div class="dash-rating">

          <span class="dash-rating-stars">${'★'.repeat(Math.round(currentStorefront.rating))}${'☆'.repeat(5-Math.round(currentStorefront.rating))}</span>

          <span class="dash-rating-val">${currentStorefront.rating} out of 5</span>

          <span class="dash-rating-count">(${currentStorefront.review_count} reviews)</span>

        </div>

      </div>` : ''}

      ${products.length > 0 ? `

      <div class="dash-section">

        <div class="dash-section-title">Top Products</div>

        ${products.map(p => `

          <div class="dash-product-row" onclick="slideTo('add-product',()=>buildAddProductForm('${p.id}'))">

            <div class="dash-product-img-wrap">

              ${p.images?.[0] ? `<img src="${p.images[0]}" class="dash-product-img" alt="">` : `<div class="dash-product-img" style="background:${gradientFor(p.id)}"></div>`}

            </div>

            <div class="dash-product-info">

              <div class="dash-product-title">${escHtml(p.title)}</div>

              <div class="dash-product-price">${mktFmtNgn(p.price_ngn)}</div>

            </div>

            <div class="dash-product-stats">

              <div class="dash-product-stat">${p.views} views</div>

              <div class="dash-product-stat" style="color:#00c48c">${p.sales_count} sold</div>

            </div>

          </div>`).join('')}

      </div>` : ''}

      <div style="height:32px"></div>

    </div>`;

}

// ══════════════════════════════════════════

// DISCOUNT CODES

// ══════════════════════════════════════════

function openDiscountCodes() { slideTo('discount-codes', loadDiscountCodes); }

async function loadDiscountCodes() {

  const el = document.getElementById('discount-codes-content');

  if (!el || !currentStorefront) return;

  el.innerHTML = `<div class="loading-pulse" style="height:300px"></div>`;

  const { data: codes } = await supabase.from('discount_codes').select('*').eq('storefront_id', currentStorefront.id).order('created_at', { ascending: false });

  if (!codes?.length) {

    el.innerHTML = `<div class="empty-state"><div style="font-size:48px;margin-bottom:12px">🏷️</div><p>No discount codes yet</p><span>Create codes to reward your customers</span><button class="btn-primary" style="margin-top:16px" onclick="openCreateDiscountCode()">Create Code</button></div>`;

    return;

  }

  el.innerHTML = `

    <div class="dc-list">

      ${codes.map(code => `

        <div class="dc-code-card ${!code.is_active?'inactive':''}">

          <div class="dc-code-top">

            <div class="dc-code-value">${escHtml(code.code)}</div>

            <div class="dc-code-discount">${code.type==='percentage' ? code.value+'% OFF' : mktFmtNgn(code.value)+' OFF'}</div>

          </div>

          <div class="dc-code-meta">

            <span>${code.uses_count}${code.max_uses?'/'+code.max_uses:''} uses</span>

            ${code.expires_at ? `<span>Expires ${new Date(code.expires_at).toLocaleDateString('en-NG')}</span>` : '<span>No expiry</span>'}

            ${code.min_order_ngn > 0 ? `<span>Min ${mktFmtNgn(code.min_order_ngn)}</span>` : ''}

          </div>

          <div class="dc-code-actions">

            <button class="dc-toggle-btn" onclick="toggleDiscountCode('${code.id}',${code.is_active},this)">${code.is_active?'Deactivate':'Activate'}</button>

            <button class="dc-delete-btn" onclick="deleteDiscountCode('${code.id}')">Delete</button>

          </div>

        </div>`).join('')}

    </div>`;

}

function openCreateDiscountCode() {

  const overlay = document.createElement('div');

  overlay.id    = 'create-dc-overlay';

  overlay.style.cssText = 'position:fixed;inset:0;z-index:900;background:rgba(0,0,0,0.5);display:flex;align-items:flex-end';

  overlay.innerHTML = `

    <div style="background:var(--bg);border-radius:20px 20px 0 0;width:100%;padding:20px 16px calc(var(--safe-bottom)+24px)">

      <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:16px">New Discount Code</div>

      <div class="csf-field"><label class="csf-label">Code <span class="csf-required">*</span></label><input class="csf-input" id="dc-code" placeholder="e.g. SAVE20" style="text-transform:uppercase"></div>

      <div style="display:flex;gap:10px">

        <div class="csf-field" style="flex:1"><label class="csf-label">Type</label><select class="csf-select" id="dc-type"><option value="percentage">Percentage %</option><option value="fixed">Fixed ₦</option></select></div>

        <div class="csf-field" style="flex:1"><label class="csf-label">Value <span class="csf-required">*</span></label><input class="csf-input" id="dc-value" type="number" placeholder="20"></div>

      </div>

      <div style="display:flex;gap:10px">

        <div class="csf-field" style="flex:1"><label class="csf-label">Min Order (₦)</label><input class="csf-input" id="dc-min" type="number" placeholder="0"></div>

        <div class="csf-field" style="flex:1"><label class="csf-label">Max Uses</label><input class="csf-input" id="dc-max-uses" type="number" placeholder="Unlimited"></div>

      </div>

      <div class="csf-field"><label class="csf-label">Expiry Date</label><input class="csf-input" id="dc-expiry" type="date"></div>

      <div style="display:flex;gap:10px;margin-top:8px">

        <button onclick="document.getElementById('create-dc-overlay').remove()" style="flex:1;height:46px;border-radius:23px;border:1px solid var(--border);background:none;color:var(--text);font-size:14px;font-weight:600;cursor:pointer">Cancel</button>

        <button onclick="saveDiscountCode()" style="flex:2;height:46px;border-radius:23px;border:none;background:var(--accent);color:white;font-size:14px;font-weight:700;cursor:pointer">Create Code</button>

      </div>

    </div>`;

  overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });

  document.body.appendChild(overlay);

}

async function saveDiscountCode() {

  const code    = document.getElementById('dc-code')?.value.trim().toUpperCase();

  const type    = document.getElementById('dc-type')?.value;

  const value   = parseFloat(document.getElementById('dc-value')?.value||'0');

  const min     = parseFloat(document.getElementById('dc-min')?.value||'0');

  const maxUses = parseInt(document.getElementById('dc-max-uses')?.value||'0')||null;

  const expiry  = document.getElementById('dc-expiry')?.value;

  if (!code)  { showToast('Enter a discount code'); return; }

  if (!value) { showToast('Enter a discount value'); return; }

  if (type==='percentage' && value>100) { showToast('Percentage cannot exceed 100%'); return; }

  const { error } = await supabase.from('discount_codes').insert({ storefront_id: currentStorefront.id, code, type, value, min_order_ngn: min, max_uses: maxUses, expires_at: expiry||null, is_active: true });

  if (error) { showToast(error.code==='23505' ? 'Code already exists' : 'Failed to create code'); return; }

  showToast('Discount code created ✓');

  document.getElementById('create-dc-overlay')?.remove();

  loadDiscountCodes();

}

async function toggleDiscountCode(id, isActive, btn) {

  await supabase.from('discount_codes').update({ is_active: !isActive }).eq('id', id);

  btn.textContent = isActive ? 'Activate' : 'Deactivate';

  btn.closest('.dc-code-card').classList.toggle('inactive', isActive);

  showToast(isActive ? 'Code deactivated' : 'Code activated');

}

async function deleteDiscountCode(id) {

  showActionSheet([{ label: 'Delete Code', danger: true, action: async () => {

    await supabase.from('discount_codes').delete().eq('id', id);

    showToast('Code deleted'); loadDiscountCodes();

  }}]);

}

// ══════════════════════════════════════════

// REVIEWS

// ══════════════════════════════════════════

async function openLeaveReview(order) {

  if (!order?.items?.length) return;

  const product = order.items[0];

  const overlay = document.createElement('div');

  overlay.id    = 'leave-review-overlay';

  overlay.style.cssText = 'position:fixed;inset:0;z-index:900;background:rgba(0,0,0,0.5);display:flex;align-items:flex-end';

  window._reviewRating  = 5;

  overlay.innerHTML = `

    <div style="background:var(--bg);border-radius:20px 20px 0 0;width:100%;padding:20px 16px calc(var(--safe-bottom)+24px)">

      <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px">Leave a Review</div>

      <div style="font-size:13px;color:var(--text3);margin-bottom:16px">${escHtml(product.product_title)}</div>

      <div id="review-stars" style="display:flex;gap:8px;font-size:36px;margin-bottom:16px;justify-content:center">

        ${[1,2,3,4,5].map(i => `<span onclick="setReviewRating(${i})" style="cursor:pointer" id="rs-${i}">★</span>`).join('')}

      </div>

      <textarea class="csf-textarea" id="review-text" placeholder="Share your experience…" rows="3" maxlength="500"></textarea>

      <div style="display:flex;gap:10px;margin-top:12px">

        <button onclick="document.getElementById('leave-review-overlay').remove()" style="flex:1;height:46px;border-radius:23px;border:1px solid var(--border);background:none;color:var(--text);font-size:14px;font-weight:600;cursor:pointer">Skip</button>

        <button onclick="submitReview('${order.id}','${product.product_id}','${order.storefront_id}')" style="flex:2;height:46px;border-radius:23px;border:none;background:var(--accent);color:white;font-size:14px;font-weight:700;cursor:pointer">Submit Review</button>

      </div>

    </div>`;

  overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });

  document.body.appendChild(overlay);

}

function setReviewRating(rating) {

  window._reviewRating = rating;

  [1,2,3,4,5].forEach(i => { const s = document.getElementById(`rs-${i}`); if (s) s.style.opacity = i<=rating ? '1' : '0.3'; });

}

async function submitReview(orderId, productId, storefrontId) {

  const text   = document.getElementById('review-text')?.value.trim();

  const rating = window._reviewRating || 5;

  const { error } = await supabase.from('product_reviews').insert({

    product_id: productId, storefront_id: storefrontId, order_id: orderId,

    reviewer_id: currentUser.id, rating, review: text||null, is_verified_purchase: true,

  });

  if (error && error.code==='23505') { showToast('You already reviewed this product'); document.getElementById('leave-review-overlay')?.remove(); return; }

  if (error) { showToast('Failed to submit review'); return; }

  showToast('Review submitted ✓ Thank you!');

  document.getElementById('leave-review-overlay')?.remove();

}

// ══════════════════════════════════════════

// MARKET PAGE — load real products

// ══════════════════════════════════════════

async function loadMarketProducts(category) {

  const grid = document.getElementById('mkt-product-grid');

  if (!grid) return;

  let query = supabase.from('products')

    .select('*, storefront:storefronts(id,store_name,logo_url,rating)')

    .eq('status','active').gt('stock',0)

    .order('created_at', { ascending: false }).limit(40);

  if (category && category !== 'all') query = query.eq('category', category);

  const { data: products } = await query;

  if (!products?.length) return;

  grid.innerHTML = products.map(p => renderProductCard(p, p.storefront)).join('');

}

function openMktSearch() { showToast('Search coming soon ✨'); }

// ══════════════════════════════════════════

// STOREFRONT SUBSCRIPTION RENEWAL

// ══════════════════════════════════════════

async function renewStorefrontSubscription() {

  if (!currentStorefront) return;

  if (walletState.points < 1) { showToast('You need at least MP 1 to renew'); openWallet(); return; }

  showActionSheet([{ label: 'Renew — MP 1', action: async () => {

    const pinOk = await walletPinCheck();

    if (!pinOk) return;

    const expiry = new Date(currentStorefront.subscription_expires_at||new Date());

    expiry.setMonth(expiry.getMonth()+1);

    await supabase.from('storefronts').update({ subscription_expires_at: expiry.toISOString(), is_active: true }).eq('id', currentStorefront.id);

    currentStorefront.subscription_expires_at = expiry.toISOString();

    showToast('Subscription renewed ✓');

    syncWalletBalance();

  }}]);

}

async function openEditStorefront() {

  if (!currentStorefront) return;

  const { data: sf } = await supabase.from('storefronts')
    .select('store_name, category, description, pickup_name, pickup_phone, pickup_state, pickup_address')
    .eq('id', currentStorefront.id).single();

  if (!sf) { showToast('Could not load storefront data'); return; }

  const nigeriaStates = ['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'];

  const stateOptions = nigeriaStates.map(s => `<option value="${s}" ${sf.pickup_state === s ? 'selected' : ''}>${s}</option>`).join('');

  const overlay = document.createElement('div');
  overlay.id = 'edit-storefront-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:900;background:var(--bg);overflow-y:auto;-webkit-overflow-scrolling:touch';

  overlay.innerHTML =
    '<div style="position:sticky;top:0;z-index:2;background:var(--surface);border-bottom:1px solid var(--border);padding:calc(var(--safe-top)) 0 0">' +
      '<div style="display:flex;align-items:center;height:52px">' +
        '<button onclick="document.getElementById(\'edit-storefront-overlay\').remove()" style="width:48px;height:52px;display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;flex-shrink:0">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>' +
        '</button>' +
        '<div style="flex:1;font-size:16px;font-weight:700;color:var(--text)">Edit Storefront</div>' +
        '<button id="esf-save-btn" onclick="saveEditStorefront()" style="margin-right:16px;height:34px;padding:0 18px;border-radius:10px;background:var(--accent);color:white;border:none;font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font)">Save</button>' +
      '</div>' +
    '</div>' +
    '<div style="padding:16px;display:flex;flex-direction:column;gap:12px">' +

      '<div style="background:var(--surface);border-radius:16px;padding:16px;border:1px solid var(--border)">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:14px">Store Info</div>' +
        '<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:600;color:var(--text3);margin-bottom:6px">Store Name</div>' +
        '<input id="esf-name" class="co-input" value="' + escHtml(sf.store_name || '') + '" placeholder="Your store name" style="width:100%;box-sizing:border-box"></div>' +
        '<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:600;color:var(--text3);margin-bottom:6px">Category</div>' +
        '<input id="esf-category" class="co-input" value="' + escHtml(sf.category || '') + '" placeholder="e.g. Fashion, Electronics, Food…" style="width:100%;box-sizing:border-box"></div>' +
        '<div><div style="font-size:12px;font-weight:600;color:var(--text3);margin-bottom:6px">Description</div>' +
        '<textarea id="esf-description" class="co-input" rows="3" placeholder="Tell buyers about your store…" style="width:100%;box-sizing:border-box;resize:none;min-height:72px">' + escHtml(sf.description || '') + '</textarea></div>' +
      '</div>' +

      '<div style="background:var(--surface);border-radius:16px;padding:16px;border:1px solid var(--border)">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px">Pickup Address</div>' +
        '<div style="font-size:12px;color:var(--text3);margin-bottom:14px;line-height:1.5">Where Sendbox will collect orders from.</div>' +
        '<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:600;color:var(--text3);margin-bottom:6px">Contact Name</div>' +
        '<input id="esf-pickup-name" class="co-input" value="' + escHtml(sf.pickup_name || '') + '" placeholder="Full name at pickup" style="width:100%;box-sizing:border-box"></div>' +
        '<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:600;color:var(--text3);margin-bottom:6px">Contact Phone</div>' +
        '<input id="esf-pickup-phone" class="co-input" type="tel" value="' + escHtml(sf.pickup_phone || '') + '" placeholder="e.g. 08012345678" style="width:100%;box-sizing:border-box"></div>' +
        '<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:600;color:var(--text3);margin-bottom:6px">State</div>' +
        '<select id="esf-pickup-state" class="co-input" style="width:100%;box-sizing:border-box"><option value="">Select state…</option>' + stateOptions + '</select></div>' +
        '<div><div style="font-size:12px;font-weight:600;color:var(--text3);margin-bottom:6px">Street Address</div>' +
        '<input id="esf-pickup-address" class="co-input" value="' + escHtml(sf.pickup_address || '') + '" placeholder="House/flat number, street, area" style="width:100%;box-sizing:border-box"></div>' +
      '</div>' +

      '<div style="height:32px"></div>' +
    '</div>';

  document.body.appendChild(overlay);

}

async function saveEditStorefront() {

  const btn         = document.getElementById('esf-save-btn');
  const storeName   = document.getElementById('esf-name')?.value.trim();
  const category    = document.getElementById('esf-category')?.value.trim();
  const description = document.getElementById('esf-description')?.value.trim();
  const pickupName  = document.getElementById('esf-pickup-name')?.value.trim();
  const pickupPhone = document.getElementById('esf-pickup-phone')?.value.trim();
  const pickupState = document.getElementById('esf-pickup-state')?.value;
  const pickupAddr  = document.getElementById('esf-pickup-address')?.value.trim();

  if (!storeName) { showToast('Store name is required'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {

    await supabase.from('storefronts').update({
      store_name: storeName, category: category || null, description: description || null,
      pickup_name: pickupName || null, pickup_phone: pickupPhone || null,
      pickup_state: pickupState || null, pickup_address: pickupAddr || null,
    }).eq('id', currentStorefront.id);

    const { data: updated } = await supabase.from('storefronts').select('*').eq('id', currentStorefront.id).single();
    if (updated) currentStorefront = updated;

    document.getElementById('edit-storefront-overlay')?.remove();
    showToast('Storefront updated ✓');
    renderMyStorefront();

  } catch (e) {

    showToast('Save failed — try again');
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }

  }

}

async function updateStorefrontLogo(input) {

  const file = input.files?.[0];

  if (!file || !currentStorefront) return;

  showToast('Uploading logo…');

  try {

    const path = `storefronts/${currentUser.id}/logo.jpg`;

    const compressed = await compressImage(file, 400);

    await supabase.storage.from('avatars').upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);

    const logoUrl = urlData.publicUrl + '?t=' + Date.now();

    await supabase.from('storefronts').update({ logo_url: logoUrl }).eq('id', currentStorefront.id);

    currentStorefront.logo_url = logoUrl;

    showToast('Logo updated ✓'); renderMyStorefront();

  } catch(e) { showToast('Upload failed'); }

}

async function updateStorefrontBanner(input) {

  const file = input.files?.[0];

  if (!file || !currentStorefront) return;

  showToast('Uploading banner…');

  try {

    const path = `storefronts/${currentUser.id}/banner.jpg`;

    const compressed = await compressImage(file, 1200);

    await supabase.storage.from('avatars').upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);

    const bannerUrl = urlData.publicUrl + '?t=' + Date.now();

    await supabase.from('storefronts').update({ banner_url: bannerUrl }).eq('id', currentStorefront.id);

    currentStorefront.banner_url = bannerUrl;

    showToast('Banner updated ✓'); renderMyStorefront();

  } catch(e) { showToast('Upload failed'); }

}

// ══════════════════════════════════════════

// ORDER DETAIL

// ══════════════════════════════════════════

async function openOrderDetail(orderId, role) {

  const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();

  if (!order) { showToast('Order not found'); return; }

  let productImage = '';

  if (order.product_id) {

    const { data: prod } = await supabase.from('products').select('images').eq('id', order.product_id).single();

    productImage = prod?.images?.[0] || '';

  }

  const addrParts  = (order.shipping_address || '').split(' · ');

  const shipName   = addrParts[0] || '';

  const shipPhone  = addrParts[1] || '';

  const shipState  = addrParts[2] || '';

  const shipStreet = addrParts.slice(3).join(' · ') || '';

  document.getElementById('order-detail-overlay')?.remove();

  const overlay = document.createElement('div');

  overlay.id    = 'order-detail-overlay';

  overlay.style.cssText = 'position:fixed;inset:0;z-index:900;background:var(--bg);overflow-y:auto;-webkit-overflow-scrolling:touch';

  const statusMeta = {

    pending:    { color:'#ff9500', bg:'rgba(255,149,0,0.1)',   label:'Awaiting Acceptance' },

    accepted:   { color:'#007aff', bg:'rgba(0,122,255,0.1)',   label:'Accepted' },

    processing: { color:'#007aff', bg:'rgba(0,122,255,0.1)',   label:'Processing' },

    shipped:    { color:'#6C47FF', bg:'rgba(108,71,255,0.1)',  label:'Shipped' },

    delivered:  { color:'#00c48c', bg:'rgba(0,196,140,0.1)',   label:'Delivered' },

    cancelled:  { color:'#8e8e93', bg:'rgba(142,142,147,0.1)', label:'Cancelled' },

    declined:   { color:'#ff3b5c', bg:'rgba(255,59,92,0.1)',   label:'Declined' },

    refunded:   { color:'#8e8e93', bg:'rgba(142,142,147,0.1)', label:'Refunded' },

  };

  const meta = statusMeta[order.status] || { color:'var(--text3)', bg:'var(--bg2)', label: order.status };

  const timelineSteps = [

    { icon:'🛍️', label:'Order Placed',    time: order.created_at,   done: true,                 bad: false },

    { icon:'✓',  label:'Seller Accepted', time: order.accepted_at,  done: !!order.accepted_at,  bad: false },

    { icon:'⚙️', label:'Processing',      time: null,               done: ['processing','shipping_requested','shipped','delivered'].includes(order.status), bad: false },

    { icon:'📦', label:'Pickup Requested', time: order.shipping_requested_at, done: ['shipping_requested','shipped','delivered'].includes(order.status), bad: false },

    { icon:'🚚', label:'Shipped',         time: order.shipped_at,   done: !!order.shipped_at,   bad: false },

    { icon:'✅', label:'Delivered',       time: order.confirmed_at, done: !!order.confirmed_at, bad: false },

  ];

  if (order.status === 'declined' || order.status === 'cancelled') {

    timelineSteps.splice(1, 4, { icon:'✕', label: order.status === 'declined' ? ('Declined: ' + (order.decline_reason||'')) : 'Cancelled', time: order.declined_at || order.cancelled_at, done: true, bad: true });

  }

  const timelineHTML = timelineSteps.map(function(step, i) {

    const isLast = i === timelineSteps.length - 1;

    const dotBg  = step.done ? (step.bad ? 'rgba(255,59,92,0.15)' : 'rgba(0,196,140,0.15)') : 'var(--bg2)';

    const lineBg = step.done ? (step.bad ? 'rgba(255,59,92,0.3)' : 'rgba(0,196,140,0.3)') : 'var(--border)';

    return '<div style="display:flex;gap:12px;align-items:flex-start' + (!isLast ? ';margin-bottom:4px' : '') + '">' +

      '<div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0">' +

        '<div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;background:' + dotBg + '">' +

          (step.done ? step.icon : '<div style="width:8px;height:8px;border-radius:50%;background:var(--border)"></div>') +

        '</div>' +

        (!isLast ? '<div style="width:2px;flex:1;min-height:16px;background:' + lineBg + ';margin:3px 0"></div>' : '') +

      '</div>' +

      '<div style="padding-top:6px;padding-bottom:' + (!isLast ? '12' : '0') + 'px">' +

        '<div style="font-size:13px;font-weight:600;color:' + (step.done ? 'var(--text)' : 'var(--text3)') + '">' + step.label + '</div>' +

        (step.time ? '<div style="font-size:11px;color:var(--text3);margin-top:1px">' + timeSince(step.time) + '</div>' : '') +

      '</div>' +

    '</div>';

  }).join('');

  const deliveryRows = [

    shipName   ? ['Recipient', shipName]   : null,

    shipPhone  ? ['Phone',     shipPhone]  : null,

    shipState  ? ['State',     shipState]  : null,

    shipStreet ? ['Address',   shipStreet] : null,

  ].filter(Boolean).map(function(r) {

    return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border2)">' +

      '<span style="font-size:12px;color:var(--text3)">' + r[0] + '</span>' +

      '<span style="font-size:13px;font-weight:600;color:var(--text);text-align:right;max-width:60%">' + escHtml(r[1]) + '</span>' +

    '</div>';

  }).join('');

  overlay.innerHTML =

    '<div style="position:sticky;top:0;z-index:2;background:var(--surface);border-bottom:1px solid var(--border);padding:calc(var(--safe-top)) 0 0">' +

      '<div style="display:flex;align-items:center;height:52px">' +

        '<button onclick="document.getElementById(\'order-detail-overlay\').remove()" style="width:48px;height:52px;display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;flex-shrink:0">' +

          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>' +

        '</button>' +

        '<div style="flex:1;font-size:16px;font-weight:700;color:var(--text)">Order Detail</div>' +

        '<div style="margin-right:16px;background:' + meta.bg + ';color:' + meta.color + ';font-size:12px;font-weight:700;padding:5px 12px;border-radius:20px">' + meta.label + '</div>' +

      '</div>' +

    '</div>' +

    '<div style="padding:16px;display:flex;gap:14px;align-items:center;background:var(--surface);border-bottom:1px solid var(--border)">' +

      (productImage

        ? '<img src="' + productImage + '" style="width:72px;height:72px;border-radius:16px;object-fit:cover;flex-shrink:0" alt="">'

        : '<div style="width:72px;height:72px;border-radius:16px;background:' + gradientFor(order.product_id||order.id) + ';flex-shrink:0"></div>') +

      '<div style="flex:1;min-width:0">' +

        '<div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:3px;line-height:1.3">' + escHtml(order.title||'—') + '</div>' +

        '<div style="font-size:12px;color:var(--text3);margin-bottom:6px">Qty: ' + (order.quantity||1) + ' · ' + timeSince(order.created_at) + '</div>' +

        '<div style="font-size:12px;font-weight:600;color:var(--text3);letter-spacing:0.5px">#' + order.id.slice(0,8).toUpperCase() + '</div>' +

      '</div>' +

      '<div style="text-align:right;flex-shrink:0">' +

        '<div style="font-size:18px;font-weight:900;color:var(--text)">' + mktFmtNgn(order.price_ngn||0) + '</div>' +

        '<div style="font-size:12px;color:var(--accent);margin-top:2px;font-weight:600">' + fmtPts(order.price_mp||0) + '</div>' +

      '</div>' +

    '</div>' +

    '<div style="padding:16px;display:flex;flex-direction:column;gap:12px">' +

      '<div style="background:var(--surface);border-radius:16px;padding:16px;border:1px solid var(--border)">' +

        '<div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:14px">Order Progress</div>' +

        timelineHTML +

      '</div>' +

      '<div style="background:var(--surface);border-radius:16px;padding:16px;border:1px solid var(--border)">' +

        '<div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:12px">Delivery</div>' +

        (deliveryRows || ('<div style="font-size:13px;color:var(--text2)">' + escHtml(order.shipping_address||'—') + '</div>')) +

        (order.note ? '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border2);font-size:12px;color:var(--text3)">Note: ' + escHtml(order.note) + '</div>' : '') +

      '</div>' +

      (order.courier ? (

        '<div style="background:var(--surface);border-radius:16px;padding:16px;border:1px solid var(--border)">' +

          '<div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:12px">Shipping Info</div>' +

          '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border2)">' +

            '<span style="font-size:12px;color:var(--text3)">Courier</span>' +

            '<span style="font-size:13px;font-weight:600;color:var(--text)">' + escHtml(order.courier) + '</span>' +

          '</div>' +

          (order.tracking_number ? (

            '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border2)">' +

              '<span style="font-size:12px;color:var(--text3)">Tracking</span>' +

              '<span style="font-size:13px;font-weight:700;color:var(--accent)">' + escHtml(order.tracking_number) + '</span>' +

            '</div>'

          ) : '') +

          (order.sendbox_tracking_url ? (

            '<div style="padding:10px 0">' +

              '<a href="' + escHtml(order.sendbox_tracking_url) + '" target="_blank" rel="noopener" ' +

                'style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:44px;border-radius:12px;background:rgba(108,71,255,0.1);color:var(--accent);font-size:14px;font-weight:700;text-decoration:none">' +

                '📍 Track Live on Sendbox' +

              '</a>' +

            '</div>'

          ) : '') +

        '</div>'

      ) : '') +

      (order.shipping_proof_url ? (

        '<div style="background:var(--surface);border-radius:16px;padding:16px;border:1px solid var(--border)">' +

          '<div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:12px">Shipping Proof</div>' +

          '<img src="' + order.shipping_proof_url + '" style="width:100%;border-radius:12px;object-fit:cover" alt="">' +

          (order.auto_release_at ? '<div style="font-size:12px;color:var(--text3);margin-top:8px">⏱ MP auto-releases in 7 days if not confirmed</div>' : '') +

        '</div>'

      ) : '') +

      '<div style="background:var(--surface);border-radius:16px;padding:16px;border:1px solid var(--border)">' +

        '<div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:12px">Payment</div>' +

        '<div style="display:flex;justify-content:space-between;align-items:center">' +

          '<span style="font-size:15px;font-weight:700;color:var(--text)">Total</span>' +

          '<span style="font-size:18px;font-weight:900;color:var(--text)">' + mktFmtNgn(order.price_ngn||0) + '</span>' +

        '</div>' +

        '<div style="margin-top:8px;display:inline-flex;align-items:center;background:var(--accent-soft);padding:4px 10px;border-radius:8px">' +

          '<span style="font-size:12px;font-weight:700;color:var(--accent)">Paid with ' + fmtPts(order.price_mp||0) + '</span>' +

        '</div>' +

        (['pending','accepted','processing','shipping_requested','shipped'].includes(order.status) ? '<div style="margin-top:10px;font-size:12px;color:#ff9500">🔒 MP held in escrow — releases on delivery confirmation</div>' : '') +

      '</div>' +

      (order.decline_reason ? (

        '<div style="background:rgba(255,59,92,0.06);border-radius:16px;padding:16px;border:1px solid rgba(255,59,92,0.2)">' +

          '<div style="font-size:12px;font-weight:700;color:#ff3b5c;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px">Decline Reason</div>' +

          '<div style="font-size:13px;color:var(--text2)">' + escHtml(order.decline_reason) + '</div>' +

          (role==='buyer' ? '<div style="font-size:12px;color:var(--text3);margin-top:6px">Your MP has been refunded to your wallet.</div>' : '') +

        '</div>'

      ) : '') +

      '<div style="display:flex;flex-direction:column;gap:10px;padding-bottom:16px">' +

        (role==='buyer' && order.status==='pending' ? '<div style="padding:14px;background:rgba(255,149,0,0.08);border-radius:12px;font-size:13px;color:#ff9500;text-align:center">⏳ Waiting for seller to accept your order</div>' : '') +

        (role==='buyer' && order.status==='shipped' ?

          '<button onclick="confirmDelivery(\'' + order.id + '\');document.getElementById(\'order-detail-overlay\').remove()" style="width:100%;height:52px;border-radius:14px;background:#00c48c;color:white;border:none;font-size:15px;font-weight:700;cursor:pointer;font-family:var(--font)">✓ Confirm Delivery</button>' +

          '<div style="font-size:12px;color:var(--text3);text-align:center">Only confirm when you have received your order</div>'

        : '') +

        (role==='seller' && order.status==='pending' ?

          '<div style="display:flex;gap:10px">' +

            '<button onclick="acceptOrder(\'' + order.id + '\');document.getElementById(\'order-detail-overlay\').remove()" style="flex:1;height:52px;border-radius:14px;background:var(--accent);color:white;border:none;font-size:15px;font-weight:700;cursor:pointer;font-family:var(--font)">✓ Accept Order</button>' +

            '<button onclick="declineOrder(\'' + order.id + '\');document.getElementById(\'order-detail-overlay\').remove()" style="flex:1;height:52px;border-radius:14px;background:none;color:#ff3b5c;border:1.5px solid #ff3b5c;font-size:15px;font-weight:700;cursor:pointer;font-family:var(--font)">✕ Decline</button>' +

          '</div>'

        : '') +

        (role==='seller' && order.status==='accepted' ?

          '<div style="display:flex;gap:10px">' +

            '<button onclick="updateOrderStatus(\'' + order.id + '\',\'processing\');document.getElementById(\'order-detail-overlay\').remove()" style="flex:1;height:52px;border-radius:14px;background:var(--bg2);color:var(--text);border:1px solid var(--border);font-size:14px;font-weight:600;cursor:pointer;font-family:var(--font)">⚙️ Mark Processing</button>' +

            '<button onclick="openShipOrder(\'' + order.id + '\');document.getElementById(\'order-detail-overlay\').remove()" style="flex:1;height:52px;border-radius:14px;background:var(--accent);color:white;border:none;font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font)">📦 Request Pickup</button>' +

          '</div>'

        : '') +

        (role==='seller' && order.status==='processing' ?

          '<button onclick="openShipOrder(\'' + order.id + '\');document.getElementById(\'order-detail-overlay\').remove()" style="width:100%;height:52px;border-radius:14px;background:var(--accent);color:white;border:none;font-size:15px;font-weight:700;cursor:pointer;font-family:var(--font)">📦 Request Pickup</button>'

        : '') +

        (order.status==='shipping_requested' ?

          '<div style="padding:14px;background:rgba(255,149,0,0.08);border-radius:12px;font-size:13px;color:#ff9500;text-align:center">📦 Pickup requested — our team is booking a courier</div>'

        : '') +


      '</div>' +

    '</div>';

  document.body.appendChild(overlay);

}