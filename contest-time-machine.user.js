// ==UserScript==
// @name         ACM Contest Time Machine
// @name:zh-CN   ACM 比赛时光榜
// @namespace    https://github.com/Haerbin23456
// @version      0.7.0
// @description  Rebuild Nowcoder and HDU ACM standings at any moment during a contest.
// @description:zh-CN  回放牛客与杭电 ACM 比赛任意时刻的榜单。
// @homepageURL  https://github.com/Haerbin23456/contest-time-machine
// @supportURL   https://github.com/Haerbin23456/contest-time-machine/issues
// @downloadURL  https://raw.githubusercontent.com/Haerbin23456/contest-time-machine/main/contest-time-machine.user.js
// @updateURL    https://raw.githubusercontent.com/Haerbin23456/contest-time-machine/main/contest-time-machine.user.js
// @license      MIT
// @match        *://ac.nowcoder.com/acm/contest/*
// @match        *://acm.hdu.edu.cn/contest/rank*
// @require      https://cdn.jsdelivr.net/npm/pinyin-match@1.2.10/dist/main.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const ROOT_ID = 'acm-time-machine';
  const HOST_ID = 'acm-time-machine-host';
  const STYLE_ID = 'acm-time-machine-style';
  const PLAYBACK_SPEED_KEY = 'acm-time-machine:playback-speed';
  const LAUNCHER_POSITION_KEY = 'acm-time-machine:launcher-position';
  const LAUNCHER_EDGE_GAP = 6;
  const WRONG_PENALTY_MS = 20 * 60 * 1000;
  const MAX_CONCURRENCY = 6;

  const state = {
    contest: null,
    loading: null,
    second: 0,
    rowLimit: 100,
    query: '',
    playing: false,
    playTimer: null,
    playbackSpeed: 60,
    playAnchorSecond: 0,
    playAnchorTime: 0,
    renderFrame: 0,
    pinnedTeamKeys: new Set(),
  };

  const site = location.hostname === 'ac.nowcoder.com'
    ? 'nowcoder'
    : location.hostname === 'acm.hdu.edu.cn'
      ? 'hdu'
      : null;

  if (!site || document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadowRoot = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
  installStyles(shadowRoot);
  const ui = createUi(shadowRoot, host);
  state.playbackSpeed = loadPlaybackSpeed();
  ui.playbackSpeed.value = String(state.playbackSpeed);
  bindUi(ui);
  syncPageVisibility(ui);

  if (site === 'nowcoder') {
    window.addEventListener('hashchange', () => syncPageVisibility(ui));
  }

  function syncPageVisibility(ui) {
    const visible = site === 'hdu' || /^#rank(?:$|[/?])/.test(location.hash);
    ui.root.style.display = visible ? '' : 'none';
    if (!visible) closePanel(ui);
  }

  function installStyles(container) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      :host { all: initial; }
      #${ROOT_ID}, #${ROOT_ID} * { box-sizing: border-box; letter-spacing: 0; }
      #${ROOT_ID} { --actm-rank-width: 60px; --actm-team-width: 250px; --actm-solved-width: 64px; --actm-penalty-width: 76px; --actm-problem-width: 64px; position: relative; z-index: 2147483000; font-family: Inter, "Microsoft YaHei", Arial, sans-serif; font-size: 14px; line-height: 1.4; color: #202124; color-scheme: light; }
      #${ROOT_ID} button, #${ROOT_ID} input, #${ROOT_ID} select { font: inherit; }
      .actm-launcher {
        position: fixed; right: 22px; bottom: 22px; z-index: 2147483001;
        height: 40px; padding: 0 15px; border: 1px solid #1f6f4a; border-radius: 6px;
        background: #1f6f4a; color: #fff; font-weight: 600; cursor: grab;
        touch-action: none; user-select: none;
        box-shadow: 0 4px 14px rgba(0,0,0,.18);
      }
      .actm-launcher:hover { background: #185b3d; }
      .actm-launcher.dragging { cursor: grabbing; }
      .actm-backdrop { position: fixed; inset: 0; display: none; background: rgba(20,24,28,.46); z-index: 2147483002; }
      .actm-backdrop.open { display: block; }
      .actm-panel {
        position: absolute; inset: 18px; display: grid; grid-template-rows: auto auto auto minmax(0,1fr) auto;
        grid-template-columns: minmax(0,1fr);
        min-width: 720px; overflow: hidden; background: #f7f8f9; border: 1px solid #c9ced3;
        border-radius: 6px; box-shadow: 0 18px 54px rgba(0,0,0,.28);
      }
      .actm-header, .actm-controls, .actm-filter, .actm-table-wrap, .actm-footer { min-width: 0; }
      .actm-header, .actm-controls, .actm-filter, .actm-footer { background: #fff; }
      .actm-header { display: flex; align-items: center; gap: 12px; min-height: 54px; padding: 8px 14px; border-bottom: 1px solid #d9dde1; }
      .actm-title-wrap { min-width: 0; flex: 1; }
      .actm-title { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 17px; line-height: 22px; font-weight: 650; }
      .actm-subtitle { margin-top: 2px; color: #687078; font-size: 12px; }
      .actm-button, .actm-close {
        height: 32px; border: 1px solid #c7ccd1; border-radius: 4px; background: #fff; color: #30363c; cursor: pointer;
      }
      .actm-button { min-width: 46px; padding: 0 10px; }
      .actm-button:hover, .actm-close:hover { border-color: #7d858d; background: #f2f4f5; }
      .actm-button.primary { border-color: #1f6f4a; background: #1f6f4a; color: #fff; }
      .actm-button.primary:hover { background: #185b3d; }
      .actm-close { width: 32px; padding: 0; font-size: 20px; line-height: 28px; }
      .actm-controls { display: grid; grid-template-columns: minmax(220px,1fr) auto; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #d9dde1; }
      .actm-timeline { display: grid; grid-template-columns: auto minmax(100px,1fr) auto; align-items: center; gap: 8px; min-width: 0; }
      .actm-play-controls { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .actm-button-group { display: flex; align-items: center; }
      .actm-button-group .actm-button { border-radius: 0; }
      .actm-button-group .actm-button:first-child { border-radius: 4px 0 0 4px; }
      .actm-button-group .actm-button:last-child { border-radius: 0 4px 4px 0; }
      .actm-button-group .actm-button + .actm-button { margin-left: -1px; }
      .actm-range { width: 100%; min-width: 0; accent-color: #1f6f4a; cursor: pointer; }
      .actm-time-editor { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); align-items: center; gap: 5px; width: 186px; height: 32px; padding: 0 8px; border: 1px solid #c7ccd1; border-radius: 4px; background: #fff; color: #687078; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .actm-offset { width: 100% !important; min-width: 0 !important; max-width: 100%; padding: 2px 4px; border: 0; border-bottom: 1px solid transparent; outline: 0; background: transparent; color: #202124; text-align: center; font: inherit; font-weight: 650; font-variant-numeric: tabular-nums; }
      .actm-offset:hover { border-bottom-color: #aeb5bb; }
      .actm-offset:focus { border-bottom-color: #1f6f4a; }
      .actm-duration { color: #596168; text-align: center; }
      .actm-speed-wrap { display: grid; grid-template-columns: minmax(50px,64px) auto; align-items: center; height: 32px; padding: 0 7px; border: 1px solid #c7ccd1; border-radius: 4px; background: #fff; color: #596168; }
      .actm-playback-speed { width: 100%; min-width: 0; padding: 0 2px; border: 0; outline: 0; background: transparent; color: #202124; text-align: right; font: inherit; font-variant-numeric: tabular-nums; }
      .actm-filter { display: flex; align-items: center; gap: 8px; min-height: 46px; padding: 7px 14px; border-bottom: 1px solid #d9dde1; }
      .actm-search { width: min(340px,40vw); height: 32px; padding: 0 10px; border: 1px solid #c7ccd1; border-radius: 4px; }
      .actm-select { height: 32px; padding: 0 28px 0 8px; border: 1px solid #c7ccd1; border-radius: 4px; background: #fff; }
      .actm-summary { margin-left: auto; color: #4f575e; font-size: 13px; font-variant-numeric: tabular-nums; }
      .actm-table-wrap { min-height: 0; overflow: auto; background: #fff; }
      .actm-table { width: max-content; min-width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: 13px; }
      .actm-table th, .actm-table td { height: 42px; padding: 5px 7px; border-right: 1px solid #e2e5e8; border-bottom: 1px solid #e2e5e8; text-align: center; vertical-align: middle; }
      .actm-table th { position: sticky; top: 0; z-index: 2; height: 44px; background: #f0f2f3; color: #41484f; font-weight: 650; }
      .actm-table th.rank, .actm-table td.rank { position: sticky; left: 0; z-index: 3; width: var(--actm-rank-width); min-width: var(--actm-rank-width); background: #fff; font-variant-numeric: tabular-nums; }
      .actm-table th.rank { z-index: 5; background: #f0f2f3; }
      .actm-table th.team, .actm-table td.team { position: sticky; left: var(--actm-rank-width); z-index: 3; width: var(--actm-team-width); min-width: var(--actm-team-width); max-width: var(--actm-team-width); background: #fff; text-align: left; }
      .actm-table th.team { z-index: 5; background: #f0f2f3; text-align: left; }
      .actm-table th.solved, .actm-table td.solved { width: var(--actm-solved-width); min-width: var(--actm-solved-width); font-variant-numeric: tabular-nums; }
      .actm-table th.penalty, .actm-table td.penalty { width: var(--actm-penalty-width); min-width: var(--actm-penalty-width); font-variant-numeric: tabular-nums; }
      .actm-table th.problem, .actm-table td.problem { width: var(--actm-problem-width); min-width: var(--actm-problem-width); font-variant-numeric: tabular-nums; }
      .actm-team-cell { display: grid; grid-template-columns: 26px minmax(0,1fr); align-items: center; gap: 6px; min-width: 0; }
      .actm-team-copy { min-width: 0; }
      .actm-pin { width: 26px; height: 26px; padding: 0; border: 0; background: transparent; font-size: 17px; line-height: 26px; cursor: pointer; opacity: .28; filter: grayscale(1); }
      .actm-pin:hover { opacity: .7; }
      .actm-pin.active { opacity: 1; filter: none; }
      .actm-pinned td { position: sticky; top: var(--actm-pin-top, 44px); z-index: 2; background: #fff9e8; box-shadow: 0 1px 0 #e2d6ad; }
      .actm-pinned td.rank, .actm-pinned td.team { z-index: 4; background: #fff9e8; }
      .actm-team-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
      .actm-school { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #737b82; font-size: 11px; }
      .actm-problem-count { display: block; margin-top: 1px; color: #737b82; font-size: 10px; font-weight: 500; }
      .actm-accepted { background: #dff2e6; color: #135c38; font-weight: 650; }
      .actm-accepted.wrong { background: #f7e8d2; color: #78511d; }
      .actm-fail { display: block; margin-top: 1px; font-size: 10px; font-weight: 500; }
      .actm-empty { color: #a4abb1; }
      .actm-footer { display: flex; align-items: center; gap: 12px; min-height: 38px; padding: 6px 14px; border-top: 1px solid #d9dde1; color: #687078; font-size: 12px; }
      .actm-status { margin-left: auto; font-variant-numeric: tabular-nums; }
      .actm-loading { display: grid; place-items: center; min-height: 240px; color: #4f575e; font-size: 14px; }
      .actm-error { color: #a12727; white-space: pre-wrap; }
      @media (max-width: 820px) {
        #${ROOT_ID} { --actm-rank-width: 48px; --actm-team-width: 200px; --actm-solved-width: 52px; --actm-penalty-width: 60px; --actm-problem-width: 56px; }
        .actm-panel { inset: 6px; min-width: 0; }
        .actm-controls { grid-template-columns: minmax(0,1fr) auto; gap: 8px; padding: 8px; }
        .actm-timeline { grid-template-columns: auto minmax(0,1fr) auto; gap: 6px; }
        .actm-play-controls { display: flex; gap: 6px; }
        .actm-controls .actm-button { min-width: 44px; padding: 0 7px; }
        .actm-time-editor { flex: 0 0 186px; width: 186px; }
        .actm-offset { width: 100% !important; }
        .actm-speed-wrap { flex: 0 0 68px; width: 68px; grid-template-columns: minmax(32px,1fr) auto; margin-left: auto; padding: 0 5px; }
        .actm-search { width: auto; min-width: 0; flex: 1; }
        .actm-summary { display: none; }
        .actm-table { font-size: 12px; }
        .actm-table th, .actm-table td { padding: 4px 5px; }
        .actm-team-cell { grid-template-columns: 22px minmax(0,1fr); gap: 4px; }
        .actm-pin { width: 22px; height: 24px; font-size: 15px; line-height: 24px; }
        .actm-team-name { font-size: 13px; }
        .actm-school { font-size: 10px; }
      }
      @media (max-width: 640px) {
        .actm-controls { grid-template-columns: minmax(0,1fr); }
      }
      @media (max-width: 480px) {
        #${ROOT_ID} { --actm-rank-width: 44px; --actm-team-width: 160px; --actm-solved-width: 48px; --actm-penalty-width: 56px; --actm-problem-width: 52px; }
        .actm-header { gap: 8px; padding: 7px 9px; }
        .actm-title { font-size: 15px; }
        .actm-subtitle { font-size: 11px; }
        .actm-time-editor { flex: 0 1 186px; min-width: 0; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); gap: 3px; padding: 0 4px; }
        .actm-speed-wrap { width: 66px; grid-template-columns: minmax(32px,1fr) auto; }
        .actm-play-controls .actm-button { min-width: 46px; padding: 0 7px; }
        .actm-filter { padding: 7px 8px; }
        .actm-select { padding-left: 6px; padding-right: 22px; }
      }
    `;
    container.appendChild(style);
  }

  function createUi(container, host) {
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `
      <button class="actm-launcher" type="button" title="查看比赛任意时刻的榜单">时光榜</button>
      <div class="actm-backdrop" aria-hidden="true">
        <section class="actm-panel" role="dialog" aria-modal="true" aria-label="比赛时光榜">
          <header class="actm-header">
            <div class="actm-title-wrap">
              <h2 class="actm-title">比赛时光榜</h2>
              <div class="actm-subtitle">尚未加载</div>
            </div>
            <button class="actm-button refresh" type="button" title="重新抓取榜单">刷新</button>
            <button class="actm-close" type="button" title="关闭">&times;</button>
          </header>
          <div class="actm-controls">
            <div class="actm-timeline">
              <div class="actm-button-group actm-back-controls">
                <button class="actm-button prev-event secondary-control" type="button" title="跳到上一个 AC 时刻">上一AC</button>
                <button class="actm-button minus-five" type="button" title="后退 5 分钟">-5m</button>
              </div>
              <input class="actm-range" type="range" min="0" max="1" step="1" value="0" aria-label="比赛时间进度">
              <div class="actm-button-group actm-forward-controls">
                <button class="actm-button plus-five" type="button" title="前进 5 分钟">+5m</button>
                <button class="actm-button next-event secondary-control" type="button" title="跳到下一个 AC 时刻">下一AC</button>
              </div>
            </div>
            <div class="actm-play-controls">
              <label class="actm-time-editor" title="编辑当前赛时；后半部分为比赛总时长">
                <input class="actm-offset" type="text" inputmode="text" value="00:00:00" placeholder="00:00:00" spellcheck="false" aria-label="开赛后的时分秒">
                <span>/</span>
                <output class="actm-duration">00:00:00</output>
              </label>
              <label class="actm-speed-wrap" title="选择预设或输入任意播放倍速">
                <input class="actm-playback-speed" type="number" list="acm-time-machine-speed-presets" min="0.1" max="10000" step="any" value="60" aria-label="播放倍速">
                <span>&times;</span>
              </label>
              <datalist id="acm-time-machine-speed-presets">
                <option value="1"></option>
                <option value="10"></option>
                <option value="60"></option>
                <option value="300"></option>
              </datalist>
              <button class="actm-button play primary" type="button" title="播放或暂停榜单变化">播放</button>
            </div>
          </div>
          <div class="actm-filter">
            <input class="actm-search" type="search" placeholder="队名、学校或拼音筛选" aria-label="搜索和筛选队伍" title="支持全拼和首字母；空格分隔多个条件；支持 team:、school:、rank:、solved:、penalty:、ac:，前置 - 可排除">
            <select class="actm-select row-limit" aria-label="显示行数">
              <option value="50">前 50</option>
              <option value="100" selected>前 100</option>
              <option value="300">前 300</option>
              <option value="0">全部</option>
            </select>
            <div class="actm-summary">等待加载</div>
          </div>
          <div class="actm-table-wrap"><div class="actm-loading">打开后开始抓取榜单</div></div>
          <footer class="actm-footer" title="方向键 +/-1 秒，Shift+方向键 +/-1 分钟，空格播放，Home/End 跳到首尾。">
            <span class="actm-status"></span>
          </footer>
        </section>
      </div>
    `;
    container.appendChild(root);
    return {
      host,
      root,
      launcher: root.querySelector('.actm-launcher'),
      backdrop: root.querySelector('.actm-backdrop'),
      title: root.querySelector('.actm-title'),
      subtitle: root.querySelector('.actm-subtitle'),
      close: root.querySelector('.actm-close'),
      refresh: root.querySelector('.refresh'),
      range: root.querySelector('.actm-range'),
      offset: root.querySelector('.actm-offset'),
      duration: root.querySelector('.actm-duration'),
      prevEvent: root.querySelector('.prev-event'),
      nextEvent: root.querySelector('.next-event'),
      minusFive: root.querySelector('.minus-five'),
      plusFive: root.querySelector('.plus-five'),
      play: root.querySelector('.play'),
      playbackSpeed: root.querySelector('.actm-playback-speed'),
      search: root.querySelector('.actm-search'),
      rowLimit: root.querySelector('.row-limit'),
      summary: root.querySelector('.actm-summary'),
      tableWrap: root.querySelector('.actm-table-wrap'),
      status: root.querySelector('.actm-status'),
    };
  }

  function bindUi(ui) {
    const launcherDrag = bindLauncherDrag(ui.launcher);
    ui.launcher.addEventListener('click', async event => {
      if (launcherDrag.shouldSuppressClick()) {
        event.preventDefault();
        return;
      }
      ui.backdrop.classList.add('open');
      ui.backdrop.setAttribute('aria-hidden', 'false');
      await ensureLoaded(ui);
      requestAnimationFrame(() => updatePinnedOffsets(ui));
    });
    ui.close.addEventListener('click', () => closePanel(ui));
    ui.backdrop.addEventListener('mousedown', event => {
      if (event.target === ui.backdrop) closePanel(ui);
    });
    ui.refresh.addEventListener('click', async () => {
      stopPlayback(ui);
      state.contest = null;
      state.loading = null;
      await ensureLoaded(ui, true);
    });
    ui.range.addEventListener('input', () => setSecond(ui, Number(ui.range.value)));
    ui.offset.addEventListener('change', () => {
      const second = parseDurationInput(ui.offset.value);
      if (second === null) ui.offset.value = formatDuration(state.second);
      else setSecond(ui, second);
    });
    ui.minusFive.addEventListener('click', () => setSecond(ui, state.second - 5 * 60));
    ui.plusFive.addEventListener('click', () => setSecond(ui, state.second + 5 * 60));
    ui.prevEvent.addEventListener('click', () => jumpEvent(ui, -1));
    ui.nextEvent.addEventListener('click', () => jumpEvent(ui, 1));
    ui.play.addEventListener('click', () => state.playing ? stopPlayback(ui) : startPlayback(ui));
    ui.playbackSpeed.addEventListener('change', () => commitPlaybackSpeed(ui));
    ui.playbackSpeed.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitPlaybackSpeed(ui);
        ui.playbackSpeed.blur();
      }
    });
    ui.search.addEventListener('input', () => {
      state.query = ui.search.value.trim();
      scheduleRender(ui);
    });
    ui.rowLimit.addEventListener('change', () => {
      state.rowLimit = Number(ui.rowLimit.value);
      scheduleRender(ui);
    });
    ui.tableWrap.addEventListener('click', event => {
      const button = event.target.closest('.actm-pin');
      if (!button || !state.contest) return;
      const key = button.dataset.teamKey;
      if (!key) return;
      if (state.pinnedTeamKeys.has(key)) state.pinnedTeamKeys.delete(key);
      else state.pinnedTeamKeys.add(key);
      savePinnedTeams(state.contest);
      render(ui);
    });
    window.addEventListener('resize', () => {
      updatePinnedOffsets(ui);
      constrainLauncher(ui.launcher, true);
    });
    document.addEventListener('keydown', event => {
      if (!ui.backdrop.classList.contains('open')) return;
      const target = event.composedPath()[0] || event.target;
      const editing = /^(INPUT|SELECT|TEXTAREA)$/.test(target?.tagName || '');
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel(ui);
      } else if (!editing && event.key === 'ArrowLeft') {
        event.preventDefault();
        setSecond(ui, state.second - (event.shiftKey ? 60 : 1));
      } else if (!editing && event.key === 'ArrowRight') {
        event.preventDefault();
        setSecond(ui, state.second + (event.shiftKey ? 60 : 1));
      } else if (!editing && event.key === 'Home') {
        event.preventDefault();
        setSecond(ui, 0);
      } else if (!editing && event.key === 'End') {
        event.preventDefault();
        setSecond(ui, state.contest?.durationSecond || 0);
      } else if (!editing && event.code === 'Space') {
        event.preventDefault();
        state.playing ? stopPlayback(ui) : startPlayback(ui);
      }
    });
  }

  function bindLauncherDrag(launcher) {
    let drag = null;
    let suppressClickUntil = 0;

    restoreLauncherPosition(launcher);

    launcher.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      const rect = launcher.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        moved: false,
      };
      launcher.setPointerCapture(event.pointerId);
    });

    launcher.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      launcher.classList.add('dragging');
      setLauncherPosition(launcher, drag.left + dx, drag.top + dy);
      event.preventDefault();
    });

    const finishDrag = event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (launcher.hasPointerCapture(event.pointerId)) launcher.releasePointerCapture(event.pointerId);
      launcher.classList.remove('dragging');
      if (drag.moved) {
        saveLauncherPosition(launcher);
        suppressClickUntil = performance.now() + 150;
      }
      drag = null;
    };

    launcher.addEventListener('pointerup', finishDrag);
    launcher.addEventListener('pointercancel', finishDrag);

    return {
      shouldSuppressClick: () => performance.now() < suppressClickUntil,
    };
  }

  function setLauncherPosition(launcher, left, top) {
    const maxLeft = Math.max(LAUNCHER_EDGE_GAP, window.innerWidth - launcher.offsetWidth - LAUNCHER_EDGE_GAP);
    const maxTop = Math.max(LAUNCHER_EDGE_GAP, window.innerHeight - launcher.offsetHeight - LAUNCHER_EDGE_GAP);
    launcher.style.left = `${clamp(left, LAUNCHER_EDGE_GAP, maxLeft)}px`;
    launcher.style.top = `${clamp(top, LAUNCHER_EDGE_GAP, maxTop)}px`;
    launcher.style.right = 'auto';
    launcher.style.bottom = 'auto';
  }

  function constrainLauncher(launcher, persist) {
    if (!launcher.style.left) return;
    const rect = launcher.getBoundingClientRect();
    setLauncherPosition(launcher, rect.left, rect.top);
    if (persist) saveLauncherPosition(launcher);
  }

  function saveLauncherPosition(launcher) {
    try {
      localStorage.setItem(LAUNCHER_POSITION_KEY, JSON.stringify({
        left: Number.parseFloat(launcher.style.left),
        top: Number.parseFloat(launcher.style.top),
      }));
    } catch {
      // Keep the position for the current page when site storage is unavailable.
    }
  }

  function restoreLauncherPosition(launcher) {
    try {
      const position = JSON.parse(localStorage.getItem(LAUNCHER_POSITION_KEY));
      if (Number.isFinite(position?.left) && Number.isFinite(position?.top)) {
        setLauncherPosition(launcher, position.left, position.top);
      }
    } catch {
      // Use the default bottom-right position when the saved value is unavailable.
    }
  }

  async function ensureLoaded(ui, force = false) {
    if (state.contest && !force) return;
    if (state.loading) return state.loading;
    ui.tableWrap.innerHTML = '<div class="actm-loading">正在读取榜单...</div>';
    ui.status.textContent = '';
    state.loading = (site === 'nowcoder' ? loadNowcoder : loadHdu)(message => {
      ui.tableWrap.innerHTML = `<div class="actm-loading">${escapeHtml(message)}</div>`;
    }).then(contest => {
      state.contest = normalizeContest(contest);
      state.pinnedTeamKeys = loadPinnedTeams(state.contest);
      state.second = state.contest.durationSecond;
      ui.title.textContent = state.contest.title || '比赛时光榜';
      ui.subtitle.textContent = `${state.contest.platform} · ${state.contest.teams.length} 支队伍 · ${state.contest.problems.length} 题`;
      ui.range.max = String(state.contest.durationSecond);
      ui.duration.textContent = formatDuration(state.contest.durationSecond);
      setSecond(ui, state.second, true);
    }).catch(error => {
      console.error('[ACM Time Machine]', error);
      ui.tableWrap.innerHTML = `<div class="actm-loading actm-error">加载失败：${escapeHtml(error.message || String(error))}</div>`;
      ui.status.textContent = '请确认已登录比赛页面';
      return null;
    }).finally(() => {
      state.loading = null;
    });
    return state.loading;
  }

  async function loadNowcoder(onProgress) {
    const match = location.pathname.match(/\/acm\/contest\/(\d+)/);
    if (!match) throw new Error('无法从地址中识别牛客比赛 ID。');
    const contestId = match[1];
    const makeUrl = page => `/acm-heavy/acm/contest/real-time-rank-data?token=&id=${contestId}&onlyContestRank=true&page=${page}&limit=0`;
    onProgress('正在读取牛客榜单第 1 页...');
    const first = await fetchJson(makeUrl(1));
    if (first.code !== 0 || !first.data) throw new Error(first.msg || '牛客榜单接口返回异常。');
    const pageCount = Math.max(1, Number(first.data.basicInfo?.pageCount || 1));
    const pages = [first.data];
    const rest = Array.from({ length: pageCount - 1 }, (_, index) => index + 2);
    const fetched = await mapLimit(rest, MAX_CONCURRENCY, async (page, done) => {
      onProgress(`正在读取牛客榜单 ${done + 1}/${pageCount} 页...`);
      const json = await fetchJson(makeUrl(page));
      if (json.code !== 0 || !json.data) throw new Error(json.msg || `牛客榜单第 ${page} 页返回异常。`);
      return json.data;
    });
    pages.push(...fetched);

    const basic = first.data.basicInfo;
    const startTime = Number(basic.contestBeginTime);
    const endTime = Number(basic.contestEndTime);
    const problems = first.data.problemData.map(problem => ({
      id: String(problem.problemId),
      name: problem.name,
    }));
    const currentUid = String(basic.basicUid ?? '');
    const teams = dedupeTeams(pages.flatMap(page => page.rankData || []).map(team => {
      const key = String(team.uid);
      const memberUids = (team.teamMemberUids || []).map(String);
      return {
        key,
        name: team.userName || key,
        school: team.school || '',
        finalRank: Number(team.ranking || Number.MAX_SAFE_INTEGER),
        self: currentUid !== '-1' && (key === currentUid || memberUids.includes(currentUid)),
        scores: (team.scoreList || []).map(score => ({
          problemId: String(score.problemId),
          acceptedTime: score.accepted ? Number(score.acceptedTime) : -1,
          failedCount: Number(score.failedCount || 0),
          firstBlood: Boolean(score.firstBlood),
        })),
      };
    }));
    return {
      id: contestId,
      platform: 'Nowcoder',
      title: window.pageInfo?.name || window.pageInfo?.competitionName_var || `Nowcoder ${contestId}`,
      startTime,
      endTime,
      problems,
      teams,
      selfTeamKey: teams.find(team => team.self)?.key || null,
    };
  }

  async function loadHdu(onProgress) {
    const contestId = new URLSearchParams(location.search).get('cid');
    if (!contestId) throw new Error('无法从地址中识别 HDU 比赛 ID。');
    const baseUrl = `/contest/rank?cid=${encodeURIComponent(contestId)}`;
    onProgress('正在读取 HDU 榜单第 1 页...');
    const firstHtml = await fetchText(`${baseUrl}&page=1`);
    if (/Contest Login/i.test(firstHtml)) throw new Error('HDU 比赛尚未登录。');
    const contestMatch = firstHtml.match(/const\s+contest\s*=\s*(\{[^\r\n]+\})/);
    if (!contestMatch) throw new Error('无法解析 HDU 比赛时间。');
    const contestInfo = JSON.parse(contestMatch[1]);
    const pageNumbers = [...firstHtml.matchAll(/[?&]page=(\d+)/g)].map(match => Number(match[1]));
    const pageCount = Math.max(1, ...pageNumbers);
    const pages = [firstHtml];
    const rest = Array.from({ length: pageCount - 1 }, (_, index) => index + 2);
    const fetched = await mapLimit(rest, MAX_CONCURRENCY, async (page, done) => {
      onProgress(`正在读取 HDU 榜单 ${done + 1}/${pageCount} 页...`);
      return fetchText(`${baseUrl}&page=${page}`);
    });
    pages.push(...fetched);

    const firstDocument = new DOMParser().parseFromString(firstHtml, 'text/html');
    const problems = [...firstDocument.querySelectorAll('th.rank-problem-header')].map((cell, index) => {
      const href = cell.querySelector('a')?.getAttribute('href');
      const problemId = href ? new URL(href, location.origin).searchParams.get('pid') : null;
      const label = problemId || String(index + 1);
      return { id: label, name: label };
    });
    const teams = [];
    for (const html of pages) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const row of doc.querySelectorAll('tr.page-card-row')) {
        const cells = [...row.querySelectorAll(':scope > td')];
        if (cells.length < 4 + problems.length) continue;
        const finalRank = Number(cells[0].textContent.trim());
        if (!Number.isFinite(finalRank)) continue;
        const identity = textLines(cells[1]);
        const name = identity[0] || `rank-${finalRank}`;
        const school = identity.slice(1).join(' · ');
        const scores = problems.map((problem, index) => {
          const cell = cells[4 + index];
          const firstBlood = cell.classList.contains('rank-status-fb');
          const accepted = cell.classList.contains('rank-status-accepted') || firstBlood;
          const timeMatch = cell.textContent.match(/(\d{2}):(\d{2}):(\d{2})/);
          const failedMatch = cell.textContent.match(/\(-(\d+)\)/);
          let acceptedTime = -1;
          if (accepted && timeMatch) {
            const second = Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3]);
            acceptedTime = Number(contestInfo.start) * 1000 + second * 1000;
          }
          return {
            problemId: problem.id,
            acceptedTime,
            failedCount: Number(failedMatch?.[1] || 0),
            firstBlood,
          };
        });
        teams.push({ key: name, name, school, finalRank, scores });
      }
    }
    const loginHtml = await fetchText(`/contest/login?cid=${encodeURIComponent(contestId)}`);
    const loginDocument = new DOMParser().parseFromString(loginHtml, 'text/html');
    const uniqueTeams = dedupeTeams(teams);
    const accountName = firstDocument.querySelector('.contest-header > .dropdown > [data-bs-toggle="dropdown"]')?.textContent.trim()
      || firstDocument.querySelector('.contest-header > .dropdown > :first-child')?.textContent.trim()
      || '';
    return {
      id: contestId,
      platform: 'HDU',
      title: loginDocument.querySelector('.contest-info h2')?.textContent.trim() || `HDU ${contestId}`,
      startTime: Number(contestInfo.start) * 1000,
      endTime: Number(contestInfo.end) * 1000,
      problems,
      teams: uniqueTeams,
      selfTeamKey: uniqueTeams.find(team => team.name === accountName)?.key || null,
    };
  }

  function normalizeContest(contest) {
    const durationSecond = Math.max(0, Math.floor((contest.endTime - contest.startTime) / 1000));
    const problemIndex = new Map(contest.problems.map((problem, index) => [problem.id, index]));
    const events = new Set([0, durationSecond]);
    for (const team of contest.teams) {
      const ordered = Array.from({ length: contest.problems.length }, () => null);
      for (const score of team.scores) {
        const index = problemIndex.get(score.problemId);
        if (index === undefined) continue;
        ordered[index] = score;
        if (score.acceptedTime >= contest.startTime && score.acceptedTime <= contest.endTime) {
          events.add(Math.floor((score.acceptedTime - contest.startTime) / 1000));
        }
      }
      team.scores = ordered;
    }
    return {
      ...contest,
      durationSecond,
      events: [...events].sort((a, b) => a - b),
    };
  }

  function snapshotAt(contest, second) {
    const timestamp = contest.startTime + second * 1000;
    const problemAccepted = Array(contest.problems.length).fill(0);
    let totalAccepted = 0;
    const rows = contest.teams.map(team => {
      let solved = 0;
      let penaltyMs = 0;
      const accepted = team.scores.map((score, index) => {
        if (!score || score.acceptedTime < contest.startTime || score.acceptedTime > timestamp || score.acceptedTime > contest.endTime) return null;
        solved += 1;
        totalAccepted += 1;
        problemAccepted[index] += 1;
        penaltyMs += score.acceptedTime - contest.startTime + score.failedCount * WRONG_PENALTY_MS;
        return score;
      });
      return { ...team, solved, penaltyMs, accepted };
    });
    rows.sort((a, b) => b.solved - a.solved || a.penaltyMs - b.penaltyMs || a.finalRank - b.finalRank || a.name.localeCompare(b.name));
    let rank = 0;
    let previous = null;
    rows.forEach((row, index) => {
      const key = `${row.solved}:${row.penaltyMs}`;
      if (key !== previous) rank = index + 1;
      row.rank = rank;
      previous = key;
    });
    return { rows, problemAccepted, totalAccepted };
  }

  function setSecond(ui, value, immediate = false, fromPlayback = false) {
    if (!state.contest) return;
    const second = clamp(Math.round(Number(value) || 0), 0, state.contest.durationSecond);
    state.second = second;
    ui.range.value = String(second);
    ui.offset.value = formatDuration(second);
    if (state.playing && !fromPlayback) resetPlaybackAnchor();
    if (immediate) render(ui);
    else scheduleRender(ui);
  }

  function scheduleRender(ui) {
    cancelAnimationFrame(state.renderFrame);
    state.renderFrame = requestAnimationFrame(() => render(ui));
  }

  function render(ui) {
    if (!state.contest) return;
    const contest = state.contest;
    const snapshot = snapshotAt(contest, state.second);
    const query = state.query;
    const searchPredicate = createSearchPredicate(query, contest);
    let rows = query ? snapshot.rows.filter(searchPredicate) : snapshot.rows;
    const matchedCount = rows.length;
    const pinnedRows = rows.filter(row => state.pinnedTeamKeys.has(row.key));
    const regularRows = rows.filter(row => !state.pinnedTeamKeys.has(row.key));
    rows = state.rowLimit > 0
      ? [...pinnedRows, ...regularRows].slice(0, state.rowLimit)
      : [...pinnedRows, ...regularRows];
    const teamsWithSolve = snapshot.rows.reduce((sum, row) => sum + (row.solved > 0 ? 1 : 0), 0);
    ui.summary.textContent = `${teamsWithSolve} 队过题 · 总 AC ${snapshot.totalAccepted}`;
    ui.status.textContent = `显示 ${rows.length}/${matchedCount} · 置顶 ${pinnedRows.length} · 数据源 ${contest.platform}`;

    const header = contest.problems.map((problem, index) => `
      <th class="problem" title="${escapeHtml(problem.name)}">
        ${escapeHtml(problem.name)}
        <span class="actm-problem-count">${snapshot.problemAccepted[index]}</span>
      </th>
    `).join('');
    const body = rows.map(row => {
      const cells = row.accepted.map(score => {
        if (!score) return '<td class="problem actm-empty"></td>';
        const elapsedSecond = Math.floor((score.acceptedTime - contest.startTime) / 1000);
        const wrongClass = score.failedCount > 0 ? ' wrong' : '';
        const fail = score.failedCount > 0 ? `<span class="actm-fail">-${score.failedCount}</span>` : '';
        const first = score.firstBlood ? '*' : '';
        return `<td class="problem actm-accepted${wrongClass}" title="${formatDuration(elapsedSecond)}，错误 ${score.failedCount} 次">${Math.floor(elapsedSecond / 60)}${first}${fail}</td>`;
      }).join('');
      const pinned = state.pinnedTeamKeys.has(row.key);
      return `
        <tr class="${pinned ? 'actm-pinned' : ''}">
          <td class="rank">${row.rank}</td>
          <td class="team" title="${escapeHtml(row.name)}${row.school ? ` · ${escapeHtml(row.school)}` : ''}">
            <div class="actm-team-cell">
              <button class="actm-pin${pinned ? ' active' : ''}" type="button" data-team-key="${escapeHtml(row.key)}" title="${pinned ? '取消置顶' : '置顶队伍'}" aria-label="${pinned ? '取消置顶' : '置顶队伍'}">&#128204;</button>
              <div class="actm-team-copy">
                <div class="actm-team-name">${escapeHtml(row.name)}</div>
                <div class="actm-school">${escapeHtml(row.school)}</div>
              </div>
            </div>
          </td>
          <td class="solved">${row.solved}</td>
          <td class="penalty" title="${formatDuration(Math.floor(row.penaltyMs / 1000))}">${Math.floor(row.penaltyMs / 60000)}</td>
          ${cells}
        </tr>
      `;
    }).join('');
    ui.tableWrap.innerHTML = `
      <table class="actm-table">
        <thead><tr>
          <th class="rank">排名</th>
          <th class="team">队伍</th>
          <th class="solved">过题</th>
          <th class="penalty">罚时</th>
          ${header}
        </tr></thead>
        <tbody>${body || '<tr><td colspan="99">没有匹配的队伍</td></tr>'}</tbody>
      </table>
    `;
    updatePinnedOffsets(ui);
  }

  function updatePinnedOffsets(ui) {
    const table = ui.tableWrap.querySelector('.actm-table');
    const header = table?.tHead;
    if (!header) return;
    let top = header.getBoundingClientRect().height;
    if (top <= 0) return;
    for (const row of table.querySelectorAll('tbody tr.actm-pinned')) {
      row.style.setProperty('--actm-pin-top', `${top}px`);
      top += row.getBoundingClientRect().height;
    }
  }

  function jumpEvent(ui, direction) {
    if (!state.contest) return;
    const events = state.contest.events;
    if (direction < 0) {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index] < state.second) return setSecond(ui, events[index]);
      }
      setSecond(ui, 0);
    } else {
      for (const event of events) {
        if (event > state.second) return setSecond(ui, event);
      }
      setSecond(ui, state.contest.durationSecond);
    }
  }

  function startPlayback(ui) {
    if (!state.contest) return;
    if (state.second >= state.contest.durationSecond) setSecond(ui, 0);
    state.playing = true;
    resetPlaybackAnchor();
    ui.play.textContent = '暂停';
    state.playTimer = window.setInterval(() => {
      const elapsedSecond = (performance.now() - state.playAnchorTime) / 1000;
      const next = Math.min(
        state.contest.durationSecond,
        state.playAnchorSecond + Math.floor(elapsedSecond * state.playbackSpeed),
      );
      if (next !== state.second) setSecond(ui, next, false, true);
      if (next >= state.contest.durationSecond) stopPlayback(ui);
    }, 100);
  }

  function resetPlaybackAnchor() {
    state.playAnchorSecond = state.second;
    state.playAnchorTime = performance.now();
  }

  function commitPlaybackSpeed(ui) {
    const speed = Number(ui.playbackSpeed.value);
    if (!Number.isFinite(speed) || speed < 0.1 || speed > 10000) {
      ui.playbackSpeed.value = String(state.playbackSpeed);
      return;
    }
    state.playbackSpeed = speed;
    ui.playbackSpeed.value = String(speed);
    try {
      localStorage.setItem(PLAYBACK_SPEED_KEY, String(speed));
    } catch {
      // Keep the setting for the current page when site storage is unavailable.
    }
    resetPlaybackAnchor();
  }

  function loadPlaybackSpeed() {
    try {
      const speed = Number(localStorage.getItem(PLAYBACK_SPEED_KEY));
      return Number.isFinite(speed) && speed >= 0.1 && speed <= 10000 ? speed : 60;
    } catch {
      return 60;
    }
  }

  function stopPlayback(ui) {
    state.playing = false;
    ui.play.textContent = '播放';
    clearInterval(state.playTimer);
    state.playTimer = null;
  }

  function closePanel(ui) {
    stopPlayback(ui);
    ui.backdrop.classList.remove('open');
    ui.backdrop.setAttribute('aria-hidden', 'true');
  }

  async function fetchJson(url) {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(`请求失败：HTTP ${response.status}`);
    return response.json();
  }

  async function fetchText(url) {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(`请求失败：HTTP ${response.status}`);
    return response.text();
  }

  async function mapLimit(items, limit, worker) {
    const result = Array(items.length);
    let cursor = 0;
    let completed = 0;
    async function run() {
      while (cursor < items.length) {
        const index = cursor++;
        result[index] = await worker(items[index], completed);
        completed += 1;
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return result;
  }

  function dedupeTeams(teams) {
    const map = new Map();
    for (const team of teams) {
      const previous = map.get(team.key);
      if (!previous || team.finalRank < previous.finalRank) map.set(team.key, team);
    }
    return [...map.values()];
  }

  function pinnedStorageKey(contest) {
    return `acm-time-machine:pinned:${contest.platform}:${contest.id}`;
  }

  function loadPinnedTeams(contest) {
    const defaultPinned = () => new Set(contest.selfTeamKey ? [contest.selfTeamKey] : []);
    try {
      const raw = localStorage.getItem(pinnedStorageKey(contest));
      if (raw === null) return defaultPinned();
      const saved = JSON.parse(raw);
      const knownKeys = new Set(contest.teams.map(team => team.key));
      return new Set(Array.isArray(saved) ? saved.filter(key => knownKeys.has(String(key))).map(String) : []);
    } catch {
      return defaultPinned();
    }
  }

  function savePinnedTeams(contest) {
    try {
      localStorage.setItem(pinnedStorageKey(contest), JSON.stringify([...state.pinnedTeamKeys]));
    } catch {
      // Browsers with disabled site storage still support pinning for the current page.
    }
  }

  function textLines(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    return clone.textContent.split('\n').map(line => line.trim()).filter(Boolean);
  }

  function formatDuration(totalSecond) {
    const second = Math.max(0, Math.floor(totalSecond));
    const hours = Math.floor(second / 3600);
    const minutes = Math.floor(second / 60) % 60;
    const seconds = second % 60;
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  function parseDurationInput(value) {
    const text = String(value || '').trim();
    if (/^\d+$/.test(text)) return Number(text);
    if (!/^\d+(?::\d{1,2}){0,2}$/.test(text)) return null;
    const parts = text.split(':').map(Number);
    const seconds = parts.pop();
    const minutes = parts.pop() || 0;
    const hours = parts.pop() || 0;
    if (seconds >= 60 || minutes >= 60) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }

  function createSearchPredicate(query, contest) {
    const filters = parseSearchQuery(query);
    if (!filters.length) return () => true;
    return row => filters.every(filter => {
      const matched = matchesSearchFilter(row, filter, contest);
      return filter.exclude ? !matched : matched;
    });
  }

  function parseSearchQuery(query) {
    const filters = [];
    const pattern = /(-)?(?:(team|school|rank|solved|penalty|ac):)?(?:"([^"]*)"|'([^']*)'|([^\s]+))/gi;
    for (const match of String(query || '').matchAll(pattern)) {
      const value = match[3] ?? match[4] ?? match[5] ?? '';
      if (!value) continue;
      filters.push({
        exclude: Boolean(match[1]),
        field: (match[2] || 'text').toLowerCase(),
        value: normalizeSearchText(value),
      });
    }
    return filters;
  }

  function matchesSearchFilter(row, filter, contest) {
    if (filter.field === 'team') return matchesSearchText(row.name, filter.value);
    if (filter.field === 'school') return matchesSearchText(row.school, filter.value);
    if (filter.field === 'rank') return matchesNumericFilter(row.rank, filter.value);
    if (filter.field === 'solved') return matchesNumericFilter(row.solved, filter.value);
    if (filter.field === 'penalty') return matchesNumericFilter(Math.floor(row.penaltyMs / 60000), filter.value);
    if (filter.field === 'ac') {
      const acceptedProblems = row.accepted.flatMap((score, index) => score ? [contest.problems[index]] : []);
      if (filter.value === 'any') return acceptedProblems.length > 0;
      if (filter.value === 'none') return acceptedProblems.length === 0;
      return acceptedProblems.some(problem => matchesSearchText(`${problem.id} ${problem.name}`, filter.value));
    }
    return matchesSearchText(`${row.name} ${row.school}`, filter.value);
  }

  function matchesSearchText(text, keyword) {
    const normalizedText = normalizeSearchText(text);
    if (normalizedText.includes(keyword)) return true;
    try {
      return Boolean(globalThis.PinyinMatch?.match(normalizedText, keyword));
    } catch {
      return false;
    }
  }

  function matchesNumericFilter(actual, expression) {
    const range = expression.match(/^(\d+)-(\d+)$/);
    if (range) return actual >= Number(range[1]) && actual <= Number(range[2]);
    const comparison = expression.match(/^(<=|>=|<|>|=)?(\d+)$/);
    if (!comparison) return false;
    const expected = Number(comparison[2]);
    if (comparison[1] === '<') return actual < expected;
    if (comparison[1] === '<=') return actual <= expected;
    if (comparison[1] === '>') return actual > expected;
    if (comparison[1] === '>=') return actual >= expected;
    return actual === expected;
  }

  function normalizeSearchText(value) {
    return String(value ?? '').normalize('NFKC').toLocaleLowerCase();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    })[character]);
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }
})();
