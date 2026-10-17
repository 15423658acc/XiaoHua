/**
 * 2048 游戏 —— 实现 GameInstance 接口
 *
 * 渲染：DOM + CSS Grid
 * 输入：键盘方向键 + 触屏滑动
 * 计分：每次合并累加合并后的数值
 * 成就：合成 128/256/512/1024/2048，单局分数 5000/20000
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';
import {
  type Grid,
  type Direction,
  createEmptyGrid,
  addRandomTile,
  move,
  canMove,
  maxTile,
} from './board';

export function Game2048Factory(): GameInstance {
  return new Game2048();
}

class Game2048 implements GameInstance {
  private root!: HTMLElement;
  private boardEl!: HTMLElement;
  private instructionsEl!: HTMLElement;
  private overlayEl: HTMLElement | null = null;

  private grid: Grid = createEmptyGrid();
  private score = 0;
  private best = 0;
  private isOver = false;
  private won = false;
  private hasContinued = false; // 达成 2048 后是否选择继续

  private scoreCb: ((score: number) => void) | null = null;
  private eventCb: ((event: string, payload?: unknown) => void) | null = null;

  private keyHandler = (e: KeyboardEvent) => this.handleKey(e);
  private touchStart = { x: 0, y: 0 };
  private touchStartHandler = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    this.touchStart.x = e.touches[0].clientX;
    this.touchStart.y = e.touches[0].clientY;
  };
  private touchEndHandler = (e: TouchEvent) => this.handleTouchEnd(e);

  start(container: HTMLElement): void {
    // 加载历史最高分
    const save = storage.load();
    this.best = save.scores['2048'] ?? 0;

    this.root = container;
    this.root.innerHTML = `
      <div class="g2048-wrap">
        <div class="g2048-instructions">
          使用方向键 ↑ ↓ ← → 或屏幕滑动合并相同数字，目标 2048
        </div>
        <div class="g2048-board" id="g2048-board"></div>
      </div>
    `;
    this.instructionsEl = this.root.querySelector('.g2048-instructions')!;
    this.boardEl = this.root.querySelector('#g2048-board')!;

    this.initGrid();
    this.render();
    this.bindInput();

    this.scoreCb?.(this.score);
  }

  private initGrid() {
    this.grid = createEmptyGrid();
    addRandomTile(this.grid);
    addRandomTile(this.grid);
    this.score = 0;
    this.isOver = false;
    this.won = false;
    this.hasContinued = false;
  }

  private bindInput() {
    window.addEventListener('keydown', this.keyHandler, { passive: false });
    this.boardEl.addEventListener('touchstart', this.touchStartHandler, { passive: true });
    this.boardEl.addEventListener('touchend', this.touchEndHandler, { passive: false });
  }

  private unbindInput() {
    window.removeEventListener('keydown', this.keyHandler);
    this.boardEl.removeEventListener('touchstart', this.touchStartHandler);
    this.boardEl.removeEventListener('touchend', this.touchEndHandler);
  }

  private handleKey(e: KeyboardEvent) {
    let dir: Direction | null = null;
    switch (e.key) {
      case 'ArrowUp': case 'w': case 'W': dir = 'up'; break;
      case 'ArrowDown': case 's': case 'S': dir = 'down'; break;
      case 'ArrowLeft': case 'a': case 'A': dir = 'left'; break;
      case 'ArrowRight': case 'd': case 'D': dir = 'right'; break;
    }
    if (!dir) return;
    e.preventDefault();
    this.applyMove(dir);
  }

  private handleTouchEnd(e: TouchEvent) {
    e.preventDefault();
    if (e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - this.touchStart.x;
    const dy = e.changedTouches[0].clientY - this.touchStart.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (Math.max(absX, absY) < 24) return; // 防误触
    let dir: Direction;
    if (absX > absY) dir = dx > 0 ? 'right' : 'left';
    else dir = dy > 0 ? 'down' : 'up';
    this.applyMove(dir);
  }

  private applyMove(dir: Direction) {
    if (this.isOver) return;
    const result = move(this.grid, dir);
    if (!result.moved) return;

    this.grid = result.grid;
    this.score += result.scoreGain;
    if (this.score > this.best) this.best = this.score;
    this.scoreCb?.(this.score);

    // 检查成就（基于本次合成出的最大数字）
    const highest = result.maxTileAfterMove;
    this.checkTileAchievements(highest);
    // 检查分数成就
    this.checkScoreAchievements(this.score);

    // 检查胜利
    if (!this.won && maxTile(this.grid) >= 2048 && !this.hasContinued) {
      this.won = true;
      this.showOverlay('win');
    }

    this.render(result.newTile, result.mergedCells);

    // 检查游戏结束
    if (!canMove(this.grid)) {
      this.isOver = true;
      this.endGame();
    }
  }

  private checkTileAchievements(highest: number) {
    const map: Record<number, string> = {
      128: 'g2048_tile_128',
      256: 'g2048_tile_256',
      512: 'g2048_tile_512',
      1024: 'g2048_tile_1024',
      2048: 'g2048_tile_2048',
    };
    for (const [val, achId] of Object.entries(map)) {
      if (highest >= Number(val)) {
        const isNew = storage.unlock(achId);
        if (isNew) this.eventCb?.('achievement-unlocked', achId);
      }
    }
  }

  private checkScoreAchievements(score: number) {
    if (score >= 5000) {
      const isNew = storage.unlock('g2048_score_5000');
      if (isNew) this.eventCb?.('achievement-unlocked', 'g2048_score_5000');
    }
    if (score >= 20000) {
      const isNew = storage.unlock('g2048_score_20000');
      if (isNew) this.eventCb?.('achievement-unlocked', 'g2048_score_20000');
    }
  }

  private render(
    newTile: { row: number; col: number; value: number } | null = null,
    mergedCells: { row: number; col: number }[] = []
  ) {
    const newSet = newTile ? new Set([`${newTile.row},${newTile.col}`]) : new Set<string>();
    const mergedSet = new Set(mergedCells.map((m) => `${m.row},${m.col}`));

    this.boardEl.innerHTML = '';
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const val = this.grid[r][c];
        const cell = document.createElement('div');
        cell.className = 'g2048-cell';
        if (val === 0) {
          // 空格不显示数字
        } else {
          cell.dataset.val = String(val);
          cell.textContent = String(val);
        }
        if (newSet.has(`${r},${c}`)) cell.classList.add('new-tile');
        if (mergedSet.has(`${r},${c}`)) cell.classList.add('merged');
        this.boardEl.appendChild(cell);
      }
    }
  }

  private showOverlay(type: 'win' | 'over') {
    if (this.overlayEl) this.overlayEl.remove();
    const overlay = document.createElement('div');
    overlay.className = 'g2048-overlay';
    if (type === 'win') {
      overlay.innerHTML = `
        <h3>🎉 合成 2048！</h3>
        <p>得分 ${this.score}</p>
        <div class="g2048-overlay-actions">
          <button class="btn-primary" data-action="continue">继续挑战</button>
          <button class="btn-secondary" data-action="restart">重新开始</button>
        </div>
      `;
    } else {
      overlay.innerHTML = `
        <h3>💀 游戏结束</h3>
        <p>得分 ${this.score} · 最高 ${this.best}</p>
        <div class="g2048-overlay-actions">
          <button class="btn-primary" data-action="restart">再来一局</button>
        </div>
      `;
    }
    this.boardEl.parentElement!.appendChild(overlay);
    this.overlayEl = overlay;

    overlay.querySelector('[data-action=continue]')?.addEventListener('click', () => {
      this.hasContinued = true;
      overlay.remove();
      this.overlayEl = null;
    });
    overlay.querySelector('[data-action=restart]')?.addEventListener('click', () => {
      overlay.remove();
      this.overlayEl = null;
      this.initGrid();
      this.render();
      this.scoreCb?.(this.score);
    });
  }

  private endGame() {
    storage.recordScore('2048', this.score);
    storage.markPlayed('2048');
    // 检查里程碑
    const newly = checkMilestones(storage.load());
    for (const id of newly) {
      storage.markMilestone(id);
      this.eventCb?.('milestone-reached', id);
    }
    this.showOverlay('over');
  }

  destroy(): void {
    this.unbindInput();
    if (this.overlayEl) this.overlayEl.remove();
    // 若未结束就退出，仍记录分数和游玩
    if (!this.isOver && this.score > 0) {
      storage.recordScore('2048', this.score);
      storage.markPlayed('2048');
      const newly = checkMilestones(storage.load());
      for (const id of newly) storage.markMilestone(id);
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
    return '使用方向键或滑动屏幕合并相同数字，挑战合成 2048';
  }
}
