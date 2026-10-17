// Builders for realistic (fake) InnerTube JSON: ytInitialData for the Watch Later page, browse continuation
// responses and edit_playlist replies, plus a tiny in-memory "server" used by unit tests and the e2e.
// Shapes mirror what YouTube's web client receives; every value here is made up.
import { createHash } from 'node:crypto';
import { generateVideos } from './generate.mjs';

export const FAKE_YTCFG = Object.freeze({
  INNERTUBE_API_KEY: 'TEST_KEY_not_a_real_key_000000000000000',
  INNERTUBE_CONTEXT: { client: { hl: 'en', gl: 'US', clientName: 'WEB', clientVersion: '2.20261015.01.00', visitorData: 'Cgt0ZXN0dmlzaXRvcg%3D%3D' }, user: { lockedSafetyMode: false }, request: { useSsl: true } },
  INNERTUBE_CONTEXT_CLIENT_NAME: 1,
  INNERTUBE_CLIENT_VERSION: '2.20261015.01.00',
  VISITOR_DATA: 'Cgt0ZXN0dmlzaXRvcg%3D%3D',
  SESSION_INDEX: 0,
  LOGGED_IN: true,
});

const pad = (n) => String(n).padStart(2, '0');
export const fmtDuration = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

export function setVideoIdFor(videoId) {
  return createHash('sha1').update(`set:${videoId}`).digest('hex').slice(0, 16).toUpperCase();
}

/** One playlistVideoRenderer from a fake video { id, title, channel, duration, progress, age, views }. */
export function playlistVideoRenderer(v, i, { menuOnlySetId = false } = {}) {
  const setVideoId = setVideoIdFor(v.id);
  const r = {
    videoId: v.id,
    thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, width: 168, height: 94 }] },
    title: { runs: [{ text: v.title }], accessibility: { accessibilityData: { label: v.channel ? `${v.title} by ${v.channel} ${v.views || '1K views'} ${v.age || ''} ${v.duration ? `${Math.floor(v.duration / 60)} minutes` : ''}`.trim() : v.title } } },
    index: { simpleText: String(i + 1) },
    navigationEndpoint: { watchEndpoint: { videoId: v.id, playlistId: 'WL', index: i } },
    isPlayable: Boolean(v.channel),
    menu: {
      menuRenderer: {
        items: [
          { menuServiceItemRenderer: { text: { runs: [{ text: 'Add to queue' }] }, serviceEndpoint: { signalServiceEndpoint: { signal: 'CLIENT_SIGNAL' } } } },
          {
            menuServiceItemRenderer: {
              text: { runs: [{ text: 'Remove from ' }, { text: 'Watch later' }] },
              icon: { iconType: 'DELETE' },
              serviceEndpoint: { playlistEditEndpoint: { playlistId: 'WL', actions: [{ setVideoId, action: 'ACTION_REMOVE_VIDEO' }] } },
            },
          },
        ],
      },
    },
  };
  if (!menuOnlySetId) r.setVideoId = setVideoId;
  if (v.channel) {
    r.shortBylineText = { runs: [{ text: v.channel, navigationEndpoint: { browseEndpoint: { browseId: 'UCfakechannel000000000000' } } }] };
    r.lengthSeconds = String(v.duration);
    r.lengthText = { accessibility: { accessibilityData: { label: `${Math.floor(v.duration / 60)} minutes` } }, simpleText: fmtDuration(v.duration) };
    r.videoInfo = { runs: [{ text: v.views || '1K views' }, { text: ' • ' }, { text: v.age }] };
    r.thumbnailOverlays = [{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: fmtDuration(v.duration) }, style: 'DEFAULT' } }];
    if (v.progress != null) r.thumbnailOverlays.push({ thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: v.progress } });
  } else {
    r.thumbnailOverlays = [];
  }
  return r;
}

