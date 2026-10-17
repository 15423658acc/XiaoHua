/**
 * 推箱子游戏 —— 实现 GameInstance 接口
 *
 * 渲染：DOM + CSS Grid（每关行列数动态）
 * 输入：键盘方向键 + WASD + 触屏滑动 + R 键重置
 * 计分：每通关 1 关 +100
 * 成就：通关第 1 关、第 3 关、全部 10 关
 *
 * 字符约定（见 levels.ts）：
 *   '#' 墙 / ' ' 空地 / '.' 目标 / '$' 箱子 / '*' 箱子在目标 / '@' 角色 / '+' 角色在目标
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import { LEVELS } from './levels';
import './styles.css';

type Dir = 'up' | 'down' | 'left' | 'right';
interface Pos { x: number; y: number; }

export function SokobanFactory(): GameInstance {
  return new Sokoban();
}

class Sokoban implements GameInstance {
  private root!: HTMLElement;
  private boardEl!: HTMLElement;
  private levelInfoEl!: HTMLElement;
  private bannerEl: HTMLElement | null = null;
  private overlayEl: HTMLElement | null = null;

  private walls: Set<string> = new Set();
  private targets: Set<string> = new Set();
  private boxes: Set<string> = new Set();
  private player: Pos = { x: 0, y: 0 };
  private rows = 0;
  private cols = 0;
  private levelIndex = 0;
  private steps = 0;
  private score = 0;
  private isOver = false;
  private isTransitioning = false;
  private bannerTimer: number | null = null;
  private transitionTimer: number | null = null;

  private scoreCb: ((s: number) => void) | null = null;
  private eventCb: ((e: string, p?: unknown) => void) | null = null;

  private keyHandler = (e: KeyboardEvent) => this.handleKey(e);
  private touchStart = { x: 0, y: 0 };
  private touchStartHandler = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    this.touchStart.x = e.touches[0].clientX;
    this.touchStart.y = e.touches[0].clientY;
  };
  private touchEndHandler = (e: TouchEvent) => this.handleTouchEnd(e);

  start(container: HTMLElement): void {
    this.root = container;
    this.root.innerHTML = `
      <div class="sokoban-wrap">
        <div class="sokoban-instructions">
          方向键 / WASD 或滑动屏幕移动角色，把所有箱子推到目标点。R 键或按钮可重置本关
        </div>
        <div class="sokoban-header">
          <span class="sokoban-level-info" id="sokoban-level-info">第 1 关 · 步数 0</span>
          <button class="sokoban-reset-btn" data-action="reset" type="button">重置本关</button>
        </div>
        <div class="sokoban-board-wrap">
          <div class="sokoban-board" id="sokoban-board"></div>
        </div>
      </div>
    `;
    this.levelInfoEl = this.root.querySelector('#sokoban-level-info')!;
    this.boardEl = this.root.querySelector('#sokoban-board')!;

    this.score = 0;
    this.levelIndex = 0;
    this.isOver = false;
    this.isTransitioning = false;
    this.loadLevel(0);
    this.bindInput();
    this.scoreCb?.(this.score);
  }

  private loadLevel(idx: number) {
    this.levelIndex = idx;
    const level = LEVELS[idx];
    this.rows = level.length;
    this.cols = level[0].length;
    this.walls = new Set();
    this.targets = new Set();
    this.boxes = new Set();
    this.steps = 0;
    this.player = { x: 0, y: 0 };
    for (let y = 0; y < this.rows; y++) {
      const row = level[y];
      for (let x = 0; x < this.cols; x++) {
        const ch = row[x] ?? ' ';
        const key = `${x},${y}`;
        switch (ch) {
          case '#': this.walls.add(key); break;
          case '.': this.targets.add(key); break;
          case '$': this.boxes.add(key); break;
          case '*': this.boxes.add(key); this.targets.add(key); break;
          case '@': this.player = { x, y }; break;
          case '+': this.player = { x, y }; this.targets.add(key); break;
          case ' ': break;
        }
      }
    }
    this.boardEl.style.gridTemplateColumns = `repeat(${this.cols}, 1fr)`;
    this.boardEl.style.gridTemplateRows = `repeat(${this.rows}, 1fr)`;
    this.render();
    this.updateHeader();
    this.showBanner(`第 ${idx + 1} 关`);
  }

  private bindInput() {
    window.addEventListener('keydown', this.keyHandler, { passive: false });
    this.boardEl.addEventListener('touchstart', this.touchStartHandler, { passive: true });
    this.boardEl.addEventListener('touchend', this.touchEndHandler, { passive: false });
    this.root.querySelector('[data-action=reset]')?.addEventListener('click', () => {
      if (this.isOver || this.isTransitioning) return;
      this.loadLevel(this.levelIndex);
    });
  }

  private unbindInput() {
    window.removeEventListener('keydown', this.keyHandler);
    this.boardEl.removeEventListener('touchstart', this.touchStartHandler);
    this.boardEl.removeEventListener('touchend', this.touchEndHandler);
  }

  private handleKey(e: KeyboardEvent) {
    if (this.isOver || this.isTransitioning) return;
    let d: Dir | null = null;
    let isReset = false;
    switch (e.key) {
      case 'ArrowUp': case 'w': case 'W': d = 'up'; break;
      case 'ArrowDown': case 's': case 'S': d = 'down'; break;
      case 'ArrowLeft': case 'a': case 'A': d = 'left'; break;
      case 'ArrowRight': case 'd': case 'D': d = 'right'; break;
      case 'r': case 'R': isReset = true; break;
    }
    if (!d && !isReset) return;
    e.preventDefault();
    if (isReset) {
      this.loadLevel(this.levelIndex);
      return;
    }
    this.tryMove(d!);
  }

  private handleTouchEnd(e: TouchEvent) {
    e.preventDefault();
    if (this.isOver || this.isTransitioning) return;
    if (e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - this.touchStart.x;
    const dy = e.changedTouches[0].clientY - this.touchStart.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (Math.max(absX, absY) < 24) return; // 防误触
    let d: Dir;
    if (absX > absY) d = dx > 0 ? 'right' : 'left';
    else d = dy > 0 ? 'down' : 'up';
    this.tryMove(d);
  }

  private tryMove(d: Dir) {
    const next: Pos = { x: this.player.x, y: this.player.y };
    switch (d) {
      case 'up': next.y -= 1; break;
      case 'down': next.y += 1; break;
      case 'left': next.x -= 1; break;
      case 'right': next.x += 1; break;
    }
    const nextKey = `${next.x},${next.y}`;
    if (this.walls.has(nextKey)) return;
    if (this.boxes.has(nextKey)) {
      // 推箱子：箱子后方必须是空地或目标（不能是墙、其他箱子）
      const beyond: Pos = { x: next.x, y: next.y };
      switch (d) {
        case 'up': beyond.y -= 1; break;
        case 'down': beyond.y += 1; break;
        case 'left': beyond.x -= 1; break;
        case 'right': beyond.x += 1; break;
      }
      const beyondKey = `${beyond.x},${beyond.y}`;
      if (this.walls.has(beyondKey)) return;
      if (this.boxes.has(beyondKey)) return;
      this.boxes.delete(nextKey);
      this.boxes.add(beyondKey);
      this.player = next;
      this.steps += 1;
    } else {
      this.player = next;
      this.steps += 1;
    }
    this.render();
    this.updateHeader();
    this.checkWin();
  }

  private checkWin() {
    for (const t of this.targets) {
      if (!this.boxes.has(t)) return;
    }
    // 通关
    this.score += 100;
    this.scoreCb?.(this.score);
    this.checkClearAchievements(this.levelIndex + 1);
    if (this.levelIndex + 1 >= LEVELS.length) {
      // 全部通关
      const isNew = storage.unlock('sokoban_clear_all');
      if (isNew) this.eventCb?.('achievement-unlocked', 'sokoban_clear_all');
      this.endGame();
    } else {
      // 先显示通关提示，1 秒后加载下一关
      this.isTransitioning = true;
      this.showBanner('🎉 通关！');
      this.transitionTimer = window.setTimeout(() => {
        this.isTransitioning = false;
        this.transitionTimer = null;
        this.loadLevel(this.levelIndex + 1);
      }, 1000);
    }
  }

  private checkClearAchievements(cleared: number) {
    if (cleared >= 1) {
      const isNew = storage.unlock('sokoban_clear_1');
      if (isNew) this.eventCb?.('achievement-unlocked', 'sokoban_clear_1');
    }
    if (cleared >= 3) {
      const isNew = storage.unlock('sokoban_clear_3');
      if (isNew) this.eventCb?.('achievement-unlocked', 'sokoban_clear_3');
    }
  }

  private updateHeader() {
    this.levelInfoEl.textContent = `第 ${this.levelIndex + 1} 关 · 步数 ${this.steps}`;
  }

  private showBanner(text: string) {
    if (this.bannerEl) this.bannerEl.remove();
    if (this.bannerTimer !== null) {
      window.clearTimeout(this.bannerTimer);
      this.bannerTimer = null;
    }
    const banner = document.createElement('div');
    banner.className = 'sokoban-banner';
    banner.textContent = text;
    this.boardEl.parentElement!.appendChild(banner);
    this.bannerEl = banner;
    this.bannerTimer = window.setTimeout(() => {
      if (this.bannerEl) {
        this.bannerEl.remove();
        this.bannerEl = null;
      }
      this.bannerTimer = null;
    }, 1500);
  }

  private render() {
    this.boardEl.innerHTML = '';
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const cell = document.createElement('div');
        cell.className = 'sokoban-cell';
        const key = `${x},${y}`;
        const isWall = this.walls.has(key);
        const isTarget = this.targets.has(key);
        const isBox = this.boxes.has(key);
        const isPlayer = this.player.x === x && this.player.y === y;
        if (isWall) {
          cell.classList.add('wall');
        } else if (isPlayer && isTarget) {
          cell.classList.add('player-on-target');
        } else if (isPlayer) {
          cell.classList.add('player');
        } else if (isBox && isTarget) {
          cell.classList.add('box-on-target');
        } else if (isBox) {
          cell.classList.add('box');
        } else if (isTarget) {
          cell.classList.add('target');
        } else {
          cell.classList.add('floor');
        }
        this.boardEl.appendChild(cell);
      }
    }
  }

  private endGame() {
    this.isOver = true;
    storage.recordScore('sokoban', this.score);
    storage.markPlayed('sokoban');
    const newly = checkMilestones(storage.load());
    for (const id of newly) {
      storage.markMilestone(id);
      this.eventCb?.('milestone-reached', id);
    }
    this.showOverlay();
  }

  private showOverlay() {
    if (this.overlayEl) this.overlayEl.remove();
    const overlay = document.createElement('div');
    overlay.className = 'sokoban-overlay';
    overlay.innerHTML = `
      <h3>🎉 全部通关！</h3>
      <p>得分 ${this.score}</p>
      <div class="sokoban-overlay-actions">
        <button class="btn-primary" data-action="restart" type="button">重玩</button>
      </div>
    `;
    this.boardEl.parentElement!.appendChild(overlay);
    this.overlayEl = overlay;
    overlay.querySelector('[data-action=restart]')?.addEventListener('click', () => {
      overlay.remove();
      this.overlayEl = null;
      this.score = 0;
      this.isOver = false;
      this.loadLevel(0);
      this.scoreCb?.(this.score);
    });
  }

  destroy(): void {
    this.unbindInput();
    if (this.bannerTimer !== null) {
      window.clearTimeout(this.bannerTimer);
      this.bannerTimer = null;
    }
    if (this.transitionTimer !== null) {
      window.clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
    if (this.bannerEl) {
      this.bannerEl.remove();
      this.bannerEl = null;
    }
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    // 若未结束就退出，仍记录分数和游玩 + 处理里程碑
    if (!this.isOver && this.score > 0) {
      storage.recordScore('sokoban', this.score);
      storage.markPlayed('sokoban');
      const newly = checkMilestones(storage.load());
      for (const id of newly) {
        storage.markMilestone(id);
      }
    }
    this.root.innerHTML = '';
  }

  onScoreChange(cb: (score: number) => void): void {
    this.scoreCb = cb;
  }

  onEvent(cb: (event: string, payload?: unknown) => void): void {
    this.eventCb = cb;
  }

  getInstructions(): string {
    return '方向键 / WASD 或滑动屏幕移动角色，把所有箱子推到目标点';
  }
}
