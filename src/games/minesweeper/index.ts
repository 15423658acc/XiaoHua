/**
 * 扫雷游戏 —— 实现 GameInstance 接口
 *
 * 渲染：DOM + CSS Grid
 * 输入：左键翻开 / 右键标记（触屏：长按 500ms = 标记）
 * 计分：通关 = max(100, 1000 - 用时秒数 * 5)；踩雷 = 0
 * 成就：通关 / 60 秒内通关 / 不使用标记通关
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';

const GAME_ID = 'minesweeper';
const ROWS = 9;
const COLS = 9;
const TOTAL_MINES = 10;
const TOTAL_CELLS = ROWS * COLS;
const SAFE_CELLS = TOTAL_CELLS - TOTAL_MINES;
const LONG_PRESS_MS = 500;

/** 数字 1-8 的颜色映射 */
const NUM_COLORS: Record<number, string> = {
  1: '#5e72e4', // 蓝
  2: '#4ecca3', // 绿
  3: '#e94560', // 红
  4: '#a855f7', // 紫
  5: '#b07b4d', // 棕
  6: '#22d3ee', // 青
  7: '#111827', // 黑
  8: '#9ca3af', // 灰
};

interface Cell {
  isMine: boolean;
  revealed: boolean;
  flagged: boolean;
  adjacent: number; // 周围雷数 0-8
}

