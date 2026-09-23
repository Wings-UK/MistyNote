/* ═══════════════════════════════════════════════════════
   MISTYNOTE — app-predict.js
   Pulse Prediction Market (Parimutuel)
   Requires: app-core.js, app-social.js
═══════════════════════════════════════════════════════ */

const PREDICT_PLATFORM_CUT  = 0.08;
const PREDICT_MIN_STAKE     = 0.1;
const PREDICT_CASHOUT_FEE   = 0.05;

// KWD rate — read from window.MP_RATE set by wallet module, fallback 4350
function getMPRate() { return window.MP_RATE || 4350; }
function mpToNgn(mp) { return Math.round(mp * getMPRate()); }
function fmtNgn(ngn) {
  if (ngn >= 1000000) return '&#8358;' + (ngn/1000000).toFixed(2) + 'M';
  if (ngn >= 1000)    return '&#8358;' + (ngn/1000).toFixed(0)    + 'K';
  return '&#8358;' + ngn.toLocaleString();
}
function fmtMP(mp) {
  if (!mp && mp !== 0) return '&mdash;';
  if (mp >= 1000) return mp.toFixed(0) + 'K MP';
  return Number(mp).toFixed(2).replace(/\.00$/, '') + ' MP';
}
function fmtMPNgn(mp) {
  return `${fmtMP(mp)} <span style="color:var(--text3);font-weight:500;font-size:0.85em">(&#8776; ${fmtNgn(mpToNgn(mp))})</span>`;
}
function fmtOdds(odds) {
  if (!odds || odds <= 0) return '&mdash;';
  return Number(odds).toFixed(2) + 'x';
}
function fmtCountdown(closesAt) {
  const diff = new Date(closesAt) - new Date();
  if (diff <= 0) return 'Closed';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (d > 0)  return `${d}d ${h}h ${m}m`;
  if (h > 0)  return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

const CAT_GRADIENT = {
  'Politics':      'linear-gradient(90deg,#6C47FF,#a855f7)',
  'Entertainment': 'linear-gradient(90deg,#f0385a,#f093fb)',
  'Sports':        'linear-gradient(90deg,#16a34a,#38f9d7)',
  'Economy':       'linear-gradient(90deg,#f5a623,#fda085)',
  'Social':        'linear-gradient(90deg,#4facfe,#00f2fe)',
  'General':       'linear-gradient(90deg,#6C47FF,#a855f7)',
};
const CAT_EMOJI = {
  'Politics':'&#127963;','Entertainment':'&#127908;','Sports':'&#9917;',
  'Economy':'&#128200;','Social':'&#128172;','General':'&#127919;',
};
const BAR_COLORS = [
  'linear-gradient(90deg,#6C47FF,#a855f7)',
  'linear-gradient(90deg,#f0385a,#f093fb)',
  'linear-gradient(90deg,#16a34a,#38f9d7)',
  'linear-gradient(90deg,#f5a623,#fda085)',
  'linear-gradient(90deg,#4facfe,#00f2fe)',
];

// ── State ────────────────────────────────────────────
let _pred = {
  currentId:   null,
  currentData: null,
  selectedOptId: null,
  accaSlip:    [],
};
let _predictTab = 'open';
let _predCountdownTimer = null;

// ══════════════════════════════════════════════════════
// OPEN PULSE PAGE
// ══════════════════════════════════════════════════════
function openPredictionsPage() {
  slideTo('predictions', () => {
    _loadPulseWallet();
    _loadPulseWinnersTicker();
    loadPredictionsInbox(_predictTab);
  });
}

// ══════════════════════════════════════════════════════
// WALLET DISPLAY
// ══════════════════════════════════════════════════════
async function _loadPulseWallet() {
  if (!currentUser) return;
  try {
    const { data } = await supabase
      .from('wallets')
      .select('available')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    const mp = data?.available ?? 0;
    const ngn = mpToNgn(mp);
    const mpEl  = document.getElementById('pulse-wallet-mp');
    const ngnEl = document.getElementById('pulse-wallet-ngn');
    if (mpEl)  mpEl.textContent  = fmtMP(mp).replace(/&[^;]+;/g,'');
    if (ngnEl) ngnEl.innerHTML   = '≈ ' + fmtNgn(ngn);
  } catch (e) {
    console.warn('[Pulse] wallet load failed', e);
  }
}

// ══════════════════════════════════════════════════════
// WINNERS TICKER
// ══════════════════════════════════════════════════════
async function _loadPulseWinnersTicker() {
  const el = document.getElementById('pulse-winners-text');
  if (!el) return;
  const { data } = await supabase
    .from('prediction_stakes')
    .select('actual_return, user:users(username), prediction:predictions(title)')
    .eq('status', 'won')
    .order('actual_return', { ascending: false })
    .limit(10);
  if (!data?.length) { el.textContent = 'Be the first to win on Pulse!'; return; }
  const parts = data.map(s => {
    const u = s.user?.username || 'someone';
    const mp = Number(s.actual_return || 0).toFixed(2);
    const ngn = fmtNgn(mpToNgn(mp)).replace(/&[^;]+;/g, '₦');
    const q = s.prediction?.title?.slice(0, 30) || 'a prediction';
    return `${u} won ${mp} MP (~${ngn}) on "${q}"`;
  });
  el.textContent = parts.join('  ·  ') + '  ·  ' + parts.join('  ·  ');
}

// ══════════════════════════════════════════════════════
// SWITCH CATEGORY TAB
// ══════════════════════════════════════════════════════
function switchPredictTab(tab) {
  _predictTab = tab;
  document.querySelectorAll('#pulse-cats .pulse-cat').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  loadPredictionsInbox(tab);
}

// ══════════════════════════════════════════════════════
// INBOX — render full pulse page
// ══════════════════════════════════════════════════════
async function loadPredictionsInbox(tab) {
  const body = document.getElementById('predict-inbox-body');
  if (!body) return;
  body.innerHTML = `<div style="padding:48px;text-align:center;color:var(--text3)">
    <div style="font-size:32px;margin-bottom:10px">&#127939;</div>Loading&hellip;</div>`;

  // Winners section (always shown on All tab)
  let winnersHTML = '';
  if (tab === 'open') {
    const { data: wins } = await supabase
      .from('prediction_stakes')
      .select('actual_return, created_at, user:users(id,username,avatar), prediction:predictions(title), option:prediction_options(label)')
      .eq('status', 'won')
      .order('actual_return', { ascending: false })
      .limit(6);

    if (wins?.length) {
      const grads = ['linear-gradient(135deg,#f5a623,#f093fb)','linear-gradient(135deg,#4facfe,#00f2fe)','linear-gradient(135deg,#43e97b,#38f9d7)','linear-gradient(135deg,#f0385a,#f093fb)','linear-gradient(135deg,#6C47FF,#a855f7)','linear-gradient(135deg,#f6d365,#fda085)'];
      winnersHTML = `
        <div style="margin-bottom:18px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <span style="font-size:15px;font-weight:800;color:var(--text)">&#127942; Recent Winners</span>
          </div>
          <div style="display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:4px">
            ${wins.map((w,i) => {
              const mp  = Number(w.actual_return||0).toFixed(2);
              const ngn = mpToNgn(mp);
              const av  = w.user?.avatar
                ? `<img src="${escHtml(w.user.avatar)}" style="width:30px;height:30px;border-radius:50%;object-fit:cover">`
                : `<div class="pulse-winner-av" style="background:${grads[i%grads.length]}">${(w.user?.username||'?')[0].toUpperCase()}</div>`;
              return `<div class="pulse-winner-card" onclick="showUserProfile('${w.user?.id||''}',this)">
                <div style="display:flex;align-items:center;gap:7px;margin-bottom:7px">${av}
                  <div><div style="font-size:12px;font-weight:700;color:var(--text)">${escHtml(w.user?.username||'')}</div>
                  <div style="font-size:10px;color:var(--text3)">${timeAgo(w.created_at)}</div></div>
                </div>
                <div class="pulse-winner-amount">+${mp} MP</div>
                <div class="pulse-winner-ngn">&#8776; ${fmtNgn(ngn)} won</div>
                <div class="pulse-winner-q">${escHtml(w.prediction?.title||'')}</div>
                <div class="pulse-winner-pick">&#10003; ${escHtml(w.option?.label||'')}</div>
              </div>`;
            }).join('')}
          </div>
        </div>`;
    }
  }

  // Fetch predictions
  let query = supabase
    .from('predictions')
    .select('*, prediction_options(*)')
    .order('total_pool', { ascending: false })
    .limit(30);

  if (tab === 'open')             query = query.eq('status','open').gt('closes_at', new Date().toISOString());
  else if (tab === 'resolved')    query = query.eq('status','resolved');
  else if (tab === 'politics')    query = query.eq('status','open').ilike('category','%Politics%');
  else if (tab === 'entertainment') query = query.eq('status','open').ilike('category','%Entertainment%');
  else if (tab === 'sports')      query = query.eq('status','open').ilike('category','%Sports%');
  else if (tab === 'economy')     query = query.eq('status','open').ilike('category','%Economy%');
  else if (tab === 'social')      query = query.eq('status','open').ilike('category','%Social%');
  else if (tab === 'mine') {
  loadMyBets();
  return;
}

  const { data: preds, error } = await query;

  if (error) {
    console.error('[Pulse] inbox error:', error);
    body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">Failed to load. Please try again.</div>`;
    return;
  }

  if (!preds?.length) {
    body.innerHTML = winnersHTML + `<div style="padding:56px;text-align:center;color:var(--text3)">
      <div style="font-size:40px;margin-bottom:12px">&#127919;</div>
      <p style="font-weight:700">No predictions here yet</p>
      <p style="font-size:13px;margin-top:6px">Check back soon — new questions drop daily</p>
    </div>`;
    return;
  }

  const cardsHTML = preds.map(p => _buildInboxCard(p)).join('');
  body.innerHTML  = winnersHTML + cardsHTML;
}

// ── Build a single prediction card (sports-betting style) ──
function _buildInboxCard(pred) {
  const isOpen    = pred.status === 'open' && new Date(pred.closes_at) > new Date();
  const totalPool = pred.total_pool || 0;
  const prizePool = pred.prize_pool || (totalPool * (1 - PREDICT_PLATFORM_CUT));
  const options   = (pred.prediction_options || []).sort((a,b) => b.total_staked - a.total_staked);
  const cat       = (pred.category || 'General').toLowerCase();
  const catLabel  = pred.category || 'General';
  const emoji     = CAT_EMOJI[pred.category] || '&#127919;';

  const optionsHTML = options.slice(0,3).map((opt, i) => {
    const pct  = totalPool > 0 ? Math.round((opt.total_staked / totalPool) * 100) : Math.round(100/options.length);
    const odds = prizePool > 0 && opt.total_staked > 0
      ? Math.max(1.01, prizePool / opt.total_staked).toFixed(2)
      : (options.length > 0 ? (1/options.length * (1/(1-PREDICT_PLATFORM_CUT))).toFixed(2) : '1.00');
    const barColor = BAR_COLORS[i % BAR_COLORS.length];
    return `<div class="pred-inbox-option">
      <div class="pred-inbox-option-body">
        <div class="pred-inbox-option-row">
          <span class="pred-inbox-option-label">${escHtml(opt.label)}</span>
          <span class="pred-inbox-option-pct">${pct}%</span>
        </div>
        <div class="pred-inbox-bar-bg"><div class="pred-inbox-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
      </div>
      <div class="pred-inbox-odds-pill">
        <div class="pred-inbox-odds-num">${odds}<span style="font-size:10px">x</span></div>
        <div class="pred-inbox-odds-lbl">ODDS</div>
      </div>
    </div>`;
  }).join('');

  const countdown = isOpen ? fmtCountdown(pred.closes_at) : 'Closed';
  const ngnPool   = mpToNgn(totalPool);

  return `<div class="pred-inbox-card" onclick="openPrediction('${pred.id}')">
    <div class="pred-inbox-cat-strip ${cat}"></div>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:12px 14px 8px">
      <div>
        <div style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:3px 8px;border-radius:6px;margin-bottom:5px;background:rgba(108,71,255,0.08);color:var(--accent)">${emoji} ${escHtml(catLabel)}</div>
        <div class="pred-inbox-title">${escHtml(pred.title)}</div>
      </div>
      ${isOpen ? `<div class="pred-inbox-live"><div class="pred-inbox-live-dot"></div>LIVE</div>` : `<div style="font-size:10px;font-weight:700;color:var(--text3);background:var(--bg2);padding:3px 8px;border-radius:8px;flex-shrink:0">CLOSED</div>`}
    </div>
    <div class="pred-inbox-stats">
      <div class="pred-inbox-stat">
        <span class="pred-inbox-stat-val accent">${totalPool > 0 ? Number(totalPool).toFixed(2)+' MP' : '—'}</span>
        <span class="pred-inbox-stat-label">Pool</span>
      </div>
      <div class="pred-inbox-stat">
        <span class="pred-inbox-stat-val">${totalPool > 0 ? fmtNgn(ngnPool).replace(/&[^;]+;/g,'₦') : '—'}</span>
        <span class="pred-inbox-stat-label">&#8776; Naira</span>
      </div>
      <div class="pred-inbox-stat">
        <span class="pred-inbox-stat-val">${pred.stake_count || 0}</span>
        <span class="pred-inbox-stat-label">Stakers</span>
      </div>
      <div class="pred-inbox-stat">
        <span class="pred-inbox-stat-val countdown" id="cd-${pred.id}">${countdown}</span>
        <span class="pred-inbox-stat-label">Closes</span>
      </div>
    </div>
    <div class="pred-inbox-options">${optionsHTML}</div>
    <div class="pred-inbox-bottom">
      <div class="pred-inbox-pool">
        <div class="pred-inbox-pool-mp">Min: 0.1 MP</div>
        <div class="pred-inbox-pool-ngn">&#8776; ₦${Math.round(0.1 * getMPRate()).toLocaleString()} &middot; Rate: &#8358;${getMPRate().toLocaleString()}/MP</div>
      </div>
      ${isOpen ? `
        <div class="pred-inbox-acca-btn" onclick="event.stopPropagation();_addToAccaFromCard('${pred.id}','${escHtml(pred.title)}')">+</div>
        <div class="pred-inbox-stake-btn" onclick="event.stopPropagation();openPrediction('${pred.id}')">Stake</div>
      ` : `<div style="font-size:13px;font-weight:600;color:var(--text3)">Prediction closed</div>`}
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════
// OPEN SINGLE PREDICTION PAGE
// ══════════════════════════════════════════════════════
async function openPrediction(predictionId) {
  slideTo('predict', async () => {
    _pred.currentId      = predictionId;
    _pred.currentData    = null;
    _pred.selectedOptId  = null;
    clearInterval(_predCountdownTimer);

    const body   = document.getElementById('predict-body');
    const panel  = document.getElementById('predict-stake-panel');
    const title  = document.getElementById('predict-topbar-title');
    if (body)  body.innerHTML = `<div style="padding:48px;text-align:center;color:var(--text3)">Loading&hellip;</div>`;
    if (panel) panel.style.display = 'none';

    const { data: pred, error } = await supabase
      .from('predictions').select('*, prediction_options(*)')
      .eq('id', predictionId).single();

    if (error || !pred) { showToast('Could not load prediction'); slideBack(); return; }
    _pred.currentData = pred;
    if (title) title.textContent = pred.title;

    // Increment views
    supabase.from('predictions').update({ view_count: (pred.view_count||0)+1 }).eq('id', predictionId).then(()=>{});

    _renderPredictionPage(pred);
    _subscribePredictionLive(predictionId);

    // Live countdown
    _predCountdownTimer = setInterval(() => {
      document.querySelectorAll(`[id^="pcd-"]`).forEach(el => {
        el.textContent = fmtCountdown(pred.closes_at);
      });
    }, 1000);
  });
}

function _renderPredictionPage(pred) {
  const body  = document.getElementById('predict-body');
  const panel = document.getElementById('predict-stake-panel');
  if (!body) return;

  const isOpen    = pred.status === 'open' && new Date(pred.closes_at) > new Date();
  const totalPool = pred.total_pool || 0;
  const prizePool = pred.prize_pool || (totalPool * (1-PREDICT_PLATFORM_CUT));
  const options   = (pred.prediction_options||[]).sort((a,b) => b.total_staked - a.total_staked);
  const cat       = (pred.category||'General').toLowerCase();
  const catGrad   = CAT_GRADIENT[pred.category] || CAT_GRADIENT['General'];
  const emoji     = CAT_EMOJI[pred.category]    || '&#127919;';

  const optionsHTML = options.map((opt, i) => {
    const pct  = totalPool > 0 ? Math.round((opt.total_staked/totalPool)*100) : Math.round(100/options.length);
    const odds = prizePool > 0 && opt.total_staked > 0
      ? Math.max(1.01, prizePool/opt.total_staked).toFixed(2)
      : (options.length > 0 ? (1/options.length*(1/(1-PREDICT_PLATFORM_CUT))).toFixed(2) : '1.00');
    const barColor = BAR_COLORS[i % BAR_COLORS.length];
    return `<div class="predict-option" id="popt-${opt.id}" onclick="selectPredictOption('${opt.id}','${escHtml(opt.label)}',${odds})">
      <div style="display:flex;align-items:center">
        <div style="flex:1;padding:12px 14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:15px;font-weight:700;color:var(--text)">${escHtml(opt.label)}</span>
            <span style="font-size:12px;color:var(--text3);font-weight:500">${pct}% backed</span>
          </div>
          <div style="height:4px;background:var(--border);border-radius:2px">
            <div id="pbar-${opt.id}" style="height:100%;border-radius:2px;width:${pct}%;background:${barColor};transition:width 0.5s"></div>
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">${fmtMP(opt.total_staked)} staked</div>
        </div>
        <div style="padding:0 14px;border-left:1.5px solid var(--border);min-width:64px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px">
          <div id="podds-${opt.id}" style="font-size:20px;font-weight:900;color:var(--accent);line-height:1;font-variant-numeric:tabular-nums">${odds}<span style="font-size:11px">x</span></div>
          <div style="font-size:9px;color:var(--text3);font-weight:600">ODDS</div>
        </div>
      </div>
    </div>`;
  }).join('');

  body.innerHTML = `
    <!-- Banner -->
    <div style="padding:18px 16px 16px;background:${catGrad};position:relative;overflow:hidden;min-height:120px;display:flex;flex-direction:column;justify-content:flex-end">
      <div style="position:absolute;top:12px;left:12px;display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.15);color:white;font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;padding:3px 10px;border-radius:20px;border:1px solid rgba(255,255,255,0.2)">${emoji} ${escHtml(pred.category||'General')}</div>
      <div style="font-size:20px;font-weight:900;color:white;line-height:1.25;letter-spacing:-0.3px;position:relative;z-index:1">${escHtml(pred.title)}</div>
    </div>

    <!-- Stats strip -->
    <div style="display:flex;border-bottom:1px solid var(--border);background:var(--surface)">
      <div style="flex:1;padding:10px 0;text-align:center;border-right:1px solid var(--border)">
        <div style="font-size:14px;font-weight:900;color:var(--accent)">${Number(totalPool).toFixed(2)} MP</div>
        <div style="font-size:9px;color:var(--text3);font-weight:500;margin-top:1px">Pool</div>
      </div>
      <div style="flex:1;padding:10px 0;text-align:center;border-right:1px solid var(--border)">
        <div style="font-size:13px;font-weight:900;color:var(--text)">${fmtNgn(mpToNgn(totalPool)).replace(/&[^;]+;/g,'₦')}</div>
        <div style="font-size:9px;color:var(--text3);font-weight:500;margin-top:1px">&#8776; Naira</div>
      </div>
      <div style="flex:1;padding:10px 0;text-align:center;border-right:1px solid var(--border)">
        <div style="font-size:14px;font-weight:900;color:var(--text)">${pred.stake_count||0}</div>
        <div style="font-size:9px;color:var(--text3);font-weight:500;margin-top:1px">Stakers</div>
      </div>
      <div style="flex:1;padding:10px 0;text-align:center">
        <div id="pcd-${pred.id}" style="font-size:12px;font-weight:900;color:var(--red);font-variant-numeric:tabular-nums">${fmtCountdown(pred.closes_at)}</div>
        <div style="font-size:9px;color:var(--text3);font-weight:500;margin-top:1px">Closes</div>
      </div>
    </div>

    ${pred.description ? `<div style="padding:12px 16px;font-size:14px;color:var(--text2);line-height:1.5;border-bottom:1px solid var(--border)">${escHtml(pred.description)}</div>` : ''}

    <!-- Options -->
    <div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px">${optionsHTML}</div>

    <!-- Prize pool info -->
    <div style="margin:0 14px 12px;padding:12px 14px;border-radius:14px;background:var(--bg2);border:1px solid var(--border)">
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:4px">How payouts work</div>
      <div style="font-size:12px;color:var(--text3);line-height:1.5">Winners share the prize pool of <strong>${Number(prizePool).toFixed(2)} MP</strong> (&#8776; ${fmtNgn(mpToNgn(prizePool)).replace(/&[^;]+;/g,'₦')}). Your payout = your stake &divide; total on winning option &times; prize pool. Odds shown are live estimates and update as more people stake.</div>
    </div>

    ${pred.status === 'resolved' ? `
      <div style="margin:0 14px 16px;padding:14px;border-radius:14px;background:rgba(22,163,74,0.08);border:1px solid rgba(22,163,74,0.2);font-size:15px;font-weight:800;color:#16a34a;text-align:center">
        &#10003; Resolved &mdash; ${escHtml(options.find(o=>o.id===pred.resolved_option_id)?.label||'Unknown')} won
      </div>` : ''}
  `;

  if (panel) panel.style.display = isOpen ? 'block' : 'none';
}

// ── Select option ─────────────────────────────────────
function selectPredictOption(optId, label, odds) {
  _pred.selectedOptId = optId;
  document.querySelectorAll('.predict-option').forEach(el => el.classList.remove('selected'));
  document.getElementById('popt-'+optId)?.classList.add('selected');
  const nameEl = document.getElementById('predict-stake-option-name');
  const oddsEl = document.getElementById('predict-stake-odds-tag');
  const panel  = document.getElementById('predict-stake-panel');
  if (nameEl) nameEl.textContent  = label;
  if (oddsEl) oddsEl.textContent  = Number(odds).toFixed(2) + 'x';
  if (panel)  { panel.dataset.optId = optId; panel.dataset.odds = odds; }
  updatePredictPotential();
}

function updatePredictPotential() {
  const input  = document.getElementById('predict-stake-input');
  const potEl  = document.getElementById('predict-potential');
  const panel  = document.getElementById('predict-stake-panel');
  if (!input || !potEl || !panel) return;
  const amount = parseFloat(input.value) || 0;
  const odds   = parseFloat(panel.dataset.odds) || 0;
  const est    = amount * odds;
  const ngnEst = mpToNgn(est);
  potEl.innerHTML = amount > 0 && odds > 0
    ? `Est. return: <strong>${est.toFixed(2)} MP</strong> (&#8776; ${fmtNgn(ngnEst).replace(/&[^;]+;/g,'₦')}) &mdash; live odds, final may vary`
    : 'Enter amount to see estimated return';
}

function setPredictQuick(amount) {
  const input = document.getElementById('predict-stake-input');
  if (input) { input.value = amount; updatePredictPotential(); }
}

// ── Submit stake ──────────────────────────────────────
async function submitPredictStake() {
  if (!currentUser) { showToast('Sign in to stake'); return; }
  const panel  = document.getElementById('predict-stake-panel');
  const input  = document.getElementById('predict-stake-input');
  const btn    = document.getElementById('predict-stake-submit-btn');
  if (!panel || !input) return;

  const amount = parseFloat(input.value);
  const optId  = panel.dataset.optId || _pred.selectedOptId;

  if (!optId)  { showToast('Select an option first'); return; }
  if (!amount || amount < PREDICT_MIN_STAKE) {
    showToast(`Minimum stake is ${PREDICT_MIN_STAKE} MP`); return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Placing stake\u2026'; }

  const { data, error } = await supabase.rpc('place_prediction_stake', {
    p_user_id:       currentUser.id,
    p_prediction_id: _pred.currentId,
    p_option_id:     optId,
    p_amount_mp:     amount,
  });

  if (btn) { btn.disabled = false; btn.textContent = 'Place Stake'; }

  if (error) {
    console.error('[Pulse] stake error:', error);
    showToast(error.message || 'Failed to place stake');
    return;
  }

  const ngnStaked = mpToNgn(amount);
  showToast(`Stake placed \u2014 ${amount} MP (\u2248 \u20a6${ngnStaked.toLocaleString()}) \ud83c\udfaf`);
  input.value = '';
  updatePredictPotential();
  _loadPulseWallet();

// ✅ Force homepage Pulse cards to refresh immediately
if (typeof loadPulseMoments === 'function') {
  loadPulseMoments();
}

  // Refresh
  const { data: refreshed } = await supabase
    .from('predictions').select('*, prediction_options(*)').eq('id', _pred.currentId).single();
  if (refreshed) { _pred.currentData = refreshed; _renderPredictionPage(refreshed); selectPredictOption(optId, document.getElementById('predict-stake-option-name')?.textContent, parseFloat(panel.dataset.odds)); }
}

// ══════════════════════════════════════════════════════
// ACCUMULATOR
// ══════════════════════════════════════════════════════
function _addToAccaFromCard(predId, predTitle) {
  // Open the prediction first so user picks an option
  openPrediction(predId);
  showToast('Select an option then tap + to add to Acca');
}

function addToAccaFromPanel() {
  const panel = document.getElementById('predict-stake-panel');
  const optId = panel?.dataset.optId || _pred.selectedOptId;
  if (!optId) { showToast('Select an option first'); return; }
  if (_pred.accaSlip.find(l => l.predictionId === _pred.currentId)) {
    showToast('Already added this prediction to your Acca'); return;
  }
  const label = document.getElementById('predict-stake-option-name')?.textContent || '';
  const odds  = parseFloat(panel?.dataset.odds || 0);
  _pred.accaSlip.push({
    predictionId: _pred.currentId,
    optionId:     optId,
    optionLabel:  label,
    predTitle:    _pred.currentData?.title || '',
    odds,
  });
  _updateAccaFAB();
  showToast(`Added to Acca \u2014 ${_pred.accaSlip.length} leg${_pred.accaSlip.length > 1 ? 's' : ''}`);
}

function _updateAccaFAB() {
  const fab   = document.getElementById('predict-acca-fab');
  const count = _pred.accaSlip.length;
  if (!fab) return;
  fab.classList.toggle('visible', count > 0);
  const countEl = document.getElementById('predict-acca-fab-count');
  if (countEl) countEl.textContent = count;
}

function openAccaSlip() {
  const panel = document.getElementById('predict-acca-panel');
  if (panel) panel.style.display = 'flex';
  _renderAccaSlip();
}

function closeAccaSlip() {
  const panel = document.getElementById('predict-acca-panel');
  if (panel) panel.style.display = 'none';
}

function _renderAccaSlip() {
  const list = document.getElementById('predict-acca-list');
  if (!list) return;
  if (!_pred.accaSlip.length) {
    list.innerHTML = `<div style="padding:48px;text-align:center;color:var(--text3)"><div style="font-size:36px;margin-bottom:10px">&#128221;</div><p>No selections yet</p><p style="font-size:12px;margin-top:6px">Tap + on a prediction to add it here</p></div>`;
    _updateAccaSummary(); return;
  }
  list.innerHTML = _pred.accaSlip.map((leg, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(leg.predTitle)}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px">&#10003; ${escHtml(leg.optionLabel)}</div>
      </div>
      <div style="font-size:16px;font-weight:900;color:var(--accent);flex-shrink:0">${leg.odds.toFixed(2)}x</div>
      <button onclick="removeAccaLeg(${i})" style="width:28px;height:28px;border-radius:50%;background:var(--bg2);color:var(--text3);display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`).join('');
  _updateAccaSummary();
}

function _updateAccaSummary() {
  const oddsEl   = document.getElementById('predict-acca-combined-odds');
  const potEl    = document.getElementById('predict-acca-potential');
  const stakeIn  = document.getElementById('predict-acca-stake');
  const combined = _pred.accaSlip.reduce((a,l) => a * l.odds, 1);
  const stake    = parseFloat(stakeIn?.value) || 0;
  const pot      = stake * combined;
  if (oddsEl) oddsEl.textContent = combined.toFixed(2) + 'x';
  if (potEl)  potEl.innerHTML = stake > 0
    ? `Potential: <strong>${pot.toFixed(2)} MP</strong> (&#8776; ${fmtNgn(mpToNgn(pot)).replace(/&[^;]+;/g,'₦')})`
    : 'Enter stake to see potential return';
}

function removeAccaLeg(i) {
  _pred.accaSlip.splice(i,1);
  _updateAccaFAB();
  _renderAccaSlip();
}

function clearAccaSlip() {
  _pred.accaSlip = [];
  _updateAccaFAB();
  _renderAccaSlip();
}

async function submitAcca() {
  if (!currentUser) { showToast('Sign in to place Acca'); return; }
  if (_pred.accaSlip.length < 2) { showToast('Add at least 2 selections'); return; }
  const input = document.getElementById('predict-acca-stake');
  const stake = parseFloat(input?.value);
  if (!stake || stake < PREDICT_MIN_STAKE) { showToast(`Minimum Acca stake is ${PREDICT_MIN_STAKE} MP`); return; }
  const btn = document.getElementById('predict-acca-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Placing Acca\u2026'; }
  try {
    const { data: acca, error: ae } = await supabase.from('prediction_accas')
      .insert({ user_id: currentUser.id, total_stake_mp: stake, total_legs: _pred.accaSlip.length, status: 'active' })
      .select().single();
    if (ae) throw ae;
    const { error: me } = await supabase.rpc('deduct_mp', { p_user_id: currentUser.id, p_amount: stake });
    if (me) throw me;
    await supabase.from('prediction_acca_legs').insert(_pred.accaSlip.map(l => ({
      acca_id: acca.id, prediction_id: l.predictionId,
      option_id: l.optionId, odds_at_stake: l.odds, status: 'pending',
    })));
    const combined = _pred.accaSlip.reduce((a,l) => a*l.odds, 1);
    showToast(`Acca placed \u2014 ${_pred.accaSlip.length} legs, ${combined.toFixed(2)}x odds \ud83c\udfaf`);
    clearAccaSlip();
    closeAccaSlip();
    _loadPulseWallet();
  } catch(e) {
    console.error('[Pulse] acca error:', e);
    showToast(e.message || 'Failed to place Acca');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Place Acca'; }
  }
}

// ══════════════════════════════════════════════════════
// REALTIME — live odds updates on prediction page
// ══════════════════════════════════════════════════════
let _predChannel = null;
function _subscribePredictionLive(predId) {
  if (_predChannel) supabase.removeChannel(_predChannel);
  _predChannel = supabase.channel(`pred-live-${predId}`)
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'prediction_options', filter:`prediction_id=eq.${predId}` }, payload => {
      const opt    = payload.new;
      const total  = _pred.currentData?.total_pool || 1;
      const prize  = _pred.currentData?.prize_pool || (total * 0.92);
      const odds   = prize > 0 && opt.total_staked > 0
        ? Math.max(1.01, prize / opt.total_staked).toFixed(2) : '1.00';
      const pct    = total > 0 ? Math.round((opt.total_staked / total) * 100) : 0;
      const oddsEl = document.getElementById(`podds-${opt.id}`);
      const barEl  = document.getElementById(`pbar-${opt.id}`);
      if (oddsEl) { oddsEl.innerHTML = odds + '<span style="font-size:11px">x</span>'; oddsEl.style.animation='none'; setTimeout(()=>{ oddsEl.style.animation=''; },50); }
      if (barEl)  barEl.style.width = pct + '%';
    })
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'predictions', filter:`id=eq.${predId}` }, payload => {
      if (_pred.currentData) Object.assign(_pred.currentData, payload.new);
    })
    .subscribe();
}

// ══════════════════════════════════════════════════════
// PULSE MOMENTS ROW — top predictions in feed strip
// ══════════════════════════════════════════════════════
let _pulseMomentsChannel = null;

async function loadPulseMoments() {
  const row = document.getElementById('pulse-moments-row');
  if (!row) return;

  // Remove old realtime channel
  if (_pulseMomentsChannel) {
    supabase.removeChannel(_pulseMomentsChannel);
    _pulseMomentsChannel = null;
  }

  const { data: preds } = await supabase
    .from('predictions')
    .select('id, title, category, total_pool, prize_pool, closes_at, prediction_options(*)')
    .eq('status', 'open')
    .gt('closes_at', new Date().toISOString())
    .order('total_pool', { ascending: false })
    .limit(5);

  if (!preds || !preds.length) {
    row.innerHTML = '<div class="moment-card pulse-moment-placeholder" onclick="openPredictionsPage()">' +
      '<div class="moment-card-bg" style="background:linear-gradient(135deg,#6C47FF,#a855f7)"></div>' +
      '<div class="moment-card-overlay"></div>' +
      '<div class="pulse-moment-icon">🎯</div>' +
      '<div class="moment-card-name">Predict</div>' +
      '</div>';
    return;
  }

  const catBg = {
    'Politics':      'linear-gradient(135deg,#3d1f8a,#6C47FF)',
    'Entertainment': 'linear-gradient(135deg,#8a1f5c,#f0385a)',
    'Sports':        'linear-gradient(135deg,#1f5c2d,#22c55e)',
    'Economy':       'linear-gradient(135deg,#5c4d1f,#f5a623)',
    'Social':        'linear-gradient(135deg,#1f3a5c,#4facfe)',
    'General':       'linear-gradient(135deg,#3d1f8a,#6C47FF)'
  };
  const catEm = {
    'Politics': '🏛', 'Entertainment': '🎤', 'Sports': '⚽',
    'Economy': '📈', 'Social': '💬', 'General': '🎯'
  };

  const predMap = {};
  let html = '';

  preds.forEach(function(pred) {
    const options   = pred.prediction_options || [];
    const totalPool = pred.total_pool || 0;
    const prizePool = pred.prize_pool || (totalPool * 0.92);
    const bg        = catBg[pred.category] || catBg['General'];
    const emoji     = catEm[pred.category] || '🎯';
    const top2      = options.slice().sort(function(a, b) {
      return (b.total_staked || 0) - (a.total_staked || 0);
    }).slice(0, 2);

    const title = pred.title.length > 52 ? pred.title.slice(0, 50) + '…' : pred.title;

    predMap[pred.id] = {
      totalPool: totalPool,
      prizePool: prizePool,
      options: options
    };

    let oddsHTML = '';
    top2.forEach(function(opt) {
      let odds = '—';
      if (prizePool > 0 && opt.total_staked > 0) {
        odds = Math.max(1.01, prizePool / opt.total_staked).toFixed(2);
      }
      oddsHTML += '<div class="pulse-moment-opt" data-opt-id="' + opt.id + '">' +
        '<span class="pulse-moment-opt-label">' + escHtml(opt.label) + '</span>' +
        '<span class="pulse-moment-opt-odds" id="pm-odds-' + opt.id + '">' + odds + 'x</span>' +
        '</div>';
    });

    html += '<div class="moment-card pulse-moment-card" data-pred-id="' + pred.id + '" onclick="openPrediction(\'' + pred.id + '\')">' +
      '<div class="moment-card-bg" style="background:' + bg + '"></div>' +
      '<div class="moment-card-overlay"></div>' +
      '<div class="pulse-moment-live-dot"></div>' +
      '<div class="pulse-moment-top">' +
        '<span class="pulse-moment-cat">' + emoji + ' ' + escHtml(pred.category || 'General') + '</span>' +
        '<span class="pulse-moment-pool" id="pm-pool-' + pred.id + '">' + Number(totalPool).toFixed(1) + ' MP</span>' +
      '</div>' +
      '<div class="pulse-moment-title">' + escHtml(title) + '</div>' +
      '<div class="pulse-moment-odds-wrap">' + oddsHTML + '</div>' +
      '</div>';
  });

  row.innerHTML = html;

  // Realtime updates
  const predIds = preds.map(function(p) { return p.id; });
  if (!predIds.length) return;

  _pulseMomentsChannel = supabase
    .channel('pulse-moments-live')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'prediction_options',
      filter: 'prediction_id=in.(' + predIds.join(',') + ')'
    }, function(payload) {
      const opt = payload.new;
      const predId = opt.prediction_id;
      const info = predMap[predId];
      if (!info) return;

      // Update local option
      for (let i = 0; i < info.options.length; i++) {
        if (info.options[i].id === opt.id) {
          info.options[i].total_staked = opt.total_staked;
          break;
        }
      }

      // Recalculate pool
      let newTotal = 0;
      info.options.forEach(function(o) {
        newTotal += Number(o.total_staked || 0);
      });
      info.totalPool = newTotal;
      info.prizePool = newTotal * 0.92;

      // Update pool text
      const poolEl = document.getElementById('pm-pool-' + predId);
      if (poolEl) poolEl.textContent = Number(newTotal).toFixed(1) + ' MP';

      // Update top 2 odds + flash
      const top2 = info.options.slice().sort(function(a, b) {
        return (b.total_staked || 0) - (a.total_staked || 0);
      }).slice(0, 2);

      top2.forEach(function(o) {
        const oddsEl = document.getElementById('pm-odds-' + o.id);
        if (!oddsEl) return;

        let newOdds = '—';
        if (info.prizePool > 0 && o.total_staked > 0) {
          newOdds = Math.max(1.01, info.prizePool / o.total_staked).toFixed(2);
        }

        if (oddsEl.textContent !== newOdds + 'x') {
          oddsEl.textContent = newOdds + 'x';
          oddsEl.classList.remove('odds-flash');
          void oddsEl.offsetWidth;
          oddsEl.classList.add('odds-flash');
        }
      });
    })
    .subscribe();
}

