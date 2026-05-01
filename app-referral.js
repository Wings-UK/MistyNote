/* ═══════════════════════════════════════════
   MISTYNOTE — app-referral.js
   Invite system, milestone tracking,
   pending breakdown sheet, KYC expiry.
   Requires: app-core.js, app-wallet.js
   ═══════════════════════════════════════════ */

'use strict';

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════

const REF = {
  REWARDS: {
    signup:     0.057,   // MP — ≈ ₦250
    followers:  0.114,   // MP — ≈ ₦500
    post_likes: 0.229,   // MP — ≈ ₦1,000
    kyc:        0.600,   // MP — ≈ ₦2,627
  },
  DEADLINE_DAYS: 90,
  FOLLOWERS_TARGET: 10,
  LIKES_TARGET: 100,
};

// ═══════════════════════════════════════════
// INVITE CODE — generate & fetch
// ═══════════════════════════════════════════

async function getOrCreateInviteCode() {
  if (!currentUser) return null;

  // Try cached on profile first
  if (currentProfile?.invite_code) return currentProfile.invite_code;

  const { data } = await supabase
    .from('users')
    .select('invite_code')
    .eq('id', currentUser.id)
    .maybeSingle();

  if (data?.invite_code) {
    if (currentProfile) currentProfile.invite_code = data.invite_code;
    return data.invite_code;
  }

  // Generate new code
  const code = Math.random().toString(36).slice(2, 10).toLowerCase();
  await supabase.from('users').update({ invite_code: code }).eq('id', currentUser.id);
  if (currentProfile) currentProfile.invite_code = code;
  return code;
}

function buildInviteLink(code) {
  return `${window.location.origin}/?ref=${code}`;
}

// ═══════════════════════════════════════════
// SHARE INVITE
// ═══════════════════════════════════════════