/** 8 方向偏移 */
const NEIGHBORS_8: ReadonlyArray<[number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

export function MinesweeperFactory(): GameInstance {
  return new Minesweeper();
}

class Minesweeper implements GameInstance {
  private root!: HTMLElement;
  private boardEl!: HTMLElement;
  private countEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private restartBtn!: HTMLElement;
  private overlayEl: HTMLElement | null = null;

  private grid: Cell[][] = [];
  private score = 0;
  private isOver = false;
  private hasStarted = false;
  private startTime: number | null = null;
  private elapsedSeconds = 0;
  private timerInterval: number | null = null;

  /** 标记数 */
  private flagCount = 0;
  /** 翻开的非雷格数 */
  private revealedCount = 0;
  /** 是否使用过标记（用于成就） */
  private flagUsed = false;

  private scoreCb: ((score: number) => void) | null = null;
  private eventCb: ((event: string, payload?: unknown) => void) | null = null;

  /** 触屏起点信息（含长按定时器） */
  private touchStartInfo: { x: number; y: number; cellEl: HTMLElement; timerId: number | null } | null = null;

  // 事件处理函数引用，便于 removeEventListener
  private readonly clickHandler = (e: Event) => this.handleClick(e);
  private readonly contextMenuHandler = (e: Event) => this.handleContextMenu(e);
  private readonly touchStartHandler = (e: TouchEvent) => this.onTouchStart(e);
  private readonly touchEndHandler = (e: TouchEvent) => this.onTouchEnd(e);
  private readonly touchMoveHandler = (e: TouchEvent) => this.onTouchMove(e);
  private readonly restartHandler = () => this.restart();

  start(container: HTMLElement): void {
    this.root = container;
    this.root.innerHTML = `
      <div class="mine-wrap">
        <div class="mine-header">
          <span class="mine-count" id="mine-count">💣 ${TOTAL_MINES}</span>
          <button class="mine-restart" id="mine-restart">重新开始</button>
          <span class="mine-timer" id="mine-timer">⏱ 0</span>
        </div>
        <div class="mine-board" id="mine-board"></div>
      </div>
    `;
    this.boardEl = this.root.querySelector('#mine-board')!;
    this.countEl = this.root.querySelector('#mine-count')!;
    this.timerEl = this.root.querySelector('#mine-timer')!;
    this.restartBtn = this.root.querySelector('#mine-restart')!;

    this.initGrid();
    this.renderBoard();
    this.bindEvents();

    this.scoreCb?.(0);
  }

  private initGrid() {
    this.grid = [];
    for (let r = 0; r < ROWS; r++) {
      const row: Cell[] = [];
      for (let c = 0; c < COLS; c++) {
        row.push({ isMine: false, revealed: false, flagged: false, adjacent: 0 });
      }
      this.grid.push(row);
    }
    this.score = 0;
    this.isOver = false;
    this.hasStarted = false;
    this.startTime = null;
    this.elapsedSeconds = 0;
    this.flagCount = 0;
    this.revealedCount = 0;
    this.flagUsed = false;
    if (this.timerInterval !== null) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /** 首次点击后放置雷（确保第一次点击不踩雷，且周围安全） */
  private placeMines(safeR: number, safeC: number) {
    const forbidden = new Set<string>();
    forbidden.add(`${safeR},${safeC}`);
    // 周围 8 格也禁止放雷，保证首次点击能展开
    for (const [dr, dc] of NEIGHBORS_8) {
      const nr = safeR + dr;
      const nc = safeC + dc;
      if (this.inBounds(nr, nc)) forbidden.add(`${nr},${nc}`);
    }

    const candidates: [number, number][] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!forbidden.has(`${r},${c}`)) candidates.push([r, c]);
      }
    }
    // Fisher-Yates 洗牌
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const minesToPlace = Math.min(TOTAL_MINES, candidates.length);
    for (let i = 0; i < minesToPlace; i++) {
      const [r, c] = candidates[i];
      this.grid[r][c].isMine = true;
    }
    // 计算每格周围雷数
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c].isMine) continue;
        let count = 0;
        for (const [dr, dc] of NEIGHBORS_8) {
          const nr = r + dr;
          const nc = c + dc;
          if (this.inBounds(nr, nc) && this.grid[nr][nc].isMine) count++;
        }
        this.grid[r][c].adjacent = count;
      }
    }
  }

  private bindEvents() {
    this.boardEl.addEventListener('click', this.clickHandler);
    this.boardEl.addEventListener('contextmenu', this.contextMenuHandler);
    this.boardEl.addEventListener('touchstart', this.touchStartHandler, { passive: false });
    this.boardEl.addEventListener('touchend', this.touchEndHandler, { passive: false });
    this.boardEl.addEventListener('touchmove', this.touchMoveHandler, { passive: true });
    this.restartBtn.addEventListener('click', this.restartHandler);
  }

  private unbindEvents() {
    this.boardEl.removeEventListener('click', this.clickHandler);
    this.boardEl.removeEventListener('contextmenu', this.contextMenuHandler);
    this.boardEl.removeEventListener('touchstart', this.touchStartHandler);
    this.boardEl.removeEventListener('touchend', this.touchEndHandler);
    this.boardEl.removeEventListener('touchmove', this.touchMoveHandler);
    this.restartBtn.removeEventListener('click', this.restartHandler);
  }

  private onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    const touch = e.touches[0];
    const target = e.target as HTMLElement;
    const cellEl = target.closest('.mine-cell') as HTMLElement | null;
    if (!cellEl) return;
    const timerId = window.setTimeout(() => {
      // 长按触发：标记 + 取消后续点击
      if (this.touchStartInfo) {
        const key = this.touchStartInfo.cellEl.dataset.key!;
        this.handleFlag(key);
        this.touchStartInfo = null;
      }
    }, LONG_PRESS_MS);
    this.touchStartInfo = {
      x: touch.clientX,
      y: touch.clientY,
      cellEl,
      timerId,
    };
  }

  private onTouchMove(e: TouchEvent) {
    if (!this.touchStartInfo || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - this.touchStartInfo.x);
    const dy = Math.abs(touch.clientY - this.touchStartInfo.y);
    if (dx > 10 || dy > 10) {
      // 视为滑动，取消长按
      if (this.touchStartInfo.timerId !== null) {
        window.clearTimeout(this.touchStartInfo.timerId);
      }
      this.touchStartInfo = null;
    }
  }

  private onTouchEnd(e: TouchEvent) {
    if (!this.touchStartInfo) return;
    e.preventDefault();
    const info = this.touchStartInfo;
    if (info.timerId !== null) {
      window.clearTimeout(info.timerId);
    }
    this.touchStartInfo = null;
    // 短按：翻开该格
    if (info.cellEl.isConnected) {
      const key = info.cellEl.dataset.key!;
      this.handleReveal(key);
    }
  }

  private handleClick(e: Event) {
    const target = e.target as HTMLElement;
    const cellEl = target.closest('.mine-cell') as HTMLElement | null;
    if (!cellEl) return;
    // 左键点击：翻开
    this.handleReveal(cellEl.dataset.key!);
  }

  private handleContextMenu(e: Event) {
    e.preventDefault();
    const target = e.target as HTMLElement;
    const cellEl = target.closest('.mine-cell') as HTMLElement | null;
    if (!cellEl) return;
    // 右键：标记/取消标记
    this.handleFlag(cellEl.dataset.key!);
  }

  private cellKey(r: number, c: number) {
    return `${r},${c}`;
  }

  private parseKey(key: string): [number, number] {
    const [r, c] = key.split(',').map(Number);
    return [r, c];
  }

  private handleReveal(key: string) {
    if (this.isOver) return;
    const [r, c] = this.parseKey(key);
    const cell = this.grid[r][c];
    if (!cell || cell.revealed || cell.flagged) return;

    // 首次点击：放雷 + 启动计时
    if (!this.hasStarted) {
      this.hasStarted = true;
      this.placeMines(r, c);
      this.startTime = Date.now();
      this.timerInterval = window.setInterval(() => this.tickTimer(), 250);
    }

    if (cell.isMine) {
      cell.revealed = true;
      this.gameOver(false);
      return;
    }

    this.floodReveal(r, c);

    if (this.revealedCount >= SAFE_CELLS) {
      this.gameOver(true);
    }
  }

  private floodReveal(r: number, c: number) {
    const stack: [number, number][] = [[r, c]];
    while (stack.length > 0) {
      const [cr, cc] = stack.pop()!;
      const cell = this.grid[cr][cc];
      if (!cell || cell.revealed || cell.flagged || cell.isMine) continue;
      cell.revealed = true;
      this.revealedCount++;
      this.updateCellDom(cr, cc);
      if (cell.adjacent === 0) {
        for (const [dr, dc] of NEIGHBORS_8) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (this.inBounds(nr, nc)) {
            const n = this.grid[nr][nc];
            if (n && !n.revealed && !n.flagged && !n.isMine) {
              stack.push([nr, nc]);
            }
          }
        }
      }
    }
  }

  private handleFlag(key: string) {
    if (this.isOver) return;
    const [r, c] = this.parseKey(key);
    const cell = this.grid[r][c];
    if (!cell || cell.revealed) return;
    if (cell.flagged) {
      cell.flagged = false;
      this.flagCount--;
    } else {
      cell.flagged = true;
      this.flagCount++;
      this.flagUsed = true;
    }
    this.updateCellDom(r, c);
    this.updateCountDisplay();
  }

  private tickTimer() {
    if (this.startTime === null) return;
    this.elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    this.timerEl.textContent = `⏱ ${this.elapsedSeconds}`;
    if (!this.isOver) {
      this.score = Math.max(100, 1000 - this.elapsedSeconds * 5);
      this.scoreCb?.(this.score);
    }
  }

  private updateCountDisplay() {
    const remaining = TOTAL_MINES - this.flagCount;
    this.countEl.textContent = `💣 ${remaining}`;
  }

  private inBounds(r: number, c: number): boolean {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  private renderBoard() {
    this.boardEl.innerHTML = '';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const el = document.createElement('div');
        el.className = 'mine-cell';
        el.dataset.key = this.cellKey(r, c);
        this.boardEl.appendChild(el);
        this.updateCellDom(r, c);
      }
    }
    this.updateCountDisplay();
    this.timerEl.textContent = '⏱ 0';
  }

  private updateCellDom(r: number, c: number) {
    const el = this.boardEl.querySelector<HTMLElement>(
      `.mine-cell[data-key="${r},${c}"]`
    );
    if (!el) return;
    const cell = this.grid[r][c];
    el.classList.toggle('revealed', cell.revealed);
    el.classList.toggle('flagged', cell.flagged);
    el.classList.remove('mine', 'exploded', 'wrong-flag');
    el.textContent = '';
    el.style.color = '';
    if (cell.revealed) {
      if (cell.isMine) {
        el.classList.add('mine');
        el.textContent = '💣';
      } else if (cell.adjacent > 0) {
        el.textContent = String(cell.adjacent);
        el.style.color = NUM_COLORS[cell.adjacent] ?? '';
      }
    } else if (cell.flagged) {
      el.textContent = '🚩';
    }
  }

  private gameOver(win: boolean) {
    this.isOver = true;
    if (this.timerInterval !== null) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    if (win) {
      this.score = Math.max(100, 1000 - this.elapsedSeconds * 5);
    } else {
      this.score = 0;
      // 显示所有雷的位置 + 错误标记打叉
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = this.grid[r][c];
          if (cell.isMine && !cell.flagged) {
            cell.revealed = true;
            this.updateCellDom(r, c);
          } else if (!cell.isMine && cell.flagged) {
            const el = this.boardEl.querySelector<HTMLElement>(
              `.mine-cell[data-key="${r},${c}"]`
            );
            if (el) {
              el.classList.add('wrong-flag');
              el.textContent = '❌';
            }
          }
        }
      }
      // 踩雷格红色高亮
      const exploded = this.boardEl.querySelector<HTMLElement>('.mine-cell.revealed.mine');
      if (exploded) exploded.classList.add('exploded');
    }

    this.scoreCb?.(this.score);

    storage.recordScore(GAME_ID, this.score);
    storage.markPlayed(GAME_ID);

    if (win) {
      this.unlock('minesweeper_clear');
      if (this.elapsedSeconds <= 60) this.unlock('minesweeper_time_60s');
      if (!this.flagUsed) this.unlock('minesweeper_no_flag');
    }

    const newly = checkMilestones(storage.load());
    for (const id of newly) {
      storage.markMilestone(id);
      this.eventCb?.('milestone-reached', id);
    }

    this.showOverlay(win);
  }

  private unlock(id: string) {
    const isNew = storage.unlock(id);
    if (isNew) this.eventCb?.('achievement-unlocked', id);
  }

  private showOverlay(win: boolean) {
    if (this.overlayEl) this.overlayEl.remove();
    const overlay = document.createElement('div');
    overlay.className = 'mine-overlay';
    if (win) {
      overlay.innerHTML = `
        <h3>🎉 通关！</h3>
        <p>得分 ${this.score}</p>
        <p class="mine-overlay-stats">用时 ${this.elapsedSeconds} 秒</p>
        <div class="mine-overlay-actions">
          <button class="btn-primary" data-action="restart">再来一局</button>
        </div>
      `;
    } else {
      overlay.innerHTML = `
        <h3>💥 踩雷了</h3>
        <p>得分 0</p>
        <p class="mine-overlay-stats">用时 ${this.elapsedSeconds} 秒</p>
        <div class="mine-overlay-actions">
          <button class="btn-primary" data-action="restart">再来一局</button>
        </div>
      `;
    }
    this.boardEl.parentElement!.appendChild(overlay);
    this.overlayEl = overlay;

    overlay.querySelector('[data-action=restart]')?.addEventListener('click', () => {
      overlay.remove();
      this.overlayEl = null;
      this.restart();
    });
  }

  private restart() {
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    if (this.touchStartInfo?.timerId !== null && this.touchStartInfo?.timerId !== undefined) {
      window.clearTimeout(this.touchStartInfo.timerId);
    }
    this.touchStartInfo = null;
    this.initGrid();
    this.renderBoard();
    this.scoreCb?.(0);
  }

  destroy(): void {
    this.unbindEvents();
    if (this.timerInterval !== null) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.touchStartInfo?.timerId !== null && this.touchStartInfo?.timerId !== undefined) {
      window.clearTimeout(this.touchStartInfo.timerId);
    }
    this.touchStartInfo = null;
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    // 若未结束就退出，仍记录分数和游玩
    if (!this.isOver && this.hasStarted) {
      storage.recordScore(GAME_ID, this.score);
      storage.markPlayed(GAME_ID);
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
    return '左键翻开格子，右键（或触屏长按）插旗标记雷。翻开所有非雷格通关，用时越短得分越高。';
  }
}
