/**
 * 应用主入口
 *
 * 职责：
 * - 初始化主菜单
 * - 监听"启动游戏"事件，切换到游戏视图
 * - 监听成就解锁 / 里程碑达成事件，弹出 Toast
 */
import './styles/main.css';
import { HomeMenu } from './ui/HomeMenu';
import { findGame } from './core/GameRegistry';
import { ACHIEVEMENTS, MILESTONES } from './core/Achievements';
import { storage } from './core/Storage';
import type { GameInstance } from './types';

const app = document.getElementById('app')!;

let homeMenu: HomeMenu | null = null;
let currentGame: GameInstance | null = null;

function ensureToastContainer(): HTMLElement {
  let el = document.querySelector<HTMLElement>('.toast-container');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast-container';
    document.body.appendChild(el);
  }
  return el;
}

function showToast(msg: string, icon = '🎉', type: 'success' | 'error' = 'success') {
  const container = ensureToastContainer();
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'error' ? ' error' : '');
  t.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity 0.3s';
    setTimeout(() => t.remove(), 300);
  }, 2400);
}

function renderHome() {
  app.innerHTML = '';
  homeMenu = new HomeMenu(app);
  homeMenu.render();
  // 监听启动游戏
  app.addEventListener('launch-game', (e: Event) => {
    const gameId = (e as CustomEvent).detail.gameId as string;
    launchGame(gameId);
  });
}

function launchGame(gameId: string) {
  const reg = findGame(gameId);
  if (!reg) {
    showToast('未找到游戏：' + gameId, '❌', 'error');
    return;
  }
  app.innerHTML = '';
  // 工具栏
  const toolbar = document.createElement('div');
  toolbar.className = 'game-toolbar';
  toolbar.innerHTML = `
    <div class="game-toolbar-left">
      <button class="icon-btn" data-action="back" aria-label="返回">←</button>
      <div class="game-toolbar-title">${reg.icon} ${reg.name}</div>
    </div>
    <div class="game-score-display">
      <div class="score-block">
        <div class="score-label">本局</div>
        <div class="score-value" id="cur-score">0</div>
      </div>
      <div class="score-block">
        <div class="score-label">最高</div>
        <div class="score-value" id="best-score">0</div>
      </div>
    </div>
  `;
  const gameView = document.createElement('div');
  gameView.className = 'game-view';
  gameView.appendChild(toolbar);

  const gameContainer = document.createElement('div');
  gameContainer.className = 'game-container';
  gameView.appendChild(gameContainer);
  app.appendChild(gameView);

  // 返回按钮
  toolbar.querySelector('[data-action=back]')!.addEventListener('click', () => {
    if (currentGame) {
      currentGame.destroy();
      currentGame = null;
    }
    renderHome();
  });

  // 启动游戏
  const game = reg.factory();
  currentGame = game;

  // 显示最高分
  const save = storage.load();
  const bestEl = gameView.querySelector<HTMLElement>('#best-score')!;
  bestEl.textContent = String(save.scores[gameId] ?? 0);

  // 绑定分数回调
  const curScoreEl = gameView.querySelector<HTMLElement>('#cur-score')!;
  game.onScoreChange((score) => {
    curScoreEl.textContent = String(score);
  });

  // 绑定事件回调（成就解锁、里程碑达成）
  game.onEvent((event, payload) => {
    if (event === 'achievement-unlocked' && typeof payload === 'string') {
      const ach = ACHIEVEMENTS.find((a) => a.id === payload);
      if (ach) {
        showToast(`成就解锁：${ach.name}`, ach.icon);
      }
    } else if (event === 'milestone-reached' && typeof payload === 'string') {
      const m = MILESTONES.find((m) => m.id === payload);
      if (m) {
        showToast(`里程碑达成：${m.name}`, m.icon);
      }
    }
  });

  game.start(gameContainer);
}

// 初始渲染
renderHome();

// PWA 风格：处理 ESC 返回主菜单
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && currentGame) {
    currentGame.destroy();
    currentGame = null;
    renderHome();
  }
});