// Auto-load when feed is ready
window.addEventListener('supabase-ready', () => {
  const tryLoad = (n=0) => {
    if (document.getElementById('pulse-moments-row')) loadPulseMoments();
    else if (n < 12) setTimeout(()=>tryLoad(n+1), 400);
  };
  tryLoad();
});
document.addEventListener('feedTabActivated', loadPulseMoments);

// ══════════════════════════════════════════════════════
// MY BETS — Premium Ticket View
// ══════════════════════════════════════════════════════
async function loadMyBets() {
  const body = document.getElementById('predict-inbox-body');
  if (!body || !currentUser) return;

  body.innerHTML = `<div style="padding:48px;text-align:center;color:var(--text3)">
    <div style="font-size:28px;margin-bottom:10px">⏳</div>Loading your bets…
  </div>`;

  const { data: stakes, error } = await supabase
  .from('prediction_stakes')
  .select(`
    id,
    amount_mp,
    odds_at_stake,
    status,
    actual_return,
    created_at,
    prediction:predictions (
      id,
      title,
      category,
      status,
      closes_at,
      prize_pool,
      total_pool
    ),
    option:prediction_options (
      id,
      label,
      total_staked
    )
  `)
  .eq('user_id', currentUser.id)
  .order('created_at', { ascending: false });

  if (error) {
    console.error('[MyBets]', error);
    body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">Failed to load bets</div>`;
    return;
  }

  if (!stakes || !stakes.length) {
    body.innerHTML = `
      <div class="mybets-empty">
        <div class="mybets-empty-icon">🎯</div>
        <div class="mybets-empty-title">No bets yet</div>
        <div class="mybets-empty-sub">Place your first prediction and<br>it will appear here.</div>
        <button onclick="switchPredictTab('open')" style="
          background:var(--accent);color:white;border:none;border-radius:12px;
          padding:12px 24px;font-size:14px;font-weight:700;font-family:var(--font)">
          Explore Live Predictions
        </button>
      </div>`;
    return;
  }

  const active  = stakes.filter(s => s.status === 'pending');
  const settled = stakes.filter(s => s.status !== 'pending');

  const totalStaked = active.reduce((s, b) => s + Number(b.amount_mp || 0), 0);
  const totalWon    = settled
    .filter(s => s.status === 'won')
    .reduce((s, b) => s + Number(b.actual_return || 0), 0);

  body.innerHTML = `
    <div class="mybets-summary">
      <div class="mybets-summary-card">
        <div class="mybets-summary-val accent">${active.length}</div>
        <div class="mybets-summary-label">Active</div>
      </div>
      <div class="mybets-summary-card">
        <div class="mybets-summary-val">${Number(totalStaked).toFixed(1)}</div>
        <div class="mybets-summary-label">Staked (MP)</div>
      </div>
      <div class="mybets-summary-card">
        <div class="mybets-summary-val green">${Number(totalWon).toFixed(1)}</div>
        <div class="mybets-summary-label">Won (MP)</div>
      </div>
    </div>

    <div class="mybets-tabs">
      <div class="mybets-tab active" onclick="switchMyBetsView('active', this)">Active (${active.length})</div>
      <div class="mybets-tab" onclick="switchMyBetsView('settled', this)">Settled (${settled.length})</div>
    </div>

    <div id="mybets-list">
      ${renderBetTickets(active, 'active')}
    </div>
  `;

  window._myBetsActive  = active;
  window._myBetsSettled = settled;
  subscribeMyBetsLive(stakes);
}

