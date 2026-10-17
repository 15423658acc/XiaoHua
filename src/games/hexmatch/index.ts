/**
 * 六边形消除 —— 实现 GameInstance 接口
 *
 * 渲染：DOM + flex 行 + clip-path 六边形（奇数行右偏半格）
 * 输入：点击两个相邻六边形交换；形成 3+ 同色连线消除
 * 计分：3 连 = 30 / 4 连 = 60 / 5+ 连 = 100；连锁 +50% 每层
 * 限时：60 秒倒计时；时间到或无可消除组合 → 结束
 * 成就：单局 ≥100 / ≥500 / 一次 4 连消除
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';

const GAME_ID = 'hexmatch';
const ROWS = 6;
const COLS = 6;
const TIME_LIMIT = 60;

/** 5 种柔和低饱和色（防眼花） */
const COLORS = ['#e0708c', '#6ec9a3', '#e0c070', '#7c8cd1', '#a884c4'];

/** 三条轴：水平 E、右下 SE、左下 SW（forward 方向） */
type Axis = 'E' | 'SE' | 'SW';
type Dir = 'forward' | 'backward';
const AXES: Axis[] = ['E', 'SE', 'SW'];

interface Cell { r: number; c: number; }

export function HexmatchFactory(): GameInstance {
  return new Hexmatch();
}

class Hexmatch implements GameInstance {
  private root!: HTMLElement;
  private boardEl!: HTMLElement;
  private scoreEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private overlayEl: HTMLElement | null = null;

  /** grid[r][c] = 颜色索引 0..4；-1 表示空 */
  private grid: number[][] = [];
  private score = 0;
  private timeLeft = TIME_LIMIT;
  private isOver = false;
  private isAnimating = false;

  private firstSelect: Cell | null = null;

  private timerInterval: number | null = null;
  /** 等待中的 setTimeout id，destroy 时统一清理 */
  private pendingTimeouts = new Set<number>();

  private scoreCb: ((score: number) => void) | null = null;
  private eventCb: ((event: string, payload?: unknown) => void) | null = null;

  private readonly clickHandler = (e: Event) => this.onClick(e);

  start(container: HTMLElement): void {
    this.root = container;
    this.root.innerHTML = `
      <div class="hex-wrap">
        <div class="hex-header">
          <span class="hex-score" id="hex-score">得分: 0</span>
          <span class="hex-timer" id="hex-timer">⏱ ${TIME_LIMIT}</span>
        </div>
        <div class="hex-board" id="hex-board"></div>
      </div>
    `;
    this.boardEl = this.root.querySelector('#hex-board')!;
    this.scoreEl = this.root.querySelector('#hex-score')!;
    this.timerEl = this.root.querySelector('#hex-timer')!;

    this.score = 0;
    this.timeLeft = TIME_LIMIT;
    this.isOver = false;
    this.isAnimating = false;
    this.firstSelect = null;

    this.initGrid();
    this.renderBoard();
    this.boardEl.addEventListener('click', this.clickHandler);
    this.timerInterval = window.setInterval(() => this.tick(), 1000);

    this.scoreCb?.(0);
  }

