/**
 * 记忆翻牌 —— 实现 GameInstance 接口
 *
 * 渲染：DOM + CSS Grid + CSS 3D 翻转
 * 输入：鼠标/触屏点击牌面
 * 关卡：5 关递增（6/8/10/12/15 对），卡牌随关卡缩小
 * 计分：每关 1000 - 步数*10 - 时间秒数*5（最低 100），总分 = 各关分数之和
 * 成就：通关 / ≤20 步通关 / ≤30 秒通关 / 0 错误通关（按单关表现判定）
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';

const EMOJIS = [
  '🌟', '🌙', '☀️', '🌈', '🌸', '🍎', '🎸', '🎲',
  '🦊', '🐢', '🚀', '🎨', '⚽', '🎵', '💎',
];
const GAME_ID = 'memory';

interface LevelConfig {
  pairs: number;
  cols: number;
  rows: number;
}

const LEVELS: LevelConfig[] = [
  { pairs: 6, cols: 4, rows: 3 },   // 12 张
  { pairs: 8, cols: 4, rows: 4 },   // 16 张
  { pairs: 10, cols: 5, rows: 4 },  // 20 张
  { pairs: 12, cols: 6, rows: 4 },  // 24 张
  { pairs: 15, cols: 6, rows: 5 },  // 30 张
];

export function MemoryFactory(): GameInstance {
  return new Memory();
}

interface Card {
  emoji: string;
  flipped: boolean;
  matched: boolean;
}

class Memory implements GameInstance {
  private root!: HTMLElement;
  private boardEl!: HTMLElement;

  private cards: Card[] = [];
  private firstIdx: number | null = null;
  private secondIdx: number | null = null;
  private locked = false; // 翻回等待期间禁止点击

  private level = 1;
  private totalScore = 0; // 各关分数之和
  private currentPairs = 0; // 当前关卡需要的配对数
  private steps = 0;
  private wrongMatches = 0;
  private matchedPairs = 0;
  private startTime: number | null = null;
  private elapsedSec = 0;
  private isOver = false;
  private hasStarted = false;

  private timerInterval: number | null = null;
  private flipBackTimer: number | null = null;
  private levelTimer: number | null = null;
  private overlayEl: HTMLElement | null = null;
  private bannerEl: HTMLElement | null = null;

  private scoreCb: ((score: number) => void) | null = null;
  private eventCb: ((event: string, payload?: unknown) => void) | null = null;

  private clickHandler = (e: Event) => this.handleClick(e);

  start(container: HTMLElement): void {
    this.root = container;
    this.root.innerHTML = `
      <div class="mem-wrap">
        <div class="mem-info">
          <div class="mem-stat">
            <span class="mem-stat-label">关卡</span>
            <span class="mem-stat-value" id="mem-level">1/${LEVELS.length}</span>
          </div>
          <div class="mem-stat">
            <span class="mem-stat-label">步数</span>
            <span class="mem-stat-value" id="mem-steps">0</span>
          </div>
          <div class="mem-stat">
            <span class="mem-stat-label">用时</span>
            <span class="mem-stat-value" id="mem-time">0s</span>
          </div>
          <div class="mem-stat">
            <span class="mem-stat-label">配对</span>
            <span class="mem-stat-value" id="mem-pairs">0/0</span>
          </div>
          <div class="mem-stat">
            <span class="mem-stat-label">总分</span>
            <span class="mem-stat-value" id="mem-score">0</span>
          </div>
        </div>
        <div class="mem-board" id="mem-board"></div>
      </div>
    `;
    this.boardEl = this.root.querySelector('#mem-board')!;

    this.level = 1;
    this.totalScore = 0;
    this.isOver = false;
    this.scoreCb?.(0);
    this.loadLevel(1);

    this.boardEl.addEventListener('click', this.clickHandler);
  }

  /** 加载第 lvl 关：选牌、洗牌、重置状态、渲染棋盘 */
  private loadLevel(lvl: number) {
    const config = LEVELS[lvl - 1];
    this.currentPairs = config.pairs;

    // 清理上一关可能残留的定时器与横幅
    this.clearTimers();
    if (this.bannerEl) {
      this.bannerEl.remove();
      this.bannerEl = null;
    }

    // 从 EMOJIS 中取前 config.pairs 个并复制成对
    const chosen = EMOJIS.slice(0, config.pairs);
    const pairs = [...chosen, ...chosen];
    this.shuffle(pairs);
    this.cards = pairs.map((emoji) => ({ emoji, flipped: false, matched: false }));

    // 重置本关状态
    this.firstIdx = null;
    this.secondIdx = null;
    this.locked = false;
    this.steps = 0;
    this.wrongMatches = 0;
    this.matchedPairs = 0;
    this.startTime = null;
    this.elapsedSec = 0;
    this.isOver = false;
    this.hasStarted = false;

    this.createBoard();
    this.updateInfo();
  }

  private shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  private handleClick(e: Event) {
    const target = e.target as HTMLElement;
    const cardEl = target.closest('.mem-card') as HTMLElement | null;
    if (!cardEl) return;
    const idx = Number(cardEl.dataset.idx);
    if (Number.isNaN(idx)) return;
    this.flipCard(idx);
  }

  private flipCard(idx: number) {
    if (this.isOver || this.locked) return;
    const card = this.cards[idx];
    if (!card || card.flipped || card.matched) return;

    // 首次翻牌：启动计时
    if (!this.hasStarted) {
      this.hasStarted = true;
      this.startTime = Date.now();
      this.timerInterval = window.setInterval(() => this.tickTimer(), 1000);
    }

    card.flipped = true;
    this.updateCardState(idx);

    this.steps += 1;

    if (this.firstIdx === null) {
      this.firstIdx = idx;
    } else {
      this.secondIdx = idx;
      this.locked = true;
      this.checkMatch();
    }

    this.updateInfo();
    this.updateLiveScore();
  }

  private checkMatch() {
    if (this.firstIdx === null || this.secondIdx === null) return;
    const a = this.cards[this.firstIdx];
    const b = this.cards[this.secondIdx];
    if (!a || !b) return;
    const firstIdx = this.firstIdx;
    const secondIdx = this.secondIdx;

    if (a.emoji === b.emoji) {
      // 配对成功：保持翻开（绿色高亮）
      a.matched = true;
      b.matched = true;
      this.matchedPairs += 1;
      this.firstIdx = null;
      this.secondIdx = null;
      this.locked = false;
      this.updateCardState(firstIdx);
      this.updateCardState(secondIdx);
      if (this.matchedPairs === this.currentPairs) {
        this.onLevelClear();
      }
    } else {
      // 配对失败：1 秒后翻回
      this.wrongMatches += 1;
      this.flipBackTimer = window.setTimeout(() => {
        if (this.cards[firstIdx]) this.cards[firstIdx].flipped = false;
        if (this.cards[secondIdx]) this.cards[secondIdx].flipped = false;
        this.firstIdx = null;
        this.secondIdx = null;
        this.locked = false;
        this.updateCardState(firstIdx);
        this.updateCardState(secondIdx);
      }, 1000);
    }
  }

  private tickTimer() {
    if (this.startTime === null) return;
    this.elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);
    this.updateInfo();
    this.updateLiveScore();
  }

  private computeScore(): number {
    return Math.max(100, 1000 - this.steps * 10 - this.elapsedSec * 5);
  }

  private updateLiveScore() {
    // 进行中：累计 + 本关实时估算；关卡间：仅累计
    if (this.hasStarted) {
      this.scoreCb?.(this.totalScore + this.computeScore());
    } else {
      this.scoreCb?.(this.totalScore);
    }
  }

  private updateInfo() {
    const levelEl = this.root.querySelector('#mem-level');
    const stepsEl = this.root.querySelector('#mem-steps');
    const timeEl = this.root.querySelector('#mem-time');
    const pairsEl = this.root.querySelector('#mem-pairs');
    const scoreEl = this.root.querySelector('#mem-score');
    if (levelEl) levelEl.textContent = `${this.level}/${LEVELS.length}`;
    if (stepsEl) stepsEl.textContent = String(this.steps);
    if (timeEl) timeEl.textContent = `${this.elapsedSec}s`;
    if (pairsEl) pairsEl.textContent = `${this.matchedPairs}/${this.currentPairs}`;
    if (scoreEl) {
      scoreEl.textContent = String(
        this.hasStarted ? this.totalScore + this.computeScore() : this.totalScore
      );
    }
  }

  private createBoard() {
    const config = LEVELS[this.level - 1];
    this.boardEl.innerHTML = '';
    // 根据当前关卡设置 grid 列数/行数与宽高比
    this.boardEl.style.gridTemplateColumns = `repeat(${config.cols}, 1fr)`;
    this.boardEl.style.gridTemplateRows = `repeat(${config.rows}, 1fr)`;
    this.boardEl.style.aspectRatio = `${config.cols} / ${config.rows}`;
    this.boardEl.dataset.level = String(this.level);
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      const el = document.createElement('div');
      el.className = 'mem-card';
      el.dataset.idx = String(i);
      el.innerHTML = `
        <div class="mem-card-inner">
          <div class="mem-card-back">❓</div>
          <div class="mem-card-front">${card.emoji}</div>
        </div>
      `;
      this.boardEl.appendChild(el);
    }
  }

  private updateCardState(idx: number) {
    const card = this.cards[idx];
    if (!card) return;
    const el = this.boardEl.querySelector<HTMLElement>(
      `.mem-card[data-idx="${idx}"]`
    );
    if (!el) return;
    el.classList.toggle('flipped', card.flipped || card.matched);
    el.classList.toggle('matched', card.matched);
  }

  /** 通关一关：累加分数、判定成就、加载下一关或结束游戏 */
  private onLevelClear() {
    // 停止本关计时，避免后续 updateLiveScore 重复计入本关分数
    if (this.timerInterval !== null) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.hasStarted = false;

    const levelScore = this.computeScore();
    this.totalScore += levelScore;
    this.scoreCb?.(this.totalScore);
    this.updateInfo();

    // 单关成就判定（沿用各关独立表现）
    if (this.steps <= 20) this.unlockAch('memory_steps_20');
    if (this.elapsedSec <= 30) this.unlockAch('memory_time_30s');
    if (this.wrongMatches === 0) this.unlockAch('memory_perfect');

    if (this.level < LEVELS.length) {
      this.showLevelClearBanner();
      this.levelTimer = window.setTimeout(() => {
        this.level += 1;
        this.loadLevel(this.level);
      }, 1500);
    } else {
      this.endGame();
    }
  }

  /** 关卡通关短暂横幅 */
  private showLevelClearBanner() {
    if (this.bannerEl) this.bannerEl.remove();
    const banner = document.createElement('div');
    banner.className = 'mem-banner';
    banner.innerHTML = `<span>🎉 第 ${this.level} 关通关！</span>`;
    this.boardEl.appendChild(banner);
    this.bannerEl = banner;
  }

  private endGame() {
    this.isOver = true;
    this.clearTimers();
    const finalScore = this.totalScore;
    this.scoreCb?.(finalScore);

    storage.recordScore(GAME_ID, finalScore);
    storage.markPlayed(GAME_ID);

    // 通关成就（仅完成全部关卡才解锁）
    this.unlockAch('memory_clear');

    // 检查里程碑
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
    overlay.className = 'mem-overlay';
    overlay.innerHTML = `
      <h3>🏆 全部通关！</h3>
      <p>总分 ${score}</p>
      <p class="mem-overlay-stats">最后一关 · 步数 ${this.steps} · 用时 ${this.elapsedSec}s · 错误 ${this.wrongMatches}</p>
      <div class="mem-overlay-actions">
        <button class="btn-primary" data-action="restart">再来一局</button>
      </div>
    `;
    this.boardEl.appendChild(overlay);
    this.overlayEl = overlay;

    overlay.querySelector('[data-action=restart]')?.addEventListener('click', () => {
      overlay.remove();
      this.overlayEl = null;
      this.level = 1;
      this.totalScore = 0;
      this.isOver = false;
      this.scoreCb?.(0);
      this.loadLevel(1);
    });
  }

  private clearTimers() {
    if (this.timerInterval !== null) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.flipBackTimer !== null) {
      window.clearTimeout(this.flipBackTimer);
      this.flipBackTimer = null;
    }
    if (this.levelTimer !== null) {
      window.clearTimeout(this.levelTimer);
      this.levelTimer = null;
    }
  }

  destroy(): void {
    this.clearTimers();
    this.boardEl?.removeEventListener('click', this.clickHandler);
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    if (this.bannerEl) {
      this.bannerEl.remove();
      this.bannerEl = null;
    }
    // 若未结束就退出，仍记录分数和游玩
    if (!this.isOver && this.hasStarted) {
      // 未通关时不计实际分数（避免用阶段性步数/时间污染排行榜）
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
    return '翻开两张相同图案的牌即可配对。共 5 关递增难度，每关独立计分，总分 = 各关分数之和。步数越少、用时越短、错误越少，得分越高。';
  }
}