export function continuationItem(token, shape = 'command') {
  if (shape === 'executor') {
    return { continuationItemRenderer: { trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN', continuationEndpoint: { commandExecutorCommand: { commands: [{ playlistVotingRefreshPopupCommand: {} }, { continuationCommand: { token, request: 'CONTINUATION_REQUEST_TYPE_BROWSE' } }] } } } };
  }
  return { continuationItemRenderer: { trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN', continuationEndpoint: { clickTrackingParams: 'CAAQ', continuationCommand: { token, request: 'CONTINUATION_REQUEST_TYPE_BROWSE' } } } };
}

export const tokenFor = (offset) => `4qmFsgJhEgRWTFdMGgZDR1FTQWchCAEaA${offset}`;

function pageItems(videos, offset, pageSize, shape, opts) {
  const items = videos.slice(offset, offset + pageSize).map((v, k) => ({ playlistVideoRenderer: playlistVideoRenderer(v, offset + k, opts) }));
  if (offset + pageSize < videos.length) items.push(continuationItem(tokenFor(offset + pageSize), shape));
  return items;
}

/** ytInitialData-like object for https://www.youtube.com/playlist?list=WL (first page + continuation). */
export function buildInitialData(videos, { pageSize = 100, shape = 'command', playlistId = 'WL', ...opts } = {}) {
  return {
    responseContext: { serviceTrackingParams: [], webResponseContextExtensionData: { hasDecorated: true } },
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              selected: true,
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      itemSectionRenderer: {
                        contents: [{ playlistVideoListRenderer: { contents: pageItems(videos, 0, pageSize, shape, opts), playlistId, isEditable: true, canReorder: true } }],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
    header: { playlistHeaderRenderer: { playlistId, title: { simpleText: 'Watch later' }, numVideosText: { runs: [{ text: String(videos.length) }, { text: ' videos' }] } } },
    metadata: { playlistMetadataRenderer: { title: 'Watch later' } },
  };
}

/** Browse continuation response for the page starting at `offset`. */
export function buildContinuation(videos, offset, { pageSize = 100, shape = 'command', legacy = false, ...opts } = {}) {
  const items = pageItems(videos, offset, pageSize, shape, opts);
  if (legacy) return { responseContext: {}, continuationContents: { playlistVideoListContinuation: { contents: items } } };
  return { responseContext: {}, onResponseReceivedActions: [{ clickTrackingParams: 'CAAQ', appendContinuationItemsAction: { continuationItems: items, targetId: 'pl-video-list' } }], trackingParams: 'CAAQ' };
}

export function sapisidHashNode(sapisid, origin, ts) {
  return `SAPISIDHASH ${ts}_${createHash('sha1').update(`${ts} ${sapisid} ${origin}`).digest('hex')}`;
}

/**
 * In-memory fake of the two endpoints. handle({ url, headers, body }) → { status, json }.
 * opts: { pageSize, sapisid, origin, failEdits: n (first n edit calls fail with 500), editStatus }
 */
export function createFakeInnertube(videos, opts = {}) {
  const pageSize = opts.pageSize || 100;
  const state = { videos: videos.slice(), browseCalls: 0, editCalls: 0, removed: [], requests: [], authErrors: 0, failEdits: opts.failEdits || 0 };
  const checkAuth = (headers) => {
    if (!opts.sapisid) return true;
    const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const m = /^SAPISIDHASH (\d+)_([0-9a-f]{40})/.exec(h.authorization || '');
    const ok = Boolean(m) && h.authorization.startsWith(sapisidHashNode(opts.sapisid, opts.origin || 'https://www.youtube.com', Number(m[1]))) && h['x-origin'] === (opts.origin || 'https://www.youtube.com') && h['x-goog-authuser'] === '0';
    if (!ok) state.authErrors++;
    return ok;
  };
  function handle({ url, headers, body }) {
    const b = typeof body === 'string' ? JSON.parse(body) : body;
    state.requests.push({ url, body: b, t: Date.now() });
    if (!checkAuth(headers)) return { status: 401, json: { error: { code: 401, status: 'UNAUTHENTICATED', message: 'Request is missing required authentication credential.' } } };
    if (/\/youtubei\/v1\/browse\/edit_playlist/.test(url)) {
      state.editCalls++;
      if (state.failEdits > 0) {
        state.failEdits--;
        return { status: 500, json: { error: { code: 500, status: 'INTERNAL', message: 'Internal error encountered.' } } };
      }
      if (b.playlistId !== 'WL' || !Array.isArray(b.actions) || !b.actions.length) return { status: 400, json: { error: { code: 400, status: 'INVALID_ARGUMENT' } } };
      for (const a of b.actions) {
        const idx = state.videos.findIndex((v) => (a.action === 'ACTION_REMOVE_VIDEO' && setVideoIdFor(v.id) === a.setVideoId) || (a.action === 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID' && v.id === a.removedVideoId));
        if (idx < 0) return { status: 200, json: { responseContext: {}, status: 'STATUS_FAILED' } };
        state.removed.push(state.videos[idx].id);
        state.videos.splice(idx, 1);
      }
      return { status: 200, json: { responseContext: {}, status: opts.editStatus || 'STATUS_SUCCEEDED', playlistEditResults: [{ playlistEditVideoAddedResultData: {} }] } };
    }
    if (/\/youtubei\/v1\/browse/.test(url)) {
      state.browseCalls++;
      if (b.continuation) {
        const offset = Number(String(b.continuation).replace(tokenFor(''), ''));
        return { status: 200, json: buildContinuation(state.videos, offset, { pageSize, shape: opts.shape }) };
      }
      return { status: 200, json: buildInitialData(state.videos, { pageSize, shape: opts.shape }) };
    }
    return { status: 404, json: { error: { code: 404 } } };
  }
  return { state, handle };
}

/** The 9 videos of watch-later.html as API data (same ids, titles, progress, ages). */
export const SAMPLE_VIDEOS = [
  { id: 'aaaaaaaaaa1', title: 'Learn Rust in 10 minutes', channel: 'Tech Channel', duration: 600, progress: 100, age: '2 years ago', views: '1.2M views' },
  { id: 'aaaaaaaaaa2', title: 'Lo-fi beats to study to', channel: 'Chill Music', duration: 7200, progress: 95, age: '3 months ago', views: '8.4M views' },
  { id: 'aaaaaaaaaa3', title: 'Cooking pasta like a pro', channel: 'Kitchen Lab', duration: 754, progress: 40, age: '5 years ago', views: '310K views' },
  { id: 'aaaaaaaaaa4', title: '[Deleted video]', channel: null },
  { id: 'aaaaaaaaaa5', title: '[Private video]', channel: null },
  { id: 'aaaaaaaaaa6', title: 'Unboxing the new phone', channel: 'Gadget Reviews', duration: 482, progress: null, age: '2 weeks ago', views: '56K views' },
  { id: 'aaaaaaaaaa7', title: 'Full Course: JavaScript for beginners', channel: 'Tech Channel', duration: 13500, progress: 89, age: '1 year ago', views: '4M views' },
  { id: 'aaaaaaaaaa8', title: 'Live concert highlights', channel: 'Chill Music', duration: 1830, progress: 10, age: 'Streamed 4 years ago', views: '900K views' },
  { id: 'aaaaaaaaaa9', title: 'Podcast episode #42 – productivity', channel: 'Talk Show Daily', duration: 3723, progress: null, age: '8 days ago', views: '12K views' },
];

export { generateVideos };
