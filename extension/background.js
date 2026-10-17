/* Watch Later Cleaner — service worker. Its only job: pacing sleeps for the Fast mode.
 * Timers in a hidden YouTube tab are throttled by Chrome; the service worker's are not, so the content
 * script asks for "sleep N ms" here while the tab is hidden. No network access, no data stored. */
'use strict';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'wlc:sleep' || !sender || sender.id !== chrome.runtime.id) return false;
  const ms = Math.max(0, Math.min(20000, Number(msg.ms) || 0));
  setTimeout(() => sendResponse({ ok: true, ms }), ms);
  return true; // keep the channel open until the timer fires
});
