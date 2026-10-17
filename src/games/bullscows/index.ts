/**
 * 猜数字（Bulls and Cows）游戏 —— 实现 GameInstance 接口
 *
 * 渲染：DOM
 * 输入：数字输入框 + 猜测/清除/提示按钮 + 键盘 Enter
 * 规则：AI 生成 4 位不重复数字（首位非 0），玩家 10 次内猜中 4A 胜利
 * 反馈：A（数字对且位置对）B（数字对但位置错）
 * 计分：胜利 100 + (10 - 猜测次数) * 20；使用提示 -30；失败 0；会话内累计
 * 成就：胜利 1 次 / 5 次内猜中 / 3 次内猜中 / 不用提示胜利 3 次（跨局累计）
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';

const GAME_ID = 'bullscows';
const MAX_GUESSES = 10;

interface GuessRecord {
  guess: string;
  a: number;
  b: number;
}

/** 生成 4 位不重复数字答案（首位非 0） */
function generateAnswer(): number[] {
  const digits: number[] = [];
  const first = Math.floor(Math.random() * 9) + 1; // 1-9
  digits.push(first);
  while (digits.length < 4) {
    const d = Math.floor(Math.random() * 10);
    if (!digits.includes(d)) digits.push(d);
  }
  return digits;
}

/** 校验玩家输入：4 位、纯数字、首位非 0、不重复。通过返回 null，否则返回错误文案 */
function validateGuess(input: string): string | null {
  if (input.length !== 4) return '请输入 4 位数字';
  if (!/^\d{4}$/.test(input)) return '只能输入数字';
  const digits = input.split('').map(Number);
  if (digits[0] === 0) return '首位不能为 0';
  if (new Set(digits).size !== 4) return '4 位数字不能重复';
  return null;
}

/** 计算 Bulls (A) 与 Cows (B) */
function evaluate(guess: number[], answer: number[]): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (let i = 0; i < 4; i++) {
    if (guess[i] === answer[i]) {
      a++;
    } else if (answer.includes(guess[i])) {
      b++;
    }
  }
  return { a, b };
}

export function BullscowsFactory(): GameInstance {
  return new Bullscows();
}

class Bullscows implements GameInstance {
  private root!: HTMLElement;
  private answerCells: HTMLElement[] = [];
  private inputEl!: HTMLInputElement;
  private historyBodyEl!: HTMLElement;
  private infoEl!: HTMLElement;
  private overlayEl: HTMLElement | null = null;

  private answer: number[] = [];
  private revealed: boolean[] = [false, false, false, false];
  private history: GuessRecord[] = [];
  private guessCount = 0;
  private hintUsed = false;
  private isGameOver = false;

  private score = 0; // 会话内累计
  private best = 0;
  private noHintWinCount = 0; // 跨局累计：未使用提示胜利次数

  private scoreCb: ((score: number) => void) | null = null;
  private eventCb: ((event: string, payload?: unknown) => void) | null = null;

  // 用箭头函数字段保证 add/removeEventListener 引用一致
  private keyHandler = (e: KeyboardEvent) => this.handleKey(e);
  private submitHandler = (e: Event) => this.handleSubmit(e);
  private clearHandler = (e: Event) => this.handleClear(e);
  private hintHandler = (e: Event) => this.handleHint(e);

  start(container: HTMLElement): void {
    const save = storage.load();
    this.best = save.scores[GAME_ID] ?? 0;

    this.root = container;
    this.root.innerHTML = `
      <div class="bc-wrap">
        <div class="bc-instructions">
          猜出 4 位不重复数字（首位非 0），10 次内 4A 胜利
        </div>
        <div class="bc-answer-row">
          <div class="bc-answer-cell" data-pos="0">?</div>
          <div class="bc-answer-cell" data-pos="1">?</div>
          <div class="bc-answer-cell" data-pos="2">?</div>
          <div class="bc-answer-cell" data-pos="3">?</div>
        </div>
        <div class="bc-input-row">
          <input class="bc-input" type="text" inputmode="numeric" pattern="[0-9]*"
                 maxlength="4" placeholder="输入 4 位数字" autocomplete="off" />
          <button class="bc-submit-btn">猜测</button>
        </div>
        <div class="bc-action-row">
          <button class="bc-clear-btn">清除</button>
          <button class="bc-hint-btn">随机填一位</button>
        </div>
        <div class="bc-info">剩余猜测次数：<b class="bc-remaining">${MAX_GUESSES}</b> / ${MAX_GUESSES}</div>
        <div class="bc-history-wrap">
          <table class="bc-history">
            <thead>
              <tr><th>#</th><th>猜测</th><th>A</th><th>B</th></tr>
            </thead>
            <tbody class="bc-history-body"></tbody>
          </table>
        </div>
      </div>
    `;

    this.answerCells = Array.from(this.root.querySelectorAll('.bc-answer-cell'));
    this.inputEl = this.root.querySelector('.bc-input') as HTMLInputElement;
    this.historyBodyEl = this.root.querySelector('.bc-history-body') as HTMLElement;
    this.infoEl = this.root.querySelector('.bc-info') as HTMLElement;

    this.startNewRound();
    this.bindInput();
    this.scoreCb?.(this.score);
  }

