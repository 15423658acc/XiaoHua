/**
 * 五子棋残局游戏 —— 实现 GameInstance 接口
 *
 * 渲染：DOM + CSS Grid 15x15
 * 输入：鼠标点击 / 触摸交叉点 / R 键重置 / H 键提示
 * 模式：5 局预设残局，玩家需找到致胜走法
 * 计分：通关一局 +100，使用提示 -20
 * 成就：通关第 1 局 / 第 3 局 / 全部 5 局 / 无提示通关全部
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';

/** 棋子：0=空，1=黑，2=白 */
type Stone = 0 | 1 | 2;
type Board = Stone[][];

type AILevel = 'random' | 'medium' | 'strong' | 'minimax';

interface Coord {
  r: number;
  c: number;
}

interface LevelDef {
  /** 初始黑棋位置 */
  black: Coord[];
  /** 初始白棋位置 */
  white: Coord[];
  /** 玩家执子颜色 */
  playerColor: Stone;
  /** AI 执子颜色 */
  aiColor: Stone;
  /** AI 是否先手 */
  aiFirst: boolean;
  /** 该局目标提示 */
  goal: string;
  /** AI 强度 */
  aiLevel: AILevel;
}

const SIZE = 15;
/** 4 个方向：横、竖、正斜、反斜 */
const DIRS: ReadonlyArray<[number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/** 5 局预设残局 */
const LEVELS: LevelDef[] = [
  // 第 1 局：教程关，玩家执黑已有 4 连，找到关键点完成五连
  {
    black: [
      { r: 7, c: 5 },
      { r: 7, c: 6 },
      { r: 7, c: 7 },
      { r: 7, c: 8 },
    ],
    white: [
      { r: 3, c: 3 },
      { r: 11, c: 11 },
      { r: 3, c: 11 },
      { r: 11, c: 3 },
    ],
    playerColor: 1,
    aiColor: 2,
    aiFirst: false,
    goal: '找到致胜点完成五连（教程关）',
    aiLevel: 'random',
  },
  // 第 2 局：双活三机会，走中心形成两个方向的活三
  {
    black: [
      { r: 6, c: 6 },
      { r: 8, c: 8 },
      { r: 6, c: 8 },
      { r: 8, c: 6 },
    ],
    white: [
      { r: 3, c: 3 },
      { r: 11, c: 11 },
      { r: 3, c: 11 },
      { r: 11, c: 3 },
    ],
    playerColor: 1,
    aiColor: 2,
    aiFirst: false,
    goal: '走中心点形成双活三威胁',
    aiLevel: 'medium',
  },
  // 第 3 局：冲四 + 活三组合胜
  {
    black: [
      { r: 7, c: 5 },
      { r: 7, c: 6 },
      { r: 7, c: 7 },
      { r: 8, c: 7 },
      { r: 9, c: 7 },
    ],
    white: [
      { r: 7, c: 4 },
      { r: 3, c: 3 },
      { r: 11, c: 11 },
    ],
    playerColor: 1,
    aiColor: 2,
    aiFirst: false,
    goal: '先冲四迫使 AI 堵截，再形成活三胜',
    aiLevel: 'medium',
  },
  // 第 4 局：玩家执白，AI 黑先手，需先防守再反击
  {
    black: [
      { r: 7, c: 5 },
      { r: 7, c: 6 },
      { r: 7, c: 7 },
    ],
    white: [
      { r: 7, c: 4 },
      { r: 3, c: 3 },
      { r: 4, c: 3 },
      { r: 5, c: 3 },
      { r: 2, c: 5 },
      { r: 2, c: 6 },
      { r: 2, c: 7 },
    ],
    playerColor: 2,
    aiColor: 1,
    aiFirst: true,
    goal: '先防守黑棋威胁，再反击致胜',
    aiLevel: 'strong',
  },
  // 第 5 局：复杂残局，AI 较强（评估 + minimax 深度 2）
  {
    black: [
      { r: 6, c: 5 },
      { r: 6, c: 6 },
      { r: 6, c: 7 },
      { r: 7, c: 7 },
      { r: 8, c: 7 },
    ],
    white: [
      { r: 6, c: 4 },
      { r: 3, c: 3 },
      { r: 11, c: 11 },
      { r: 5, c: 5 },
    ],
    playerColor: 1,
    aiColor: 2,
    aiFirst: false,
    goal: '复杂残局，找到关键致胜走法',
    aiLevel: 'minimax',
  },
];

/** 一条线上的连子信息 */
interface LineInfo {
  /** 连子数（含当前落子） */
  count: number;
  /** 开放端数 0/1/2 */
  openEnds: number;
}

export function GomokuFactory(): GameInstance {
  return new Gomoku();
}

class Gomoku implements GameInstance {
  private root!: HTMLElement;
  private boardEl!: HTMLElement;
  private levelInfoEl!: HTMLElement;
  private goalEl!: HTMLElement;
  private lastMoveEl!: HTMLElement;
  private overlayEl: HTMLElement | null = null;
  private hintTimer: number | null = null;
  private aiTimer: number | null = null;

  private board: Board = [];
  private levelIndex = 0;
  private score = 0;
  private isOver = false;
  private isTransitioning = false;
  private isAIThinking = false;
  private lastMove: Coord | null = null;
  private winLine: Coord[] | null = null;
  private hintCoord: Coord | null = null;
  private hintUsedThisLevel = false;
  private hintUsedAnyLevel = false;

  private scoreCb: ((s: number) => void) | null = null;
  private eventCb: ((e: string, p?: unknown) => void) | null = null;

  private clickHandler = (e: Event) => this.handleClick(e);
  private keyHandler = (e: KeyboardEvent) => this.handleKey(e);
  private touchStartHandler = (e: TouchEvent) => {
    // 阻止页面滚动，但允许 click 事件触发
    e.preventDefault();
  };
  private resetBtnHandler = () => this.resetLevel();
  private hintBtnHandler = () => this.showHint();

  start(container: HTMLElement): void {
    this.root = container;
    this.root.innerHTML = `
      <div class="gomoku-wrap">
        <div class="gomoku-header">
          <div class="gomoku-level-info" id="gomoku-level-info">第 1 局 / 共 5 局</div>
          <div class="gomoku-goal" id="gomoku-goal"></div>
        </div>
        <div class="gomoku-main">
          <div class="gomoku-board-wrap">
            <div class="gomoku-board" id="gomoku-board"></div>
          </div>
          <aside class="gomoku-side">
            <div class="gomoku-side-section">
              <div class="gomoku-side-label">上一步</div>
              <div class="gomoku-last-move" id="gomoku-last-move">尚无落子</div>
            </div>
            <div class="gomoku-side-section">
              <div class="gomoku-side-label">操作</div>
              <button class="gomoku-btn" id="gomoku-reset" type="button">重置本局 (R)</button>
              <button class="gomoku-btn" id="gomoku-hint" type="button">提示 (H)</button>
            </div>
            <div class="gomoku-side-section">
              <div class="gomoku-side-label">说明</div>
              <div class="gomoku-help">点击棋盘交叉点落子。黑子为你，白子为 AI。任意方向 5 连即胜。</div>
            </div>
          </aside>
        </div>
      </div>
    `;
    this.levelInfoEl = this.root.querySelector('#gomoku-level-info')!;
    this.goalEl = this.root.querySelector('#gomoku-goal')!;
    this.boardEl = this.root.querySelector('#gomoku-board')!;
    this.lastMoveEl = this.root.querySelector('#gomoku-last-move')!;

    this.score = 0;
    this.levelIndex = 0;
    this.isOver = false;
    this.hintUsedAnyLevel = false;
    this.loadLevel(0);
    this.bindInput();
    this.scoreCb?.(this.score);
  }

  private loadLevel(idx: number) {
    const level = LEVELS[idx];
    this.levelIndex = idx;
    this.board = Array.from({ length: SIZE }, () => Array<Stone>(SIZE).fill(0));
    for (const c of level.black) this.board[c.r][c.c] = 1;
    for (const c of level.white) this.board[c.r][c.c] = 2;
    this.lastMove = null;
    this.winLine = null;
    this.isTransitioning = false;
    this.isAIThinking = false;
    this.hintUsedThisLevel = false;
    this.hintCoord = null;
    this.clearHint();
    this.clearAITimer();
    this.removeOverlay();
    this.render();
    this.updateHeader();
    this.updateLastMove();

    if (level.aiFirst) {
      this.scheduleAI();
    }
  }

  private bindInput() {
    this.boardEl.addEventListener('click', this.clickHandler);
    this.boardEl.addEventListener('touchstart', this.touchStartHandler, {
      passive: false,
    });
    window.addEventListener('keydown', this.keyHandler);
    this.root
      .querySelector('#gomoku-reset')
      ?.addEventListener('click', this.resetBtnHandler);
    this.root
      .querySelector('#gomoku-hint')
      ?.addEventListener('click', this.hintBtnHandler);
  }

  private unbindInput() {
    this.boardEl.removeEventListener('click', this.clickHandler);
    this.boardEl.removeEventListener('touchstart', this.touchStartHandler);
    window.removeEventListener('keydown', this.keyHandler);
    this.root
      .querySelector('#gomoku-reset')
      ?.removeEventListener('click', this.resetBtnHandler);
    this.root
      .querySelector('#gomoku-hint')
      ?.removeEventListener('click', this.hintBtnHandler);
  }

  private handleKey(e: KeyboardEvent) {
    if (this.isOver) return;
    const k = e.key;
    if (k === 'r' || k === 'R') {
      e.preventDefault();
      this.resetLevel();
    } else if (k === 'h' || k === 'H') {
      e.preventDefault();
      this.showHint();
    }
  }

  private handleClick(e: Event) {
    if (this.isOver || this.isTransitioning || this.isAIThinking) return;
    const target = e.target as HTMLElement | null;
    const cell = target?.closest('[data-r][data-c]') as HTMLElement | null;
    if (!cell) return;
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    if (!Number.isFinite(r) || !Number.isFinite(c)) return;
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return;
    if (this.board[r][c] !== 0) return;
    const level = LEVELS[this.levelIndex];
    this.placeStone(r, c, level.playerColor);
  }

  private placeStone(r: number, c: number, color: Stone) {
    this.board[r][c] = color;
    this.lastMove = { r, c };
    this.clearHint();
    this.render();
    this.updateLastMove();

    const win = this.checkWin(r, c, color);
    if (win) {
      this.winLine = win;
      this.render();
      if (color === LEVELS[this.levelIndex].playerColor) {
        this.handlePlayerWin();
      } else {
        this.handlePlayerLose();
      }
      return;
    }

    const level = LEVELS[this.levelIndex];
    if (color === level.playerColor) {
      // 玩家走完，AI 思考
      this.scheduleAI();
    }
    // 若 AI 走完，等待玩家点击
  }

  private scheduleAI() {
    this.clearAITimer();
    this.isAIThinking = true;
    const delay = 500 + Math.floor(Math.random() * 501); // 500-1000ms
    this.aiTimer = window.setTimeout(() => {
      this.aiTimer = null;
      this.isAIThinking = false;
      this.makeAIMove();
    }, delay);
  }

  private clearAITimer() {
    if (this.aiTimer !== null) {
      window.clearTimeout(this.aiTimer);
      this.aiTimer = null;
    }
    this.isAIThinking = false;
  }

  private makeAIMove() {
    if (this.isOver || this.isTransitioning) return;
    const level = LEVELS[this.levelIndex];
    const aiColor = level.aiColor;
    const playerColor = level.playerColor;
    const move = this.chooseAIMove(level.aiLevel, aiColor, playerColor);
    if (!move) return;
    this.placeStone(move.r, move.c, aiColor);
  }

  /** 根据难度选择 AI 落子 */
  private chooseAIMove(
    level: AILevel,
    aiColor: Stone,
    playerColor: Stone
  ): Coord | null {
    const empties = this.getEmptyCells();
    if (empties.length === 0) return null;

    if (level === 'random') {
      // 第 1 局：几乎随机，优先靠近已有棋子的位置
      const near = empties.filter((c) => this.hasNeighbor(c.r, c.c, 2));
      const pool = near.length > 0 ? near : empties;
      return pool[Math.floor(Math.random() * pool.length)];
    }

    if (level === 'medium') {
      // 第 2-3 局：必堵 4 连威胁，否则随机靠近
      // 先看自己能否成 5
      for (const c of empties) {
        if (this.wouldWin(c.r, c.c, aiColor)) return c;
      }
      // 再看玩家能否成 5（必须堵）
      for (const c of empties) {
        if (this.wouldWin(c.r, c.c, playerColor)) return c;
      }
      // 堵玩家 4 连威胁（rush-4 / open-4）
      const blockFour = this.findBlockMove(playerColor);
      if (blockFour) return blockFour;
      // 随机靠近已有棋子
      const near = empties.filter((c) => this.hasNeighbor(c.r, c.c, 2));
      const pool = near.length > 0 ? near : empties;
      return pool[Math.floor(Math.random() * pool.length)];
    }

    // strong / minimax：评估函数
    const scores = this.evaluateAllCells(aiColor, playerColor);
    if (scores.length === 0) return empties[0];

    if (level === 'strong') {
      // 取最高分位置（同分随机选一）
      const top = scores[0].score;
      const candidates = scores.filter((s) => s.score === top);
      return candidates[Math.floor(Math.random() * candidates.length)];
    }

    // minimax 深度 2：对前 N 个候选拟一步玩家反击
    const topN = scores.slice(0, Math.min(8, scores.length));
    let bestEval = -Infinity;
    let bestMove: Coord | null = null;
    for (const cand of topN) {
      this.board[cand.r][cand.c] = aiColor;
      // AI 已胜
      if (this.checkWin(cand.r, cand.c, aiColor)) {
        this.board[cand.r][cand.c] = 0;
        return { r: cand.r, c: cand.c };
      }
      // 玩家最强反击分（玩家视角）
      const playerScores = this.evaluateAllCells(playerColor, aiColor);
      const playerBest = playerScores.length > 0 ? playerScores[0].score : 0;
      // AI 视角估值：自身分 - 玩家反击分（带衰减）
      const evalScore = cand.score - playerBest * 0.6;
      this.board[cand.r][cand.c] = 0;
      if (evalScore > bestEval) {
        bestEval = evalScore;
        bestMove = { r: cand.r, c: cand.c };
      }
    }
    return bestMove ?? scores[0];
  }

  /** 评估所有空位的得分，按降序返回 */
  private evaluateAllCells(
    aiColor: Stone,
    playerColor: Stone
  ): Array<{ r: number; c: number; score: number }> {
    const result: Array<{ r: number; c: number; score: number }> = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (this.board[r][c] !== 0) continue;
        if (!this.hasNeighbor(r, c, 2)) continue; // 跳过远离棋子的格子
        const aiScore = this.scoreMove(r, c, aiColor);
        const playerScore = this.scoreMove(r, c, playerColor);
        // 防守略低于进攻，确保 AI 优先攻
        const score = aiScore + playerScore * 0.9;
        result.push({ r, c, score });
      }
    }
    result.sort((a, b) => b.score - a.score);
    return result;
  }

  /** 评估在 (r,c) 落 color 子的总价值（4 个方向求和） */
  private scoreMove(r: number, c: number, color: Stone): number {
    let total = 0;
    for (const [dr, dc] of DIRS) {
      const line = this.getLineInfo(r, c, dr, dc, color);
      total += this.lineScore(line);
    }
    return total;
  }

  /** 沿方向获取连子信息（假设 (r,c) 已落 color 子） */
  private getLineInfo(
    r: number,
    c: number,
    dr: number,
    dc: number,
    color: Stone
  ): LineInfo {
    let count = 1; // 包含当前落子
    // 正向延伸
    let fr = r + dr;
    let fc = c + dc;
    while (
      fr >= 0 &&
      fr < SIZE &&
      fc >= 0 &&
      fc < SIZE &&
      this.board[fr][fc] === color
    ) {
      count++;
      fr += dr;
      fc += dc;
    }
    const forwardOpen =
      fr >= 0 && fr < SIZE && fc >= 0 && fc < SIZE && this.board[fr][fc] === 0;
    // 反向延伸
    let br = r - dr;
    let bc = c - dc;
    while (
      br >= 0 &&
      br < SIZE &&
      bc >= 0 &&
      bc < SIZE &&
      this.board[br][bc] === color
    ) {
      count++;
      br -= dr;
      bc -= dc;
    }
    const backwardOpen =
      br >= 0 &&
      br < SIZE &&
      bc >= 0 &&
      bc < SIZE &&
      this.board[br][bc] === 0;
    const openEnds = (forwardOpen ? 1 : 0) + (backwardOpen ? 1 : 0);
    return { count, openEnds };
  }

  /** 单条线的得分 */
  private lineScore(line: LineInfo): number {
    const { count, openEnds } = line;
    if (count >= 5) return 100000; // 成 5
    if (count === 4) {
      if (openEnds === 2) return 10000; // 活四
      if (openEnds === 1) return 1000; // 冲四
      return 0; // 死四
    }
    if (count === 3) {
      if (openEnds === 2) return 500; // 活三
      if (openEnds === 1) return 100; // 冲三
      return 0;
    }
    if (count === 2) {
      if (openEnds === 2) return 50;
      if (openEnds === 1) return 10;
      return 0;
    }
    if (count === 1) {
      if (openEnds === 2) return 5;
      if (openEnds === 1) return 1;
      return 0;
    }
    return 0;
  }

  /** 是否在 (r,c) 落 color 子可成 5 */
  private wouldWin(r: number, c: number, color: Stone): boolean {
    return this.scoreMove(r, c, color) >= 100000;
  }

  /** 找到必须堵的位置（玩家若在此落子可形成 4+ 威胁） */
  private findBlockMove(playerColor: Stone): Coord | null {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (this.board[r][c] !== 0) continue;
        if (!this.hasNeighbor(r, c, 2)) continue;
        const score = this.scoreMove(r, c, playerColor);
        if (score >= 1000) return { r, c }; // 冲四 / 活四
      }
    }
    return null;
  }

  /** 是否在 (r,c) 的 range 范围内有已落子 */
  private hasNeighbor(r: number, c: number, range: number): boolean {
    for (let dr = -range; dr <= range; dr++) {
      for (let dc = -range; dc <= range; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
        if (this.board[nr][nc] !== 0) return true;
      }
    }
    return false;
  }

  private getEmptyCells(): Coord[] {
    const list: Coord[] = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (this.board[r][c] === 0) list.push({ r, c });
      }
    }
    return list;
  }

  /** 检查 (r,c) 落 color 子后是否形成 5+ 连，返回连子坐标或 null */
  private checkWin(r: number, c: number, color: Stone): Coord[] | null {
    for (const [dr, dc] of DIRS) {
      const line: Coord[] = [{ r, c }];
      // 正向
      let fr = r + dr;
      let fc = c + dc;
      while (
        fr >= 0 &&
        fr < SIZE &&
        fc >= 0 &&
        fc < SIZE &&
        this.board[fr][fc] === color
      ) {
        line.push({ r: fr, c: fc });
        fr += dr;
        fc += dc;
      }
      // 反向
      let br = r - dr;
      let bc = c - dc;
      while (
        br >= 0 &&
        br < SIZE &&
        bc >= 0 &&
        bc < SIZE &&
        this.board[br][bc] === color
      ) {
        line.unshift({ r: br, c: bc });
        br -= dr;
        bc -= dc;
      }
      if (line.length >= 5) {
        return line;
      }
    }
    return null;
  }

  private handlePlayerWin() {
    this.score += 100;
    this.scoreCb?.(this.score);

    if (this.levelIndex === 0) {
      const isNew = storage.unlock('gomoku_clear_1');
      if (isNew) this.eventCb?.('achievement-unlocked', 'gomoku_clear_1');
    }
    if (this.levelIndex === 2) {
      const isNew = storage.unlock('gomoku_clear_3');
      if (isNew) this.eventCb?.('achievement-unlocked', 'gomoku_clear_3');
    }

    if (this.levelIndex === LEVELS.length - 1) {
      // 全通关
      const isNew = storage.unlock('gomoku_clear_all');
      if (isNew) this.eventCb?.('achievement-unlocked', 'gomoku_clear_all');
      if (!this.hintUsedAnyLevel) {
        const nh = storage.unlock('gomoku_no_hint');
        if (nh) this.eventCb?.('achievement-unlocked', 'gomoku_no_hint');
      }
      storage.recordScore('gomoku', this.score);
      storage.markPlayed('gomoku');
      const newly = checkMilestones(storage.load());
      for (const id of newly) {
        storage.markMilestone(id);
        this.eventCb?.('milestone-reached', id);
      }
      this.isOver = true;
      this.showWinOverlay(true);
    } else {
      this.showWinOverlay(false);
    }
  }

  private handlePlayerLose() {
    this.showLoseOverlay();
  }

  private showWinOverlay(isLast: boolean) {
    this.removeOverlay();
    const overlay = document.createElement('div');
    overlay.className = 'gomoku-overlay';
    if (isLast) {
      overlay.innerHTML = `
        <h3>🎉 全部通关！</h3>
        <p>本局得分 ${this.score}</p>
        <div class="gomoku-overlay-actions">
          <button class="btn-primary" data-action="restart-all" type="button">再来一次</button>
        </div>
      `;
    } else {
      overlay.innerHTML = `
        <h3>🎉 本局胜！</h3>
        <p>当前得分 ${this.score}</p>
        <div class="gomoku-overlay-actions">
          <button class="btn-primary" data-action="next" type="button">下一局</button>
        </div>
      `;
    }
    this.boardEl.parentElement!.appendChild(overlay);
    this.overlayEl = overlay;

    overlay
      .querySelector('[data-action=restart-all]')
      ?.addEventListener('click', () => {
        this.removeOverlay();
        this.score = 0;
        this.isOver = false;
        this.hintUsedAnyLevel = false;
        this.loadLevel(0);
        this.scoreCb?.(this.score);
      });
    overlay.querySelector('[data-action=next]')?.addEventListener('click', () => {
      this.removeOverlay();
      this.loadLevel(this.levelIndex + 1);
    });
  }

  private showLoseOverlay() {
    this.removeOverlay();
    const overlay = document.createElement('div');
    overlay.className = 'gomoku-overlay';
    overlay.innerHTML = `
      <h3>💀 本局失败</h3>
      <p>AI 已形成 5 连，请重试</p>
      <div class="gomoku-overlay-actions">
        <button class="btn-primary" data-action="retry" type="button">重试本局</button>
      </div>
    `;
    this.boardEl.parentElement!.appendChild(overlay);
    this.overlayEl = overlay;

    overlay.querySelector('[data-action=retry]')?.addEventListener('click', () => {
      this.removeOverlay();
      this.loadLevel(this.levelIndex);
    });
  }

  private removeOverlay() {
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
  }

  private resetLevel() {
    if (this.isOver || this.isTransitioning) return;
    this.loadLevel(this.levelIndex);
  }

  private showHint() {
    if (this.isOver || this.isTransitioning || this.isAIThinking) return;
    if (this.hintUsedThisLevel) return; // 每局限 1 次

    const level = LEVELS[this.levelIndex];
    const playerColor = level.playerColor;
    const aiColor = level.aiColor;

    // 优先找直接获胜的位置
    let candidate: Coord | null = null;
    for (let r = 0; r < SIZE && !candidate; r++) {
      for (let c = 0; c < SIZE && !candidate; c++) {
        if (this.board[r][c] !== 0) continue;
        if (this.wouldWin(r, c, playerColor)) candidate = { r, c };
      }
    }
    // 其次用评估函数选最高分位置
    if (!candidate) {
      const scores = this.evaluateAllCells(playerColor, aiColor);
      if (scores.length > 0) candidate = { r: scores[0].r, c: scores[0].c };
    }
    if (!candidate) return;

    this.hintUsedThisLevel = true;
    this.hintUsedAnyLevel = true;
    this.score -= 20;
    if (this.score < 0) this.score = 0;
    this.scoreCb?.(this.score);

    this.hintCoord = candidate;
    this.render();
    this.hintTimer = window.setTimeout(() => {
      this.hintCoord = null;
      this.hintTimer = null;
      this.render();
    }, 2000);
  }

  private clearHint() {
    if (this.hintTimer !== null) {
      window.clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
    this.hintCoord = null;
  }

  private updateHeader() {
    this.levelInfoEl.textContent = `第 ${this.levelIndex + 1} 局 / 共 ${LEVELS.length} 局`;
    this.goalEl.textContent = LEVELS[this.levelIndex].goal;
  }

  private updateLastMove() {
    if (!this.lastMove) {
      this.lastMoveEl.textContent = '尚无落子';
      return;
    }
    const level = LEVELS[this.levelIndex];
    const color = this.board[this.lastMove.r][this.lastMove.c];
    const colorText =
      color === level.playerColor ? '你' : 'AI';
    // 显示为 1-15 的常规坐标（行号/列号从 1 起）
    this.lastMoveEl.textContent = `${colorText} → ${this.lastMove.r + 1},${this.lastMove.c + 1}`;
  }

  private render() {
    this.boardEl.innerHTML = '';
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'gomoku-cell';
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        if (c === SIZE - 1) cell.classList.add('edge-col');
        if (r === SIZE - 1) cell.classList.add('edge-row');

        const stone = this.board[r][c];
        if (stone !== 0) {
          const stoneEl = document.createElement('div');
          stoneEl.className = 'gomoku-stone';
          stoneEl.classList.add(stone === 1 ? 'black' : 'white');
          if (this.lastMove && this.lastMove.r === r && this.lastMove.c === c) {
            stoneEl.classList.add('last-move');
          }
          if (
            this.winLine &&
            this.winLine.some((w) => w.r === r && w.c === c)
          ) {
            stoneEl.classList.add('win-line');
          }
          cell.appendChild(stoneEl);
        }

        if (this.hintCoord && this.hintCoord.r === r && this.hintCoord.c === c) {
          cell.classList.add('gomoku-hint-cell');
        }

        this.boardEl.appendChild(cell);
      }
    }
  }

  destroy(): void {
    this.unbindInput();
    this.clearAITimer();
    this.clearHint();
    this.removeOverlay();
    // 未结束且有分数：记录分数与游玩
    if (!this.isOver && this.score > 0) {
      storage.recordScore('gomoku', this.score);
      storage.markPlayed('gomoku');
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
    return '点击棋盘交叉点落子，5 局残局挑战，任意方向 5 连即胜';
  }
}
