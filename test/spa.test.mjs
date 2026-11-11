import { describe, it, expect, beforeEach } from 'vitest';
import { loadWLC, loadFixture } from './helpers.mjs';

const WLC = loadWLC();
const WL = 'https://www.youtube.com/playlist?list=WL';

const TWO_TREES = `<!doctype html><html><body>
  <ytd-browse page-subtype="playlist" hidden>
    <ytd-playlist-video-renderer>
      <a id="video-title" href="/watch?v=stalehidden1&amp;list=WL">Stale hidden</a>
      <ytd-channel-name><a href="/@h">Hidden</a></ytd-channel-name>
    </ytd-playlist-video-renderer>
  </ytd-browse>
  <ytd-miniplayer>
    <ytd-browse page-subtype="playlist">
      <ytd-playlist-video-list-renderer>
        <ytd-playlist-video-renderer>
          <a id="video-title" href="/watch?v=stalemini01&amp;list=WL">Stale mini</a>
          <ytd-channel-name><a href="/@m">Mini</a></ytd-channel-name>
        </ytd-playlist-video-renderer>
        <ytd-playlist-video-renderer>
          <a id="video-title" href="/watch?v=stalemini02&amp;list=WL">Stale mini two</a>
        </ytd-playlist-video-renderer>
      </ytd-playlist-video-list-renderer>
      <ytd-continuation-item-renderer id="mini-cont"></ytd-continuation-item-renderer>
      <ytd-playlist-byline-renderer>9 videos</ytd-playlist-byline-renderer>
    </ytd-browse>
  </ytd-miniplayer>
  <ytd-browse page-subtype="playlist">
    <ytd-playlist-video-list-renderer id="contents">
      <ytd-playlist-video-renderer>
        <a id="video-title" href="/watch?v=primaryvid1&amp;list=WL">Primary one</a>
        <ytd-channel-name id="channel-name"><a href="/@p">Primary</a></ytd-channel-name>
        <yt-formatted-string id="video-info"><span>1 year ago</span></yt-formatted-string>
      </ytd-playlist-video-renderer>
    </ytd-playlist-video-list-renderer>
    <ytd-playlist-byline-renderer>1 video</ytd-playlist-byline-renderer>
  </ytd-browse>
</body></html>`;

describe('panel host across SPA navigation', () => {
  beforeEach(() => {
    loadFixture();
    document.getElementById(WLC.PANEL_HOST_ID)?.remove();
  });

  it('keeps one host on Watch Later, destroys it on leave, and recreates one on return', () => {
    const first = WLC.syncWatchLaterPanel(document, WL);
    expect(document.querySelectorAll('#' + WLC.PANEL_HOST_ID)).toHaveLength(1);
    const extra = document.createElement('div');
    extra.id = WLC.PANEL_HOST_ID;
    extra.__wlc = { destroy() { extra.remove(); } };
    document.body.appendChild(extra);
    const again = WLC.syncWatchLaterPanel(document, WL);
    expect(again).toBe(first);
    expect(document.querySelectorAll('#' + WLC.PANEL_HOST_ID)).toHaveLength(1);
    expect(WLC.syncWatchLaterPanel(document, 'https://www.youtube.com/watch?v=abcdefghijk')).toBeNull();
    expect(document.getElementById(WLC.PANEL_HOST_ID)).toBeNull();
    const back = WLC.syncWatchLaterPanel(document, WL);
    expect(document.querySelectorAll('#' + WLC.PANEL_HOST_ID)).toHaveLength(1);
    expect(back).not.toBe(first);
    expect(back.isOpen()).toBe(false);
    back.destroy();
    expect(document.getElementById(WLC.PANEL_HOST_ID)).toBeNull();
  });
});

describe('active playlist root vs miniplayer', () => {
  beforeEach(() => loadFixture({ html: TWO_TREES }));

  it('reads items, counts, and video lookup from the visible Watch Later browse only', () => {
    const root = WLC.activePlaylistRoot(document);
    expect(root.tagName).toBe('YTD-BROWSE');
    expect(root.hasAttribute('hidden')).toBe(false);
    expect(root.closest('ytd-miniplayer')).toBeNull();
    const items = WLC.parseAll(document);
    expect(items.map((v) => v.videoId)).toEqual(['primaryvid1']);
    expect(items[0].title).toBe('Primary one');
    expect(WLC.getPlaylistCount(document)).toBe(1);
    expect(WLC.findItemByVideoId(document, 'stalemini01')).toBeNull();
    expect(WLC.findItemByVideoId(document, 'stalehidden1')).toBeNull();
    expect(WLC.findItemByVideoId(document, 'primaryvid1')).toBe(items[0].el);
    const scoped = (WLC.activePlaylistRoot(document) || document).querySelector(WLC.SELECTORS.continuation);
    expect(scoped).toBeNull();
    expect(document.querySelector('#mini-cont')).toBeTruthy();
  });
});
