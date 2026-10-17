import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { loadWLC } from './helpers.mjs';
import { SAMPLE_VIDEOS, buildInitialData, buildContinuation, tokenFor, playlistVideoRenderer, setVideoIdFor, FAKE_YTCFG, sapisidHashNode } from './fixtures/innertube.mjs';

const WLC = loadWLC();
const sha1 = (s) => createHash('sha1').update(s, 'utf8').digest('hex');

describe('sha1Hex', () => {
  it('matches node:crypto across block boundaries and UTF-8', () => {
    const inputs = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'x'.repeat(1000), '나중에 볼 동영상 – ünïcode ✓ 🎬'];
    for (const s of inputs) expect(WLC.sha1Hex(s)).toBe(sha1(s));
  });
  it('known FIPS vector', () => {
    expect(WLC.sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });
});

describe('SAPISIDHASH', () => {
  const ts = 1760700000;
  const sapisid = 'TeSt-SaPiSiD_value/AbCdEf123';
  const origin = 'https://www.youtube.com';

  it('equals "SAPISIDHASH <ts>_<sha1(ts SAPISID origin)>" (vector computed independently)', () => {
    const expected = `SAPISIDHASH ${ts}_${sha1(`${ts} ${sapisid} ${origin}`)}`;
    expect(WLC.sapisidHash(sapisid, origin, ts)).toBe(expected);
    expect(WLC.sapisidHash(sapisid, origin, ts)).toBe(sapisidHashNode(sapisid, origin, ts));
    expect(WLC.sapisidHash(sapisid, origin, ts + 0.9)).toBe(expected); // whole seconds
  });

  it('depends on origin and timestamp', () => {
    expect(WLC.sapisidHash(sapisid, 'https://m.youtube.com', ts)).not.toBe(WLC.sapisidHash(sapisid, origin, ts));
    expect(WLC.sapisidHash(sapisid, origin, ts + 1)).not.toBe(WLC.sapisidHash(sapisid, origin, ts));
  });

  it('buildAuthorization adds 1P/3P variants when those cookies exist, null when signed out', () => {
    const cookies = `PREF=f6=40000000; SAPISID=${sapisid}; __Secure-1PAPISID=one1P; __Secure-3PAPISID=three3P; YSC=abc`;
    const a = WLC.buildAuthorization(cookies, origin, ts);
    expect(a).toBe(
      [`SAPISIDHASH ${ts}_${sha1(`${ts} ${sapisid} ${origin}`)}`, `SAPISID1PHASH ${ts}_${sha1(`${ts} one1P ${origin}`)}`, `SAPISID3PHASH ${ts}_${sha1(`${ts} three3P ${origin}`)}`].join(' ')
    );
    expect(WLC.buildAuthorization('PREF=x; YSC=y', origin, ts)).toBeNull();
    expect(WLC.buildAuthorization('__Secure-3PAPISID=only3p', origin, ts)).toMatch(new RegExp(`^SAPISIDHASH ${ts}_${sha1(`${ts} only3p ${origin}`)} SAPISID3PHASH`));
  });

  it('readCookie', () => {
    expect(WLC.readCookie('a=1; SAPISID=x%2Fy; b=2', 'SAPISID')).toBe('x/y');
    expect(WLC.readCookie('XSAPISID=1', 'SAPISID')).toBeNull();
    expect(WLC.readCookie('', 'SAPISID')).toBeNull();
  });
});

