// ==UserScript==
// @name         ACM Contest Time Machine
// @name:zh-CN   ACM 比赛时光榜
// @namespace    https://github.com/Haerbin23456
// @version      0.9.0
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
    participantScope: 'all',
    rankingMode: 'team',
    playing: false,
    playTimer: null,
    playbackSpeed: 60,
    playAnchorSecond: 0,
    playAnchorTime: 0,
    renderFrame: 0,
    pinnedTeamKeys: new Set(),
    submissionCache: new Map(),
    submissionRequestId: 0,
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
      .actm-filter { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 46px; padding: 7px 14px; border-bottom: 1px solid #d9dde1; }
      .actm-search { width: min(340px,40vw); min-width: 180px; height: 32px; padding: 0 10px; border: 1px solid #c7ccd1; border-radius: 4px; }
      .actm-select { height: 32px; padding: 0 28px 0 8px; border: 1px solid #c7ccd1; border-radius: 4px; background: #fff; }
      .actm-segmented { display: inline-flex; align-items: center; height: 32px; border: 1px solid #c7ccd1; border-radius: 4px; overflow: hidden; background: #fff; }
      .actm-segment { min-width: 48px; height: 30px; padding: 0 10px; border: 0; border-right: 1px solid #d5d9dc; background: #fff; color: #4f575e; cursor: pointer; }
      .actm-segment:last-child { border-right: 0; }
      .actm-segment:hover { background: #f2f4f5; }
      .actm-segment.active { background: #e4efe9; color: #155c3b; font-weight: 650; box-shadow: inset 0 0 0 1px #8bb7a0; }
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
      .actm-problem-link { color: inherit; text-decoration: none; }
      .actm-problem-link:hover { color: #176a47; text-decoration: underline; text-underline-offset: 2px; }
      .actm-problem-link:focus-visible { outline: 2px solid #1f6f4a; outline-offset: 2px; }
      .actm-problem-count { display: block; margin-top: 1px; color: #737b82; font-size: 10px; font-weight: 500; }
      .actm-accepted { background: #dff2e6; color: #135c38; font-weight: 650; }
      .actm-accepted.wrong { background: #f7e8d2; color: #78511d; }
      .actm-fail { display: block; margin-top: 1px; font-size: 10px; font-weight: 500; }
      .actm-empty { color: #a4abb1; }
      .actm-submission-cell { cursor: pointer; transition: box-shadow .12s ease, filter .12s ease; }
      .actm-submission-cell:hover { box-shadow: inset 0 0 0 2px #5c9277; filter: brightness(.98); }
      .actm-submission-cell:focus-visible { outline: 2px solid #1f6f4a; outline-offset: -2px; }
      .actm-footer { display: flex; align-items: center; gap: 12px; min-height: 38px; padding: 6px 14px; border-top: 1px solid #d9dde1; color: #687078; font-size: 12px; }
      .actm-status { margin-left: auto; font-variant-numeric: tabular-nums; }
      .actm-loading { display: grid; place-items: center; min-height: 240px; color: #4f575e; font-size: 14px; }
      .actm-error { color: #a12727; white-space: pre-wrap; }
      .actm-submission-layer { position: absolute; inset: 0; z-index: 20; display: none; place-items: center; padding: 24px; background: rgba(28,33,38,.48); backdrop-filter: blur(1px); }
      .actm-submission-layer.open { display: grid; }
      .actm-submission-dialog { display: grid; grid-template-rows: auto minmax(0,1fr) auto; width: fit-content; min-width: min(620px,100%); max-width: 100%; max-height: min(640px,calc(100% - 16px)); overflow: hidden; border: 1px solid #cbd1d6; border-radius: 6px; background: #fff; box-shadow: 0 24px 70px rgba(0,0,0,.32); }
      .actm-submission-header { display: flex; align-items: center; gap: 16px; min-height: 70px; padding: 12px 14px 12px 20px; border-bottom: 1px solid #dfe3e6; background: #fff; }
      .actm-submission-heading { min-width: 0; flex: 1; text-align: left; }
      .actm-submission-title { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1f252a; font-size: 18px; line-height: 24px; font-weight: 700; }
      .actm-submission-subtitle { display: flex; align-items: center; gap: 7px; min-width: 0; margin-top: 4px; color: #687078; font-size: 12px; }
      .actm-submission-school { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #4f5961; }
      .actm-submission-meta { flex: none; color: #7b848b; }
      .actm-submission-meta::before { content: ''; display: inline-block; width: 3px; height: 3px; margin: 0 7px 2px 0; border-radius: 50%; background: #a2a9ae; }
      .actm-submission-content { min-height: 160px; overflow: auto; }
      .actm-submission-message { display: grid; place-items: center; min-height: 190px; padding: 24px; color: #596168; text-align: center; }
      .actm-submission-message.error { color: #a12727; }
      .actm-submission-table { width: max-content; min-width: 620px; border-collapse: separate; border-spacing: 0; table-layout: auto; font-size: 13px; }
      .actm-submission-table th, .actm-submission-table td { height: 46px; padding: 7px 14px; border-bottom: 1px solid #e6e9eb; text-align: left; vertical-align: middle; }
      .actm-submission-table th { position: sticky; top: 0; z-index: 1; height: 40px; background: #f4f6f7; color: #596168; text-align: left; font-size: 12px; font-weight: 650; }
      .actm-submission-table tbody tr:nth-child(even) { background: #fafbfb; }
      .actm-submission-table tbody tr:hover { background: #f0f6f3; }
      .actm-submission-table th:first-child, .actm-submission-table td:first-child { width: 14%; padding-left: 20px; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .actm-submission-table th:nth-child(2), .actm-submission-table td:nth-child(2) { width: 1%; white-space: nowrap; }
      .actm-submission-table th:nth-child(3), .actm-submission-table td:nth-child(3) { width: 1%; white-space: nowrap; }
      .actm-language { display: block; width: max-content; max-width: clamp(110px,20vw,190px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .actm-submission-table th:nth-child(4), .actm-submission-table td:nth-child(4),
      .actm-submission-table th:nth-child(5), .actm-submission-table td:nth-child(5),
      .actm-submission-table th:last-child, .actm-submission-table td:last-child { width: 1%; white-space: nowrap; }
      .actm-submission-table th:nth-child(4), .actm-submission-table td:nth-child(4),
      .actm-submission-table th:nth-child(5), .actm-submission-table td:nth-child(5) { padding-left: 10px; padding-right: 10px; font-variant-numeric: tabular-nums; }
      .actm-submission-table th:last-child, .actm-submission-table td:last-child { padding-left: 10px; padding-right: 20px; }
      .actm-submission-table th:nth-child(4), .actm-submission-table td:nth-child(4),
      .actm-submission-table th:nth-child(5), .actm-submission-table td:nth-child(5),
      .actm-submission-table th:last-child, .actm-submission-table td:last-child { text-align: right; }
      .actm-submission-time { color: #30383e; font-weight: 600; }
      .actm-verdict { display: inline-flex; align-items: flex-start; gap: 7px; font-weight: 650; }
      .actm-verdict::before { content: ''; width: 7px; height: 7px; flex: none; margin-top: .42em; border-radius: 50%; background: currentColor; }
      .actm-verdict-copy { display: grid; width: max-content; line-height: 1.3; }
      .actm-verdict.accepted { color: #52c41a; }
      .actm-verdict.wrong-answer,
      .actm-verdict.presentation-error { color: #e74c3c; }
      .actm-verdict.runtime-error,
      .actm-verdict.segment-fault,
      .actm-verdict.execution-error { color: #9d3dcf; }
      .actm-verdict.compile-error { color: #fadb14; }
      .actm-verdict.time-limit,
      .actm-verdict.memory-limit,
      .actm-verdict.output-limit { color: #052242; }
      .actm-verdict.pending { color: #bfbfbf; }
      .actm-verdict.other { color: #0e1d69; }
      .actm-source-link { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; color: #176a47; font-weight: 650; text-decoration: none; white-space: nowrap; }
      .actm-source-link:hover { text-decoration: underline; }
      .actm-submission-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 42px; padding: 8px 20px; border-top: 1px solid #dfe3e6; background: #fff; color: #687078; font-size: 12px; }
      .actm-submission-count { font-variant-numeric: tabular-nums; }
      .actm-submission-hint { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #899096; text-align: right; }
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
        .actm-submission-layer { padding: 8px; }
        .actm-submission-dialog { max-height: calc(100% - 8px); }
        .actm-submission-header { min-height: 64px; padding: 10px 12px 10px 16px; }
        .actm-submission-title { font-size: 16px; }
        .actm-submission-footer { padding: 7px 16px; }
        .actm-submission-hint { display: none; }
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
        .actm-search { flex: 1 0 100%; width: 100%; }
        .actm-segment { min-width: 44px; padding: 0 8px; }
        .actm-summary { flex: 1 0 100%; text-align: right; }
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
              <label class="actm-time-editor" title="编辑当前赛时；在时、分、秒上滚轮可分别调整">
                <input class="actm-offset" type="text" inputmode="text" value="00:00:00" placeholder="00:00:00" spellcheck="false" aria-label="开赛后的时分秒">
                <span>/</span>
                <output class="actm-duration">00:00:00</output>
              </label>
              <label class="actm-speed-wrap" title="选择、输入或滚轮调整播放倍速；Shift + 滚轮使用 10 倍步长">
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
            <input class="actm-search" type="search" placeholder="队名、机构或拼音筛选" aria-label="搜索和筛选队伍或机构" title="支持全拼和首字母；空格分隔多个条件；支持 team:、school:、rank:、solved:、penalty:、ac:，前置 - 可排除">
            <div class="actm-segmented actm-participant-scope" role="group" aria-label="参赛层级">
              <button class="actm-segment active" type="button" data-value="all" aria-pressed="true">全部</button>
              <button class="actm-segment" type="button" data-value="university" aria-pressed="false">大学</button>
            </div>
            <div class="actm-segmented actm-ranking-mode" role="group" aria-label="排名方式">
              <button class="actm-segment active" type="button" data-value="team" aria-pressed="true">队伍</button>
              <button class="actm-segment" type="button" data-value="institution" aria-pressed="false">机构</button>
            </div>
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
        <div class="actm-submission-layer" aria-hidden="true">
          <section class="actm-submission-dialog" role="dialog" aria-modal="true" aria-labelledby="actm-submission-title">
            <header class="actm-submission-header">
              <div class="actm-submission-heading">
                <h3 class="actm-submission-title" id="actm-submission-title">提交记录</h3>
                <div class="actm-submission-subtitle">
                  <span class="actm-submission-school"></span>
                  <span class="actm-submission-meta"></span>
                </div>
              </div>
              <button class="actm-close actm-submission-close" type="button" title="关闭提交记录">&times;</button>
            </header>
            <div class="actm-submission-content"></div>
            <footer class="actm-submission-footer">
              <span class="actm-submission-count"></span>
              <span class="actm-submission-hint">代码可见性由原平台权限决定</span>
            </footer>
          </section>
        </div>
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
      participantScope: root.querySelector('.actm-participant-scope'),
      rankingMode: root.querySelector('.actm-ranking-mode'),
      rowLimit: root.querySelector('.row-limit'),
      summary: root.querySelector('.actm-summary'),
      tableWrap: root.querySelector('.actm-table-wrap'),
      status: root.querySelector('.actm-status'),
      submissionLayer: root.querySelector('.actm-submission-layer'),
      submissionTitle: root.querySelector('.actm-submission-title'),
      submissionSchool: root.querySelector('.actm-submission-school'),
      submissionMeta: root.querySelector('.actm-submission-meta'),
      submissionContent: root.querySelector('.actm-submission-content'),
      submissionCount: root.querySelector('.actm-submission-count'),
      submissionClose: root.querySelector('.actm-submission-close'),
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
    ui.submissionClose.addEventListener('click', () => closeSubmissionModal(ui));
    ui.submissionLayer.addEventListener('mousedown', event => {
      if (event.target === ui.submissionLayer) closeSubmissionModal(ui);
    });
    ui.backdrop.addEventListener('mousedown', event => {
      if (event.target === ui.backdrop) closePanel(ui);
    });
    ui.refresh.addEventListener('click', async () => {
      stopPlayback(ui);
      closeSubmissionModal(ui);
      state.contest = null;
      state.loading = null;
      state.submissionCache.clear();
      await ensureLoaded(ui, true);
    });
    ui.range.addEventListener('input', () => setSecond(ui, Number(ui.range.value)));
    ui.offset.addEventListener('change', () => {
      const second = parseDurationInput(ui.offset.value);
      if (second === null) ui.offset.value = formatDuration(state.second);
      else setSecond(ui, second);
    });
    ui.offset.addEventListener('wheel', event => adjustTimeByWheel(ui, event), { passive: false });
    ui.minusFive.addEventListener('click', () => setSecond(ui, state.second - 5 * 60));
    ui.plusFive.addEventListener('click', () => setSecond(ui, state.second + 5 * 60));
    ui.prevEvent.addEventListener('click', () => jumpEvent(ui, -1));
    ui.nextEvent.addEventListener('click', () => jumpEvent(ui, 1));
    ui.play.addEventListener('click', () => state.playing ? stopPlayback(ui) : startPlayback(ui));
    ui.playbackSpeed.addEventListener('change', () => commitPlaybackSpeed(ui));
    ui.playbackSpeed.addEventListener('wheel', event => adjustPlaybackSpeedByWheel(ui, event), { passive: false });
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
    bindSegmentedControl(ui.participantScope, value => {
      state.participantScope = value;
      scheduleRender(ui);
    });
    bindSegmentedControl(ui.rankingMode, value => {
      state.rankingMode = value;
      scheduleRender(ui);
    });
    ui.rowLimit.addEventListener('change', () => {
      state.rowLimit = Number(ui.rowLimit.value);
      scheduleRender(ui);
    });
    ui.tableWrap.addEventListener('click', async event => {
      const button = event.target.closest('.actm-pin');
      if (button && state.contest) {
        const keys = decodePinKeys(button.dataset.pinKeys);
        if (!keys.length) return;
        const pinned = keys.some(key => state.pinnedTeamKeys.has(key));
        if (pinned) keys.forEach(key => state.pinnedTeamKeys.delete(key));
        else state.pinnedTeamKeys.add(keys[0]);
        savePinnedTeams(state.contest);
        render(ui);
        return;
      }
      const cell = event.target.closest('.actm-submission-cell');
      if (cell) await openSubmissionModal(ui, cell.dataset.teamKey, Number(cell.dataset.problemIndex));
    });
    ui.tableWrap.addEventListener('keydown', async event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const cell = event.target.closest('.actm-submission-cell');
      if (!cell) return;
      event.preventDefault();
      await openSubmissionModal(ui, cell.dataset.teamKey, Number(cell.dataset.problemIndex));
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
        if (ui.submissionLayer.classList.contains('open')) closeSubmissionModal(ui);
        else closePanel(ui);
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

  function bindSegmentedControl(control, onChange) {
    control.addEventListener('click', event => {
      const button = event.target.closest('.actm-segment');
      if (!button || button.classList.contains('active')) return;
      for (const item of control.querySelectorAll('.actm-segment')) {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      }
      onChange(button.dataset.value);
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
      url: `/acm/contest/${encodeURIComponent(contestId)}/${encodeURIComponent(problem.name)}`,
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
      return { id: label, name: label, url: href ? new URL(href, location.origin).href : '' };
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

  function participantRows(rows, scope) {
    const filtered = scope === 'university'
      ? rows.filter(row => isUniversityInstitution(institutionName(row)))
      : rows;
    return filtered.map(row => ({ ...row }));
  }

  function buildInstitutionRows(rows) {
    const groups = new Map();
    for (const row of rows) {
      const name = institutionName(row);
      const key = name ? normalizeSearchText(name) : `team:${row.key}`;
      let group = groups.get(key);
      if (!group) {
        group = { name: name || row.name, members: [] };
        groups.set(key, group);
      }
      group.members.push(row);
    }
    const representatives = [...groups.values()].map(group => {
      const representative = group.members[0];
      return {
        ...representative,
        institutionName: group.name,
        institutionProvided: Boolean(institutionName(representative)),
        representativeName: representative.name,
        memberKeys: group.members.map(member => member.key),
        memberNames: group.members.map(member => member.name),
      };
    });
    return rankRows(representatives);
  }

  function rankRows(rows) {
    const ranked = [...rows].sort(compareRankingRows);
    let rank = 0;
    let previous = null;
    ranked.forEach((row, index) => {
      const key = `${row.solved}:${row.penaltyMs}`;
      if (key !== previous) rank = index + 1;
      row.rank = rank;
      previous = key;
    });
    return ranked;
  }

  function compareRankingRows(a, b) {
    return b.solved - a.solved
      || a.penaltyMs - b.penaltyMs
      || a.finalRank - b.finalRank
      || a.name.localeCompare(b.name);
  }

  function summarizeRankingRows(rows, problemCount) {
    const problemAccepted = Array(problemCount).fill(0);
    let solvedCount = 0;
    let totalAccepted = 0;
    for (const row of rows) {
      if (row.solved > 0) solvedCount += 1;
      totalAccepted += row.solved;
      row.accepted.forEach((score, index) => {
        if (score) problemAccepted[index] += 1;
      });
    }
    return { solvedCount, totalAccepted, problemAccepted };
  }

  function institutionName(row) {
    const school = String(row.school || '').trim();
    if (!school || /^(?:none|null|n\/a|-|无|暂无|未填写|未提供)$/i.test(school)) return '';
    const parts = school.split(/\s*[·•]\s*/).map(part => part.trim()).filter(Boolean);
    return parts.at(-1) || school;
  }

  function isUniversityInstitution(name) {
    const value = String(name || '').trim();
    if (!value) return false;
    if (/(?:附属)?(?:中学|小学|高中|初中)|附中|附小|high school|middle school|primary school|secondary school/i.test(value)) return false;
    return /大学|学院|高等专科学校|职业技术学院|职业大学|\buniversity\b|\bcollege\b|\binstitute\b|\binst\.\s+of\b|\bpolytechnic\b|université|universität|università|universidad|universidade|universiteit|uniwersytet|sveučilište/i.test(value);
  }

  function isRowPinned(row) {
    return (row.memberKeys || [row.key]).some(key => state.pinnedTeamKeys.has(key));
  }

  function encodePinKeys(keys) {
    return encodeURIComponent(JSON.stringify(keys.map(String)));
  }

  function decodePinKeys(value) {
    try {
      const keys = JSON.parse(decodeURIComponent(value || ''));
      return Array.isArray(keys) ? keys.map(String) : [];
    } catch {
      return [];
    }
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
    const scopedRows = participantRows(snapshot.rows, state.participantScope);
    const rankingRows = state.rankingMode === 'institution'
      ? buildInstitutionRows(scopedRows)
      : rankRows(scopedRows);
    const rankingSummary = summarizeRankingRows(rankingRows, contest.problems.length);
    let rows = query ? rankingRows.filter(searchPredicate) : rankingRows;
    const matchedCount = rows.length;
    const pinnedRows = rows.filter(isRowPinned);
    const regularRows = rows.filter(row => !isRowPinned(row));
    rows = state.rowLimit > 0
      ? [...pinnedRows, ...regularRows].slice(0, state.rowLimit)
      : [...pinnedRows, ...regularRows];
    const unit = state.rankingMode === 'institution' ? '机构' : '队';
    const scopeLabel = state.participantScope === 'university' ? '大学' : '全部';
    const rankingLabel = state.rankingMode === 'institution' ? '机构榜' : '队伍榜';
    ui.summary.textContent = `${rankingSummary.solvedCount} ${unit}过题 · 总 AC ${rankingSummary.totalAccepted}`;
    ui.status.textContent = `显示 ${rows.length}/${matchedCount} · 置顶 ${pinnedRows.length} · ${scopeLabel} · ${rankingLabel} · 数据源 ${contest.platform}`;

    const header = contest.problems.map((problem, index) => `
      <th class="problem" title="${escapeHtml(problem.name)}">
        ${problem.url
          ? `<a class="actm-problem-link" href="${escapeHtml(problem.url)}" target="_blank" rel="noopener noreferrer" title="打开题目 ${escapeHtml(problem.name)}">${escapeHtml(problem.name)}</a>`
          : escapeHtml(problem.name)}
        <span class="actm-problem-count">${rankingSummary.problemAccepted[index]}</span>
      </th>
    `).join('');
    const body = rows.map(row => {
      const cells = row.accepted.map((score, problemIndex) => {
        const data = `data-team-key="${escapeHtml(row.key)}" data-problem-index="${problemIndex}"`;
        if (!score) return `<td class="problem actm-empty actm-submission-cell" ${data} role="button" tabindex="0" title="查看提交记录"></td>`;
        const elapsedSecond = Math.floor((score.acceptedTime - contest.startTime) / 1000);
        const wrongClass = score.failedCount > 0 ? ' wrong' : '';
        const fail = score.failedCount > 0 ? `<span class="actm-fail">-${score.failedCount}</span>` : '';
        const first = score.firstBlood ? '*' : '';
        return `<td class="problem actm-accepted actm-submission-cell${wrongClass}" ${data} role="button" tabindex="0" title="${formatDuration(elapsedSecond)}，错误 ${score.failedCount} 次；点击查看提交记录">${Math.floor(elapsedSecond / 60)}${first}${fail}</td>`;
      }).join('');
      const pinned = isRowPinned(row);
      const pinKeys = row.memberKeys || [row.key];
      const primaryName = row.institutionName || row.name;
      const secondaryName = row.institutionName
        ? row.institutionProvided ? `代表队：${row.representativeName}` : '未提供机构信息'
        : row.school;
      const title = row.institutionName
        ? row.institutionProvided ? `${row.institutionName} · 代表队 ${row.representativeName}` : `${row.name} · 未提供机构信息`
        : `${row.name}${row.school ? ` · ${row.school}` : ''}`;
      return `
        <tr class="${pinned ? 'actm-pinned' : ''}">
          <td class="rank">${row.rank}</td>
          <td class="team" title="${escapeHtml(title)}">
            <div class="actm-team-cell">
              <button class="actm-pin${pinned ? ' active' : ''}" type="button" data-pin-keys="${escapeHtml(encodePinKeys(pinKeys))}" title="${pinned ? '取消置顶' : `置顶${unit}`}" aria-label="${pinned ? '取消置顶' : `置顶${unit}`}">&#128204;</button>
              <div class="actm-team-copy">
                <div class="actm-team-name">${escapeHtml(primaryName)}</div>
                <div class="actm-school">${escapeHtml(secondaryName)}</div>
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
          <th class="team">${state.rankingMode === 'institution' ? '机构' : '队伍'}</th>
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

  async function openSubmissionModal(ui, teamKey, problemIndex) {
    const contest = state.contest;
    const team = contest?.teams.find(item => item.key === String(teamKey));
    const problem = contest?.problems[problemIndex];
    if (!contest || !team || !problem) return;

    const requestId = ++state.submissionRequestId;
    ui.submissionTitle.textContent = `${team.name} · ${problem.name}`;
    ui.submissionSchool.textContent = team.school || '未提供学校信息';
    ui.submissionSchool.title = team.school || '';
    ui.submissionMeta.textContent = `${contest.platform} · 整场比赛`;
    ui.submissionCount.textContent = '';
    ui.submissionContent.innerHTML = '<div class="actm-submission-message">正在读取提交记录...</div>';
    ui.submissionLayer.classList.add('open');
    ui.submissionLayer.setAttribute('aria-hidden', 'false');

    try {
      const submissions = await loadSubmissions(contest, team, problem);
      if (requestId !== state.submissionRequestId || !ui.submissionLayer.classList.contains('open')) return;
      renderSubmissions(ui, contest, submissions);
    } catch (error) {
      if (requestId !== state.submissionRequestId || !ui.submissionLayer.classList.contains('open')) return;
      console.error('[ACM Time Machine] Failed to load submissions', error);
      ui.submissionContent.innerHTML = `<div class="actm-submission-message error">${escapeHtml(error.message || String(error))}</div>`;
    }
  }

  function closeSubmissionModal(ui) {
    state.submissionRequestId += 1;
    ui.submissionLayer.classList.remove('open');
    ui.submissionLayer.setAttribute('aria-hidden', 'true');
  }

  function renderSubmissions(ui, contest, submissions) {
    const acceptedCount = submissions.filter(submission => isAcceptedVerdict(submission.verdict)).length;
    ui.submissionCount.textContent = `${submissions.length} 次提交 · ${acceptedCount} 次 AC`;
    if (!submissions.length) {
      ui.submissionContent.innerHTML = '<div class="actm-submission-message">这支队伍在本场比赛中没有提交这道题。</div>';
      return;
    }
    const rows = submissions.map(submission => {
      const elapsedSecond = Math.max(0, Math.floor((submission.submitTime - contest.startTime) / 1000));
      const verdictClass = submissionVerdictClass(submission.verdict);
      const [verdictMain, verdictDetail] = splitVerdictLabel(submission.verdict);
      const verdictLabel = `<span class="actm-verdict-copy"><span>${escapeHtml(verdictMain)}</span>${verdictDetail ? `<span>${escapeHtml(verdictDetail)}</span>` : ''}</span>`;
      const link = submission.sourceUrl
        ? `<a class="actm-source-link" href="${escapeHtml(submission.sourceUrl)}" target="_blank" rel="noopener noreferrer" title="前往原平台查看提交">代码 &#8599;</a>`
        : '-';
      return `
        <tr>
          <td class="actm-submission-time" title="${escapeHtml(formatDateTime(submission.submitTime))}">${formatDuration(elapsedSecond)}</td>
          <td><span class="actm-verdict ${verdictClass}" title="${escapeHtml(submission.verdict)}">${verdictLabel}</span></td>
          <td><span class="actm-language" title="${escapeHtml(submission.language)}">${escapeHtml(submission.language)}</span></td>
          <td>${formatRuntime(submission.timeMs)}</td>
          <td>${formatMemory(submission.memoryKb)}</td>
          <td>${link}</td>
        </tr>
      `;
    }).join('');
    ui.submissionContent.innerHTML = `
      <table class="actm-submission-table">
        <thead><tr>
          <th>赛时</th>
          <th>结果</th>
          <th>语言</th>
          <th>耗时</th>
          <th>内存</th>
          <th aria-label="代码"></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  async function loadSubmissions(contest, team, problem) {
    const cacheKey = `${contest.platform}:${contest.id}:${team.key}:${problem.id}`;
    if (state.submissionCache.has(cacheKey)) return state.submissionCache.get(cacheKey);
    const request = (contest.platform === 'Nowcoder'
      ? loadNowcoderSubmissions(contest, team, problem)
      : loadHduSubmissions(contest, team, problem)
    ).catch(error => {
      state.submissionCache.delete(cacheKey);
      throw error;
    });
    state.submissionCache.set(cacheKey, request);
    return request;
  }

  async function loadNowcoderSubmissions(contest, team, problem) {
    const makeUrl = page => {
      const query = new URLSearchParams({
        id: contest.id,
        page: String(page),
        searchUserName: team.name,
        problemIdFilter: problem.id,
      });
      return `/acm-heavy/acm/contest/status-list?${query}`;
    };
    const first = await fetchJson(makeUrl(1));
    if (first.code !== 0 || !first.data) throw new Error(first.msg || '牛客提交记录接口返回异常。');
    const pageCount = Math.max(1, Number(first.data.basicInfo?.pageCount || 1));
    const rest = Array.from({ length: pageCount - 1 }, (_, index) => index + 2);
    const pages = [first.data, ...await mapLimit(rest, MAX_CONCURRENCY, async page => {
      const json = await fetchJson(makeUrl(page));
      if (json.code !== 0 || !json.data) throw new Error(json.msg || `牛客提交记录第 ${page} 页返回异常。`);
      return json.data;
    })];
    return pages.flatMap(page => page.data || [])
      .filter(item => String(item.userId) === team.key
        && String(item.problemId) === problem.id
        && Number(item.submitTime) >= contest.startTime
        && Number(item.submitTime) <= contest.endTime)
      .map(item => ({
        id: String(item.submissionId),
        submitTime: Number(item.submitTime),
        verdict: item.statusMessage || '未知结果',
        language: item.languageName || item.language || '-',
        timeMs: Number(item.time),
        memoryKb: Number(item.memory),
        sourceUrl: `/acm/contest/view-submission?submissionId=${encodeURIComponent(item.submissionId)}`,
      }))
      .sort((a, b) => a.submitTime - b.submitTime || Number(a.id) - Number(b.id));
  }

  async function loadHduSubmissions(contest, team, problem) {
    if (!contest.selfTeamKey || team.key !== contest.selfTeamKey) {
      throw new Error('HDU 只向当前登录队伍提供提交详情，无法读取其他队伍的提交记录。');
    }
    const teamCacheKey = `${contest.platform}:${contest.id}:${team.key}:*`;
    let allRequest = state.submissionCache.get(teamCacheKey);
    if (!allRequest) {
      allRequest = loadHduTeamSubmissions(contest).catch(error => {
        state.submissionCache.delete(teamCacheKey);
        throw error;
      });
      state.submissionCache.set(teamCacheKey, allRequest);
    }
    const submissions = await allRequest;
    return submissions.filter(item => item.problemId === problem.id);
  }

  async function loadHduTeamSubmissions(contest) {
    const baseUrl = `/contest/status?cid=${encodeURIComponent(contest.id)}&status=`;
    const firstHtml = await fetchText(`${baseUrl}&page=0`);
    if (/Contest Login/i.test(firstHtml)) throw new Error('HDU 比赛登录已失效，请重新登录后再试。');
    const pageNumbers = [...firstHtml.matchAll(/[?&]page=(\d+)/g)].map(match => Number(match[1]));
    const lastPage = Math.max(0, ...pageNumbers);
    const rest = Array.from({ length: lastPage }, (_, index) => index + 1);
    const pages = [firstHtml, ...await mapLimit(rest, MAX_CONCURRENCY, page => fetchText(`${baseUrl}&page=${page}`))];
    const submissions = pages.flatMap(html => parseHduSubmissionPage(html, contest));
    const unique = new Map(submissions.map(item => [item.id, item]));
    return [...unique.values()].sort((a, b) => a.submitTime - b.submitTime || Number(a.id) - Number(b.id));
  }

  function parseHduSubmissionPage(html, contest) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('tr.page-card-row')].flatMap(row => {
      const cells = [...row.querySelectorAll(':scope > td')];
      if (cells.length < 7) return [];
      const id = cells[0].textContent.trim();
      const submitTime = parseHduDateTime(cells[1].textContent.trim());
      const problemId = cells[2].textContent.trim();
      if (!Number.isFinite(submitTime)
        || submitTime < contest.startTime
        || submitTime > contest.endTime) return [];
      const timeMs = Number(cells[3].textContent.match(/[\d.]+/)?.[0]);
      const memoryKb = Number(cells[4].textContent.match(/[\d.]+/)?.[0]);
      const sourceHref = cells[5].querySelector('a')?.getAttribute('href');
      return [{
        id,
        problemId,
        submitTime,
        verdict: cells[6].textContent.trim() || 'Unknown',
        language: cells[5].textContent.trim() || '-',
        timeMs,
        memoryKb,
        sourceUrl: sourceHref ? new URL(sourceHref, location.origin).href : '',
      }];
    });
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

  function adjustTimeByWheel(ui, event) {
    if (!state.contest || event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    const rect = ui.offset.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 0.999999);
    const segment = Math.floor(ratio * 3);
    const units = [3600, 60, 1];
    const direction = event.deltaY < 0 ? 1 : -1;
    setSecond(ui, state.second + direction * units[segment]);
    ui.offset.focus({ preventScroll: true });
    ui.offset.setSelectionRange(segment * 3, segment * 3 + 2);
  }

  function adjustPlaybackSpeedByWheel(ui, event) {
    if (event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    const current = Number(ui.playbackSpeed.value);
    const speed = Number.isFinite(current) && current >= 0.1 && current <= 10000
      ? current
      : state.playbackSpeed;
    const step = playbackSpeedWheelStep(speed) * (event.shiftKey ? 10 : 1);
    const direction = event.deltaY < 0 ? 1 : -1;
    ui.playbackSpeed.value = String(roundDecimal(clamp(speed + direction * step, 0.1, 10000), 3));
    commitPlaybackSpeed(ui);
    ui.playbackSpeed.focus({ preventScroll: true });
    ui.playbackSpeed.select();
  }

  function playbackSpeedWheelStep(speed) {
    return Math.max(0.1, 10 ** (Math.floor(Math.log10(Math.max(0.1, speed))) - 1));
  }

  function roundDecimal(value, precision) {
    const scale = 10 ** precision;
    return Math.round((value + Number.EPSILON) * scale) / scale;
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
    closeSubmissionModal(ui);
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

  function parseHduDateTime(value) {
    const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return Number.NaN;
    return Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`);
  }

  function formatDateTime(timestamp) {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(timestamp));
  }

  function formatRuntime(value) {
    return Number.isFinite(value) ? `${value} ms` : '-';
  }

  function formatMemory(value) {
    if (!Number.isFinite(value)) return '-';
    if (value >= 1024) return `${roundDecimal(value / 1024, 1)} MB`;
    return `${value} KB`;
  }

  function isAcceptedVerdict(verdict) {
    return /accepted|答案正确/i.test(String(verdict));
  }

  function splitVerdictLabel(verdict) {
    const value = String(verdict).trim();
    const match = value.match(/^(.*?)\s*(\([^()]*\)|（[^（）]*）)$/);
    return match ? [match[1], match[2]] : [value, ''];
  }

  function submissionVerdictClass(verdict) {
    const value = String(verdict).trim();
    if (/accepted|答案正确/i.test(value)) return 'accepted';
    if (/wrong answer|答案错误/i.test(value)) return 'wrong-answer';
    if (/time limit|运行超时/i.test(value)) return 'time-limit';
    if (/memory limit|内存超限/i.test(value)) return 'memory-limit';
    if (/compile|编译错误/i.test(value)) return 'compile-error';
    if (/segment|access_violation|段错误/i.test(value)) return 'segment-fault';
    if (/runtime|运行错误/i.test(value)) return 'runtime-error';
    if (/执行出错|system error|judge error/i.test(value)) return 'execution-error';
    if (/output limit|输出超限/i.test(value)) return 'output-limit';
    if (/presentation|格式错误/i.test(value)) return 'presentation-error';
    if (/pending|judg|queu|running|compiling|等待|评测|运行中/i.test(value)) return 'pending';
    return 'other';
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
    const teamText = row.memberNames?.join(' ') || row.name;
    const schoolText = row.institutionName || row.school;
    if (filter.field === 'team') return matchesSearchText(teamText, filter.value);
    if (filter.field === 'school') return matchesSearchText(schoolText, filter.value);
    if (filter.field === 'rank') return matchesNumericFilter(row.rank, filter.value);
    if (filter.field === 'solved') return matchesNumericFilter(row.solved, filter.value);
    if (filter.field === 'penalty') return matchesNumericFilter(Math.floor(row.penaltyMs / 60000), filter.value);
    if (filter.field === 'ac') {
      const acceptedProblems = row.accepted.flatMap((score, index) => score ? [contest.problems[index]] : []);
      if (filter.value === 'any') return acceptedProblems.length > 0;
      if (filter.value === 'none') return acceptedProblems.length === 0;
      return acceptedProblems.some(problem => matchesSearchText(`${problem.id} ${problem.name}`, filter.value));
    }
    return matchesSearchText(`${teamText} ${schoolText}`, filter.value);
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
