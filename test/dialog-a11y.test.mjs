import { afterEach, describe, expect, it } from 'vitest';
import { loadWLC } from './helpers.mjs';

const WLC = loadWLC();

function panel() {
  document.getElementById(WLC.PANEL_HOST_ID)?.remove();
  return WLC.createPanel(document);
}

function keydown(target, key, extra) {
  const event = new KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, extra));
  target.dispatchEvent(event);
  return event;
}

function focusables(p) {
  const root = p.shadow.querySelector('.panel');
  return Array.from(root.querySelectorAll('a[href], button, input, select, textarea, summary')).filter((el) => {
    if (el.disabled || el.tabIndex < 0) return false;
    let n = el;
    while (n && n !== root) {
      if (n.hidden) return false;
      n = n.parentElement;
    }
    return true;
  });
}

afterEach(() => {
  document.getElementById(WLC.PANEL_HOST_ID)?.remove();
});

describe('panel dialog accessibility', () => {
  it('opens onto a control, labels Close and Expand, and marks the dialog modal', () => {
    const p = panel();
    const $ = (s) => p.shadow.querySelector(s);
    const fab = $('.fab');
    fab.focus();
    expect(p.shadow.activeElement).toBe(fab);

    p.show();
    expect(p.isOpen()).toBe(true);
    expect(p.shadow.activeElement).toBe($('.close'));
    expect($('.close').getAttribute('aria-label')).toBe('Close');
    expect($('.expand').getAttribute('aria-label')).toBe('Wider panel');
    expect($('.panel').getAttribute('aria-modal')).toBe('true');
    expect($('.panel').getAttribute('role')).toBe('dialog');
    expect(p.shadow.querySelector('style').textContent).toMatch(/:focus-visible/);

    fab.focus();
    fab.click();
    expect(p.isOpen()).toBe(false);
    expect(p.shadow.activeElement).toBe(fab);

    p.show();
    $('.close').click();
    expect(p.isOpen()).toBe(false);
    expect(p.shadow.activeElement).toBe(fab);
  });

  it('Escape closes and restores the FAB, and wraps Tab inside the dialog', () => {
    const p = panel();
    const $ = (s) => p.shadow.querySelector(s);
    const fab = $('.fab');
    fab.focus();
    p.show();
    expect(p.shadow.activeElement).toBe($('.close'));

    keydown(p.shadow, 'Escape');
    expect(p.isOpen()).toBe(false);
    expect(p.shadow.activeElement).toBe(fab);

    p.show();
    const items = focusables(p);
    expect(items[0]).toBe($('.expand'));
    expect(items).toContain($('.close'));
    items[items.length - 1].focus();
    expect(p.shadow.activeElement).toBe(items[items.length - 1]);
    keydown(p.shadow, 'Tab');
    expect(p.shadow.activeElement).toBe(items[0]);
    keydown(p.shadow, 'Tab', { shiftKey: true });
    expect(p.shadow.activeElement).toBe(items[items.length - 1]);

    p.setExpanded(true);
    expect($('.expand').getAttribute('aria-label')).toBe('Narrower panel');
  });

  it('Escape focuses Stop while a removal is in progress', async () => {
    const p = panel();
    const $ = (s) => p.shadow.querySelector(s);
    const orig = WLC.listVideos;
    let release;
    WLC.listVideos = () => new Promise((resolve) => {
      release = resolve;
    });
    try {
      p.show();
      const pending = p.preview();
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(p.state.busy).toBe(true);
      expect($('.btn-stop').disabled).toBe(false);
      $('.close').focus();
      keydown(p.shadow, 'Escape');
      expect(p.isOpen()).toBe(true);
      expect(p.shadow.activeElement).toBe($('.btn-stop'));
      p.stop();
      release({ videos: [], incomplete: false, mode: 'fast', fallbackReason: null });
      await pending;
    } finally {
      WLC.listVideos = orig;
      p.destroy();
    }
  });

  it('Left and Right arrows move between tabs and keep a visible selected tab', () => {
    const p = panel();
    const tabs = [...p.shadow.querySelectorAll('.tabs [role="tab"]')];
    expect(tabs.map((t) => t.getAttribute('role'))).toEqual(['tab', 'tab']);
    p.show();
    tabs[0].focus();
    keydown(tabs[0], 'ArrowRight');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].tabIndex).toBe(-1);
    expect(tabs[1].tabIndex).toBe(0);
    expect(p.shadow.activeElement).toBe(tabs[1]);
    expect(p.shadow.querySelector('.view-analytics').hidden).toBe(false);
    keydown(tabs[1], 'ArrowLeft');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(p.shadow.activeElement).toBe(tabs[0]);
    expect(p.shadow.querySelector('.view-clean').hidden).toBe(false);
  });
});