describe('ytcfg, headers and request bodies', () => {
  const ytcfg = { data_: Object.assign({}, FAKE_YTCFG), get(k) { return this.data_[k]; } };

  it('reads ytcfg via get() or data_', () => {
    const c = WLC.readYtcfg(ytcfg);
    expect(c.apiKey).toBe(FAKE_YTCFG.INNERTUBE_API_KEY);
    expect(c.context.client.clientName).toBe('WEB');
    expect(c.clientVersion).toBe('2.20261015.01.00');
    expect(c.sessionIndex).toBe(0);
    expect(WLC.readYtcfg({ data_: FAKE_YTCFG }).apiKey).toBe(FAKE_YTCFG.INNERTUBE_API_KEY);
    expect(WLC.readYtcfg(undefined)).toBeNull();
  });

  it('fastModeProblems lists what is missing', () => {
    expect(WLC.fastModeProblems(WLC.readYtcfg(ytcfg), true)).toEqual([]);
    expect(WLC.fastModeProblems(null, false)).toEqual(['ytcfg-missing', 'sapisid-cookie-missing']);
    expect(WLC.fastModeProblems(WLC.readYtcfg({ data_: { LOGGED_IN: false } }), true)).toEqual(['api-key-missing', 'context-missing', 'not-logged-in']);
  });

  it('headers mirror the web client', () => {
    const cfg = WLC.readYtcfg(ytcfg);
    const h = WLC.buildHeaders({ authorization: 'SAPISIDHASH 1_abc', origin: 'https://www.youtube.com', cfg });
    expect(h).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'SAPISIDHASH 1_abc',
      'X-Origin': 'https://www.youtube.com',
      'X-Goog-AuthUser': '0',
      'X-Youtube-Client-Name': '1',
      'X-Youtube-Client-Version': '2.20261015.01.00',
      'X-Goog-Visitor-Id': FAKE_YTCFG.VISITOR_DATA,
    });
    expect(h['X-Goog-PageId']).toBeUndefined();
    expect(WLC.buildHeaders({ cfg: Object.assign({}, cfg, { delegatedSessionId: '1234', sessionIndex: 1 }) })).toMatchObject({ 'X-Goog-PageId': '1234', 'X-Goog-AuthUser': '1' });
  });

  it('endpoint URLs carry the page API key', () => {
    expect(WLC.endpointUrl(WLC.IT.EDIT_PLAYLIST_PATH, { apiKey: 'K Y' })).toBe('/youtubei/v1/browse/edit_playlist?key=K%20Y&prettyPrint=false');
    expect(WLC.endpointUrl(WLC.IT.BROWSE_PATH, {})).toBe('/youtubei/v1/browse?prettyPrint=false');
  });

  it('browse body: continuation or browseId VLWL; context is copied', () => {
    const ctx = { client: { clientName: 'WEB' } };
    const b = WLC.buildBrowseBody(ctx, { continuation: 'TOKEN' });
    expect(b).toEqual({ context: ctx, continuation: 'TOKEN' });
    b.context.client.clientName = 'X';
    expect(ctx.client.clientName).toBe('WEB');
    expect(WLC.buildBrowseBody(ctx)).toEqual({ context: ctx, browseId: 'VLWL' });
  });

  it('edit_playlist body: ACTION_REMOVE_VIDEO by setVideoId, by videoId as fallback, playlistId WL', () => {
    const ctx = { client: { clientName: 'WEB' } };
    expect(WLC.buildEditPlaylistBody(ctx, { videoId: 'aaaaaaaaaa1', setVideoId: 'ABCDEF0123456789' })).toEqual({
      context: ctx,
      actions: [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: 'ABCDEF0123456789' }],
      playlistId: 'WL',
    });
    expect(WLC.buildEditPlaylistBody(ctx, [{ videoId: 'aaaaaaaaaa2' }, { videoId: 'aaaaaaaaaa3', setVideoId: 'S3' }, {}]).actions).toEqual([
      { action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: 'aaaaaaaaaa2' },
      { action: 'ACTION_REMOVE_VIDEO', setVideoId: 'S3' },
    ]);
  });
});

