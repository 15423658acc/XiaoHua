/**
 * 连连看 —— 实现 GameInstance 接口
 *
 * 渲染：DOM + CSS Grid + SVG 连线
 * 输入：点击牌格；提示/洗牌按钮采用 click + touchend 双绑定（防移动端 300ms 延迟 / 失效）
 * 计分：每关 Math.max(100, 2000 - 用时秒数 * 3)，5 关总分累加
 * 成就：通关任意一关 / 通关第 3 关 / 通关全部 5 关 / 不使用提示通关全部 5 关 / 第 1 关 90 秒内通关
 *
 * 关卡：5 关递增（4x4 → 6x6 → 6x8 → 8x8 → 8x10），每关时间独立，每次重进从第 1 关开始
 * 路径规则：最多 2 个转折点，可绕到棋盘外
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';

const GAME_ID = 'liankan';

interface LevelConfig {
  rows: number;
  cols: number;
  timeLimit: number; // 秒
}

// 5 关递增：从 4x4 教程关到 8x10 终极关
const LEVELS: LevelConfig[] = [
  { rows: 4, cols: 4, timeLimit: 120 },  // 第 1 关：16 牌 / 8 对（教程关）
  { rows: 6, cols: 6, timeLimit: 180 },  // 第 2 关：36 牌 / 18 对
  { rows: 6, cols: 8, timeLimit: 240 },  // 第 3 关：48 牌 / 24 对
  { rows: 8, cols: 8, timeLimit: 300 },  // 第 4 关：64 牌 / 32 对
  { rows: 8, cols: 10, timeLimit: 360 }, // 第 5 关：80 牌 / 40 对（原难度）
];

// 水果食物 emoji 池（足够 40 对）
const EMOJIS = [
  '🍎', '🍌', '🍊', '🍋', '🍇', '🍓', '🍑', '🍒', '🍉', '🍐',
  '🥝', '🍍', '🥥', '🥑', '🍅', '🥕', '🌽', '🥦', '🍔', '🍟',
  '🍕', '🌭', '🥪', '🌮', '🍣', '🍱', '🍙', '🍚', '🍜', '🍲',
  '🍰', '🎂', '🍪', '🍩', '🍫', '🍬', '🍭', '🍮', '☕', '🍵',
];

interface Point {
  r: number;
  c: number;
}

export function LiankanFactory(): GameInstance {
  return new Liankan();
}

class Liankan implements GameInstance {
  private root!: HTMLElement;
  private boardEl!: HTMLElement;
  private boardWrapEl!: HTMLElement;
  private overlaySvg!: SVGSVGElement;
  private remainingEl: HTMLElement | null = null;
  private timerEl: HTMLElement | null = null;
  private levelEl: HTMLElement | null = null;

  private grid: (string | null)[][] = [];
  private selected: Point | null = null;
  private hintTiles: Point[] = [];
  // 消除动画进行中：保留 emoji + 加 lk-tile-vanish 动画 class
  private matchingTiles: { p: Point; emoji: string }[] = [];

  private rows = 0;
  private cols = 0;
  private timeLimit = 0;
  private levelIndex = 0;
  private remaining = 0;
  private startTime: number | null = null;
  private elapsedSec = 0;
  private timerInterval: number | null = null;
  private lineTimer: number | null = null;
  private hintTimer: number | null = null;
  private matchTimer: number | null = null;

  private isOver = false;       // 全局结束（全部通关或彻底退出）
  private levelEnded = false;   // 当前关已结束（通关 / 失败），阻塞输入
  private hasStarted = false;   // 当前关已开始计时
  private hintUsed = 0;         // 整局累计使用提示次数
  private totalScore = 0;       // 5 关总分累加
  private overlayEl: HTMLElement | null = null;

  private scoreCb: ((s: number) => void) | null = null;
  private eventCb: ((e: string, p?: unknown) => void) | null = null;

  private keyHandler = (e: KeyboardEvent) => this.handleKey(e);
  private clickHandler = (e: Event) => this.handleClick(e);

  // 移动端按钮：同时绑定 click + touchend，标志位防重复触发
  private lastButtonTs = 0;
  private hintClickHandler = (e: Event) => this.onHintButton(e);
  private hintTouchHandler = (e: TouchEvent) => this.onHintButton(e);
  private shuffleClickHandler = (e: Event) => this.onShuffleButton(e);
  private shuffleTouchHandler = (e: TouchEvent) => this.onShuffleButton(e);

  start(container: HTMLElement): void {
    this.root = container;
    this.root.innerHTML = `
      <div class="lk-wrap">
        <div class="lk-header">
          <span class="lk-level">第 1 关 / 共 ${LEVELS.length} 关</span>
          <span class="lk-remaining">剩余: 0</span>
          <span class="lk-timer">⏱ 0</span>
          <button class="lk-hint" type="button">提示(H)</button>
          <button class="lk-shuffle" type="button">洗牌(S)</button>
        </div>
        <div class="lk-board-wrap">
          <div class="lk-board" id="lk-board"></div>
          <svg class="lk-line-overlay" id="lk-line-overlay" xmlns="http://www.w3.org/2000/svg"></svg>
        </div>
      </div>
    `;
    this.boardEl = this.root.querySelector('#lk-board')!;
    this.boardWrapEl = this.root.querySelector('.lk-board-wrap')!;
    this.overlaySvg = this.root.querySelector('#lk-line-overlay')!;
    this.remainingEl = this.root.querySelector('.lk-remaining');
    this.timerEl = this.root.querySelector('.lk-timer');
    this.levelEl = this.root.querySelector('.lk-level');

    this.bindButton(this.root.querySelector('.lk-hint'), this.hintClickHandler, this.hintTouchHandler);
    this.bindButton(this.root.querySelector('.lk-shuffle'), this.shuffleClickHandler, this.shuffleTouchHandler);

    // 每次重进都从第 1 关开始，不续接上次进度
    this.totalScore = 0;
    this.hintUsed = 0;
    this.isOver = false;
    this.loadLevel(0);
    this.bindInput();
    this.scoreCb?.(0);
  }

  private bindButton(
    el: HTMLElement | null,
    click: (e: Event) => void,
    touch: (e: TouchEvent) => void
  ): void {
    if (!el) return;
    el.addEventListener('click', click);
    el.addEventListener('touchend', touch, { passive: false });
  }

  private unbindButton(
    el: HTMLElement | null,
    click: (e: Event) => void,
    touch: (e: TouchEvent) => void
  ): void {
    if (!el) return;
    el.removeEventListener('click', click);
    el.removeEventListener('touchend', touch);
  }

  private onHintButton(e: Event) {
    e.preventDefault();
    const now = Date.now();
    if (now - this.lastButtonTs < 400) return; // 防重复触发
    this.lastButtonTs = now;
    this.useHint();
  }

  private onShuffleButton(e: Event) {
    e.preventDefault();
    const now = Date.now();
    if (now - this.lastButtonTs < 400) return; // 防重复触发
    this.lastButtonTs = now;
    this.shuffleTiles();
  }

  private loadLevel(idx: number) {
    const cfg = LEVELS[idx];
    this.levelIndex = idx;
    this.rows = cfg.rows;
    this.cols = cfg.cols;
    this.timeLimit = cfg.timeLimit;
    this.levelEnded = false;

    const totalTiles = this.rows * this.cols;
    const pairs = totalTiles / 2;

    const tiles: string[] = [];
    for (let i = 0; i < pairs; i++) {
      tiles.push(EMOJIS[i]);
      tiles.push(EMOJIS[i]);
    }
    this.shuffle(tiles);

    this.grid = [];
    let t = 0;
    for (let r = 0; r < this.rows; r++) {
      const row: (string | null)[] = [];
      for (let c = 0; c < this.cols; c++) row.push(tiles[t++]);
      this.grid.push(row);
    }

    this.selected = null;
    this.hintTiles = [];
    this.matchingTiles = [];
    this.remaining = totalTiles;
    this.startTime = null;
    this.elapsedSec = 0;
    this.hasStarted = false;

    this.clearLevelTimers();
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    this.overlaySvg.innerHTML = '';

    // 动态设置网格尺寸：列/行 aspect-ratio + grid-template，字号随关卡调整
    this.boardWrapEl.style.aspectRatio = `${this.cols} / ${this.rows}`;
    this.boardEl.style.gridTemplateColumns = `repeat(${this.cols}, 1fr)`;
    this.boardEl.style.gridTemplateRows = `repeat(${this.rows}, 1fr)`;
    this.boardEl.dataset.level = String(idx + 1);

    this.render();
    this.updateInfo();
    this.scoreCb?.(this.totalScore);
  }

  private restartGame() {
    this.totalScore = 0;
    this.hintUsed = 0;
    this.isOver = false;
    this.loadLevel(0);
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
    this.unbindButton(
      this.root?.querySelector('.lk-hint') ?? null,
      this.hintClickHandler,
      this.hintTouchHandler
    );
    this.unbindButton(
      this.root?.querySelector('.lk-shuffle') ?? null,
      this.shuffleClickHandler,
      this.shuffleTouchHandler
    );
  }

  private handleKey(e: KeyboardEvent) {
    if (this.levelEnded || this.isOver) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
    const key = e.key;
    if (key === 'h' || key === 'H') {
      e.preventDefault();
      this.onHintButton(e);
    } else if (key === 's' || key === 'S') {
      e.preventDefault();
      this.onShuffleButton(e);
    }
  }

  private handleClick(e: Event) {
    if (this.levelEnded || this.isOver) return;
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
    const emoji = this.grid[p1.r][p1.c]!;
    this.grid[p1.r][p1.c] = null;
    this.grid[p2.r][p2.c] = null;
    this.remaining -= 2;

    // 暂存消除动画数据：render 时这两个位置仍显示 emoji + 加 vanish 动画 class
    this.matchingTiles = [
      { p: p1, emoji },
      { p: p2, emoji },
    ];

    this.drawConnectLine(path);
    this.updateInfo();
    this.updateLiveScore();

    // 最后一对：立即锁定状态并停计时器，防止动画期间触发失败
    if (this.remaining === 0) {
      this.levelEnded = true;
      if (this.timerInterval !== null) {
        window.clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
    }

    if (this.matchTimer !== null) window.clearTimeout(this.matchTimer);
    this.matchTimer = window.setTimeout(() => {
      this.matchingTiles = [];
      this.matchTimer = null;
      this.render();
      if (this.remaining === 0) this.winLevel();
    }, 450);
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
    }, 500); // 从 300ms 延长到 500ms，给用户更清晰的消除反馈
  }

  private getCellCenter(r: number, c: number): { x: number; y: number } {
    const boardRect = this.boardEl.getBoundingClientRect();
    const sampleCell = this.boardEl.querySelector<HTMLElement>('.lk-tile');
    if (!sampleCell) return { x: 0, y: 0 };
    const sampleRect = sampleCell.getBoundingClientRect();
    const cellW = sampleRect.width;
    const cellH = sampleRect.height;
    const gap = 3; // 与 CSS gap 保持一致

    if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) {
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
    const rClamp = Math.max(0, Math.min(this.rows - 1, r));
    const cClamp = Math.max(0, Math.min(this.cols - 1, c));
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
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return true;
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
    for (let cMid = -1; cMid <= this.cols; cMid++) {
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
    for (let rMid = -1; rMid <= this.rows; rMid++) {
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
    if (this.levelEnded || this.isOver) return;
    if (!this.hasStarted) {
      this.hasStarted = true;
      this.startTime = Date.now();
      this.timerInterval = window.setInterval(() => this.tickTimer(), 1000);
    }

    const tiles: { p: Point; emoji: string }[] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
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
    if (this.levelEnded || this.isOver) return;
    if (!this.hasStarted) {
      this.hasStarted = true;
      this.startTime = Date.now();
      this.timerInterval = window.setInterval(() => this.tickTimer(), 1000);
    }

    const remaining: string[] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c] !== null) remaining.push(this.grid[r][c]!);
      }
    }
    this.shuffle(remaining);

    let idx = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
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
    if (this.levelEnded || this.isOver) return;
    if (this.startTime === null) return;
    this.elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);
    this.updateInfo();
    this.updateLiveScore();

    if (this.elapsedSec >= this.timeLimit) this.failLevel();
  }

  private updateInfo() {
    if (this.remainingEl) this.remainingEl.textContent = `剩余: ${this.remaining}`;
    if (this.timerEl) {
      const rem = Math.max(0, this.timeLimit - this.elapsedSec);
      this.timerEl.textContent = `⏱ ${rem}`;
    }
    if (this.levelEl) {
      this.levelEl.textContent = `第 ${this.levelIndex + 1} 关 / 共 ${LEVELS.length} 关`;
    }
  }

  private computeLevelScore(): number {
    return Math.max(100, 2000 - this.elapsedSec * 3);
  }

  private updateLiveScore() {
    if (this.levelEnded) return;
    if (this.remaining === 0) return;
    const live = this.totalScore + (this.hasStarted ? this.computeLevelScore() : 0);
    this.scoreCb?.(live);
  }

  private winLevel() {
    this.levelEnded = true;
    this.clearLevelTimers();

    const levelScore = this.computeLevelScore();
    this.totalScore += levelScore;
    this.scoreCb?.(this.totalScore);

    // 成就：任意一关通关（原 liankan_clear，仍保留触发）
    this.unlockAch('liankan_clear');
    // 成就：通关第 3 关
    if (this.levelIndex >= 2) this.unlockAch('liankan_clear_3');
    // 成就：第 1 关 90 秒内通关
    if (this.levelIndex === 0 && this.elapsedSec <= 90) this.unlockAch('liankan_time_180s');

    // 处理里程碑
    const newly = checkMilestones(storage.load());
    for (const id of newly) {
      storage.markMilestone(id);
      this.eventCb?.('milestone-reached', id);
    }

    const isLast = this.levelIndex + 1 >= LEVELS.length;
    if (isLast) {
      // 全部通关：记录总分、标记游玩、触发最终成就
      this.isOver = true;
      storage.recordScore(GAME_ID, this.totalScore);
      storage.markPlayed(GAME_ID);
      this.unlockAch('liankan_clear_all');
      if (this.hintUsed === 0) this.unlockAch('liankan_no_hint');

      const newlyFinal = checkMilestones(storage.load());
      for (const id of newlyFinal) {
        storage.markMilestone(id);
        this.eventCb?.('milestone-reached', id);
      }

      this.showLevelOverlay({
        title: '🎉 全部通关！',
        levelScore,
        totalScore: this.totalScore,
        actions: [{ label: '再来一次', action: 'restart' }],
      });
    } else {
      this.showLevelOverlay({
        title: `第 ${this.levelIndex + 1} 关通过`,
        levelScore,
        totalScore: this.totalScore,
        actions: [{ label: '下一关', action: 'next' }],
      });
    }
  }

  private failLevel() {
    this.levelEnded = true;
    this.clearLevelTimers();

    // 失败不记录分数（用户可重试本关或回到第 1 关）
    this.showLevelOverlay({
      title: `⏰ 时间到，第 ${this.levelIndex + 1} 关失败`,
      levelScore: 0,
      totalScore: this.totalScore,
      actions: [
        { label: '重试本关', action: 'retry' },
        { label: '回到第 1 关', action: 'restart' },
      ],
    });
  }

  private unlockAch(id: string) {
    const isNew = storage.unlock(id);
    if (isNew) this.eventCb?.('achievement-unlocked', id);
  }

  private showLevelOverlay(opts: {
    title: string;
    levelScore: number;
    totalScore: number;
    actions: { label: string; action: string }[];
  }) {
    if (this.overlayEl) this.overlayEl.remove();
    const overlay = document.createElement('div');
    overlay.className = 'lk-overlay';
    const stats = `用时 ${this.elapsedSec}s · 提示 ${this.hintUsed}`;
    const actionsHtml = opts.actions
      .map(
        (a) =>
          `<button class="btn-primary" data-action="${a.action}" type="button">${a.label}</button>`
      )
      .join('');
    overlay.innerHTML = `
      <h3>${opts.title}</h3>
      <p>本关得分 ${opts.levelScore}</p>
      <p>总分 ${opts.totalScore}</p>
      <p class="lk-overlay-stats">${stats}</p>
      <div class="lk-overlay-actions">${actionsHtml}</div>
    `;
    this.boardWrapEl.appendChild(overlay);
    this.overlayEl = overlay;

    overlay.querySelector('[data-action="next"]')?.addEventListener('click', () => {
      this.closeOverlay();
      this.loadLevel(this.levelIndex + 1);
    });
    overlay.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
      this.closeOverlay();
      this.loadLevel(this.levelIndex);
    });
    overlay.querySelector('[data-action="restart"]')?.addEventListener('click', () => {
      this.closeOverlay();
      this.restartGame();
    });
  }

  private closeOverlay() {
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
  }

  private render() {
    this.boardEl.innerHTML = '';
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const tile = this.grid[r][c];
        const el = document.createElement('div');
        el.className = 'lk-tile';
        el.dataset.r = String(r);
        el.dataset.c = String(c);

        const matchInfo = this.matchingTiles.find((m) => m.p.r === r && m.p.c === c);
        if (tile === null) {
          if (matchInfo) {
            // 消除动画进行中：保留 emoji 并加上 vanish 动画 class
            el.textContent = matchInfo.emoji;
            el.classList.add('lk-tile-vanish');
          } else {
            el.classList.add('lk-tile-empty');
          }
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

  private clearLevelTimers() {
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
    if (this.matchTimer !== null) {
      window.clearTimeout(this.matchTimer);
      this.matchTimer = null;
    }
  }

  destroy(): void {
    this.unbindInput();
    this.clearLevelTimers();
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    // 中途退出：若已有累积分数则记录
    if (!this.isOver && this.totalScore > 0) {
      storage.recordScore(GAME_ID, this.totalScore);
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
    return "点击两张相同图案的牌，若可用最多 2 个转折的折线（可绕到棋盘外）连接即可消除。消除全部牌即通关。点错牌会切换为新选择。H 键或点'提示'按钮可显示一对可消除的牌（2 秒），S 键或点'洗牌'按钮重排剩余牌。每关时间独立，从第 1 关开始递增难度。";
  }
}