  private startNewRound() {
    this.answer = generateAnswer();
    this.revealed = [false, false, false, false];
    this.history = [];
    this.guessCount = 0;
    this.hintUsed = false;
    this.isGameOver = false;

    this.renderAnswer();
    this.renderHistory();
    this.updateRemaining();
    this.inputEl.value = '';
    this.inputEl.disabled = false;
    this.inputEl.focus();

    // 重置提示按钮
    const hintBtn = this.root.querySelector('.bc-hint-btn') as HTMLButtonElement | null;
    if (hintBtn) {
      hintBtn.disabled = false;
      hintBtn.textContent = '随机填一位';
    }
  }

  private bindInput() {
    this.inputEl.addEventListener('keydown', this.keyHandler);
    const submitBtn = this.root.querySelector('.bc-submit-btn');
    const clearBtn = this.root.querySelector('.bc-clear-btn');
    const hintBtn = this.root.querySelector('.bc-hint-btn');
    submitBtn?.addEventListener('click', this.submitHandler);
    clearBtn?.addEventListener('click', this.clearHandler);
    hintBtn?.addEventListener('click', this.hintHandler);
  }

  private unbindInput() {
    this.inputEl.removeEventListener('keydown', this.keyHandler);
    const submitBtn = this.root.querySelector('.bc-submit-btn');
    const clearBtn = this.root.querySelector('.bc-clear-btn');
    const hintBtn = this.root.querySelector('.bc-hint-btn');
    submitBtn?.removeEventListener('click', this.submitHandler);
    clearBtn?.removeEventListener('click', this.clearHandler);
    hintBtn?.removeEventListener('click', this.hintHandler);
  }