describe('parseBrowseResponse', () => {
  it('parses the first page of ytInitialData with a continuation token', () => {
    const r = WLC.parseBrowseResponse(buildInitialData(SAMPLE_VIDEOS, { pageSize: 4 }));
    expect(r.kind).toBe('initial');
    expect(r.playlistId).toBe('WL');
    expect(r.continuation).toBe(tokenFor(4));
    expect(r.videos.map((v) => v.videoId)).toEqual(['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaaa3', 'aaaaaaaaaa4']);
    const [rust, , , deleted] = r.videos;
    expect(rust).toMatchObject({
      index: 0,
      position: '1',
      setVideoId: setVideoIdFor('aaaaaaaaaa1'),
      title: 'Learn Rust in 10 minutes',
      channel: 'Tech Channel',
      durationSec: 600,
      durationText: '10:00',
      progress: 100,
      unavailable: false,
    });
    expect(rust.ageCandidates).toContain('2 years ago');
    expect(deleted).toMatchObject({ title: '[Deleted video]', channel: '', durationSec: null, progress: 0, unavailable: true, isPlayable: false });
  });

  it('parses continuations (command, commandExecutor and legacy shapes) and numbers items across pages', () => {
    const c1 = WLC.parseBrowseResponse(buildContinuation(SAMPLE_VIDEOS, 4, { pageSize: 4 }), 4);
    expect(c1.kind).toBe('continuation');
    expect(c1.videos.map((v) => v.index)).toEqual([4, 5, 6, 7]);
    expect(c1.videos[0].title).toBe('[Private video]');
    expect(c1.continuation).toBe(tokenFor(8));
    const c2 = WLC.parseBrowseResponse(buildContinuation(SAMPLE_VIDEOS, 8, { pageSize: 4 }), 8);
    expect(c2.videos.map((v) => v.videoId)).toEqual(['aaaaaaaaaa9']);
    expect(c2.continuation).toBeNull();
    const ex = WLC.parseBrowseResponse(buildContinuation(SAMPLE_VIDEOS, 0, { pageSize: 3, shape: 'executor' }));
    expect(ex.continuation).toBe(tokenFor(3));
    const legacy = WLC.parseBrowseResponse(buildContinuation(SAMPLE_VIDEOS, 3, { pageSize: 3, legacy: true }), 3);
    expect(legacy.kind).toBe('continuation');
    expect(legacy.videos.map((v) => v.position)).toEqual(['4', '5', '6']);
    expect(legacy.continuation).toBe(tokenFor(6));
  });

  it('takes setVideoId from the remove menu item when it is not on the renderer', () => {
    const v = WLC.parsePlaylistVideoRenderer(playlistVideoRenderer(SAMPLE_VIDEOS[2], 2, { menuOnlySetId: true }), 2);
    expect(v.setVideoId).toBe(setVideoIdFor('aaaaaaaaaa3'));
  });

  it('reads Streamed/age runs and resume percent', () => {
    const v = WLC.parsePlaylistVideoRenderer(playlistVideoRenderer(SAMPLE_VIDEOS[7], 7), 7);
    expect(v.ageCandidates).toContain('Streamed 4 years ago');
    expect(v.progress).toBe(10);
  });

  it('tolerates junk', () => {
    expect(WLC.parseBrowseResponse(null)).toMatchObject({ videos: [], continuation: null, kind: 'unknown' });
    expect(WLC.parseBrowseResponse({ responseContext: {} }).kind).toBe('unknown');
  });

  it('isWatchLaterData only accepts the WL playlist', () => {
    expect(WLC.isWatchLaterData(buildInitialData(SAMPLE_VIDEOS))).toBe(true);
    expect(WLC.isWatchLaterData(buildInitialData(SAMPLE_VIDEOS, { playlistId: 'PLother' }))).toBe(false);
    expect(WLC.isWatchLaterData({ contents: { twoColumnWatchNextResults: {} } })).toBe(false);
  });
});

describe('interpretEditResponse', () => {
  it('succeeds only on HTTP OK + STATUS_SUCCEEDED', () => {
    expect(WLC.interpretEditResponse(true, 200, { status: 'STATUS_SUCCEEDED' })).toMatchObject({ ok: true, status: 'removed', step: 'api-removed' });
    expect(WLC.interpretEditResponse(true, 200, { status: 'STATUS_FAILED' })).toMatchObject({ ok: false, step: 'api-not-succeeded' });
    expect(WLC.interpretEditResponse(true, 200, {})).toMatchObject({ ok: false, step: 'api-not-succeeded' });
    expect(WLC.interpretEditResponse(false, 500, { status: 'STATUS_SUCCEEDED' })).toMatchObject({ ok: false, step: 'api-server-error' });
  });
  it('classifies failures', () => {
    const unauth = WLC.interpretEditResponse(false, 401, { error: { code: 401, status: 'UNAUTHENTICATED', message: 'missing credential' } });
    expect(unauth).toMatchObject({ ok: false, step: 'api-unauthorized', retryable: false });
    expect(unauth.detail).toBe('HTTP 401 UNAUTHENTICATED missing credential');
    expect(WLC.interpretEditResponse(false, 429, null)).toMatchObject({ step: 'api-throttled', retryable: true });
    expect(WLC.interpretEditResponse(false, 0, { error: { message: 'Failed to fetch' } })).toMatchObject({ step: 'api-network-error', retryable: true });
  });
});
