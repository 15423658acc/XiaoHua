/**
 * 连连看 —— 实现 GameInstance 接口
 *
 * 渲染：DOM + CSS Grid + SVG 连线
 * 输入：点击牌格
 * 计分：Math.max(100, 2000 - 用时秒数 * 3)
 * 成就：通关 / 不使用提示通关 / 180 秒内通关
 *
 * 路径规则：最多 2 个转折点，可绕到棋盘外
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';

const GAME_ID = 'liankan';
const COLS = 8;
const ROWS = 10;
const TIME_LIMIT = 300;

const EMOJIS = [
  '🍎', '🍌', '🍊', '🍋', '🍇', '🍓', '🍑', '🍒', '🍉', '🍐',
  '🥝', '🍍', '🥥', '🥑', '🍅', '🥕', '🌽', '🥦', '🍔', '🍟',
  '🍕', '🌭', '🥪', '🌮', '🍣', '🍱', '🍙', '🍚', '🍜', '🍲',
  '🍰', '🎂', '🍪', '🍩', '🍫', '🍬', '🍭', '🍮', '☕', '🍵',
];

export function LiankanFactory(): GameInstance {
  return new Liankan();
}

interface Point {
  r: number;
  c: number;
}

class Liankan implements GameInstance {
  private root!: HTMLElement;
  private boardEl!: HTMLElement;
  private overlaySvg!: SVGSVGElement;
  private remainingEl: HTMLElement | null = null;
  private timerEl: HTMLElement | null = null;

  private grid: (string | null)[][] = [];
  private selected: Point | null = null;
  private hintTiles: Point[] = [];

  private remaining = 0;
  private startTime: number | null = null;
  private elapsedSec = 0;
  private timerInterval: number | null = null;
  private lineTimer: number | null = null;
  private hintTimer: number | null = null;

  private isOver = false;
  private hasStarted = false;
  private hintUsed = 0;
  private score = 0;
  private overlayEl: HTMLElement | null = null;

  private scoreCb: ((s: number) => void) | null = null;
  private eventCb: ((e: string, p?: unknown) => void) | null = null;

  private keyHandler = (e: KeyboardEvent) => this.handleKey(e);
  private clickHandler = (e: Event) => this.handleClick(e);
  private hintClickHandler = () => this.useHint();
  private shuffleClickHandler = () => this.shuffleTiles();

  start(container: HTMLElement): void {
    this.root = container;
    this.root.innerHTML = `
      <div class="lk-wrap">
        <div class="lk-header">
          <span class="lk-remaining">剩余: 80</span>
          <span class="lk-timer">⏱ ${TIME_LIMIT}</span>
          <button class="lk-hint">提示(H)</button>
          <button class="lk-shuffle">洗牌(S)</button>
        </div>
        <div class="lk-board-wrap">
          <div class="lk-board" id="lk-board"></div>
          <svg class="lk-line-overlay" id="lk-line-overlay" xmlns="http://www.w3.org/2000/svg"></svg>
        </div>
      </div>
    `;
    this.boardEl = this.root.querySelector('#lk-board')!;
    this.overlaySvg = this.root.querySelector('#lk-line-overlay')!;
    this.remainingEl = this.root.querySelector('.lk-remaining');
    this.timerEl = this.root.querySelector('.lk-timer');

    this.root.querySelector('.lk-hint')?.addEventListener('click', this.hintClickHandler);
    this.root.querySelector('.lk-shuffle')?.addEventListener('click', this.shuffleClickHandler);

    this.newGame();
    this.bindInput();
    this.scoreCb?.(0);
  }

  private newGame() {
    const tiles: string[] = [];
    for (let i = 0; i < 40; i++) {
      tiles.push(EMOJIS[i]);
      tiles.push(EMOJIS[i]);
    }
    this.shuffle(tiles);

    this.grid = [];
    let idx = 0;
    for (let r = 0; r < ROWS; r++) {
      const row: (string | null)[] = [];
      for (let c = 0; c < COLS; c++) row.push(tiles[idx++]);
      this.grid.push(row);
    }

    this.selected = null;
    this.hintTiles = [];
    this.remaining = ROWS * COLS;
    this.startTime = null;
    this.elapsedSec = 0;
    this.isOver = false;
    this.hasStarted = false;
    this.hintUsed = 0;
    this.score = 0;

    this.clearTimers();
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    this.overlaySvg.innerHTML = '';

    this.render();
    this.updateInfo();
    this.scoreCb?.(0);
  }

  private shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  private bindInput() {
    window.addEventListener('keydown', this.keyHandler, { passive: false });
    this.boardEl.addEventListener('click', this.clickHandler);
  }

  private unbindInput() {
    window.removeEventListener('keydown', this.keyHandler);
    this.boardEl?.removeEventListener('click', this.clickHandler);
    this.root?.querySelector('.lk-hint')?.removeEventListener('click', this.hintClickHandler);
    this.root?.querySelector('.lk-shuffle')?.removeEventListener('click', this.shuffleClickHandler);
  }

  private handleKey(e: KeyboardEvent) {
    if (this.isOver) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
    const key = e.key;
    if (key === 'h' || key === 'H') {
      e.preventDefault();
      this.useHint();
    } else if (key === 's' || key === 'S') {
      e.preventDefault();
      this.shuffleTiles();
    }
  }

  private handleClick(e: Event) {
    const target = e.target as HTMLElement;
    const tileEl = target.closest('.lk-tile') as HTMLElement | null;
    if (!tileEl) return;
    const r = Number(tileEl.dataset.r);
    const c = Number(tileEl.dataset.c);
    if (Number.isNaN(r) || Number.isNaN(c)) return;
    if (this.grid[r][c] === null) return;

    if (!this.hasStarted) {
      this.hasStarted = true;
      this.startTime = Date.now();
      this.timerInterval = window.setInterval(() => this.tickTimer(), 1000);
    }

    this.selectTile(r, c);
  }

  private selectTile(r: number, c: number) {
    this.hintTiles = [];

    if (this.selected === null) {
      this.selected = { r, c };
      this.render();
      return;
    }

    if (this.selected.r === r && this.selected.c === c) {
      this.selected = null;
      this.render();
      return;
    }

    const prev = this.selected;
    if (this.grid[prev.r][prev.c] !== this.grid[r][c]) {
      this.selected = { r, c };
      this.render();
      return;
    }

    const path = this.canConnect(prev.r, prev.c, r, c);
    if (path) {
      this.matchPair(prev, { r, c }, path);
      this.selected = null;
    } else {
      this.selected = { r, c };
    }
    this.render();
  }

  private matchPair(p1: Point, p2: Point, path: Point[]) {
    this.grid[p1.r][p1.c] = null;
    this.grid[p2.r][p2.c] = null;
    this.remaining -= 2;

    this.drawConnectLine(path);
    this.updateInfo();
    this.updateLiveScore();

    if (this.remaining === 0) this.winGame();
  }

  private drawConnectLine(path: Point[]) {
    const points = path.map((p) => this.getCellCenter(p.r, p.c));
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

    this.overlaySvg.innerHTML = '';
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', d);
    pathEl.setAttribute('stroke', '#4ecca3');
    pathEl.setAttribute('stroke-width', '4');
    pathEl.setAttribute('fill', 'none');
    pathEl.setAttribute('stroke-linecap', 'round');
    pathEl.setAttribute('stroke-linejoin', 'round');
    pathEl.classList.add('lk-line-path');
    this.overlaySvg.appendChild(pathEl);

    if (this.lineTimer !== null) window.clearTimeout(this.lineTimer);
    this.lineTimer = window.setTimeout(() => {
      this.overlaySvg.innerHTML = '';
      this.lineTimer = null;
    }, 300);
  }

  private getCellCenter(r: number, c: number): { x: number; y: number } {
    const boardRect = this.boardEl.getBoundingClientRect();
    const sampleCell = this.boardEl.querySelector<HTMLElement>('.lk-tile');
    if (!sampleCell) return { x: 0, y: 0 };
    const sampleRect = sampleCell.getBoundingClientRect();
    const cellW = sampleRect.width;
    const cellH = sampleRect.height;
    const gap = 3; // 与 CSS gap 保持一致

    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
      const cell = this.boardEl.querySelector<HTMLElement>(
        `.lk-tile[data-r="${r}"][data-c="${c}"]`
      );
      if (cell) {
        const rect = cell.getBoundingClientRect();
        return {
          x: rect.left - boardRect.left + rect.width / 2,
          y: rect.top - boardRect.top + rect.height / 2,
        };
      }
    }

    // 外部点：基于最近的内部 cell 外推
    const rClamp = Math.max(0, Math.min(ROWS - 1, r));
    const cClamp = Math.max(0, Math.min(COLS - 1, c));
    const cell = this.boardEl.querySelector<HTMLElement>(
      `.lk-tile[data-r="${rClamp}"][data-c="${cClamp}"]`
    );
    if (!cell) return { x: 0, y: 0 };
    const rect = cell.getBoundingClientRect();
    const baseX = rect.left - boardRect.left + rect.width / 2;
    const baseY = rect.top - boardRect.top + rect.height / 2;
    return {
      x: baseX + (c - cClamp) * (cellW + gap),
      y: baseY + (r - rClamp) * (cellH + gap),
    };
  }

  private isWalkable(r: number, c: number): boolean {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return true;
    return this.grid[r][c] === null;
  }

  private isLineClear(r1: number, c1: number, r2: number, c2: number): boolean {
    if (!this.isWalkable(r1, c1) || !this.isWalkable(r2, c2)) return false;
    if (r1 === r2) {
      const minC = Math.min(c1, c2);
      const maxC = Math.max(c1, c2);
      for (let c = minC + 1; c < maxC; c++) {
        if (!this.isWalkable(r1, c)) return false;
      }
      return true;
    }
    if (c1 === c2) {
      const minR = Math.min(r1, r2);
      const maxR = Math.max(r1, r2);
      for (let r = minR + 1; r < maxR; r++) {
        if (!this.isWalkable(r, c1)) return false;
      }
      return true;
    }
    return false;
  }

  private canConnect(r1: number, c1: number, r2: number, c2: number): Point[] | null {
    // 0 转折：直线
    if (this.isLineClear(r1, c1, r2, c2)) {
      return [{ r: r1, c: c1 }, { r: r2, c: c2 }];
    }

    // 1 转折：两个可能的拐点
    if (
      this.isWalkable(r1, c2) &&
      this.isLineClear(r1, c1, r1, c2) &&
      this.isLineClear(r1, c2, r2, c2)
    ) {
      return [{ r: r1, c: c1 }, { r: r1, c: c2 }, { r: r2, c: c2 }];
    }
    if (
      this.isWalkable(r2, c1) &&
      this.isLineClear(r1, c1, r2, c1) &&
      this.isLineClear(r2, c1, r2, c2)
    ) {
      return [{ r: r1, c: c1 }, { r: r2, c: c1 }, { r: r2, c: c2 }];
    }

    // 2 转折：共享列
    for (let cMid = -1; cMid <= COLS; cMid++) {
      if (cMid === c1 || cMid === c2) continue;
      if (!this.isWalkable(r1, cMid) || !this.isWalkable(r2, cMid)) continue;
      if (
        this.isLineClear(r1, c1, r1, cMid) &&
        this.isLineClear(r1, cMid, r2, cMid) &&
        this.isLineClear(r2, cMid, r2, c2)
      ) {
        return [
          { r: r1, c: c1 }, { r: r1, c: cMid }, { r: r2, c: cMid }, { r: r2, c: c2 },
        ];
      }
    }

    // 2 转折：共享行
    for (let rMid = -1; rMid <= ROWS; rMid++) {
      if (rMid === r1 || rMid === r2) continue;
      if (!this.isWalkable(rMid, c1) || !this.isWalkable(rMid, c2)) continue;
      if (
        this.isLineClear(r1, c1, rMid, c1) &&
        this.isLineClear(rMid, c1, rMid, c2) &&
        this.isLineClear(rMid, c2, r2, c2)
      ) {
        return [
          { r: r1, c: c1 }, { r: rMid, c: c1 }, { r: rMid, c: c2 }, { r: r2, c: c2 },
        ];
      }
    }

    return null;
  }

  private useHint() {
    if (this.isOver) return;
    if (!this.hasStarted) {
      this.hasStarted = true;
      this.startTime = Date.now();
      this.timerInterval = window.setInterval(() => this.tickTimer(), 1000);
    }

    const tiles: { p: Point; emoji: string }[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c] !== null) {
          tiles.push({ p: { r, c }, emoji: this.grid[r][c]! });
        }
      }
    }

    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) {
        if (tiles[i].emoji === tiles[j].emoji) {
          const path = this.canConnect(
            tiles[i].p.r, tiles[i].p.c, tiles[j].p.r, tiles[j].p.c
          );
          if (path) {
            this.hintTiles = [tiles[i].p, tiles[j].p];
            this.hintUsed += 1;
            this.render();
            if (this.hintTimer !== null) window.clearTimeout(this.hintTimer);
            this.hintTimer = window.setTimeout(() => {
              this.hintTiles = [];
              this.render();
              this.hintTimer = null;
            }, 2000);
            return;
          }
        }
      }
    }
  }

  private shuffleTiles() {
    if (this.isOver) return;
    if (!this.hasStarted) {
      this.hasStarted = true;
      this.startTime = Date.now();
      this.timerInterval = window.setInterval(() => this.tickTimer(), 1000);
    }

    const remaining: string[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c] !== null) remaining.push(this.grid[r][c]!);
      }
    }
    this.shuffle(remaining);

    let idx = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c] !== null) {
          this.grid[r][c] = remaining[idx++] ?? null;
        }
      }
    }

    this.selected = null;
    this.hintTiles = [];
    this.render();
  }

  private tickTimer() {
    if (this.startTime === null) return;
    this.elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);
    this.updateInfo();
    this.updateLiveScore();

    if (this.elapsedSec >= TIME_LIMIT) this.endGame();
  }

  private updateInfo() {
    if (this.remainingEl) this.remainingEl.textContent = `剩余: ${this.remaining}`;
    if (this.timerEl) {
      const remaining_time = Math.max(0, TIME_LIMIT - this.elapsedSec);
      this.timerEl.textContent = `⏱ ${remaining_time}`;
    }
  }

  private computeScore(): number {
    return Math.max(100, 2000 - this.elapsedSec * 3);
  }

  private updateLiveScore() {
    if (this.remaining === 0) return;
    this.scoreCb?.(this.computeScore());
  }

  private winGame() {
    this.isOver = true;
    this.clearTimers();

    const finalScore = this.computeScore();
    this.score = finalScore;
    this.scoreCb?.(finalScore);

    storage.recordScore(GAME_ID, finalScore);
    storage.markPlayed(GAME_ID);

    this.unlockAch('liankan_clear');
    if (this.hintUsed === 0) this.unlockAch('liankan_no_hint');
    if (this.elapsedSec <= 180) this.unlockAch('liankan_time_180s');

    const newly = checkMilestones(storage.load());
    for (const id of newly) {
      storage.markMilestone(id);
      this.eventCb?.('milestone-reached', id);
    }

    this.showOverlay(finalScore, true);
  }

  private endGame() {
    if (this.isOver) return;
    this.isOver = true;
    this.clearTimers();

    storage.recordScore(GAME_ID, 0);
    storage.markPlayed(GAME_ID);

    const newly = checkMilestones(storage.load());
    for (const id of newly) {
      storage.markMilestone(id);
      this.eventCb?.('milestone-reached', id);
    }

    this.showOverlay(0, false);
  }

  private unlockAch(id: string) {
    const isNew = storage.unlock(id);
    if (isNew) this.eventCb?.('achievement-unlocked', id);
  }

  private showOverlay(score: number, won: boolean) {
    if (this.overlayEl) this.overlayEl.remove();
    const overlay = document.createElement('div');
    overlay.className = 'lk-overlay';
    overlay.innerHTML = won
      ? `
        <h3>🎉 通关！</h3>
        <p>得分 ${score}</p>
        <p class="lk-overlay-stats">用时 ${this.elapsedSec}s · 提示 ${this.hintUsed}</p>
        <div class="lk-overlay-actions">
          <button class="btn-primary" data-action="restart">再来一局</button>
        </div>
      `
      : `
        <h3>⏰ 时间到</h3>
        <p>剩余 ${this.remaining} 块未消除</p>
        <div class="lk-overlay-actions">
          <button class="btn-primary" data-action="restart">再来一局</button>
        </div>
      `;
    this.boardEl.parentElement!.appendChild(overlay);
    this.overlayEl = overlay;

    overlay.querySelector('[data-action=restart]')?.addEventListener('click', () => {
      overlay.remove();
      this.overlayEl = null;
      this.newGame();
    });
  }

  private render() {
    this.boardEl.innerHTML = '';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const tile = this.grid[r][c];
        const el = document.createElement('div');
        el.className = 'lk-tile';
        el.dataset.r = String(r);
        el.dataset.c = String(c);

        if (tile === null) {
          el.classList.add('lk-tile-empty');
        } else {
          el.textContent = tile;
        }

        if (this.selected && this.selected.r === r && this.selected.c === c) {
          el.classList.add('lk-tile-selected');
        }
        if (this.hintTiles.some((p) => p.r === r && p.c === c)) {
          el.classList.add('lk-tile-hint');
        }

        this.boardEl.appendChild(el);
      }
    }
  }

  private clearTimers() {
    if (this.timerInterval !== null) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.lineTimer !== null) {
      window.clearTimeout(this.lineTimer);
      this.lineTimer = null;
    }
    if (this.hintTimer !== null) {
      window.clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
  }

  destroy(): void {
    this.unbindInput();
    this.clearTimers();
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    if (!this.isOver && this.hasStarted) {
      storage.recordScore(GAME_ID, 0);
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
    return '点击两个相同图案，若可用最多两个转折的折线连接即可消除。H 提示，S 洗牌，5 分钟内全部消除通关';
  }
}
