/**
 * 井字棋游戏 —— 实现 GameInstance 接口
 *
 * 渲染：DOM + CSS Grid 3x3
 * 输入：鼠标点击 / 触摸 / 数字键 1-9 / R 键重开
 * AI：Minimax 算法，三档难度
 *   - 简单：30% 随机 + 70% Minimax
 *   - 中等：Minimax 深度限制为 1（可被陷阱击败）
 *   - 困难：完整 Minimax（满深度，不输）
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';

type Cell = 'X' | 'O' | '';
type Board = Cell[];
type Difficulty = 'easy' | 'medium' | 'hard';
type Player = 'X' | 'O';
type GameResult = Player | 'draw';

/** 8 条胜利连线（索引） */
const WIN_LINES: number[][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // 三行
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // 三列
  [0, 4, 8], [2, 4, 6],            // 两条对角
];

/** 检查胜者，返回 'X' / 'O' / 'draw' / null */
function checkWinner(board: Board): GameResult | null {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a] as Player;
    }
  }
  if (board.every((c) => c !== '')) return 'draw';
  return null;
}

/** 取空格索引列表 */
function emptyCells(board: Board): number[] {
  const cells: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] === '') cells.push(i);
  }
  return cells;
}

/**
 * Minimax 极小化搜索
 * - AI（O）为 maximizing 方，分数 = 10 - depth（越早胜越好）
 * - 玩家（X）为 minimizing 方，分数 = depth - 10（越晚败越好）
 * - 平局 = 0
 * - maxDepth 用于中等难度限制搜索深度
 */
function minimax(
  board: Board,
  depth: number,
  isMaximizing: boolean,
  maxDepth?: number
): number {
  const result = checkWinner(board);
  if (result === 'O') return 10 - depth;
  if (result === 'X') return depth - 10;
  if (result === 'draw') return 0;
  if (maxDepth !== undefined && depth >= maxDepth) return 0;

  if (isMaximizing) {
    let best = -Infinity;
    for (const move of emptyCells(board)) {
      board[move] = 'O';
      best = Math.max(best, minimax(board, depth + 1, false, maxDepth));
      board[move] = '';
    }
    return best;
  } else {
    let best = Infinity;
    for (const move of emptyCells(board)) {
      board[move] = 'X';
      best = Math.min(best, minimax(board, depth + 1, true, maxDepth));
      board[move] = '';
    }
    return best;
  }
}

/**
 * 在当前棋盘上为 AI（O）选择最佳落子
 * - easy：30% 随机 + 70% Minimax（满深度）
 * - medium：100% Minimax 但深度限制为 1
 * - hard：100% Minimax（满深度）
 * 同分走法中随机选一个，避免每次都走固定格
 */
