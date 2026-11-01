
// ── Rebuild chat composer to Snap-style bar (MP · input · voice · emoji · gallery) ──
function rebuildChatComposer(force) {
  const bar = document.getElementById('chat-input-bar');
  if (!bar) return;
  // Bump version so deploy always rewires the live DOM (fixes stuck gallery mode)
  if (!force && bar.dataset.composerV4 === '1') {
    // still re-sync send state
    if (typeof syncChatActionBtn === 'function') syncChatActionBtn();
    return;
  }
  bar.dataset.composerV4 = '1';
  delete bar.dataset.composerV3;

  const tray = document.getElementById('chat-extras-tray');
  if (tray) tray.style.display = 'none';

  let row = bar.querySelector('.chat-input-bar-row');
  if (!row) {
    row = document.createElement('div');
    row.className = 'chat-input-bar-row';
    bar.appendChild(row);
  }
