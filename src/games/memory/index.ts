/**
 * 记忆翻牌 —— 实现 GameInstance 接口
 *
 * 渲染：DOM + CSS Grid + CSS 3D 翻转
 * 输入：鼠标/触屏点击牌面
 * 计分：基础 1000 - 步数*10 - 时间秒数*5（最低 100）
 * 成就：通关 / ≤20 步通关 / ≤30 秒通关 / 0 错误通关
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';

const EMOJIS = ['🌟', '🌙', '☀️', '🌈', '🌸', '🍎', '🎸', '🎲'];
const GAME_ID = 'memory';

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

  private steps = 0;
  private wrongMatches = 0;
  private matchedPairs = 0;
  private startTime: number | null = null;
  private elapsedSec = 0;
  private isOver = false;
  private hasStarted = false;

  private timerInterval: number | null = null;
  private flipBackTimer: number | null = null;
  private overlayEl: HTMLElement | null = null;

  private scoreCb: ((score: number) => void) | null = null;
  private eventCb: ((event: string, payload?: unknown) => void) | null = null;

  private clickHandler = (e: Event) => this.handleClick(e);

  start(container: HTMLElement): void {
    this.root = container;
    this.root.innerHTML = `
      <div class="mem-wrap">
        <div class="mem-info">
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
            <span class="mem-stat-value" id="mem-pairs">0/${EMOJIS.length}</span>
          </div>
        </div>
        <div class="mem-board" id="mem-board"></div>
      </div>
    `;
    this.boardEl = this.root.querySelector('#mem-board')!;

    this.initCards();
    this.createBoard();
    this.boardEl.addEventListener('click', this.clickHandler);

    this.scoreCb?.(0);
  }

  private initCards() {
    const pairs = [...EMOJIS, ...EMOJIS];
    this.shuffle(pairs);
    this.cards = pairs.map((emoji) => ({ emoji, flipped: false, matched: false }));
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
      if (this.matchedPairs === EMOJIS.length) {
        this.endGame();
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
    this.scoreCb?.(this.computeScore());
  }

  private updateInfo() {
    const stepsEl = this.root.querySelector('#mem-steps');
    const timeEl = this.root.querySelector('#mem-time');
    const pairsEl = this.root.querySelector('#mem-pairs');
    if (stepsEl) stepsEl.textContent = String(this.steps);
    if (timeEl) timeEl.textContent = `${this.elapsedSec}s`;
    if (pairsEl) pairsEl.textContent = `${this.matchedPairs}/${EMOJIS.length}`;
  }

  private createBoard() {
    this.boardEl.innerHTML = '';
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

  private endGame() {
    this.isOver = true;
    this.clearTimers();
    const finalScore = this.computeScore();
    this.scoreCb?.(finalScore);

    storage.recordScore(GAME_ID, finalScore);
    storage.markPlayed(GAME_ID);

    // 解锁成就
    this.unlockAch('memory_clear');
    if (this.steps <= 20) this.unlockAch('memory_steps_20');
    if (this.elapsedSec <= 30) this.unlockAch('memory_time_30s');
    if (this.wrongMatches === 0) this.unlockAch('memory_perfect');

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
      <h3>🎉 通关！</h3>
      <p>得分 ${score}</p>
      <p class="mem-overlay-stats">步数 ${this.steps} · 用时 ${this.elapsedSec}s · 错误 ${this.wrongMatches}</p>
      <div class="mem-overlay-actions">
        <button class="btn-primary" data-action="restart">再来一局</button>
      </div>
    `;
    this.boardEl.appendChild(overlay);
    this.overlayEl = overlay;

    overlay.querySelector('[data-action=restart]')?.addEventListener('click', () => {
      overlay.remove();
      this.overlayEl = null;
      this.initCards();
      this.createBoard();
      this.updateInfo();
      this.scoreCb?.(0);
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
  }

  destroy(): void {
    this.clearTimers();
    this.boardEl?.removeEventListener('click', this.clickHandler);
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
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
    return '翻开两张相同图案的牌即可配对，全部配对完成通关。步数越少、用时越短、错误越少，得分越高。';
  }
}