function switchMyBetsView(view, btn) {
  document.querySelectorAll('.mybets-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  const list = document.getElementById('mybets-list');
  if (!list) return;

  if (view === 'active') {
    list.innerHTML = renderBetTickets(window._myBetsActive || [], 'active');
  } else {
    list.innerHTML = renderBetTickets(window._myBetsSettled || [], 'settled');
  }
}

function renderBetTickets(stakes, type) {
  if (!stakes.length) {
    return '<div class="mybets-empty" style="padding:40px 20px"><div class="mybets-empty-title">No ' + type + ' bets</div></div>';
  }

  return stakes.map(function(s) {
    var pred      = s.prediction || {};
    var option    = s.option || {};
    var status    = s.status || 'pending';
    var stake     = Number(s.amount_mp || 0);
    var odds      = Number(s.odds_at_stake || 0);
    var potential = (stake * odds).toFixed(2);
    var actual    = Number(s.actual_return || 0).toFixed(2);
    var prizePool = Number(pred.prize_pool || (pred.total_pool || 0) * 0.92 || 0);

    var statusLabel = 'ACTIVE';
    if (status === 'won') statusLabel = 'WON ✓';
    else if (status === 'lost') statusLabel = 'LOST';
    else if (status === 'refunded') statusLabel = 'REFUNDED';

    var timeText = status === 'pending'
      ? (pred.closes_at ? 'Closes ' + fmtCountdown(pred.closes_at) : '')
      : timeAgo(s.created_at);

    var stakeNgn     = fmtNgn(mpToNgn(stake));
    var potentialNgn = fmtNgn(mpToNgn(potential));
    var actualNgn    = fmtNgn(mpToNgn(actual));

    var returnValue = status === 'pending' ? potential + ' MP' :
                      status === 'won'     ? '+' + actual + ' MP' : actual + ' MP';
    var returnClass = status === 'won' ? 'green' : (status === 'lost' ? 'red' : '');

    return '<div class="bet-ticket" ' +
      'data-stake-id="' + s.id + '" ' +
      'data-option-id="' + (option.id || '') + '" ' +
      'data-stake-amount="' + stake + '" ' +
      'data-prize-pool="' + prizePool + '" ' +
      'onclick="openPrediction(\'' + (pred.id || '') + '\')">' +

      '<div class="bet-ticket-stripe ' + status + '"></div>' +
      '<div class="bet-ticket-body">' +
        '<div class="bet-ticket-top">' +
          '<span class="bet-ticket-cat">' + escHtml(pred.category || 'General') + '</span>' +
          '<span class="bet-ticket-status ' + status + '">' + statusLabel + '</span>' +
        '</div>' +

        '<div class="bet-ticket-title">' + escHtml(pred.title || 'Prediction') + '</div>' +

        '<div class="bet-ticket-pick">' +
          '<div class="bet-ticket-pick-label">Your Pick</div>' +
          '<div class="bet-ticket-pick-value">' + escHtml(option.label || '—') + '</div>' +
        '</div>' +

        '<div class="bet-ticket-stats">' +
          '<div class="bet-ticket-stat">' +
            '<div class="bet-ticket-stat-val">' + stake.toFixed(1) + ' MP</div>' +
            '<div class="bet-ticket-stat-label">' + stakeNgn + '</div>' +
          '</div>' +
          '<div class="bet-ticket-stat">' +
            '<div class="bet-ticket-stat-val js-ticket-odds">' + (odds ? odds.toFixed(2) + 'x' : '—') + '</div>' +
            '<div class="bet-ticket-stat-label">Odds</div>' +
          '</div>' +
          '<div class="bet-ticket-stat">' +
            '<div class="bet-ticket-stat-val js-ticket-potential ' + returnClass + '">' + returnValue + '</div>' +
            '<div class="bet-ticket-stat-label js-ticket-potential-ngn">' + (status === 'pending' ? potentialNgn : actualNgn) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="bet-ticket-footer">' +
        '<span class="bet-ticket-time">' + timeText + '</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

let _myBetsChannel = null;

function subscribeMyBetsLive(stakes) {
  if (_myBetsChannel) {
    supabase.removeChannel(_myBetsChannel);
    _myBetsChannel = null;
  }

  var active = (stakes || []).filter(function(s) {
    return s.status === 'pending';
  });
  if (!active.length) return;

  var predIds = [];
  active.forEach(function(s) {
    if (s.prediction && s.prediction.id) {
      predIds.push(s.prediction.id);
    }
  });
  predIds = [...new Set(predIds)];
  if (!predIds.length) return;

  _myBetsChannel = supabase
    .channel('mybets-live')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'prediction_options',
      filter: 'prediction_id=in.(' + predIds.join(',') + ')'
    }, function(payload) {
      var opt = payload.new;
      var newTotal = Number(opt.total_staked || 0);

      var tickets = document.querySelectorAll('.bet-ticket[data-option-id="' + opt.id + '"]');

      tickets.forEach(function(ticket) {
        var stakeAmount = Number(ticket.dataset.stakeAmount || 0);
        var prizePool   = Number(ticket.dataset.prizePool || 0);

        if (stakeAmount <= 0 || prizePool <= 0 || newTotal <= 0) return;

        var newOdds = Math.max(1.01, prizePool / newTotal);
        var newPotential = (stakeAmount * newOdds).toFixed(2);
        var newPotentialNgn = fmtNgn(mpToNgn(newPotential));

        // Update odds
        var oddsEl = ticket.querySelector('.js-ticket-odds');
        if (oddsEl) {
          oddsEl.textContent = newOdds.toFixed(2) + 'x';
          oddsEl.classList.remove('odds-flash');
          void oddsEl.offsetWidth;
          oddsEl.classList.add('odds-flash');
        }

        // Update potential
        var potEl = ticket.querySelector('.js-ticket-potential');
        if (potEl) potEl.textContent = newPotential + ' MP';

        var potNgnEl = ticket.querySelector('.js-ticket-potential-ngn');
        if (potNgnEl) potNgnEl.textContent = newPotentialNgn;
      });
    })
    .subscribe();
}

// ── Helper ────────────────────────────────────────────
function timeAgo(ts) {
  const diff = Date.now() - new Date(ts);
  const m = Math.floor(diff/60000);
  const h = Math.floor(m/60);
  const d = Math.floor(h/24);
  if (d>0) return d+'d ago';
  if (h>0) return h+'h ago';
  if (m>0) return m+'m ago';
  return 'just now';
}
