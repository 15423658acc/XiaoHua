/**
 * 贪吃蛇游戏 —— 实现 GameInstance 接口
 *
 * 渲染：Canvas（20x20 网格，每格 20px，逻辑像素 400x400）
 * 输入：键盘方向键 + WASD + 触屏滑动
 * 计分：每吃一个食物 +10
 * 速度：初始 150ms/格，每吃 5 个食物加速 10ms（最低 60ms）
 * 成就：长度 10/20/30，单局 100/500 分
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';

const GRID = 20;
const CELL = 20; // 逻辑像素，canvas 400x400
const INITIAL_SPEED = 150;
const SPEED_STEP = 10;
const MIN_SPEED = 60;
const SPEEDUP_EVERY = 5;
const FOOD_SCORE = 10;

type Dir = 'up' | 'down' | 'left' | 'right';
interface Cell { x: number; y: number; }

const OPPOSITE: Record<Dir, Dir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

// 颜色（canvas 不能直接用 CSS 变量，需写死 hex）
const COLOR_BG = '#0f1a2e';
const COLOR_GRID = 'rgba(255,255,255,0.04)';
const COLOR_HEAD = '#e94560'; // var(--accent)
const COLOR_BODY = '#4ecca3'; // var(--success)
const COLOR_FOOD = '#ffd369'; // var(--warning)

export function SnakeFactory(): GameInstance {
  return new Snake();
}

class Snake implements GameInstance {
  private root!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private overlayEl: HTMLElement | null = null;

  private snake: Cell[] = [];
  private food: Cell | null = null;
  private dir: Dir = 'right';
  private pendingDir: Dir = 'right';
  private score = 0;
  private best = 0;
  private speed = INITIAL_SPEED;
  private foodEaten = 0;
  private isOver = false;
  private loopId: number | null = null;

  private scoreCb: ((s: number) => void) | null = null;
  private eventCb: ((e: string, p?: unknown) => void) | null = null;

  private keyHandler = (e: KeyboardEvent) => this.handleKey(e);
  private touchStart = { x: 0, y: 0 };
  private touchStartHandler = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    this.touchStart.x = e.touches[0].clientX;
    this.touchStart.y = e.touches[0].clientY;
  };
  private touchEndHandler = (e: TouchEvent) => this.handleTouchEnd(e);

  start(container: HTMLElement): void {
    const save = storage.load();
    this.best = save.scores['snake'] ?? 0;

    this.root = container;
    this.root.innerHTML = `
      <div class="snake-wrap">
        <div class="snake-instructions">
          方向键 / WASD 或滑动屏幕控制蛇移动，吃食物变长，撞墙或撞自身即结束
        </div>
        <div class="snake-board">
          <canvas class="snake-canvas" width="${GRID * CELL}" height="${GRID * CELL}"></canvas>
        </div>
      </div>
    `;
    this.canvas = this.root.querySelector('.snake-canvas')!;
    this.ctx = this.canvas.getContext('2d')!;

    this.resetState();
    this.bindInput();
    this.spawnFood();
    this.render();
    this.scoreCb?.(this.score);
    this.startLoop();
  }

  private resetState() {
    const cy = Math.floor(GRID / 2);
    const cx = Math.floor(GRID / 2);
    // 蛇头在中央，向右延伸，长度 3
    this.snake = [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
    ];
    this.dir = 'right';
    this.pendingDir = 'right';
    this.score = 0;
    this.speed = INITIAL_SPEED;
    this.foodEaten = 0;
    this.isOver = false;
    this.food = null;
  }

  private bindInput() {
    window.addEventListener('keydown', this.keyHandler, { passive: false });
    this.canvas.addEventListener('touchstart', this.touchStartHandler, { passive: true });
    this.canvas.addEventListener('touchend', this.touchEndHandler, { passive: false });
  }

  private unbindInput() {
    window.removeEventListener('keydown', this.keyHandler);
    this.canvas.removeEventListener('touchstart', this.touchStartHandler);
    this.canvas.removeEventListener('touchend', this.touchEndHandler);
  }

  private handleKey(e: KeyboardEvent) {
    let d: Dir | null = null;
    switch (e.key) {
      case 'ArrowUp': case 'w': case 'W': d = 'up'; break;
      case 'ArrowDown': case 's': case 'S': d = 'down'; break;
      case 'ArrowLeft': case 'a': case 'A': d = 'left'; break;
      case 'ArrowRight': case 'd': case 'D': d = 'right'; break;
    }
    if (!d) return;
    e.preventDefault();
    this.queueDir(d);
  }

  private handleTouchEnd(e: TouchEvent) {
    e.preventDefault();
    if (e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - this.touchStart.x;
    const dy = e.changedTouches[0].clientY - this.touchStart.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (Math.max(absX, absY) < 24) return; // 防误触
    let d: Dir;
    if (absX > absY) d = dx > 0 ? 'right' : 'left';
    else d = dy > 0 ? 'down' : 'up';
    this.queueDir(d);
  }

  private queueDir(d: Dir) {
    if (this.isOver) return;
    // 防反向：与当前方向相反时忽略
    if (d === OPPOSITE[this.dir]) return;
    this.pendingDir = d;
  }

  private startLoop() {
    if (this.loopId !== null) return;
    this.loopId = window.setInterval(() => this.tick(), this.speed);
  }

  private stopLoop() {
    if (this.loopId !== null) {
      window.clearInterval(this.loopId);
      this.loopId = null;
    }
  }

  private restartLoop() {
    this.stopLoop();
    this.startLoop();
  }

  private tick() {
    if (this.isOver) return;
    this.dir = this.pendingDir;
    const head = this.snake[0];
    const next: Cell = { x: head.x, y: head.y };
    switch (this.dir) {
      case 'up': next.y -= 1; break;
      case 'down': next.y += 1; break;
      case 'left': next.x -= 1; break;
      case 'right': next.x += 1; break;
    }
    // 撞墙
    if (next.x < 0 || next.x >= GRID || next.y < 0 || next.y >= GRID) {
      this.endGame();
      return;
    }
    const willEat = this.food != null && this.food.x === next.x && this.food.y === next.y;
    // 撞自身：若吃食物则不移动尾巴，需检查整条蛇；否则尾巴会移走，检查除尾段外的所有段
    const checkBody = willEat ? this.snake : this.snake.slice(0, this.snake.length - 1);
    for (const s of checkBody) {
      if (s.x === next.x && s.y === next.y) {
        this.endGame();
        return;
      }
    }

    this.snake.unshift(next);
    if (willEat) {
      this.score += FOOD_SCORE;
      if (this.score > this.best) this.best = this.score;
      this.foodEaten += 1;
      this.scoreCb?.(this.score);
      this.checkAchievements();
      if (this.foodEaten % SPEEDUP_EVERY === 0) {
        this.speed = Math.max(MIN_SPEED, this.speed - SPEED_STEP);
        this.restartLoop();
      }
      this.spawnFood();
    } else {
      this.snake.pop();
    }
    this.render();
  }

  private spawnFood() {
    const occupied = new Set(this.snake.map((s) => `${s.x},${s.y}`));
    const empties: Cell[] = [];
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (!occupied.has(`${x},${y}`)) empties.push({ x, y });
      }
    }
    if (empties.length === 0) {
      // 蛇填满整个棋盘，视为通关
      this.food = null;
      this.endGame();
      return;
    }
    this.food = empties[Math.floor(Math.random() * empties.length)];
  }

  private checkAchievements() {
    const len = this.snake.length;
    const lenMap: Array<[string, number]> = [
      ['snake_len_10', 10],
      ['snake_len_20', 20],
      ['snake_len_30', 30],
    ];
    for (const [id, need] of lenMap) {
      if (len >= need) {
        const isNew = storage.unlock(id);
        if (isNew) this.eventCb?.('achievement-unlocked', id);
      }
    }
    if (this.score >= 100) {
      const isNew = storage.unlock('snake_score_100');
      if (isNew) this.eventCb?.('achievement-unlocked', 'snake_score_100');
    }
    if (this.score >= 500) {
      const isNew = storage.unlock('snake_score_500');
      if (isNew) this.eventCb?.('achievement-unlocked', 'snake_score_500');
    }
  }

  private render() {
    const ctx = this.ctx;
    const size = GRID * CELL;
    // 背景
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, size, size);
    // 网格线（弱可见）
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    for (let i = 0; i <= GRID; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL + 0.5, 0);
      ctx.lineTo(i * CELL + 0.5, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * CELL + 0.5);
      ctx.lineTo(size, i * CELL + 0.5);
      ctx.stroke();
    }
    // 食物
    if (this.food) this.drawCell(this.food.x, this.food.y, COLOR_FOOD);
    // 蛇身（从尾到头绘制，使头压在身上）
    for (let i = this.snake.length - 1; i >= 0; i--) {
      const seg = this.snake[i];
      const color = i === 0 ? COLOR_HEAD : COLOR_BODY;
      this.drawCell(seg.x, seg.y, color);
    }
  }

  private drawCell(x: number, y: number, color: string) {
    const pad = 1;
    const r = 4;
    const px = x * CELL + pad;
    const py = y * CELL + pad;
    const w = CELL - pad * 2;
    this.ctx.fillStyle = color;
    this.roundRectPath(px, py, w, w, r);
    this.ctx.fill();
  }

  /** 兼容性圆角矩形路径（不依赖 roundRect API） */
  private roundRectPath(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  private endGame() {
    if (this.isOver) return;
    this.isOver = true;
    this.stopLoop();
    storage.recordScore('snake', this.score);
    storage.markPlayed('snake');
    const newly = checkMilestones(storage.load());
    for (const id of newly) {
      storage.markMilestone(id);
      this.eventCb?.('milestone-reached', id);
    }
    this.showOverlay();
  }

  private showOverlay() {
    if (this.overlayEl) this.overlayEl.remove();
    const overlay = document.createElement('div');
    overlay.className = 'snake-overlay';
    overlay.innerHTML = `
      <h3>💀 游戏结束</h3>
      <p>得分 ${this.score} · 最高 ${this.best}</p>
      <div class="snake-overlay-actions">
        <button class="btn-primary" data-action="restart">再来一局</button>
      </div>
    `;
    const board = this.root.querySelector('.snake-board')!;
    board.appendChild(overlay);
    this.overlayEl = overlay;
    overlay.querySelector('[data-action=restart]')?.addEventListener('click', () => {
      overlay.remove();
      this.overlayEl = null;
      this.resetState();
      this.spawnFood();
      this.render();
      this.scoreCb?.(this.score);
      this.startLoop();
    });
  }

  destroy(): void {
    this.unbindInput();
    this.stopLoop();
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    // 若未结束就退出，仍记录分数和游玩 + 处理里程碑 + 触发事件
    if (!this.isOver && this.score > 0) {
      storage.recordScore('snake', this.score);
      storage.markPlayed('snake');
      const newly = checkMilestones(storage.load());
      for (const id of newly) {
        storage.markMilestone(id);
        this.eventCb?.('milestone-reached', id);
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
    return '方向键 / WASD 或滑动屏幕控制蛇移动，吃食物变长，撞墙或撞自身即结束';
  }
}
