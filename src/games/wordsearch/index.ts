/**
 * 单词搜索（Word Search）游戏 —— 实现 GameInstance 接口
 *
 * 渲染：DOM + CSS Grid（每关尺寸递增）
 * 输入：鼠标拖拽 / 触屏拖拽
 * 计分：找到一个单词 +10 × 关卡数，全部找完一关 +50 奖励
 * 成就：通关第 1 关 / 第 3 关 / 全部 5 关 / 全部 5 关零错误
 *
 * 每次重进都从第 1 关开始，不续接上次进度。
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';

interface Pos {
  r: number;
  c: number;
}
interface Placement {
  word: string;
  found: boolean;
  cells: Pos[];
}
interface LevelConfig {
  size: number;
  words: number;
  minLen: number;
  maxLen: number;
}

const LEVELS: LevelConfig[] = [
  { size: 8, words: 5, minLen: 3, maxLen: 4 },
  { size: 10, words: 6, minLen: 4, maxLen: 5 },
  { size: 12, words: 7, minLen: 5, maxLen: 6 },
  { size: 14, words: 8, minLen: 5, maxLen: 7 },
  { size: 16, words: 10, minLen: 6, maxLen: 8 },
];

// 词库：英文常用词。前 20 个为规格给出的示例；
// 后 10 个为补充的 6 字母词，用于第 5 关（16x16 / 10 词 / 6-8 字母）的候选池
const WORD_BANK: readonly string[] = [
  'CODE', 'GAME', 'PLAY', 'WORD', 'FIND', 'LEVEL', 'SCORE', 'GRID', 'PUZZLE', 'SEARCH',
  'MATCH', 'LINE', 'BOARD', 'LETTER', 'PLAYER', 'HOBBY', 'CHALLENGE', 'VICTORY', 'COMPLETE', 'DISCOVER',
  'MEMORY', 'PLANET', 'ROCKET', 'CASTLE', 'FOREST', 'SILVER', 'ORANGE', 'PURPLE', 'GUITAR', 'WINTER',
];

// 8 个方向：[行步进, 列步进]
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
  [1, 1], [-1, -1], [1, -1], [-1, 1],
];

const GAME_ID = 'wordsearch';

export function WordsearchFactory(): GameInstance {
  return new Wordsearch();
}

class Wordsearch implements GameInstance {
  private root!: HTMLElement;
  private boardEl!: HTMLElement;
  private wordsListEl!: HTMLElement;
  private levelInfoEl!: HTMLElement;
  private progressEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private overlayEl: HTMLElement | null = null;

  private size = 0;
  private grid: string[][] = [];
  private placements: Placement[] = [];
  private cellEls: HTMLElement[][] = [];
  private levelIndex = 0;
  private score = 0;
  private wrongCount = 0; // 整个会话内累计错误提交次数
  private isOver = false;
  private isTransitioning = false;

  private startCell: Pos | null = null;
  private endCell: Pos | null = null;

  private scoreCb: ((s: number) => void) | null = null;
  private eventCb: ((e: string, p?: unknown) => void) | null = null;

  // 箭头函数字段：保留 this 绑定，便于 add/removeEventListener
  private mouseDownHandler = (e: MouseEvent) => this.handleMouseDown(e);
  private mouseMoveHandler = (e: MouseEvent) => this.handleMouseMove(e);
  private mouseUpHandler = (e: MouseEvent) => this.handleMouseUp(e);
  private mouseLeaveHandler = (e: MouseEvent) => this.handleMouseLeave(e);
  private touchStartHandler = (e: TouchEvent) => this.handleTouchStart(e);
  private touchMoveHandler = (e: TouchEvent) => this.handleTouchMove(e);
  private touchEndHandler = (e: TouchEvent) => this.handleTouchEnd(e);

  start(container: HTMLElement): void {
    this.root = container;
    this.root.innerHTML = `
      <div class="ws-wrap">
        <div class="ws-instructions">
          按住鼠标或手指在网格上拖出直线（横 / 竖 / 斜），找出隐藏的单词
        </div>
        <div class="ws-header">
          <span class="ws-level-info" id="ws-level-info">第 1 关 / 共 5 关</span>
          <span class="ws-progress" id="ws-progress">已找到 0 / 0</span>
        </div>
        <div class="ws-main">
          <aside class="ws-words">
            <div class="ws-words-title">单词列表</div>
            <ul class="ws-words-list" id="ws-words-list"></ul>
          </aside>
          <div class="ws-grid-wrap">
            <div class="ws-grid" id="ws-grid"></div>
            <div class="ws-preview" id="ws-preview"></div>
          </div>
        </div>
      </div>
    `;
    this.levelInfoEl = this.root.querySelector('#ws-level-info')!;
    this.progressEl = this.root.querySelector('#ws-progress')!;
    this.wordsListEl = this.root.querySelector('#ws-words-list')!;
    this.boardEl = this.root.querySelector('#ws-grid')!;
    this.previewEl = this.root.querySelector('#ws-preview')!;

    // 每次重进都从第 1 关开始，不续接上次进度
    this.score = 0;
    this.wrongCount = 0;
    this.levelIndex = 0;
    this.isOver = false;
    this.isTransitioning = false;
    this.startCell = null;
    this.endCell = null;

    this.loadLevel(0);
    this.bindInput();
    this.scoreCb?.(this.score);
  }

  // ====== 关卡生成 ======

  private loadLevel(idx: number) {
    this.levelIndex = idx;
    this.startCell = null;
    this.endCell = null;
    const data = this.generateLevel(idx);
    this.size = data.size;
    this.grid = data.grid;
    this.placements = data.placements;
    this.renderBoard();
    this.renderWords();
    this.updateHeader();
    this.updatePreview('');
  }

  private generateLevel(idx: number): { size: number; grid: string[][]; placements: Placement[] } {
    const cfg = LEVELS[idx];
    const size = cfg.size;

    // 候选词：长度在范围内且长度不超过网格尺寸
    let candidates = WORD_BANK.filter(
      (w) => w.length >= cfg.minLen && w.length <= cfg.maxLen && w.length <= size
    );
    // 兜底：候选不足时放宽到任意长度 ≤ size 的词（保证不会卡住）
    if (candidates.length < cfg.words) {
      candidates = WORD_BANK.filter((w) => w.length <= size);
    }

    // 多次尝试整体布局（不同的词选择 + 不同的位置组合）
    for (let attempt = 0; attempt < 200; attempt++) {
      const pool = this.shuffle(candidates.slice());
      const selected = pool.slice(0, cfg.words);

      const grid: string[][] = Array.from({ length: size }, () =>
        Array<string>(size).fill('')
      );
      const placements: Placement[] = [];
      let allPlaced = true;

      for (const word of selected) {
        const p = this.tryPlaceWord(grid, word, size);
        if (!p) {
          allPlaced = false;
          break;
        }
        placements.push(p);
      }

      if (allPlaced) {
        // 剩余空格填随机大写字母
        for (let r = 0; r < size; r++) {
          for (let c = 0; c < size; c++) {
            if (grid[r][c] === '') {
              grid[r][c] = String.fromCharCode(65 + Math.floor(Math.random() * 26));
            }
          }
        }
        return { size, grid, placements };
      }
    }

    // 极端兜底：尽力放置能放的词（理论上不会到这里）
    const grid: string[][] = Array.from({ length: size }, () =>
      Array<string>(size).fill('')
    );
    const placements: Placement[] = [];
    const pool = this.shuffle(candidates.slice());
    for (const word of pool) {
      if (placements.length >= cfg.words) break;
      const p = this.tryPlaceWord(grid, word, size);
      if (p) placements.push(p);
    }
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === '') {
          grid[r][c] = String.fromCharCode(65 + Math.floor(Math.random() * 26));
        }
      }
    }
    return { size, grid, placements };
  }

  private shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // 枚举所有 (r, c, dir) 组合并随机打乱，尝试第一个能放的位置
  private tryPlaceWord(
    grid: string[][],
    word: string,
    size: number
  ): Placement | null {
    const options: { r: number; c: number; dir: readonly [number, number] }[] = [];
    for (const dir of DIRECTIONS) {
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          options.push({ r, c, dir });
        }
      }
    }
    this.shuffle(options);

    for (const o of options) {
      if (this.canPlace(grid, word, o.r, o.c, o.dir, size)) {
        const cells = this.computeCells(o.r, o.c, o.dir, word.length);
        for (let i = 0; i < word.length; i++) {
          grid[cells[i].r][cells[i].c] = word[i];
        }
        return { word, found: false, cells };
      }
    }
    return null;
  }

  private canPlace(
    grid: string[][],
    word: string,
    r: number,
    c: number,
    dir: readonly [number, number],
    size: number
  ): boolean {
    const [dr, dc] = dir;
    for (let i = 0; i < word.length; i++) {
      const nr = r + dr * i;
      const nc = c + dc * i;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) return false;
      const cell = grid[nr][nc];
      if (cell !== '' && cell !== word[i]) return false;
    }
    return true;
  }

  private computeCells(
    r: number,
    c: number,
    dir: readonly [number, number],
    len: number
  ): Pos[] {
    const [dr, dc] = dir;
    const cells: Pos[] = [];
    for (let i = 0; i < len; i++) {
      cells.push({ r: r + dr * i, c: c + dc * i });
    }
    return cells;
  }

  // ====== 渲染 ======

  private renderBoard() {
    this.boardEl.innerHTML = '';
    this.boardEl.style.gridTemplateColumns = `repeat(${this.size}, 1fr)`;
    this.boardEl.style.gridTemplateRows = `repeat(${this.size}, 1fr)`;
    this.cellEls = [];
    for (let r = 0; r < this.size; r++) {
      const row: HTMLElement[] = [];
      for (let c = 0; c < this.size; c++) {
        const cell = document.createElement('div');
        cell.className = 'ws-cell';
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        cell.textContent = this.grid[r][c];
        this.boardEl.appendChild(cell);
        row.push(cell);
      }
      this.cellEls.push(row);
    }
  }

  private renderWords() {
    this.wordsListEl.innerHTML = '';
    for (const p of this.placements) {
      const li = document.createElement('li');
      li.className = 'ws-word';
      if (p.found) li.classList.add('found');
      li.textContent = p.word;
      this.wordsListEl.appendChild(li);
    }
  }

  private updateHeader() {
    this.levelInfoEl.textContent = `第 ${this.levelIndex + 1} 关 / 共 ${LEVELS.length} 关`;
    const found = this.placements.filter((p) => p.found).length;
    this.progressEl.textContent = `已找到 ${found} / ${this.placements.length}`;
  }

  private updatePreview(text: string) {
    this.previewEl.textContent = text;
    this.previewEl.classList.toggle('active', text.length > 0);
  }

  // ====== 事件绑定 ======

  private bindInput() {
    this.boardEl.addEventListener('mousedown', this.mouseDownHandler);
    this.boardEl.addEventListener('mousemove', this.mouseMoveHandler);
    this.boardEl.addEventListener('mouseup', this.mouseUpHandler);
    this.boardEl.addEventListener('mouseleave', this.mouseLeaveHandler);
    this.boardEl.addEventListener('touchstart', this.touchStartHandler, { passive: false });
    this.boardEl.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
    this.boardEl.addEventListener('touchend', this.touchEndHandler, { passive: false });
  }

  private unbindInput() {
    this.boardEl.removeEventListener('mousedown', this.mouseDownHandler);
    this.boardEl.removeEventListener('mousemove', this.mouseMoveHandler);
    this.boardEl.removeEventListener('mouseup', this.mouseUpHandler);
    this.boardEl.removeEventListener('mouseleave', this.mouseLeaveHandler);
    this.boardEl.removeEventListener('touchstart', this.touchStartHandler);
    this.boardEl.removeEventListener('touchmove', this.touchMoveHandler);
    this.boardEl.removeEventListener('touchend', this.touchEndHandler);
  }

  // ====== 鼠标 ======

  private handleMouseDown(e: MouseEvent) {
    if (this.isOver || this.isTransitioning) return;
    const cell = this.cellFromEvent(e);
    if (!cell) return;
    e.preventDefault();
    this.startCell = { ...cell };
    this.endCell = { ...cell };
    this.updateSelectionHighlight();
  }

  private handleMouseMove(e: MouseEvent) {
    if (!this.startCell || this.isOver || this.isTransitioning) return;
    const cell = this.cellFromEvent(e);
    if (!cell) return;
    if (this.endCell && this.endCell.r === cell.r && this.endCell.c === cell.c) return;
    if (this.isStraightLine(this.startCell, cell)) {
      this.endCell = { ...cell };
      this.updateSelectionHighlight();
    }
  }

  private handleMouseUp(_e: MouseEvent) {
    if (!this.startCell) return;
    this.submitSelection();
    this.startCell = null;
    this.endCell = null;
  }

  private handleMouseLeave(_e: MouseEvent) {
    // 离开网格视为放弃当前选择（不提交，避免误判）
    if (!this.startCell) return;
    this.startCell = null;
    this.endCell = null;
    this.clearSelectionHighlight();
  }

  // ====== 触屏 ======

  private handleTouchStart(e: TouchEvent) {
    if (this.isOver || this.isTransitioning) return;
    if (e.touches.length !== 1) return;
    const cell = this.cellFromTouch(e.touches[0]);
    if (!cell) return;
    e.preventDefault();
    this.startCell = { ...cell };
    this.endCell = { ...cell };
    this.updateSelectionHighlight();
  }

  private handleTouchMove(e: TouchEvent) {
    if (!this.startCell || this.isOver || this.isTransitioning) return;
    if (e.touches.length !== 1) return;
    e.preventDefault();
    const cell = this.cellFromTouch(e.touches[0]);
    if (!cell) return;
    if (this.endCell && this.endCell.r === cell.r && this.endCell.c === cell.c) return;
    if (this.isStraightLine(this.startCell, cell)) {
      this.endCell = { ...cell };
      this.updateSelectionHighlight();
    }
  }

  private handleTouchEnd(e: TouchEvent) {
    if (!this.startCell) return;
    e.preventDefault();
    this.submitSelection();
    this.startCell = null;
    this.endCell = null;
  }

  // ====== 工具：从事件定位格子 ======

  private cellFromEvent(e: MouseEvent): Pos | null {
    const el = (e.target as HTMLElement | null)?.closest('.ws-cell') as HTMLElement | null;
    if (!el) return null;
    return this.cellFromEl(el);
  }

  private cellFromTouch(t: Touch): Pos | null {
    const el = document.elementFromPoint(t.clientX, t.clientY);
    const cell = el?.closest('.ws-cell') as HTMLElement | null;
    if (!cell) return null;
    return this.cellFromEl(cell);
  }

  private cellFromEl(el: HTMLElement): Pos | null {
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);
    if (Number.isNaN(r) || Number.isNaN(c)) return null;
    return { r, c };
  }

  // ====== 选词逻辑 ======

  private isStraightLine(a: Pos, b: Pos): boolean {
    if (a.r === b.r && a.c === b.c) return true; // 同格
    if (a.r === b.r) return true; // 水平
    if (a.c === b.c) return true; // 垂直
    if (Math.abs(a.r - b.r) === Math.abs(a.c - b.c)) return true; // 45° 对角
    return false;
  }

  private buildPath(a: Pos, b: Pos): Pos[] {
    const dr = Math.sign(b.r - a.r);
    const dc = Math.sign(b.c - a.c);
    const path: Pos[] = [];
    let r = a.r;
    let c = a.c;
    path.push({ r, c });
    while (r !== b.r || c !== b.c) {
      r += dr;
      c += dc;
      path.push({ r, c });
    }
    return path;
  }

  private updateSelectionHighlight() {
    // 先清掉所有 selected
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        this.cellEls[r][c].classList.remove('selected');
      }
    }
    if (!this.startCell || !this.endCell) {
      this.updatePreview('');
      return;
    }
    const path = this.buildPath(this.startCell, this.endCell);
    for (const p of path) {
      this.cellEls[p.r][p.c].classList.add('selected');
    }
    const text = path.map((p) => this.grid[p.r][p.c]).join('');
    this.updatePreview(text);
  }

  private clearSelectionHighlight() {
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        this.cellEls[r][c].classList.remove('selected');
      }
    }
    this.updatePreview('');
  }

  private submitSelection() {
    if (!this.startCell || !this.endCell) return;
    // 单格不提交
    if (this.startCell.r === this.endCell.r && this.startCell.c === this.endCell.c) {
      this.clearSelectionHighlight();
      return;
    }
    const path = this.buildPath(this.startCell, this.endCell);
    const letters = path.map((p) => this.grid[p.r][p.c]).join('');
    const reversed = letters.split('').reverse().join('');
    const match = this.placements.find(
      (p) => !p.found && (p.word === letters || p.word === reversed)
    );

    if (match) {
      // 正确：路径持久高亮为绿色
      match.found = true;
      for (const p of path) {
        this.cellEls[p.r][p.c].classList.add('found');
      }
      this.score += 10 * (this.levelIndex + 1);
      this.scoreCb?.(this.score);
      this.renderWords();
      this.updateHeader();
      this.clearSelectionHighlight();
      // 本关全部找完
      if (this.placements.every((p) => p.found)) {
        this.score += 50;
        this.scoreCb?.(this.score);
        this.handleLevelClear();
      }
    } else {
      // 错误：红色闪烁 200ms 后清除
      this.wrongCount += 1;
      for (const p of path) {
        this.cellEls[p.r][p.c].classList.add('wrong');
      }
      window.setTimeout(() => {
        for (const p of path) {
          if (this.cellEls[p.r] && this.cellEls[p.r][p.c]) {
            this.cellEls[p.r][p.c].classList.remove('wrong');
          }
        }
      }, 200);
      this.clearSelectionHighlight();
    }
  }

  // ====== 关卡 / 结算 ======

  private handleLevelClear() {
    this.isTransitioning = true;
    const clearedLevels = this.levelIndex + 1;

    if (clearedLevels >= 1) {
      const isNew = storage.unlock('wordsearch_clear_1');
      if (isNew) this.eventCb?.('achievement-unlocked', 'wordsearch_clear_1');
    }
    if (clearedLevels >= 3) {
      const isNew = storage.unlock('wordsearch_clear_3');
      if (isNew) this.eventCb?.('achievement-unlocked', 'wordsearch_clear_3');
    }

    if (this.levelIndex + 1 >= LEVELS.length) {
      // 全部通关
      const isNewAll = storage.unlock('wordsearch_clear_all');
      if (isNewAll) this.eventCb?.('achievement-unlocked', 'wordsearch_clear_all');
      if (this.wrongCount === 0) {
        const isNewNoWrong = storage.unlock('wordsearch_no_wrong');
        if (isNewNoWrong) this.eventCb?.('achievement-unlocked', 'wordsearch_no_wrong');
      }
      this.endGame();
    } else {
      this.showLevelOverlay();
    }
  }

  private showLevelOverlay() {
    if (this.overlayEl) this.overlayEl.remove();
    const overlay = document.createElement('div');
    overlay.className = 'ws-overlay';
    overlay.innerHTML = `
      <h3>🎉 第 ${this.levelIndex + 1} 关完成</h3>
      <p>当前总分 ${this.score}</p>
      <div class="ws-overlay-actions">
        <button class="btn-primary" data-action="next" type="button">下一关</button>
      </div>
    `;
    this.boardEl.parentElement!.appendChild(overlay);
    this.overlayEl = overlay;
    overlay.querySelector('[data-action=next]')?.addEventListener('click', () => {
      overlay.remove();
      this.overlayEl = null;
      this.isTransitioning = false;
      this.loadLevel(this.levelIndex + 1);
    });
  }

  private endGame() {
    this.isOver = true;
    storage.recordScore(GAME_ID, this.score);
    storage.markPlayed(GAME_ID);
    const newly = checkMilestones(storage.load());
    for (const id of newly) {
      storage.markMilestone(id);
      this.eventCb?.('milestone-reached', id);
    }
    this.showFinalOverlay();
  }

  private showFinalOverlay() {
    if (this.overlayEl) this.overlayEl.remove();
    const overlay = document.createElement('div');
    overlay.className = 'ws-overlay';
    const noWrong = this.wrongCount === 0;
    overlay.innerHTML = `
      <h3>🏆 全部通关！</h3>
      <p>最终得分 ${this.score}</p>
      <p>${noWrong ? '零错误通关，完美！' : `错误次数 ${this.wrongCount}`}</p>
      <div class="ws-overlay-actions">
        <button class="btn-primary" data-action="restart" type="button">重玩</button>
      </div>
    `;
    this.boardEl.parentElement!.appendChild(overlay);
    this.overlayEl = overlay;
    overlay.querySelector('[data-action=restart]')?.addEventListener('click', () => {
      overlay.remove();
      this.overlayEl = null;
      this.isOver = false;
      this.isTransitioning = false;
      this.score = 0;
      this.wrongCount = 0;
      this.loadLevel(0);
      this.scoreCb?.(this.score);
    });
  }

  // ====== 接口实现 ======

  destroy(): void {
    this.unbindInput();
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    // 若未结束就退出，仍记录分数和游玩 + 处理里程碑
    if (!this.isOver && this.score > 0) {
      storage.recordScore(GAME_ID, this.score);
      storage.markPlayed(GAME_ID);
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
    return '按住鼠标或手指在网格上拖出直线（横 / 竖 / 斜），找出隐藏的单词';
  }
}