async function shareInviteLink() {
  const code = await getOrCreateInviteCode();
  if (!code) { showToast('Sign in to invite friends'); return; }

  const link = buildInviteLink(code);
  const username = currentProfile?.username || 'a friend';
  const text = `@${username} invited you to join MistyNote 🌟\n\nConnect, create, and earn MistyPoints together.\nJoin here 👇\n${link}`;

  if (navigator.share) {
    try {
      await navigator.share({ title: 'Join me on MistyNote', text, url: link });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }

  // Fallback — copy to clipboard
  try {
    await navigator.clipboard.writeText(text);
    showToast('Invite link copied! 🔗');
  } catch (e) {
    showToast('Copy your link: ' + link);
  }
}

async function shareReminderForReferral(refereeUsername) {
  const code = await getOrCreateInviteCode();
  if (!code) return;
  const link = buildInviteLink(code);
  const text = `Hey @${refereeUsername}! 👋\nDon't forget to complete your MistyNote verification — we both earn MistyPoints when you do!\n\nYou have ${REF.DEADLINE_DAYS} days from when you joined.\n${link}`;

  if (navigator.share) {
    try { await navigator.share({ text, url: link }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Reminder copied! Send it to them 📨');
  } catch (e) {}
}

// ═══════════════════════════════════════════
// ON SIGNUP — register referral if ref param exists
// Call this from bootApp / obFinish after user is created
// ═══════════════════════════════════════════

async function handleReferralOnSignup() {
  if (!currentUser) return;

  // Read ?ref= from URL
  const params = new URLSearchParams(window.location.search);
  const refCode = params.get('ref');
  if (!refCode) return;

  // Don't process if already referred
  const { data: me } = await supabase
    .from('users')
    .select('referred_by, invite_code')
    .eq('id', currentUser.id)
    .maybeSingle();

  if (me?.referred_by) return; // already has a referrer

  // Find referrer by invite code
  const { data: referrer } = await supabase
    .from('users')
    .select('id, invite_code')
    .eq('invite_code', refCode)
    .maybeSingle();

  if (!referrer || referrer.id === currentUser.id) return;

  // Save referrer on new user's profile
  await supabase.from('users')
    .update({ referred_by: referrer.id })
    .eq('id', currentUser.id);

  // Create referral row
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + REF.DEADLINE_DAYS);

  const { error } = await supabase.from('referrals').insert({
    referrer_id:          referrer.id,
    referee_id:           currentUser.id,
    kyc_deadline:         deadline.toISOString(),
    milestone_signup:     true,
    reward_signup_granted: false,
  });

  if (error) {
    console.error('[Referral] create failed:', error.message);
    return;
  }

  // Credit signup reward to referrer's pending
  await grantReferralReward(referrer.id, currentUser.id, 'signup');

  // Clean ref param from URL without reload
  const url = new URL(window.location.href);
  url.searchParams.delete('ref');
  window.history.replaceState({}, '', url.toString());
}

// ═══════════════════════════════════════════
// GRANT REWARD — central function
// ═══════════════════════════════════════════

async function grantReferralReward(referrerId, refereeId, milestone) {
  // Get referral row
  const { data: ref } = await supabase
    .from('referrals')
    .select('*')
    .eq('referrer_id', referrerId)
    .eq('referee_id', refereeId)
    .maybeSingle();

  if (!ref) return;
  if (ref.status === 'expired') return;

  const grantedKey  = `reward_${milestone}_granted`;
  const amountKey   = `reward_${milestone}_mp`;
  const amount      = ref[amountKey] ?? REF.REWARDS[milestone] ?? 0;

  // Already granted — skip
  if (ref[grantedKey]) return;

  // Mark milestone complete + reward granted
  const updateObj = {
    [`milestone_${milestone}`]: true,
    [grantedKey]: true,
  };
  await supabase.from('referrals').update(updateObj)
    .eq('referrer_id', referrerId).eq('referee_id', refereeId);

  // Has KYC been done? If yes → available directly. If no → pending.
  if (ref.kyc_completed_at || milestone === 'kyc') {
    // Goes straight to available
    await supabase.rpc('release_referral_pending', {
      p_referrer_id: referrerId,
      p_amount: amount,
    });
  } else {
    // Sits in pending
    await supabase.rpc('credit_referral_pending', {
      p_referrer_id: referrerId,
      p_amount: amount,
    });
  }

  // If this IS the KYC milestone, flush everything pending for this referral
  if (milestone === 'kyc') {
    await flushPendingOnKyc(referrerId, refereeId, ref);
  }
}

// ═══════════════════════════════════════════
// KYC COMPLETED — flush all pending for this referral
// ═══════════════════════════════════════════

async function flushPendingOnKyc(referrerId, refereeId, refRow) {
  // Get fresh row
  const { data: ref } = await supabase
    .from('referrals')
    .select('*')
    .eq('referrer_id', referrerId)
    .eq('referee_id', refereeId)
    .maybeSingle();

  if (!ref) return;

  // Sum all previously granted pending rewards that haven't been released yet
  // (signup, followers, post_likes that were granted BEFORE kyc)
  let pendingToRelease = 0;
  if (ref.reward_signup_granted)     pendingToRelease += ref.reward_signup_mp     ?? REF.REWARDS.signup;
  if (ref.reward_followers_granted)  pendingToRelease += ref.reward_followers_mp  ?? REF.REWARDS.followers;
  if (ref.reward_post_likes_granted) pendingToRelease += ref.reward_post_likes_mp ?? REF.REWARDS.post_likes;
  // KYC reward itself is already being released in grantReferralReward → don't double count
  // But we need to move the non-kyc pending to available
  // (kyc reward handled separately, only move pre-kyc pending)
  const preKycPending = pendingToRelease; // signup + followers + post_likes granted before kyc

  if (preKycPending > 0) {
    await supabase.rpc('release_referral_pending', {
      p_referrer_id: referrerId,
      p_amount: preKycPending,
    });
  }

  // Update referral status
  await supabase.from('referrals').update({
    kyc_completed_at: new Date().toISOString(),
    milestone_kyc: true,
    status: 'completed',
  }).eq('referrer_id', referrerId).eq('referee_id', refereeId);
}

// ═══════════════════════════════════════════
// KYC COMPLETED HOOK
// Call this when a user completes KYC payment
// ═══════════════════════════════════════════

async function onUserKycCompleted(userId) {
  // Find if this user was referred
  const { data: user } = await supabase
    .from('users')
    .select('referred_by')
    .eq('id', userId)
    .maybeSingle();

  if (!user?.referred_by) return;

  // Check deadline
  const { data: ref } = await supabase
    .from('referrals')
    .select('kyc_deadline, status')
    .eq('referrer_id', user.referred_by)
    .eq('referee_id', userId)
    .maybeSingle();

  if (!ref || ref.status === 'expired') return;

  if (new Date() > new Date(ref.kyc_deadline)) {
    // Past deadline — expire it, money goes to platform
    await supabase.rpc('expire_referral', { p_referral_id: ref.id });
    return;
  }

  // Within deadline — grant KYC reward (flushes everything to available)
  await grantReferralReward(user.referred_by, userId, 'kyc');
}

// ═══════════════════════════════════════════
// MILESTONE: FOLLOWERS
// Call after follows table insert
// ═══════════════════════════════════════════

async function checkFollowersMilestone(userId) {
  const { data: user } = await supabase
    .from('users')
    .select('referred_by, followers')
    .eq('id', userId)
    .maybeSingle();

  if (!user?.referred_by) return;
  if ((user.followers || 0) < REF.FOLLOWERS_TARGET) return;

  // Check referral still active
  const { data: ref } = await supabase
    .from('referrals')
    .select('milestone_followers, status, kyc_deadline')
    .eq('referrer_id', user.referred_by)
    .eq('referee_id', userId)
    .maybeSingle();

  if (!ref || ref.status === 'expired' || ref.milestone_followers) return;
  if (new Date() > new Date(ref.kyc_deadline) && !ref.kyc_completed_at) return;

  await grantReferralReward(user.referred_by, userId, 'followers');
}

// ═══════════════════════════════════════════
// MILESTONE: POST LIKES (100)
// Call after a like is inserted and post like_count updated
// ═══════════════════════════════════════════

async function checkPostLikesMilestone(postOwnerId) {
  const { data: user } = await supabase
    .from('users')
    .select('referred_by')
    .eq('id', postOwnerId)
    .maybeSingle();

  if (!user?.referred_by) return;

  // Check referral still active
  const { data: ref } = await supabase
    .from('referrals')
    .select('milestone_post_likes, status, kyc_deadline, kyc_completed_at')
    .eq('referrer_id', user.referred_by)
    .eq('referee_id', postOwnerId)
    .maybeSingle();

  if (!ref || ref.status === 'expired' || ref.milestone_post_likes) return;
  if (new Date() > new Date(ref.kyc_deadline) && !ref.kyc_completed_at) return;

  // Check if any post by this user has 100+ likes
  const { data: posts } = await supabase
    .from('posts')
    .select('id, like_count')
    .eq('user_id', postOwnerId)
    .gte('like_count', REF.LIKES_TARGET)
    .limit(1);

  if (!posts?.length) return;

  await grantReferralReward(user.referred_by, postOwnerId, 'post_likes');
}

// ═══════════════════════════════════════════
// EXPIRE STALE REFERRALS
// Call on wallet open — lightweight check
// ═══════════════════════════════════════════

async function expireStaleReferrals() {
  if (!currentUser) return;

  // Find pending referrals past deadline where I am the referrer
  const { data: stale } = await supabase
    .from('referrals')
    .select('id')
    .eq('referrer_id', currentUser.id)
    .eq('status', 'pending')
    .lt('kyc_deadline', new Date().toISOString());

  if (!stale?.length) return;

  for (const ref of stale) {
    await supabase.rpc('expire_referral', { p_referral_id: ref.id });
  }
}

// ═══════════════════════════════════════════
// PENDING BREAKDOWN SHEET
// ═══════════════════════════════════════════

function openPendingSheet() {
  // Add to SHEET_MAP and open
  const existing = document.getElementById('sheet-pending');
  if (existing) {
    existing.classList.remove('hidden');
    walletState.activeSheet = 'pending';
    renderPendingSheet();
    return;
  }
  // Build sheet DOM
  const sheet = document.createElement('div');
  sheet.className = 'wlt-sheet';
  sheet.id = 'sheet-pending';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Pending Balance');
  sheet.innerHTML = `
    <div class="wlt-sheet-backdrop" onclick="closePendingSheet()"></div>
    <div class="wlt-sheet-body ca-sheet-body ref-sheet-body">
      <div class="wlt-sheet-handle"></div>
      <div class="wlt-sheet-header">
        <button class="wlt-sheet-close" onclick="closePendingSheet()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          </svg>
        </button>
        <h2 class="wlt-sheet-title">Pending Balance</h2>
        <div style="width:36px"></div>
      </div>

      <!-- Explainer banner -->
      <div class="ref-explainer">
        <div class="ref-explainer-icon">⏳</div>
        <div class="ref-explainer-text">
          Pending MP releases to your available balance once your invited friends complete KYC verification, or when your marketplace orders are delivered.
        </div>
      </div>

      <!-- Content loads here -->
      <div id="pending-sheet-content">
        <div class="ref-loading">
          <div class="ref-skeleton"></div>
          <div class="ref-skeleton" style="width:70%"></div>
          <div class="ref-skeleton" style="width:85%"></div>
        </div>
      </div>

      <!-- Invite CTA -->
      <div class="ref-invite-cta">
        <button class="ref-invite-btn" onclick="shareInviteLink()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
          </svg>
          Invite more friends
        </button>
        <p class="ref-invite-hint">Earn up to MP 1.000 per verified friend</p>
      </div>
    </div>
  `;

  // Add to wallet page
  const walletPage = document.getElementById('page-wallet');
  if (walletPage) walletPage.appendChild(sheet);
  else document.body.appendChild(sheet);

  // Register in SHEET_MAP so closeAllWalletSheets works
  SHEET_MAP['pending'] = 'sheet-pending';

  walletState.activeSheet = 'pending';
  renderPendingSheet();
}

function closePendingSheet() {
  const sheet = document.getElementById('sheet-pending');
  if (sheet) sheet.classList.add('hidden');
  walletState.activeSheet = null;
}

async function renderPendingSheet() {
  const content = document.getElementById('pending-sheet-content');
  if (!content || !currentUser) return;

  // Run expiry check silently
  expireStaleReferrals();

  // Fetch referrals where I am the referrer + active/pending
  const { data: referrals } = await supabase
    .from('referrals')
    .select(`
      id, created_at, kyc_deadline, kyc_completed_at, status,
      milestone_signup, milestone_followers, milestone_post_likes, milestone_kyc,
      reward_signup_granted, reward_followers_granted,
      reward_post_likes_granted, reward_kyc_granted,
      reward_signup_mp, reward_followers_mp, reward_post_likes_mp, reward_kyc_mp,
      referee:referee_id(id, username, avatar, followers)
    `)
    .eq('referrer_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(50);

  // Fetch escrow holds
  const { data: escrows } = await supabase
    .from('escrow_holds')
    .select('id, amount, held_at, auto_release_at, order_id')
    .eq('buyer_id', currentUser.id)
    .eq('status', 'held')
    .order('held_at', { ascending: false })
    .limit(20);

  const activeReferrals = (referrals || []).filter(r => r.status === 'pending');
  const completedReferrals = (referrals || []).filter(r => r.status === 'completed');
  const hasAny = activeReferrals.length > 0 || (escrows || []).length > 0 || completedReferrals.length > 0;

  if (!hasAny) {
    content.innerHTML = `
      <div class="ref-empty">
        <div class="ref-empty-icon">🌱</div>
        <p class="ref-empty-title">Nothing pending yet</p>
        <p class="ref-empty-sub">Invite friends to start earning MistyPoints</p>
      </div>`;
    return;
  }

  let html = '';

  // ── ACTIVE REFERRALS ──
  if (activeReferrals.length > 0) {
    html += `<div class="ref-section-label">Referral Rewards</div>`;
    activeReferrals.forEach(ref => {
      html += buildReferralCard(ref, false);
    });
  }

  // ── COMPLETED REFERRALS (collapsed, show last 3) ──
  if (completedReferrals.length > 0) {
    html += `<div class="ref-section-label ref-section-label-done">Completed</div>`;
    completedReferrals.slice(0, 3).forEach(ref => {
      html += buildReferralCard(ref, true);
    });
  }

  // ── ESCROW ──
  if (escrows?.length > 0) {
    html += `<div class="ref-section-label">Marketplace Escrow</div>`;
    escrows.forEach(esc => {
      const date = new Date(esc.held_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
      const autoRelease = esc.auto_release_at
        ? new Date(esc.auto_release_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
        : null;
      html += `
        <div class="ref-escrow-card">
          <div class="ref-escrow-icon">🛍️</div>
          <div class="ref-escrow-info">
            <div class="ref-escrow-title">Order escrow</div>
            <div class="ref-escrow-sub">Held ${date}${autoRelease ? ` · Auto-releases ${autoRelease}` : ' · Releases on delivery'}</div>
          </div>
          <div class="ref-escrow-amount">${fmtPts(esc.amount)}</div>
        </div>`;
    });
  }

  content.innerHTML = html;
}

function buildReferralCard(ref, isCompleted) {
  const user = ref.referee || {};
  const username = user.username || 'Unknown';
  const avatar = user.avatar || '';
  const joinedDate = new Date(ref.created_at);
  const deadline = new Date(ref.kyc_deadline);
  const now = new Date();
  const daysLeft = Math.max(0, Math.ceil((deadline - now) / 86400000));
  const daysLeftText = daysLeft === 0 ? 'Expires today!' : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`;
  const isUrgent = daysLeft <= 14 && !isCompleted;

  // Calculate total pending MP earned so far for this referral
  let totalEarned = 0;
  if (ref.reward_signup_granted)     totalEarned += ref.reward_signup_mp     ?? REF.REWARDS.signup;
  if (ref.reward_followers_granted)  totalEarned += ref.reward_followers_mp  ?? REF.REWARDS.followers;
  if (ref.reward_post_likes_granted) totalEarned += ref.reward_post_likes_mp ?? REF.REWARDS.post_likes;
  if (ref.reward_kyc_granted)        totalEarned += ref.reward_kyc_mp        ?? REF.REWARDS.kyc;

  // Progress: count completed milestones
  const milestonesDone = [
    ref.milestone_signup,
    ref.milestone_followers,
    ref.milestone_post_likes,
    ref.milestone_kyc,
  ].filter(Boolean).length;
  const progressPct = Math.round((milestonesDone / 4) * 100);

  const joinedStr = joinedDate.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });

  return `
    <div class="ref-card ${isCompleted ? 'ref-card-done' : ''} ${isUrgent ? 'ref-card-urgent' : ''}">
      <div class="ref-card-header">
        <div class="ref-card-user">
          <img class="ref-card-av" src="${escHtml(avatar)}"
               onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(username)}'" alt="">
          <div class="ref-card-user-info">
            <span class="ref-card-username">@${escHtml(username)}</span>
            <span class="ref-card-joined">Joined ${joinedStr}</span>
          </div>
        </div>
        <div class="ref-card-earned">
          <span class="ref-card-earned-label">${isCompleted ? 'Earned' : 'Pending'}</span>
          <span class="ref-card-earned-mp">${fmtPts(totalEarned)}</span>
        </div>
      </div>

      ${!isCompleted ? `
        <!-- KYC countdown -->
        <div class="ref-card-deadline ${isUrgent ? 'ref-card-deadline-urgent' : ''}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          ${isUrgent ? `⚠ ` : ''}KYC needed · ${daysLeftText}
        </div>

        <!-- Progress bar -->
        <div class="ref-progress-wrap">
          <div class="ref-progress-bar">
            <div class="ref-progress-fill" style="width:${progressPct}%"></div>
          </div>
          <span class="ref-progress-pct">${progressPct}%</span>
        </div>
      ` : `
        <div class="ref-card-complete-badge">✓ KYC complete · All rewards released</div>
      `}

      <!-- Milestones -->
      <div class="ref-milestones">
        ${buildMilestone('Signed up',       ref.milestone_signup,      ref.reward_signup_mp     ?? REF.REWARDS.signup,     ref.reward_signup_granted)}
        ${buildMilestone('10 followers',    ref.milestone_followers,   ref.reward_followers_mp  ?? REF.REWARDS.followers,  ref.reward_followers_granted)}
        ${buildMilestone('Post: 100 likes', ref.milestone_post_likes,  ref.reward_post_likes_mp ?? REF.REWARDS.post_likes, ref.reward_post_likes_granted)}
        ${buildMilestone('KYC verified',    ref.milestone_kyc,         ref.reward_kyc_mp        ?? REF.REWARDS.kyc,        ref.reward_kyc_granted)}
      </div>

      ${!isCompleted ? `
        <button class="ref-remind-btn" onclick="shareReminderForReferral('${escHtml(username)}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
          </svg>
          Send reminder
        </button>
      ` : ''}
    </div>`;
}

function buildMilestone(label, done, mp, granted) {
  const state = done
    ? (granted ? 'granted' : 'done')
    : 'pending';
  return `
    <div class="ref-milestone ref-milestone-${state}">
      <div class="ref-milestone-icon">
        ${state === 'granted'
          ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
          : state === 'done'
            ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
            : `<div class="ref-milestone-dot"></div>`
        }
      </div>
      <span class="ref-milestone-label">${escHtml(label)}</span>
      <span class="ref-milestone-mp">${fmtPts(mp)}</span>
    </div>`;
}

// ═══════════════════════════════════════════
// INVITE PAGE — full screen slide page
// ═══════════════════════════════════════════

async function openInvitePage() {
  const code = await getOrCreateInviteCode();
  const link = code ? buildInviteLink(code) : '';
  const username = currentProfile?.username || '';

  slideTo('invite', () => {
    const body = document.getElementById('invite-page-body');
    if (!body) return;

    body.innerHTML = `
      <div class="inv-hero">
        <div class="inv-hero-glow"></div>
        <div class="inv-hero-icon">🌟</div>
        <h1 class="inv-hero-title">Invite & Earn</h1>
        <p class="inv-hero-sub">Earn up to <strong>MP 1.000</strong> for every friend who joins and verifies.</p>
      </div>

      <!-- Invite link card -->
      <div class="inv-link-card">
        <div class="inv-link-label">Your invite link</div>
        <div class="inv-link-row">
          <span class="inv-link-text" id="inv-link-display">${escHtml(link)}</span>
          <button class="inv-copy-btn" onclick="copyInviteLink('${escHtml(link)}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
            Copy
          </button>
        </div>
      </div>

      <!-- Share button -->
      <button class="inv-share-btn" onclick="shareInviteLink()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
        </svg>
        Share invite link
      </button>

      <!-- How it works -->
      <div class="inv-how">
        <div class="inv-how-title">How it works</div>
        <div class="inv-how-steps">
          <div class="inv-step">
            <div class="inv-step-num">1</div>
            <div class="inv-step-info">
              <div class="inv-step-title">Friend signs up</div>
              <div class="inv-step-sub">They use your link to create an account</div>
            </div>
            <div class="inv-step-reward">${fmtPts(REF.REWARDS.signup)}</div>
          </div>
          <div class="inv-step">
            <div class="inv-step-num">2</div>
            <div class="inv-step-info">
              <div class="inv-step-title">Gets 10 followers</div>
              <div class="inv-step-sub">They become active on the platform</div>
            </div>
            <div class="inv-step-reward">${fmtPts(REF.REWARDS.followers)}</div>
          </div>
          <div class="inv-step">
            <div class="inv-step-num">3</div>
            <div class="inv-step-info">
              <div class="inv-step-title">Post gets 100 likes</div>
              <div class="inv-step-sub">They create content people love</div>
            </div>
            <div class="inv-step-reward">${fmtPts(REF.REWARDS.post_likes)}</div>
          </div>
          <div class="inv-step inv-step-kyc">
            <div class="inv-step-num inv-step-num-kyc">✦</div>
            <div class="inv-step-info">
              <div class="inv-step-title">Completes KYC</div>
              <div class="inv-step-sub">All pending rewards release to your balance</div>
            </div>
            <div class="inv-step-reward inv-step-reward-kyc">${fmtPts(REF.REWARDS.kyc)}</div>
          </div>
        </div>
        <div class="inv-deadline-note">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          KYC must be completed within <strong>90 days</strong> of signup or all pending rewards are forfeited.
        </div>
      </div>

      <!-- Stats -->
      <div class="inv-stats" id="inv-stats">
        <div class="inv-stat">
          <span class="inv-stat-n" id="inv-stat-total">—</span>
          <span class="inv-stat-l">Total invited</span>
        </div>
        <div class="inv-stat">
          <span class="inv-stat-n" id="inv-stat-verified">—</span>
          <span class="inv-stat-l">Verified</span>
        </div>
        <div class="inv-stat">
          <span class="inv-stat-n" id="inv-stat-earned">—</span>
          <span class="inv-stat-l">Total earned</span>
        </div>
      </div>
    `;

    loadInviteStats();
  });
}

async function loadInviteStats() {
  if (!currentUser) return;

  const { data: referrals } = await supabase
    .from('referrals')
    .select('status, reward_signup_granted, reward_followers_granted, reward_post_likes_granted, reward_kyc_granted, reward_signup_mp, reward_followers_mp, reward_post_likes_mp, reward_kyc_mp')
    .eq('referrer_id', currentUser.id);

  if (!referrals) return;

  const total    = referrals.length;
  const verified = referrals.filter(r => r.status === 'completed').length;
  let earned     = 0;

  referrals.forEach(r => {
    if (r.reward_signup_granted)     earned += r.reward_signup_mp     ?? REF.REWARDS.signup;
    if (r.reward_followers_granted)  earned += r.reward_followers_mp  ?? REF.REWARDS.followers;
    if (r.reward_post_likes_granted) earned += r.reward_post_likes_mp ?? REF.REWARDS.post_likes;
    if (r.reward_kyc_granted)        earned += r.reward_kyc_mp        ?? REF.REWARDS.kyc;
  });

  const totalEl    = document.getElementById('inv-stat-total');
  const verifiedEl = document.getElementById('inv-stat-verified');
  const earnedEl   = document.getElementById('inv-stat-earned');

  if (totalEl)    totalEl.textContent    = total;
  if (verifiedEl) verifiedEl.textContent = verified;
  if (earnedEl)   earnedEl.textContent   = fmtPts(Math.round(earned * 1000) / 1000);
}

async function copyInviteLink(link) {
  try {
    await navigator.clipboard.writeText(link);
    showToast('Link copied! 🔗');
  } catch (e) {
    showToast('Copy: ' + link);
  }
}

// ═══════════════════════════════════════════
// INJECT CSS
// ═══════════════════════════════════════════

function injectReferralStyles() {
  if (document.getElementById('referral-styles')) return;
  const s = document.createElement('style');
  s.id = 'referral-styles';
  s.textContent = `

  /* ── Pending sheet body ── */
  .ref-sheet-body {
    max-height: 88vh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  /* ── Explainer banner ── */
  .ref-explainer {
    display: flex; gap: 12px; align-items: flex-start;
    background: rgba(108,71,255,0.08);
    border: 1px solid rgba(108,71,255,0.18);
    border-radius: 14px; padding: 14px 16px;
    margin: 0 0 20px;
  }
  .ref-explainer-icon { font-size: 20px; flex-shrink: 0; margin-top: 1px; }
  .ref-explainer-text { font-size: 13px; color: var(--text2); line-height: 1.5; }

  /* ── Section labels ── */
  .ref-section-label {
    font-size: 11px; font-weight: 700; letter-spacing: .08em;
    text-transform: uppercase; color: var(--text3);
    margin: 18px 0 10px; padding-left: 2px;
  }
  .ref-section-label-done { color: var(--text3); opacity: 0.6; }

  /* ── Referral card ── */
  .ref-card {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 16px; padding: 14px;
    margin-bottom: 12px;
    transition: border-color .2s;
  }
  .ref-card-done {
    opacity: 0.7;
    border-color: rgba(0,200,100,0.25);
    background: rgba(0,200,100,0.04);
  }
  .ref-card-urgent { border-color: rgba(255,59,92,0.4); }

  /* Card header */
  .ref-card-header {
    display: flex; align-items: center;
    justify-content: space-between; gap: 10px;
    margin-bottom: 10px;
  }
  .ref-card-user { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .ref-card-av {
    width: 38px; height: 38px; border-radius: 50%;
    object-fit: cover; flex-shrink: 0;
    background: var(--bg3);
  }
  .ref-card-user-info { min-width: 0; }
  .ref-card-username {
    font-size: 14px; font-weight: 700; color: var(--text);
    display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ref-card-joined { font-size: 11px; color: var(--text3); display: block; margin-top: 1px; }
  .ref-card-earned { text-align: right; flex-shrink: 0; }
  .ref-card-earned-label { font-size: 10px; color: var(--text3); display: block; }
  .ref-card-earned-mp { font-size: 14px; font-weight: 700; color: var(--accent); display: block; }

  /* Deadline */
  .ref-card-deadline {
    display: flex; align-items: center; gap: 5px;
    font-size: 12px; color: var(--text2);
    margin-bottom: 10px;
  }
  .ref-card-deadline-urgent { color: rgb(244,7,82); font-weight: 600; }

  /* Progress bar */
  .ref-progress-wrap {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 12px;
  }
  .ref-progress-bar {
    flex: 1; height: 5px; background: var(--bg3);
    border-radius: 3px; overflow: hidden;
  }
  .ref-progress-fill {
    height: 100%; background: linear-gradient(90deg, #6C47FF, #a855f7);
    border-radius: 3px; transition: width .4s ease;
  }
  .ref-progress-pct { font-size: 11px; font-weight: 600; color: var(--text2); flex-shrink: 0; }

  /* Complete badge */
  .ref-card-complete-badge {
    font-size: 12px; color: #00c48c; font-weight: 600;
    margin-bottom: 10px; display: flex; align-items: center; gap: 5px;
  }

  /* Milestones */
  .ref-milestones { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
  .ref-milestone {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 8px; border-radius: 8px;
  }
  .ref-milestone-granted { background: rgba(0,196,140,0.08); }
  .ref-milestone-done    { background: rgba(108,71,255,0.07); }
  .ref-milestone-pending { opacity: 0.5; }

  .ref-milestone-icon {
    width: 18px; height: 18px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .ref-milestone-granted .ref-milestone-icon { background: #00c48c; color: #fff; }
  .ref-milestone-done    .ref-milestone-icon { background: #6C47FF; color: #fff; }
  .ref-milestone-pending .ref-milestone-icon { background: var(--bg3); }
  .ref-milestone-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text3); }

  .ref-milestone-label { flex: 1; font-size: 13px; color: var(--text); }
  .ref-milestone-mp    { font-size: 12px; font-weight: 600; color: var(--text2); flex-shrink: 0; }
  .ref-milestone-granted .ref-milestone-mp { color: #00c48c; }
  .ref-milestone-done    .ref-milestone-mp { color: #6C47FF; }

  /* Remind button */
  .ref-remind-btn {
    display: flex; align-items: center; gap: 6px;
    width: 100%; padding: 9px 14px;
    background: transparent; border: 1.5px solid var(--border);
    border-radius: 10px; font-size: 13px; font-weight: 600;
    color: var(--text2); cursor: pointer;
    transition: all .18s; font-family: inherit;
    margin-top: 4px;
  }
  .ref-remind-btn:active { background: var(--bg3); transform: scale(.97); }

  /* Escrow card */
  .ref-escrow-card {
    display: flex; align-items: center; gap: 12px;
    background: var(--bg2); border: 1px solid var(--border);
    border-radius: 14px; padding: 12px 14px; margin-bottom: 10px;
  }
  .ref-escrow-icon { font-size: 22px; flex-shrink: 0; }
  .ref-escrow-info { flex: 1; min-width: 0; }
  .ref-escrow-title { font-size: 13px; font-weight: 600; color: var(--text); }
  .ref-escrow-sub   { font-size: 11px; color: var(--text3); margin-top: 2px; }
  .ref-escrow-amount { font-size: 14px; font-weight: 700; color: var(--accent); flex-shrink: 0; }

  /* Empty state */
  .ref-empty {
    display: flex; flex-direction: column; align-items: center;
    padding: 40px 20px; gap: 10px; text-align: center;
  }
  .ref-empty-icon  { font-size: 40px; opacity: .4; }
  .ref-empty-title { font-size: 16px; font-weight: 700; color: var(--text); margin: 0; }
  .ref-empty-sub   { font-size: 13px; color: var(--text2); margin: 0; }

  /* Invite CTA */
  .ref-invite-cta { padding: 16px 0 0; text-align: center; }
  .ref-invite-btn {
    display: inline-flex; align-items: center; gap: 8px;
    background: #6C47FF; color: #fff;
    border: none; border-radius: 14px;
    padding: 13px 24px; font-size: 15px; font-weight: 700;
    cursor: pointer; font-family: inherit;
    transition: all .18s; width: 100%; justify-content: center;
  }
  .ref-invite-btn:active { transform: scale(.97); opacity: .9; }
  .ref-invite-hint { font-size: 12px; color: var(--text3); margin-top: 8px; }

  /* Skeleton */
  .ref-loading { padding: 10px 0; }
  .ref-skeleton {
    height: 14px; border-radius: 8px; width: 100%;
    background: var(--bg3); margin-bottom: 10px;
    animation: shimmer 1.4s infinite;
    background-size: 200% 100%;
    background-image: linear-gradient(90deg, var(--bg3) 25%, var(--bg2) 50%, var(--bg3) 75%);
  }

  /* ── Invite page ── */
  .inv-hero {
    position: relative; overflow: hidden;
    background: linear-gradient(135deg, #6C47FF 0%, #a855f7 60%, #ff3b5c 100%);
    padding: 48px 24px 36px; text-align: center; color: #fff;
  }
  .inv-hero-glow {
    position: absolute; inset: 0;
    background: radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.18) 0%, transparent 70%);
  }
  .inv-hero-icon   { font-size: 48px; margin-bottom: 12px; position: relative; }
  .inv-hero-title  { font-size: 28px; font-weight: 800; margin: 0 0 8px; position: relative; }
  .inv-hero-sub    { font-size: 15px; opacity: .9; margin: 0; line-height: 1.5; position: relative; }
  .inv-hero-sub strong { opacity: 1; font-weight: 700; }

  .inv-link-card {
    margin: 20px 16px 0;
    background: var(--bg2); border: 1.5px solid var(--border);
    border-radius: 16px; padding: 14px 16px;
  }
  .inv-link-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--text3); margin-bottom: 8px; }
  .inv-link-row   { display: flex; align-items: center; gap: 10px; }
  .inv-link-text  { flex: 1; font-size: 12px; color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; }
  .inv-copy-btn {
    display: flex; align-items: center; gap: 5px;
    background: #6C47FF; color: #fff; border: none;
    border-radius: 8px; padding: 7px 12px;
    font-size: 12px; font-weight: 700; cursor: pointer;
    font-family: inherit; flex-shrink: 0;
    transition: all .15s;
  }
  .inv-copy-btn:active { transform: scale(.94); }

  .inv-share-btn {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    margin: 14px 16px 0; width: calc(100% - 32px);
    background: var(--text); color: var(--bg);
    border: none; border-radius: 14px; padding: 14px;
    font-size: 15px; font-weight: 700; cursor: pointer;
    font-family: inherit; transition: all .18s;
  }
  .inv-share-btn:active { transform: scale(.97); opacity: .85; }

  .inv-how { margin: 24px 16px 0; }
  .inv-how-title {
    font-size: 12px; font-weight: 700; letter-spacing: .08em;
    text-transform: uppercase; color: var(--text3); margin-bottom: 14px;
  }
  .inv-how-steps { display: flex; flex-direction: column; gap: 2px; }

  .inv-step {
    display: flex; align-items: center; gap: 12px;
    padding: 13px 14px; background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 12px; margin-bottom: 6px;
  }
  .inv-step-kyc { border-color: rgba(108,71,255,0.35); background: rgba(108,71,255,0.05); }

  .inv-step-num {
    width: 28px; height: 28px; border-radius: 50%;
    background: var(--bg3); color: var(--text2);
    font-size: 12px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .inv-step-num-kyc { background: #6C47FF; color: #fff; font-size: 14px; }

  .inv-step-info { flex: 1; min-width: 0; }
  .inv-step-title { font-size: 14px; font-weight: 600; color: var(--text); }
  .inv-step-sub   { font-size: 12px; color: var(--text3); margin-top: 1px; }

  .inv-step-reward     { font-size: 13px; font-weight: 700; color: var(--text2); flex-shrink: 0; }
  .inv-step-reward-kyc { color: #6C47FF; }

  .inv-deadline-note {
    display: flex; align-items: flex-start; gap: 7px;
    font-size: 12px; color: var(--text3); line-height: 1.5;
    margin-top: 14px; padding: 10px 12px;
    background: rgba(255,59,92,0.06); border-radius: 10px;
  }
  .inv-deadline-note strong { color: rgb(244,7,82); }

  /* Stats bar */
  .inv-stats {
    display: flex; margin: 20px 16px 40px;
    background: var(--bg2); border: 1px solid var(--border);
    border-radius: 16px; overflow: hidden;
  }
  .inv-stat {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; padding: 14px 4px; gap: 4px;
    position: relative;
  }
  .inv-stat + .inv-stat::before {
    content: ''; position: absolute; left: 0; top: 20%;
    height: 60%; width: 1px; background: var(--border);
  }
  .inv-stat-n { font-size: 18px; font-weight: 700; color: var(--text); }
  .inv-stat-l { font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: .04em; }

  /* Pending subrow — tappable */
  #wlt-escrow-subrow { cursor: pointer; }
  #wlt-escrow-subrow:active { opacity: 0.7; }
  `;
  document.head.appendChild(s);
}

// ═══════════════════════════════════════════
// INIT — called once on bootApp
// ═══════════════════════════════════════════

function initReferral() {
  injectReferralStyles();

  // Make pending subrow tappable
  const subrow = document.getElementById('wlt-escrow-subrow');
  if (subrow && !subrow._refWired) {
    subrow._refWired = true;
    subrow.addEventListener('click', () => {
      if (walletState.activeSheet) return;
      openPendingSheet();
    });
  }

  // Handle referral from URL on first load
  if (window.location.search.includes('ref=')) {
    // Defer until user is authenticated (called from bootApp/obFinish)
    setTimeout(() => handleReferralOnSignup(), 1000);
  }
}
