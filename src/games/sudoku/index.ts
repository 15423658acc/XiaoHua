/**
 * 数独 —— 实现 GameInstance 接口
 *
 * 渲染：DOM + CSS Grid（9x9）
 * 输入：点击空格 + 数字面板
 * 计分：Math.max(100, 1000 + 难度系数 * 500 - 用时秒数 * 2)
 * 成就：通关 / 困难通关 / 无错误通关
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';

const GAME_ID = 'sudoku';

const DIFFICULTY_CLUES: Record<number, number> = {
  1: 35,
  2: 30,
  3: 25,
};

export function SudokuFactory(): GameInstance {
  return new Sudoku();
}

class Sudoku implements GameInstance {
  private root!: HTMLElement;
  private boardEl!: HTMLElement;
  private numpadEl!: HTMLElement;

  private solution: number[][] = [];
  private given: boolean[][] = [];
  private current: number[][] = [];

  private selectedCell: [number, number] | null = null;
  private difficulty = 1;

  private startTime: number | null = null;
  private elapsedSec = 0;
  private timerInterval: number | null = null;

  private isOver = false;
  private hasStarted = false;
  private hintUsed = 0;
  private hadError = false;
  private score = 0;
  private overlayEl: HTMLElement | null = null;

  private scoreCb: ((s: number) => void) | null = null;
  private eventCb: ((e: string, p?: unknown) => void) | null = null;

  private keyHandler = (e: KeyboardEvent) => this.handleKey(e);
  private cellClickHandler = (e: Event) => this.handleCellClick(e);
  private numpadClickHandler = (e: Event) => this.handleNumpadClick(e);
  private restartClickHandler = () => this.newGame();
  private difficultyChangeHandler = (e: Event) => this.handleDifficultyChange(e);

  start(container: HTMLElement): void {
    this.root = container;
    this.root.innerHTML = `
      <div class="sudoku-wrap">
        <div class="sudoku-header">
          <select class="sudoku-difficulty">
            <option value="1">简单</option>
            <option value="2">中等</option>
            <option value="3">困难</option>
          </select>
          <span class="sudoku-timer">⏱ 0</span>
          <button class="sudoku-restart">新游戏</button>
        </div>
        <div class="sudoku-board" id="sudoku-board"></div>
        <div class="sudoku-numpad" id="sudoku-numpad" hidden>
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9]
            .map((n) => `<button class="sudoku-numpad-btn" data-num="${n}">${n}</button>`)
            .join('')}
          <button class="sudoku-numpad-btn sudoku-numpad-clear" data-num="0">✕</button>
        </div>
      </div>
    `;
    this.boardEl = this.root.querySelector('#sudoku-board')!;
    this.numpadEl = this.root.querySelector('#sudoku-numpad')!;

    const selectEl = this.root.querySelector<HTMLSelectElement>('.sudoku-difficulty')!;
    selectEl.value = String(this.difficulty);
    selectEl.addEventListener('change', this.difficultyChangeHandler);
    this.root.querySelector('.sudoku-restart')?.addEventListener('click', this.restartClickHandler);

    this.newGame();
    this.bindInput();
    this.scoreCb?.(0);
  }

  private handleDifficultyChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.difficulty = Number(select.value) || 1;
    this.newGame();
  }

  private newGame() {
    const fullSolution = this.generateSudoku();
    const clueCount = DIFFICULTY_CLUES[this.difficulty] ?? 35;
    const { puzzle, given } = this.digHoles(fullSolution, clueCount);

    this.solution = fullSolution;
    this.current = puzzle.map((row) => [...row]);
    this.given = given;

    this.selectedCell = null;
    this.startTime = null;
    this.elapsedSec = 0;
    this.isOver = false;
    this.hasStarted = false;
    this.hintUsed = 0;
    this.hadError = false;
    this.score = 0;

    this.clearTimers();
    this.hideNumpad();
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }

    this.render();
    this.updateTimerDisplay();
    this.scoreCb?.(0);
  }

  /** 生成完整有效的 9x9 数独解：基于基础模式 + 随机变换 */
  private generateSudoku(): number[][] {
    const base = [
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      [4, 5, 6, 7, 8, 9, 1, 2, 3],
      [7, 8, 9, 1, 2, 3, 4, 5, 6],
      [2, 3, 1, 5, 6, 4, 8, 9, 7],
      [5, 6, 4, 8, 9, 7, 2, 3, 1],
      [8, 9, 7, 2, 3, 1, 5, 6, 4],
      [3, 1, 2, 6, 4, 5, 9, 7, 8],
      [6, 4, 5, 9, 7, 8, 3, 1, 2],
      [9, 7, 8, 3, 1, 2, 6, 4, 5],
    ];
    const result = base.map((row) => [...row]);

    // 在每个 band 内交换行
    for (let band = 0; band < 3; band++) {
      const rows = [band * 3, band * 3 + 1, band * 3 + 2];
      this.shuffle(rows);
      const newRows = rows.map((r) => result[r]);
      for (let i = 0; i < 3; i++) {
        result[band * 3 + i] = [...newRows[i]];
      }
    }

    // 在每个 stack 内交换列
    for (let stack = 0; stack < 3; stack++) {
      const cols = [stack * 3, stack * 3 + 1, stack * 3 + 2];
      this.shuffle(cols);
      for (let r = 0; r < 9; r++) {
        const orig = [result[r][stack * 3], result[r][stack * 3 + 1], result[r][stack * 3 + 2]];
        for (let i = 0; i < 3; i++) {
          result[r][stack * 3 + i] = orig[cols[i] - stack * 3];
        }
      }
    }

    // 交换 band
    const bands = [0, 1, 2];
    this.shuffle(bands);
    const newBands = bands.map((b) => result.slice(b * 3, b * 3 + 3).map((row) => [...row]));
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        result[i * 3 + j] = [...newBands[i][j]];
      }
    }

    // 交换 stack
    const stacks = [0, 1, 2];
    this.shuffle(stacks);
    const newStacks = stacks.map((s) =>
      result.map((row) => [row[s * 3], row[s * 3 + 1], row[s * 3 + 2]])
    );
    for (let i = 0; i < 3; i++) {
      for (let r = 0; r < 9; r++) {
        for (let j = 0; j < 3; j++) {
          result[r][i * 3 + j] = newStacks[i][r][j];
        }
      }
    }

    // 重排数字 1-9
    const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const shuffled = [...digits];
    this.shuffle(shuffled);
    const digitMap: Record<number, number> = {};
    for (let i = 0; i < 9; i++) digitMap[digits[i]] = shuffled[i];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        result[r][c] = digitMap[result[r][c]];
      }
    }

    return result;
  }

  private shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  private digHoles(
    solution: number[][],
    clueCount: number
  ): { puzzle: number[][]; given: boolean[][] } {
    const puzzle = solution.map((row) => [...row]);
    const given = solution.map((row) => row.map(() => true));
    const holes = 81 - clueCount;

    const positions: [number, number][] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) positions.push([r, c]);
    }
    this.shuffle(positions);

    for (let i = 0; i < holes; i++) {
      const [r, c] = positions[i];
      puzzle[r][c] = 0;
      given[r][c] = false;
    }
    return { puzzle, given };
  }

  private bindInput() {
    window.addEventListener('keydown', this.keyHandler, { passive: false });
    this.boardEl.addEventListener('click', this.cellClickHandler);
    this.numpadEl.addEventListener('click', this.numpadClickHandler);
  }

  private unbindInput() {
    window.removeEventListener('keydown', this.keyHandler);
    this.boardEl?.removeEventListener('click', this.cellClickHandler);
    this.numpadEl?.removeEventListener('click', this.numpadClickHandler);
    this.root?.querySelector('.sudoku-difficulty')?.removeEventListener('change', this.difficultyChangeHandler);
    this.root?.querySelector('.sudoku-restart')?.removeEventListener('click', this.restartClickHandler);
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
      this.newGame();
    } else if (key === 'Escape') {
      e.preventDefault();
      this.hideNumpad();
      this.selectedCell = null;
      this.render();
    }
  }

  private handleCellClick(e: Event) {
    const target = e.target as HTMLElement;
    const cellEl = target.closest('.sudoku-cell') as HTMLElement | null;
    if (!cellEl) return;
    const r = Number(cellEl.dataset.r);
    const c = Number(cellEl.dataset.c);
    if (Number.isNaN(r) || Number.isNaN(c)) return;
    if (this.given[r][c]) return;

    if (!this.hasStarted) {
      this.hasStarted = true;
      this.startTime = Date.now();
      this.timerInterval = window.setInterval(() => this.tickTimer(), 1000);
    }

    this.selectedCell = [r, c];
    this.showNumpad();
    this.render();
  }

  private handleNumpadClick(e: Event) {
    const target = e.target as HTMLElement;
    const btn = target.closest('.sudoku-numpad-btn') as HTMLElement | null;
    if (!btn) return;
    const num = Number(btn.dataset.num);
    if (Number.isNaN(num)) return;
    if (!this.selectedCell) return;
    const [r, c] = this.selectedCell;
    if (this.given[r][c]) return;

    if (num === 0) {
      this.current[r][c] = 0;
    } else {
      this.current[r][c] = num;
      if (this.checkConflict(r, c, num)) {
        this.hadError = true;
      }
    }

    this.render();
    if (this.isComplete()) this.winGame();
  }

  private checkConflict(r: number, c: number, num: number): boolean {
    for (let i = 0; i < 9; i++) {
      if (i !== c && this.current[r][i] === num) return true;
    }
    for (let i = 0; i < 9; i++) {
      if (i !== r && this.current[i][c] === num) return true;
    }
    const boxR = Math.floor(r / 3) * 3;
    const boxC = Math.floor(c / 3) * 3;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const rr = boxR + i;
        const cc = boxC + j;
        if ((rr !== r || cc !== c) && this.current[rr][cc] === num) return true;
      }
    }
    return false;
  }

  private isComplete(): boolean {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (this.current[r][c] !== this.solution[r][c]) return false;
      }
    }
    return true;
  }

  private useHint() {
    const empties: [number, number][] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (!this.given[r][c] && this.current[r][c] !== this.solution[r][c]) {
          empties.push([r, c]);
        }
      }
    }
    if (empties.length === 0) return;

    if (!this.hasStarted) {
      this.hasStarted = true;
      this.startTime = Date.now();
      this.timerInterval = window.setInterval(() => this.tickTimer(), 1000);
    }

    const [r, c] = empties[Math.floor(Math.random() * empties.length)];
    this.current[r][c] = this.solution[r][c];
    this.hintUsed += 1;
    this.render();
    if (this.isComplete()) this.winGame();
  }

  private tickTimer() {
    if (this.startTime === null) return;
    this.elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);
    this.updateTimerDisplay();
  }

  private updateTimerDisplay() {
    const el = this.root?.querySelector('.sudoku-timer');
    if (el) el.textContent = `⏱ ${this.elapsedSec}`;
  }

  private computeScore(): number {
    return Math.max(100, 1000 + this.difficulty * 500 - this.elapsedSec * 2);
  }

  private winGame() {
    this.isOver = true;
    this.clearTimers();
    this.hideNumpad();

    const finalScore = this.computeScore();
    this.score = finalScore;
    this.scoreCb?.(finalScore);

    storage.recordScore(GAME_ID, finalScore);
    storage.markPlayed(GAME_ID);

    this.unlockAch('sudoku_clear');
    if (this.difficulty === 3) this.unlockAch('sudoku_hard');
    if (!this.hadError) this.unlockAch('sudoku_no_error');

    const newly = checkMilestones(storage.load());
    for (const id of newly) {
      storage.markMilestone(id);
      this.eventCb?.('milestone-reached', id);
    }

    this.showOverlay(finalScore);
  }

  private unlockAch(id: string) {
    const isNew = storage.unlock(id);
    if (isNew) this.eventCb?.('achievement-unlocked', id);
  }

  private showOverlay(score: number) {
    if (this.overlayEl) this.overlayEl.remove();
    const overlay = document.createElement('div');
    overlay.className = 'sudoku-overlay';
    const diffName = this.difficulty === 1 ? '简单' : this.difficulty === 2 ? '中等' : '困难';
    overlay.innerHTML = `
      <h3>🎉 通关！</h3>
      <p>得分 ${score}</p>
      <p class="sudoku-overlay-stats">用时 ${this.elapsedSec}s · 难度 ${diffName} · 提示 ${this.hintUsed}</p>
      <div class="sudoku-overlay-actions">
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

  private showNumpad() {
    this.numpadEl.hidden = false;
  }

  private hideNumpad() {
    this.numpadEl.hidden = true;
  }

  private render() {
    this.boardEl.innerHTML = '';

    // 计算所有冲突格子
    const conflictSet = new Set<string>();
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const val = this.current[r][c];
        if (val !== 0 && !this.given[r][c] && this.checkConflict(r, c, val)) {
          conflictSet.add(`${r},${c}`);
        }
      }
    }

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = document.createElement('div');
        cell.className = 'sudoku-cell';
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);

        if (c % 3 === 0 && c !== 0) cell.classList.add('sudoku-thick-left');
        if (r % 3 === 0 && r !== 0) cell.classList.add('sudoku-thick-top');

        if (this.given[r][c]) {
          cell.classList.add('sudoku-given');
        } else {
          cell.classList.add('sudoku-empty');
        }

        if (this.selectedCell && this.selectedCell[0] === r && this.selectedCell[1] === c) {
          cell.classList.add('sudoku-selected');
        }

        if (conflictSet.has(`${r},${c}`)) {
          cell.classList.add('sudoku-conflict');
        }

        const val = this.current[r][c];
        if (val !== 0) cell.textContent = String(val);

        this.boardEl.appendChild(cell);
      }
    }
  }

  private clearTimers() {
    if (this.timerInterval !== null) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
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
    return '点击空格选 1-9 数字填入，同行同列同宫不能重复。H 提示，S 重新开局';
  }
}