function bestMove(board: Board, difficulty: Difficulty): number {
  const empties = emptyCells(board);
  if (empties.length === 0) return -1;

  // 简单：30% 概率随机走
  if (difficulty === 'easy' && Math.random() < 0.3) {
    return empties[Math.floor(Math.random() * empties.length)];
  }

  // medium 深度限制 1；hard 满深度
  const maxDepth = difficulty === 'medium' ? 1 : undefined;

  let best = -Infinity;
  let bestMoves: number[] = [];
  for (const i of empties) {
    board[i] = 'O';
    const score = minimax(board, 0, false, maxDepth);
    board[i] = '';
    if (score > best) {
      best = score;
      bestMoves = [i];
    } else if (score === best) {
      bestMoves.push(i);
    }
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

export function TictactoeFactory(): GameInstance {
  return new Tictactoe();
}

class Tictactoe implements GameInstance {
  private root!: HTMLElement;
  private boardEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private scoreEl!: HTMLElement;
  private diffEl!: HTMLElement;
  private overlayEl: HTMLElement | null = null;

  private board: Board = Array(9).fill('') as Board;
  private currentDifficulty: Difficulty = 'hard';
  private isPlayerTurn = true;
  private isGameOver = false;

  private score = 0;
  private best = 0;
  private wins = 0;
  private losses = 0;
  private draws = 0;
  private streak = 0; // 连续不输（胜或平）的局数
  private hardDraws = 0; // 困难难度累计平局数
  private sessionPlays = 0; // 会话内累计局数（达到 10 触发并刷新）

  private aiTimer: number | null = null;
  private autoRestartTimer: number | null = null;

  private scoreCb: ((score: number) => void) | null = null;
  private eventCb: ((event: string, payload?: unknown) => void) | null = null;

  // 用箭头函数字段保证 add/removeEventListener 引用一致
  private boardClickHandler = (e: Event) => this.handleBoardClick(e);
  private keyHandler = (e: KeyboardEvent) => this.handleKey(e);
  private diffClickHandler = (e: Event) => this.handleDiffClick(e);

  start(container: HTMLElement): void {
    const save = storage.load();
    this.best = save.scores['tictactoe'] ?? 0;

    this.root = container;
    this.root.innerHTML = `
      <div class="ttt-wrap">
        <div class="ttt-difficulty">
          <button class="ttt-diff-btn" data-diff="easy">简单</button>
          <button class="ttt-diff-btn" data-diff="medium">中等</button>
          <button class="ttt-diff-btn active" data-diff="hard">困难</button>
        </div>
        <div class="ttt-status">你的回合</div>
        <div class="ttt-board-wrap">
          <div class="ttt-board"></div>
        </div>
        <div class="ttt-stats">
          <span>胜 <b class="ttt-wins">0</b></span>
          <span>负 <b class="ttt-losses">0</b></span>
          <span>平 <b class="ttt-draws">0</b></span>
          <span>得分 <b class="ttt-score">0</b></span>
        </div>
        <div class="ttt-instructions">
          点击格子或按数字键 1-9 落子，R 键重开一局
        </div>
      </div>
    `;
    this.diffEl = this.root.querySelector('.ttt-difficulty')!;
    this.statusEl = this.root.querySelector('.ttt-status')!;
    this.boardEl = this.root.querySelector('.ttt-board')!;
    this.scoreEl = this.root.querySelector('.ttt-score')!;

    this.renderBoard();
    this.bindInput();
    this.scoreCb?.(this.score);
  }

  private bindInput() {
    this.boardEl.addEventListener('click', this.boardClickHandler);
    window.addEventListener('keydown', this.keyHandler);
    this.diffEl.addEventListener('click', this.diffClickHandler);
  }

  private unbindInput() {
    this.boardEl.removeEventListener('click', this.boardClickHandler);
    window.removeEventListener('keydown', this.keyHandler);
    this.diffEl.removeEventListener('click', this.diffClickHandler);
  }

  private handleBoardClick(e: Event) {
    const target = e.target as HTMLElement;
    const cell = target.closest('.ttt-cell') as HTMLElement | null;
    if (!cell) return;
    const idx = Number(cell.dataset.idx);
    if (Number.isNaN(idx) || idx < 0 || idx > 8) return;
    this.playerMove(idx);
  }

  private handleKey(e: KeyboardEvent) {
    if (e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      this.playerMove(Number(e.key) - 1);
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      this.newGame();
    }
  }

  private handleDiffClick(e: Event) {
    const target = e.target as HTMLElement;
    const btn = target.closest('.ttt-diff-btn') as HTMLElement | null;
    if (!btn) return;
    const diff = btn.dataset.diff as Difficulty | undefined;
    if (!diff || diff === this.currentDifficulty) return;
    this.setDifficulty(diff);
  }

  private setDifficulty(diff: Difficulty) {
    this.currentDifficulty = diff;
    const btns = this.diffEl.querySelectorAll('.ttt-diff-btn');
    btns.forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.diff === diff);
    });
    this.newGame();
  }

  private playerMove(idx: number) {
    if (this.isGameOver || !this.isPlayerTurn) return;
    if (this.board[idx] !== '') return;
    this.board[idx] = 'X';
    this.renderBoard();
    const winner = checkWinner(this.board);
    if (winner) {
      this.endGame(winner);
      return;
    }
    this.isPlayerTurn = false;
    this.setStatus('AI 思考中...');
    this.scheduleAIMove();
  }

  private scheduleAIMove() {
    // 300-600ms 思考时间
    const delay = 300 + Math.random() * 300;
    this.aiTimer = window.setTimeout(() => {
      this.aiTimer = null;
      this.aiMove();
    }, delay);
  }

  private aiMove() {
    if (this.isGameOver) return;
    // 用副本搜索，避免修改当前棋盘
    const move = bestMove([...this.board] as Board, this.currentDifficulty);
    if (move < 0) return;
    this.board[move] = 'O';
    this.renderBoard();
    const winner = checkWinner(this.board);
    if (winner) {
      this.endGame(winner);
      return;
    }
    this.isPlayerTurn = true;
    this.setStatus('你的回合');
  }

  private setStatus(text: string) {
    this.statusEl.textContent = text;
  }

  private renderBoard() {
    this.boardEl.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const cell = document.createElement('button');
      cell.className = 'ttt-cell';
      cell.dataset.idx = String(i);
      cell.textContent = this.board[i];
      if (this.board[i] === 'X') cell.classList.add('ttt-x');
      else if (this.board[i] === 'O') cell.classList.add('ttt-o');
      this.boardEl.appendChild(cell);
    }
  }

  private endGame(winner: GameResult) {
    this.isGameOver = true;
    this.sessionPlays++;

    // 找到胜利连线（若有）
    let lineIdx: number | null = null;
    if (winner === 'X' || winner === 'O') {
      for (let i = 0; i < WIN_LINES.length; i++) {
        const [a, b, c] = WIN_LINES[i];
        if (
          this.board[a] &&
          this.board[a] === this.board[b] &&
          this.board[a] === this.board[c]
        ) {
          lineIdx = i;
          break;
        }
      }
    }

    let resultText: string;
    if (winner === 'X') {
      this.wins++;
      this.streak++;
      this.score += 10;
      resultText = '你赢了！';
      // 中等难度下胜 1 局
      if (this.currentDifficulty === 'medium') {
        const isNew = storage.unlock('tictactoe_win_medium');
        if (isNew) this.eventCb?.('achievement-unlocked', 'tictactoe_win_medium');
      }
    } else if (winner === 'O') {
      this.losses++;
      this.streak = 0;
      this.score = Math.max(0, this.score - 5);
      resultText = 'AI 赢了';
    } else {
      this.draws++;
      this.streak++;
      this.score += 1;
      resultText = '平局';
      // 困难难度累计平局 3 次
      if (this.currentDifficulty === 'hard') {
        this.hardDraws++;
        if (this.hardDraws >= 3) {
          const isNew = storage.unlock('tictactoe_draw_hard');
          if (isNew) this.eventCb?.('achievement-unlocked', 'tictactoe_draw_hard');
        }
      }
    }

    // 连续 3 局不输
    if (this.streak >= 3) {
      const isNew = storage.unlock('tictactoe_streak_3');
      if (isNew) this.eventCb?.('achievement-unlocked', 'tictactoe_streak_3');
    }

    // 累计 10 局（达到即触发并刷新计数）
    if (this.sessionPlays >= 10) {
      const isNew = storage.unlock('tictactoe_play_10');
      if (isNew) this.eventCb?.('achievement-unlocked', 'tictactoe_play_10');
      this.sessionPlays = 0;
    }

    if (this.score > this.best) this.best = this.score;

    // 持久化 + 里程碑检查
    storage.recordScore('tictactoe', this.score);
    storage.markPlayed('tictactoe');
    const newly = checkMilestones(storage.load());
    for (const id of newly) {
      storage.markMilestone(id);
      this.eventCb?.('milestone-reached', id);
    }

    this.setStatus(resultText);
    this.updateStats();
    this.scoreCb?.(this.score);

    // 高亮胜利连线 + 三连格
    if (lineIdx !== null) {
      this.drawWinLine(lineIdx, winner as Player);
    }

    // 显示覆盖层 + 1.5s 后自动新开一局
    this.showOverlay(resultText);
    this.autoRestartTimer = window.setTimeout(() => {
      this.autoRestartTimer = null;
      // 若玩家尚未通过覆盖层开始新局，则自动新开
      if (this.isGameOver) {
        this.hideOverlay();
        this.newGame();
      }
    }, 1500);
  }

  private drawWinLine(lineIdx: number, winner: Player) {
    const line = WIN_LINES[lineIdx];
    // 给三连格加高亮
    for (const i of line) {
      const cellEl = this.boardEl.querySelector(`[data-idx="${i}"]`);
      cellEl?.classList.add('ttt-win');
    }
    // 在棋盘上叠加彩色贯穿线
    const lineEl = document.createElement('div');
    lineEl.className = `ttt-win-line ttt-win-line-${lineIdx} ${
      winner === 'X' ? 'ttt-win-x' : 'ttt-win-o'
    }`;
    this.boardEl.appendChild(lineEl);
  }

  private showOverlay(resultText: string) {
    if (this.overlayEl) this.overlayEl.remove();
    const overlay = document.createElement('div');
    overlay.className = 'ttt-overlay';
    overlay.innerHTML = `
      <h3>${resultText}</h3>
      <p>本局得分 ${this.score} · 最高 ${this.best}</p>
      <div class="ttt-overlay-actions">
        <button class="btn-primary" data-action="restart">再来一局</button>
        <button class="btn-secondary" data-action="switch">切换难度</button>
      </div>
    `;
    this.boardEl.parentElement!.appendChild(overlay);
    this.overlayEl = overlay;

    overlay.querySelector('[data-action=restart]')?.addEventListener('click', () => {
      this.hideOverlay();
      this.newGame();
    });
    overlay.querySelector('[data-action=switch]')?.addEventListener('click', () => {
      // 在 easy / medium / hard 之间循环切换
      const diffs: Difficulty[] = ['easy', 'medium', 'hard'];
      const cur = diffs.indexOf(this.currentDifficulty);
      const next = diffs[(cur + 1) % diffs.length];
      this.hideOverlay();
      this.setDifficulty(next);
    });
  }

  private hideOverlay() {
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    // 清除胜利连线和单元格高亮
    this.boardEl
      .querySelectorAll('.ttt-win-line')
      .forEach((e) => e.remove());
    this.boardEl
      .querySelectorAll('.ttt-cell.ttt-win')
      .forEach((e) => e.classList.remove('ttt-win'));
  }

  private newGame() {
    // 清除上一局残留：连线、覆盖层、定时器
    this.hideOverlay();
    if (this.aiTimer !== null) {
      clearTimeout(this.aiTimer);
      this.aiTimer = null;
    }
    if (this.autoRestartTimer !== null) {
      clearTimeout(this.autoRestartTimer);
      this.autoRestartTimer = null;
    }
    this.board = Array(9).fill('') as Board;
    this.isGameOver = false;
    this.isPlayerTurn = true;
    this.renderBoard();
    this.setStatus('你的回合');
  }

  private updateStats() {
    this.root.querySelector('.ttt-wins')!.textContent = String(this.wins);
    this.root.querySelector('.ttt-losses')!.textContent = String(this.losses);
    this.root.querySelector('.ttt-draws')!.textContent = String(this.draws);
    this.scoreEl.textContent = String(this.score);
  }

  destroy(): void {
    this.unbindInput();
    if (this.aiTimer !== null) {
      clearTimeout(this.aiTimer);
      this.aiTimer = null;
    }
    if (this.autoRestartTimer !== null) {
      clearTimeout(this.autoRestartTimer);
      this.autoRestartTimer = null;
    }
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    // 若有分数，记录并检查里程碑
    if (this.score > 0) {
      storage.recordScore('tictactoe', this.score);
      storage.markPlayed('tictactoe');
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
    return '点击格子或按数字键 1-9 落子，R 键重开一局。AI 使用 Minimax 算法，困难难度力争不输！';
  }
}
