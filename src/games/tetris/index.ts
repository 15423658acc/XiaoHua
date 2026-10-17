/**
 * 俄罗斯方块 —— 实现 GameInstance 接口
 *
 * 渲染：Canvas（主棋盘 + 下一个方块预览）
 * 输入：键盘（← → 移动、↑/W 旋转、↓/S 软降、空格硬降）+ 触屏滑动
 * 重力：500ms/格，每消 10 行加速 50ms（最低 100ms）
 * 软降：50ms/格（按住下键）
 * 得分：1/2/3/4 行 = 100/300/500/800
 * 成就：累计消行 10/50/100、单局分数 1000/5000、单次消 4 行
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';
import { type PieceDef, randomPiece } from './pieces';

export function TetrisFactory(): GameInstance {
  return new Tetris();
}

interface ActivePiece {
  def: PieceDef;
  rotation: number; // 0..3
  x: number; // 棋盘列坐标（左上角）
  y: number; // 棋盘行坐标（左上角，可为负）
}

class Tetris implements GameInstance {
  private root!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private nextCanvas!: HTMLCanvasElement;
  private nextCtx!: CanvasRenderingContext2D;
  private overlayEl: HTMLElement | null = null;

  private readonly COLS = 10;
  private readonly ROWS = 20;
  private readonly CELL = 22; // canvas 内部分辨率：220 x 440
  private readonly NEXT_CELL = 22; // 预览 canvas 内部分辨率：88 x 88

  /** 棋盘格：'' 表示空，否则为颜色字符串 */
  private grid: string[][] = [];
  private current: ActivePiece | null = null;
  private next: PieceDef | null = null;

  private score = 0;
  private lines = 0;
  private best = 0;
  private isOver = false;

  /** 基础重力间隔 ms（随消行加速） */
  private gravityInterval = 500;
  private softDropActive = false;
  private gravityTimer: number | null = null;

  private scoreCb: ((score: number) => void) | null = null;
  private eventCb: ((event: string, payload?: unknown) => void) | null = null;

  private keyDownHandler = (e: KeyboardEvent) => this.handleKeyDown(e);
  private keyUpHandler = (e: KeyboardEvent) => this.handleKeyUp(e);
  private touchStart = { x: 0, y: 0 };
  private touchStartHandler = (e: TouchEvent) => this.handleTouchStart(e);
  private touchEndHandler = (e: TouchEvent) => this.handleTouchEnd(e);

  start(container: HTMLElement): void {
    const save = storage.load();
    this.best = save.scores['tetris'] ?? 0;

    this.root = container;
    this.root.innerHTML = `
      <div class="tetris-wrap">
        <div class="tetris-instructions">
          ← → 移动 · ↑/W 旋转 · ↓/S 软降 · 空格硬降 · 触屏可滑动
        </div>
        <div class="tetris-play">
          <div class="tetris-board-wrap">
            <canvas id="tetris-canvas" width="${this.COLS * this.CELL}" height="${this.ROWS * this.CELL}"></canvas>
          </div>
          <div class="tetris-side">
            <div>
              <div class="tetris-next-label">下一个</div>
              <div class="tetris-next-wrap">
                <canvas id="tetris-next" width="${4 * this.NEXT_CELL}" height="${4 * this.NEXT_CELL}"></canvas>
              </div>
            </div>
            <div class="tetris-stat-box">
              <div class="tetris-stat-label">消行</div>
              <div class="tetris-stat-num" id="tetris-lines">0</div>
            </div>
            <div class="tetris-stat-box">
              <div class="tetris-stat-label">速度</div>
              <div class="tetris-stat-num" id="tetris-speed">500</div>
            </div>
          </div>
        </div>
      </div>
    `;
    this.canvas = this.root.querySelector('#tetris-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.nextCanvas = this.root.querySelector('#tetris-next') as HTMLCanvasElement;
    this.nextCtx = this.nextCanvas.getContext('2d') as CanvasRenderingContext2D;

    this.initGrid();
    this.next = randomPiece();
    this.spawnPiece();
    this.bindInput();
    this.startGravity();
    this.render();
    this.scoreCb?.(this.score);
  }

  private initGrid() {
    this.grid = [];
    for (let r = 0; r < this.ROWS; r++) {
      const row: string[] = new Array(this.COLS).fill('');
      this.grid.push(row);
    }
    this.score = 0;
    this.lines = 0;
    this.isOver = false;
    this.gravityInterval = 500;
    this.softDropActive = false;
    this.current = null;
    this.next = null;
  }

  private bindInput() {
    window.addEventListener('keydown', this.keyDownHandler, { passive: false });
    window.addEventListener('keyup', this.keyUpHandler);
    this.canvas.addEventListener('touchstart', this.touchStartHandler, { passive: true });
    this.canvas.addEventListener('touchend', this.touchEndHandler, { passive: false });
  }

  private unbindInput() {
    window.removeEventListener('keydown', this.keyDownHandler);
    window.removeEventListener('keyup', this.keyUpHandler);
    this.canvas.removeEventListener('touchstart', this.touchStartHandler);
    this.canvas.removeEventListener('touchend', this.touchEndHandler);
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (this.isOver) return;
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A':
        e.preventDefault();
        this.move(-1);
        break;
      case 'ArrowRight': case 'd': case 'D':
        e.preventDefault();
        this.move(1);
        break;
      case 'ArrowUp': case 'w': case 'W':
        e.preventDefault();
        if (!e.repeat) this.rotate();
        break;
      case 'ArrowDown': case 's': case 'S':
        e.preventDefault();
        if (!e.repeat && !this.softDropActive) {
          this.softDropActive = true;
          this.restartGravity();
        }
        break;
      case ' ':
        e.preventDefault();
        if (!e.repeat) this.hardDrop();
        break;
    }
  }

  private handleKeyUp(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
      if (this.softDropActive) {
        this.softDropActive = false;
        this.restartGravity();
      }
    }
  }

  private handleTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    this.touchStart.x = e.touches[0].clientX;
    this.touchStart.y = e.touches[0].clientY;
  }

  private handleTouchEnd(e: TouchEvent) {
    if (this.isOver) return;
    e.preventDefault();
    if (e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - this.touchStart.x;
    const dy = e.changedTouches[0].clientY - this.touchStart.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    // 阈值 < 24px = 点击 = 硬降
    if (Math.max(absX, absY) < 24) {
      this.hardDrop();
      return;
    }
    if (absX > absY) {
      this.move(dx > 0 ? 1 : -1);
    } else if (dy > 0) {
      // 下滑 = 软降一格
      this.softDropOnce();
    } else {
      // 上滑 = 旋转
      this.rotate();
    }
  }

  /** 检查方块能否放置在指定位置 */
  private canPlace(def: PieceDef, rotation: number, x: number, y: number): boolean {
    const m = def.rotations[rotation];
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const gx = x + c;
        const gy = y + r;
        if (gx < 0 || gx >= this.COLS || gy >= this.ROWS) return false;
        if (gy >= 0 && this.grid[gy][gx] !== '') return false;
      }
    }
    return true;
  }

  /** 生成下一个方块；若无法放置则游戏结束 */
  private spawnPiece(): boolean {
    if (!this.next) this.next = randomPiece();
    const def = this.next;
    this.next = randomPiece();
    const rotation = 0;
    const matrix = def.rotations[rotation];
    const x = Math.floor((this.COLS - matrix[0].length) / 2);
    const y = 0;
    this.current = { def, rotation, x, y };
    if (!this.canPlace(def, rotation, x, y)) {
      this.isOver = true;
      this.endGame();
      return false;
    }
    this.renderNext();
    return true;
  }

  private move(dx: number) {
    if (!this.current) return;
    const nx = this.current.x + dx;
    if (this.canPlace(this.current.def, this.current.rotation, nx, this.current.y)) {
      this.current.x = nx;
      this.render();
    }
  }

  private rotate() {
    if (!this.current) return;
    const newRot = (this.current.rotation + 1) % 4;
    // 基础墙踢：尝试原位、左 1、右 1、左 2、右 2
    const kicks = [0, -1, 1, -2, 2];
    for (const k of kicks) {
      if (this.canPlace(this.current.def, newRot, this.current.x + k, this.current.y)) {
        this.current.rotation = newRot;
        this.current.x += k;
        this.render();
        return;
      }
    }
  }

  /** 软降一格（触屏） */
  private softDropOnce() {
    if (!this.current) return;
    if (this.canPlace(this.current.def, this.current.rotation, this.current.x, this.current.y + 1)) {
      this.current.y += 1;
      this.score += 1;
      if (this.score > this.best) this.best = this.score;
      this.scoreCb?.(this.score);
      this.render();
    } else {
      this.lockPiece();
    }
  }

  /** 硬降：直接落到底 */
  private hardDrop() {
    if (!this.current) return;
    let dropDist = 0;
    while (this.canPlace(this.current.def, this.current.rotation, this.current.x, this.current.y + 1)) {
      this.current.y += 1;
      dropDist += 1;
    }
    if (dropDist > 0) {
      this.score += dropDist * 2; // 硬降奖励
      if (this.score > this.best) this.best = this.score;
      this.scoreCb?.(this.score);
    }
    this.lockPiece();
    this.render();
  }

  /** 每个 tick：方块下落一格 */
  private tick() {
    if (this.isOver || !this.current) return;
    if (this.canPlace(this.current.def, this.current.rotation, this.current.x, this.current.y + 1)) {
      this.current.y += 1;
      if (this.softDropActive) {
        this.score += 1;
        if (this.score > this.best) this.best = this.score;
        this.scoreCb?.(this.score);
      }
      this.render();
    } else {
      this.lockPiece();
      this.render();
    }
  }

  private lockPiece() {
    if (!this.current) return;
    const m = this.current.def.rotations[this.current.rotation];
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (m[r][c]) {
          const gx = this.current.x + c;
          const gy = this.current.y + r;
          if (gy >= 0 && gy < this.ROWS && gx >= 0 && gx < this.COLS) {
            this.grid[gy][gx] = this.current.def.color;
          }
        }
      }
    }
    this.clearLines();
    this.spawnPiece();
  }

  private clearLines() {
    let cleared = 0;
    for (let r = this.ROWS - 1; r >= 0; r--) {
      let full = true;
      for (let c = 0; c < this.COLS; c++) {
        if (this.grid[r][c] === '') {
          full = false;
          break;
        }
      }
      if (full) {
        this.grid.splice(r, 1);
        const empty: string[] = new Array(this.COLS).fill('');
        this.grid.unshift(empty);
        cleared += 1;
        r += 1; // 同一行重新检查
      }
    }
    if (cleared > 0) {
      const scoreMap = [0, 100, 300, 500, 800];
      this.score += scoreMap[cleared] ?? 0;
      this.lines += cleared;
      if (this.score > this.best) this.best = this.score;
      this.scoreCb?.(this.score);
      // 加速：每 10 行 -50ms，最低 100ms
      const newInterval = Math.max(100, 500 - Math.floor(this.lines / 10) * 50);
      if (newInterval !== this.gravityInterval) {
        this.gravityInterval = newInterval;
        this.restartGravity();
      }
      this.updateSideStats();
      // 成就检测
      this.checkLineAchievements();
      this.checkScoreAchievements();
      if (cleared === 4) {
        const isNew = storage.unlock('tetris_clear_4');
        if (isNew) this.eventCb?.('achievement-unlocked', 'tetris_clear_4');
      }
    }
  }

  private checkLineAchievements() {
    const map: Array<{ lines: number; id: string }> = [
      { lines: 10, id: 'tetris_lines_10' },
      { lines: 50, id: 'tetris_lines_50' },
      { lines: 100, id: 'tetris_lines_100' },
    ];
    for (const { lines, id } of map) {
      if (this.lines >= lines) {
        const isNew = storage.unlock(id);
        if (isNew) this.eventCb?.('achievement-unlocked', id);
      }
    }
  }

  private checkScoreAchievements() {
    if (this.score >= 1000) {
      const isNew = storage.unlock('tetris_score_1000');
      if (isNew) this.eventCb?.('achievement-unlocked', 'tetris_score_1000');
    }
    if (this.score >= 5000) {
      const isNew = storage.unlock('tetris_score_5000');
      if (isNew) this.eventCb?.('achievement-unlocked', 'tetris_score_5000');
    }
  }

  private updateSideStats() {
    const linesEl = this.root.querySelector('#tetris-lines');
    if (linesEl) linesEl.textContent = String(this.lines);
    const speedEl = this.root.querySelector('#tetris-speed');
    if (speedEl) speedEl.textContent = String(this.gravityInterval);
  }

  private startGravity() {
    this.restartGravity();
  }

  private restartGravity() {
    if (this.gravityTimer !== null) {
      clearInterval(this.gravityTimer);
      this.gravityTimer = null;
    }
    if (this.isOver) return;
    const interval = this.softDropActive ? 50 : this.gravityInterval;
    this.gravityTimer = window.setInterval(() => this.tick(), interval);
  }

  private stopGravity() {
    if (this.gravityTimer !== null) {
      clearInterval(this.gravityTimer);
      this.gravityTimer = null;
    }
  }

  private render() {
    const ctx = this.ctx;
    const W = this.COLS * this.CELL;
    const H = this.ROWS * this.CELL;
    // 背景
    ctx.fillStyle = '#0f0f1e';
    ctx.fillRect(0, 0, W, H);
    // 网格线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let c = 1; c < this.COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * this.CELL, 0);
      ctx.lineTo(c * this.CELL, H);
      ctx.stroke();
    }
    for (let r = 1; r < this.ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * this.CELL);
      ctx.lineTo(W, r * this.CELL);
      ctx.stroke();
    }
    // 已锁定的格子
    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        if (this.grid[r][c] !== '') {
          this.drawCell(c, r, this.grid[r][c]);
        }
      }
    }
    // 当前方块
    if (this.current) {
      const m = this.current.def.rotations[this.current.rotation];
      for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
          if (m[r][c]) {
            const gx = this.current.x + c;
            const gy = this.current.y + r;
            if (gy >= 0) {
              this.drawCell(gx, gy, this.current.def.color);
            }
          }
        }
      }
    }
  }

  private drawCell(col: number, row: number, color: string) {
    const x = col * this.CELL;
    const y = row * this.CELL;
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, this.CELL - 2, this.CELL - 2);
    // 高光
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(x + 1, y + 1, this.CELL - 2, 3);
    // 边框
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1, y + 1, this.CELL - 2, this.CELL - 2);
  }

  private renderNext() {
    const ctx = this.nextCtx;
    const size = 4 * this.NEXT_CELL;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0f0f1e';
    ctx.fillRect(0, 0, size, size);
    if (!this.next) return;
    const m = this.next.rotations[0];
    // 计算填充格的边界，居中绘制
    let minR = m.length, maxR = -1, minC = m[0].length, maxC = -1;
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (m[r][c]) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
        }
      }
    }
    const w = (maxC - minC + 1) * this.NEXT_CELL;
    const h = (maxR - minR + 1) * this.NEXT_CELL;
    const offsetX = (size - w) / 2;
    const offsetY = (size - h) / 2;
    ctx.fillStyle = this.next.color;
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (m[r][c]) {
          const x = offsetX + (c - minC) * this.NEXT_CELL;
          const y = offsetY + (r - minR) * this.NEXT_CELL;
          ctx.fillRect(x + 1, y + 1, this.NEXT_CELL - 2, this.NEXT_CELL - 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
          ctx.fillRect(x + 1, y + 1, this.NEXT_CELL - 2, 3);
          ctx.fillStyle = this.next.color;
        }
      }
    }
  }

  private showOverlay() {
    if (this.overlayEl) this.overlayEl.remove();
    const overlay = document.createElement('div');
    overlay.className = 'tetris-overlay';
    overlay.innerHTML = `
      <h3>💀 游戏结束</h3>
      <p>得分 ${this.score} · 最高 ${this.best}</p>
      <p>消行 ${this.lines}</p>
      <div class="tetris-overlay-actions">
        <button class="btn-primary" data-action="restart">再来一局</button>
      </div>
    `;
    this.canvas.parentElement!.appendChild(overlay);
    this.overlayEl = overlay;
    overlay.querySelector('[data-action=restart]')?.addEventListener('click', () => {
      overlay.remove();
      this.overlayEl = null;
      this.restart();
    });
  }

  private restart() {
    this.stopGravity();
    this.initGrid();
    this.next = randomPiece();
    this.spawnPiece();
    this.startGravity();
    this.render();
    this.updateSideStats();
    this.scoreCb?.(this.score);
  }

  private endGame() {
    this.stopGravity();
    storage.recordScore('tetris', this.score);
    storage.markPlayed('tetris');
    const newly = checkMilestones(storage.load());
    for (const id of newly) {
      storage.markMilestone(id);
      this.eventCb?.('milestone-reached', id);
    }
    this.showOverlay();
  }

  destroy(): void {
    this.unbindInput();
    this.stopGravity();
    if (this.overlayEl) this.overlayEl.remove();
    // 若未结束就退出，仍记录分数和游玩
    if (!this.isOver && (this.score > 0 || this.lines > 0)) {
      storage.recordScore('tetris', this.score);
      storage.markPlayed('tetris');
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
    return '使用方向键移动和旋转方块，填满一行即可消除；空格硬降，目标尽可能高分';
  }
}