  // ====== 网格初始化（贪心避免开局即 3 连） ======
  private initGrid() {
    this.grid = [];
    for (let r = 0; r < ROWS; r++) {
      const row: number[] = [];
      for (let c = 0; c < COLS; c++) row.push(-1);
      this.grid.push(row);
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        // 随机尝试颜色，挑不会立即形成 3 连的
        const order = this.shuffle([0, 1, 2, 3, 4]);
        for (const color of order) {
          this.grid[r][c] = color;
          if (!this.wouldFormMatchAt(r, c)) break;
        }
      }
    }
  }

  private shuffle<T>(arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** 检查放置 (r,c) 是否会与"已放置的"前驱形成 3+ 连线 */
  private wouldFormMatchAt(r: number, c: number): boolean {
    const color = this.grid[r][c];
    if (color < 0) return false;
    for (const axis of AXES) {
      let count = 1;
      let cr = r, cc = c;
      while (true) {
        const [nr, nc] = this.step(cr, cc, axis, 'backward');
        if (!this.inBounds(nr, nc) || this.grid[nr][nc] !== color) break;
        count++;
        cr = nr; cc = nc;
        if (count >= 3) return true;
      }
    }
    return false;
  }

  // ====== 偏移坐标六边形 step（基于 spec 的邻居定义） ======
  /**
   * 偶数行邻居: NW=(r-1,c-1), NE=(r-1,c), W=(r,c-1), E=(r,c+1), SW=(r+1,c-1), SE=(r+1,c)
   * 奇数行邻居: NW=(r-1,c),   NE=(r-1,c+1), W=(r,c-1), E=(r,c+1), SW=(r+1,c),   SE=(r+1,c+1)
   *
   * 轴 E：forward=E；backward=W
   * 轴 SE：forward=SE；backward=NW
   * 轴 SW：forward=SW；backward=NE
   */
  private step(r: number, c: number, axis: Axis, dir: Dir): [number, number] {
    const even = r % 2 === 0;
    if (axis === 'E') {
      return dir === 'forward' ? [r, c + 1] : [r, c - 1];
    }
    if (axis === 'SE') {
      if (dir === 'forward') return even ? [r + 1, c] : [r + 1, c + 1];
      return even ? [r - 1, c - 1] : [r - 1, c];
    }
    // axis === 'SW'
    if (dir === 'forward') return even ? [r + 1, c - 1] : [r + 1, c];
    return even ? [r - 1, c] : [r - 1, c + 1];
  }

  private getNeighbors(r: number, c: number): Cell[] {
    const result: Cell[] = [];
    for (const axis of AXES) {
      const f = this.step(r, c, axis, 'forward');
      if (this.inBounds(f[0], f[1])) result.push({ r: f[0], c: f[1] });
      const b = this.step(r, c, axis, 'backward');
      if (this.inBounds(b[0], b[1])) result.push({ r: b[0], c: b[1] });
    }
    return result;
  }

  private inBounds(r: number, c: number): boolean {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  // ====== 连线检测：返回所有 ≥3 同色连线 ======
  private findMatchedLines(): Cell[][] {
    const lines: Cell[][] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const color = this.grid[r][c];
        if (color < 0) continue;
        for (const axis of AXES) {
          // 仅在"线起点"开始统计（backward 不同色/越界）
          const [br, bc] = this.step(r, c, axis, 'backward');
          if (this.inBounds(br, bc) && this.grid[br][bc] === color) continue;
          const line: Cell[] = [{ r, c }];
          let cr = r, cc = c;
          while (true) {
            const [nr, nc] = this.step(cr, cc, axis, 'forward');
            if (!this.inBounds(nr, nc) || this.grid[nr][nc] !== color) break;
            line.push({ r: nr, c: nc });
            cr = nr; cc = nc;
          }
          if (line.length >= 3) lines.push(line);
        }
      }
    }
    return lines;
  }

  private hasPossibleMoves(): boolean {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c] < 0) continue;
        for (const axis of AXES) {
          const [nr, nc] = this.step(r, c, axis, 'forward');
          if (!this.inBounds(nr, nc) || this.grid[nr][nc] < 0) continue;
          // 试交换
          this.swapCells(r, c, nr, nc);
          const has = this.findMatchedLines().length > 0;
          this.swapCells(r, c, nr, nc); // 还原
          if (has) return true;
        }
      }
    }
    return false;
  }

  private swapCells(r1: number, c1: number, r2: number, c2: number) {
    const tmp = this.grid[r1][c1];
    this.grid[r1][c1] = this.grid[r2][c2];
    this.grid[r2][c2] = tmp;
  }

  // ====== 重力（按列下落，顶部补随机色） ======
  private applyGravity() {
    for (let c = 0; c < COLS; c++) {
      const stack: number[] = [];
      for (let r = ROWS - 1; r >= 0; r--) {
        if (this.grid[r][c] >= 0) stack.push(this.grid[r][c]);
      }
      for (let r = ROWS - 1; r >= 0; r--) {
        const idx = ROWS - 1 - r;
        this.grid[r][c] = idx < stack.length ? stack[idx] : Math.floor(Math.random() * COLORS.length);
      }
    }
  }

  // ====== 渲染 ======
  private renderBoard() {
    this.boardEl.innerHTML = '';
    for (let r = 0; r < ROWS; r++) {
      const rowEl = document.createElement('div');
      rowEl.className = 'hex-row' + (r % 2 === 1 ? ' odd' : '');
      for (let c = 0; c < COLS; c++) {
        rowEl.appendChild(this.createTile(r, c));
      }
      this.boardEl.appendChild(rowEl);
    }
  }

  private createTile(r: number, c: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'hex-tile';
    el.dataset.key = `${r},${c}`;
    const color = this.grid[r][c];
    if (color >= 0) {
      el.style.background = COLORS[color];
      el.dataset.color = String(color);
    }
    if (this.firstSelect && this.firstSelect.r === r && this.firstSelect.c === c) {
      el.classList.add('selected');
    }
    return el;
  }

  // ====== 交互 ======
  private onClick(e: Event) {
    if (this.isOver || this.isAnimating) return;
    const target = e.target as HTMLElement;
    const tile = target.closest('.hex-tile') as HTMLElement | null;
    if (!tile) return;
    const key = tile.dataset.key!;
    const [r, c] = key.split(',').map(Number);
    this.handleSelect(r, c);
  }

  private handleSelect(r: number, c: number) {
    if (this.grid[r][c] < 0) return;
    if (this.firstSelect === null) {
      this.firstSelect = { r, c };
      this.updateSelection();
      return;
    }
    if (this.firstSelect.r === r && this.firstSelect.c === c) {
      // 再次点击同一格：取消选择
      this.firstSelect = null;
      this.updateSelection();
      return;
    }
    const first = this.firstSelect;
    if (this.areAdjacent(first.r, first.c, r, c)) {
      this.firstSelect = null;
      this.updateSelection();
      void this.trySwap(first.r, first.c, r, c);
    } else {
      // 重新选择新格
      this.firstSelect = { r, c };
      this.updateSelection();
    }
  }

  private areAdjacent(r1: number, c1: number, r2: number, c2: number): boolean {
    return this.getNeighbors(r1, c1).some(n => n.r === r2 && n.c === c2);
  }

  private updateSelection() {
    this.boardEl.querySelectorAll('.hex-tile.selected').forEach(el => el.classList.remove('selected'));
    if (this.firstSelect) {
      const el = this.boardEl.querySelector<HTMLElement>(
        `.hex-tile[data-key="${this.firstSelect.r},${this.firstSelect.c}"]`
      );
      if (el) el.classList.add('selected');
    }
  }

  private async trySwap(r1: number, c1: number, r2: number, c2: number) {
    this.isAnimating = true;
    // 交换
    this.swapCells(r1, c1, r2, c2);
    this.renderBoard();
    await this.delay(150);

    const lines = this.findMatchedLines();
    if (lines.length === 0) {
      // 无效交换：还原
      this.swapCells(r1, c1, r2, c2);
      this.renderBoard();
      this.isAnimating = false;
      return;
    }

    // 连锁消除
    let cascade = 0;
    let currentLines = lines;
    while (currentLines.length > 0) {
      // 计分
      let clear4ThisRound = false;
      for (const line of currentLines) {
        const size = line.length;
        const base = size >= 5 ? 100 : size >= 4 ? 60 : 30;
        const mult = 1 + 0.5 * cascade;
        this.score += Math.round(base * mult);
        if (size >= 4) clear4ThisRound = true;
      }
      if (clear4ThisRound) this.unlock('hexmatch_clear_4');
      this.checkScoreAchievements();
      this.scoreEl.textContent = `得分: ${this.score}`;
      this.scoreCb?.(this.score);

      // 标记删除动画
      const matchedKeys = new Set<string>();
      for (const line of currentLines) {
        for (const cell of line) {
          matchedKeys.add(`${cell.r},${cell.c}`);
        }
      }
      matchedKeys.forEach(key => {
        const el = this.boardEl.querySelector<HTMLElement>(`.hex-tile[data-key="${key}"]`);
        if (el) el.classList.add('removing');
      });
      await this.delay(260);

      // 清空
      matchedKeys.forEach(key => {
        const [r, c] = key.split(',').map(Number);
        this.grid[r][c] = -1;
      });

      // 重力 + 重绘
      this.applyGravity();
      this.renderBoard();
      await this.delay(220);

      cascade++;
      currentLines = this.findMatchedLines();
    }

    this.isAnimating = false;

    // 检查是否还有可消除组合
    if (!this.hasPossibleMoves()) {
      this.endGame();
    }
  }

  // ====== 计时 ======
  private tick() {
    if (this.isOver) return;
    this.timeLeft--;
    this.timerEl.textContent = `⏱ ${this.timeLeft}`;
    if (this.timeLeft <= 0) {
      this.endGame();
    }
  }

  // ====== 结束 ======
  private endGame() {
    if (this.isOver) return;
    this.isOver = true;
    if (this.timerInterval !== null) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.checkScoreAchievements();

    storage.recordScore(GAME_ID, this.score);
    storage.markPlayed(GAME_ID);

    const newly = checkMilestones(storage.load());
    for (const id of newly) {
      storage.markMilestone(id);
      this.eventCb?.('milestone-reached', id);
    }

    this.showOverlay();
  }

  private checkScoreAchievements() {
    if (this.score >= 100) this.unlock('hexmatch_score_100');
    if (this.score >= 500) this.unlock('hexmatch_score_500');
  }

  private unlock(id: string) {
    const isNew = storage.unlock(id);
    if (isNew) this.eventCb?.('achievement-unlocked', id);
  }

  private showOverlay() {
    if (this.overlayEl) this.overlayEl.remove();
    const overlay = document.createElement('div');
    overlay.className = 'hex-overlay';
    const reason = this.timeLeft <= 0 ? '时间到' : '无可消除组合';
    overlay.innerHTML = `
      <h3>🎮 游戏结束</h3>
      <p>${reason}</p>
      <p>得分 ${this.score}</p>
      <div class="hex-overlay-actions">
        <button class="btn-primary" data-action="restart">再来一局</button>
      </div>
    `;
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
    // 清空等待中的 timeout
    for (const id of this.pendingTimeouts) {
      window.clearTimeout(id);
    }
    this.pendingTimeouts.clear();
    if (this.timerInterval !== null) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.score = 0;
    this.timeLeft = TIME_LIMIT;
    this.isOver = false;
    this.isAnimating = false;
    this.firstSelect = null;
    this.initGrid();
    this.renderBoard();
    this.scoreEl.textContent = `得分: 0`;
    this.timerEl.textContent = `⏱ ${TIME_LIMIT}`;
    this.scoreCb?.(0);
    this.timerInterval = window.setInterval(() => this.tick(), 1000);
  }

  // ====== 工具 ======
  /** Promise 形式的 setTimeout；destroy 时统一清理 */
  private delay(ms: number): Promise<void> {
    return new Promise<void>(resolve => {
      const id = window.setTimeout(() => {
        this.pendingTimeouts.delete(id);
        resolve();
      }, ms);
      this.pendingTimeouts.add(id);
    });
  }

  destroy(): void {
    this.boardEl?.removeEventListener('click', this.clickHandler);
    if (this.timerInterval !== null) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    for (const id of this.pendingTimeouts) {
      window.clearTimeout(id);
    }
    this.pendingTimeouts.clear();
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    // 若未结束就退出，仍记录分数和游玩
    if (!this.isOver) {
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
    return '点击两个相邻的六边形交换位置，形成 3 个及以上同色连线即可消除。连锁消除得分翻倍，限时 60 秒。';
  }
}