  private handleKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.submitGuess();
      return;
    }
    // 只允许数字键（不影响 Backspace/Delete/方向键等控制键）
    if (e.key.length === 1 && !/\d/.test(e.key)) {
      e.preventDefault();
    }
  }

  private handleSubmit(e: Event) {
    e.preventDefault();
    this.submitGuess();
  }

  private handleClear(e: Event) {
    e.preventDefault();
    this.inputEl.value = '';
    this.inputEl.focus();
  }

  private handleHint(e: Event) {
    e.preventDefault();
    this.useHint();
  }

  private submitGuess() {
    if (this.isGameOver) return;
    const raw = this.inputEl.value.trim();
    const err = validateGuess(raw);
    if (err) {
      this.flashError(err);
      return;
    }
    const guessDigits = raw.split('').map(Number);
    const { a, b } = evaluate(guessDigits, this.answer);
    this.history.push({ guess: raw, a, b });
    this.guessCount++;
    this.renderHistory();
    this.updateRemaining();
    this.inputEl.value = '';
    this.inputEl.focus();

    if (a === 4) {
      this.endGame(true);
      return;
    }
    if (this.guessCount >= MAX_GUESSES) {
      this.endGame(false);
    }
  }

  private useHint() {
    if (this.isGameOver || this.hintUsed) return;
    this.hintUsed = true;
    const unrevealed: number[] = [];
    for (let i = 0; i < 4; i++) {
      if (!this.revealed[i]) unrevealed.push(i);
    }
    if (unrevealed.length === 0) return;
    const pos = unrevealed[Math.floor(Math.random() * unrevealed.length)];
    this.revealed[pos] = true;
    this.renderAnswer();
    const hintBtn = this.root.querySelector('.bc-hint-btn') as HTMLButtonElement | null;
    if (hintBtn) {
      hintBtn.disabled = true;
      hintBtn.textContent = '提示已用';
    }
  }

  private flashError(msg: string) {
    this.infoEl.textContent = msg;
    this.infoEl.classList.add('bc-error');
    window.setTimeout(() => {
      this.infoEl.classList.remove('bc-error');
      this.updateRemaining();
    }, 1500);
  }

  private updateRemaining() {
    const remaining = MAX_GUESSES - this.guessCount;
    this.infoEl.innerHTML = `剩余猜测次数：<b class="bc-remaining">${remaining}</b> / ${MAX_GUESSES}`;
  }

  private renderAnswer() {
    for (let i = 0; i < 4; i++) {
      const cell = this.answerCells[i];
      if (this.revealed[i] || this.isGameOver) {
        cell.textContent = String(this.answer[i]);
        cell.classList.add('bc-revealed');
      } else {
        cell.textContent = '?';
        cell.classList.remove('bc-revealed');
      }
    }
  }

  private renderHistory() {
    this.historyBodyEl.innerHTML = '';
    // 最新在最上
    for (let i = this.history.length - 1; i >= 0; i--) {
      const rec = this.history[i];
      const row = document.createElement('tr');
      row.className = 'bc-history-row';
      row.innerHTML = `
        <td>${i + 1}</td>
        <td class="bc-guess-cell">${rec.guess}</td>
        <td class="bc-a-cell">${rec.a}A</td>
        <td class="bc-b-cell">${rec.b}B</td>
      `;
      this.historyBodyEl.appendChild(row);
    }
  }

  private endGame(won: boolean) {
    this.isGameOver = true;
    // 揭示答案
    for (let i = 0; i < 4; i++) this.revealed[i] = true;
    this.renderAnswer();
    this.inputEl.disabled = true;
    const hintBtn = this.root.querySelector('.bc-hint-btn') as HTMLButtonElement | null;
    if (hintBtn) hintBtn.disabled = true;

    let gain = 0;
    if (won) {
      gain = 100 + (MAX_GUESSES - this.guessCount) * 20;
      if (this.hintUsed) gain -= 30;
      if (gain < 0) gain = 0;
      this.score += gain;

      // 成就：胜利 1 次
      let isNew = storage.unlock('bullscows_win');
      if (isNew) this.eventCb?.('achievement-unlocked', 'bullscows_win');
      // 5 次以内猜中
      if (this.guessCount <= 5) {
        isNew = storage.unlock('bullscows_win_5');
        if (isNew) this.eventCb?.('achievement-unlocked', 'bullscows_win_5');
      }
      // 3 次以内猜中
      if (this.guessCount <= 3) {
        isNew = storage.unlock('bullscows_win_3');
        if (isNew) this.eventCb?.('achievement-unlocked', 'bullscows_win_3');
      }
      // 未使用提示胜利（成员变量跨局累计 3 次）
      if (!this.hintUsed) {
        this.noHintWinCount++;
        if (this.noHintWinCount >= 3) {
          isNew = storage.unlock('bullscows_no_hint');
          if (isNew) this.eventCb?.('achievement-unlocked', 'bullscows_no_hint');
        }
      }
    }

    if (this.score > this.best) this.best = this.score;
    storage.recordScore(GAME_ID, this.score);
    storage.markPlayed(GAME_ID);
    const newly = checkMilestones(storage.load());
    for (const id of newly) {
      storage.markMilestone(id);
      this.eventCb?.('milestone-reached', id);
    }

    this.scoreCb?.(this.score);
    this.showOverlay(won, gain);
  }

  private showOverlay(won: boolean, gain: number) {
    if (this.overlayEl) this.overlayEl.remove();
    const overlay = document.createElement('div');
    overlay.className = 'bc-overlay';
    const answerStr = this.answer.join('');
    if (won) {
      overlay.innerHTML = `
        <h3>🎉 恭喜！</h3>
        <p>用了 ${this.guessCount} 次，本局得分 ${gain}</p>
        <p class="bc-overlay-sub">累计 ${this.score} · 最高 ${this.best}</p>
        <div class="bc-overlay-actions">
          <button class="btn-primary" data-action="restart">再来一局</button>
        </div>
      `;
    } else {
      overlay.innerHTML = `
        <h3>💀 失败</h3>
        <p>答案是 <b class="bc-overlay-answer">${answerStr}</b></p>
        <p class="bc-overlay-sub">累计 ${this.score} · 最高 ${this.best}</p>
        <div class="bc-overlay-actions">
          <button class="btn-primary" data-action="restart">再来一局</button>
        </div>
      `;
    }
    this.root.querySelector('.bc-wrap')!.appendChild(overlay);
    this.overlayEl = overlay;
    overlay.querySelector('[data-action=restart]')?.addEventListener('click', () => {
      this.hideOverlay();
      this.startNewRound();
    });
  }

  private hideOverlay() {
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
  }

  destroy(): void {
    this.unbindInput();
    this.hideOverlay();
    // 若有分数且当前局未正常结束：记录
    if (!this.isGameOver && this.score > 0) {
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
    return '输入 4 位不重复数字（首位非 0），根据 A（位置对）B（数字对位置错）反馈，10 次内猜中 4A 胜利';
  }
}
