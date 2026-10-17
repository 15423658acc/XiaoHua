/**
 * 跳跃塔 Doodle Jump 风格 —— 实现 GameInstance 接口
 *
 * 渲染：Canvas（400x600 内部分辨率，CSS 自适应 2:3）
 * 输入：键盘 ←/→ 或 A/D 移动；触摸左/右半屏控制方向；空格暂停
 * 物理：重力 0.3/帧，落到平台反弹 vy = -12；左右穿出环绕
 * 相机：上升至屏幕上半部时跟随，下落不跟随
 * 平台：普通 70% / 横向移动 20% / 易碎 10%（高度 ≥1500 才出现）
 * 计分：高度分 = floor(maxHeight / 10)
 * 成就：高度分 100/500/1000、踩横向移动平台 5 次（成员变量累计跨局保留）
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';

export function DoodlejumpFactory(): GameInstance {
  return new Doodlejump();
}

type PlatformType = 'normal' | 'moving' | 'fragile';

interface Platform {
  x: number;
  y: number; // 世界坐标，y 越大越靠下（与 canvas 一致）
  w: number;
  h: number;
  type: PlatformType;
  vx: number; // 横向移动速度（仅 moving）
  alive: boolean;
  breaking: boolean; // 易碎平台已踩、等待消失
  breakAt: number; // 触发消失的时间戳
  hasCounted: boolean; // 是否已计入移动平台成就
}

interface Star {
  x: number;
  y: number;
  r: number;
  alpha: number;
}

interface PlayerState {
  x: number;
  y: number;
  vy: number;
  vx: number;
  scaleX: number;
  scaleY: number;
  facing: number; // -1 左 / 1 右
}

type GameState = 'idle' | 'running' | 'over';

class Doodlejump implements GameInstance {
  private root!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private overlayEl: HTMLElement | null = null;

  private readonly W = 400;
  private readonly H = 600;
  private readonly PLAYER_R = 16;
  private readonly GRAVITY = 0.3;
  private readonly JUMP_VY = -12;
  private readonly PLATFORM_H = 12;
  private readonly START_Y = 500; // H - 100，玩家初始 y

  private player: PlayerState = {
    x: 200,
    y: 500,
    vy: 0,
    vx: 0,
    scaleX: 1,
    scaleY: 1,
    facing: 1,
  };
  private platforms: Platform[] = [];
  private stars: Star[] = [];

  private cameraY = 0; // 相机 y 偏移：渲染时各对象 y 减去 cameraY
  private maxHeight = 500; // 玩家到达过的最小 y（向上为小）
  private score = 0;
  private best = 0;
  private state: GameState = 'idle';
  private isOver = false;
  // 累计踩移动平台次数（跨局保留：不随 restart 重置）
  private movingPlatformCount = 0;

  private leftHeld = false;
  private rightHeld = false;
  private touchLeft = false;
  private touchRight = false;

  private rafId: number | null = null;

  private scoreCb: ((score: number) => void) | null = null;
  private eventCb: ((event: string, payload?: unknown) => void) | null = null;

  private keyDownHandler = (e: KeyboardEvent) => this.handleKeyDown(e);
  private keyUpHandler = (e: KeyboardEvent) => this.handleKeyUp(e);
  private touchStartHandler = (e: TouchEvent) => this.handleTouchStart(e);
  private touchEndHandler = (e: TouchEvent) => this.handleTouchEnd(e);
  private resizeHandler = () => { /* CSS 自适应，无需逻辑 */ };

  start(container: HTMLElement): void {
    const save = storage.load();
    this.best = save.scores['doodlejump'] ?? 0;
    this.overlayEl = null;

    this.root = container;
    this.root.innerHTML = `
      <div class="doodle-wrap">
        <div class="doodle-instructions">
          ←/→ 或 A/D 移动 · 触摸左右半屏控制 · 空格暂停
        </div>
        <div class="doodle-board-wrap">
          <canvas id="doodle-canvas" width="${this.W}" height="${this.H}"></canvas>
        </div>
      </div>
    `;
    this.canvas = this.root.querySelector('#doodle-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;

    this.resetGame();
    this.bindInput();
    this.render();
    this.scoreCb?.(this.score);
  }

  /** 重置一局（start 与 restart 共用） */
  private resetGame() {
    this.player = {
      x: this.W / 2,
      y: this.START_Y,
      vy: this.JUMP_VY,
      vx: 0,
      scaleX: 1,
      scaleY: 1,
      facing: 1,
    };
    this.cameraY = 0;
    this.maxHeight = this.START_Y;
    this.score = 0;
    this.isOver = false;
    this.state = 'idle';
    this.platforms = [];
    this.leftHeld = false;
    this.rightHeld = false;
    this.touchLeft = false;
    this.touchRight = false;

    // 起始大平台（玩家下方）
    this.platforms.push({
      x: (this.W - 80) / 2,
      y: this.START_Y + 40,
      w: 80,
      h: this.PLATFORM_H,
      type: 'normal',
      vx: 0,
      alive: true,
      breaking: false,
      breakAt: 0,
      hasCounted: false,
    });
    // 向上预生成若干平台
    let y = this.START_Y + 40;
    while (y > -200) {
      y -= 60 + Math.random() * 40;
      this.spawnPlatformAt(y);
    }

    // 星星装饰
    this.stars = [];
    for (let i = 0; i < 60; i++) {
      this.stars.push({
        x: Math.random() * this.W,
        y: Math.random() * 4 * this.H - 2 * this.H,
        r: Math.random() * 1.4 + 0.4,
        alpha: Math.random() * 0.6 + 0.2,
      });
    }
  }

  /** 在世界坐标 y 处生成一个平台，类型随攀登高度变化 */
  private spawnPlatformAt(y: number) {
    const climbed = Math.max(0, this.START_Y - this.maxHeight);
    const w = 60 + Math.random() * 20;
    const x = Math.random() * (this.W - w);
    // 易碎平台比例：高度 < 1500 不出现；之后线性增长，最高 25%
    const fragileRatio = climbed >= 1500
      ? Math.min(0.25, 0.1 + (climbed - 1500) / 12000)
      : 0;
    const movingRatio = 0.2;
    const roll = Math.random();
    let type: PlatformType = 'normal';
    if (roll < fragileRatio) type = 'fragile';
    else if (roll < fragileRatio + movingRatio) type = 'moving';
    const vx = type === 'moving'
      ? (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random())
      : 0;
    this.platforms.push({
      x,
      y,
      w,
      h: this.PLATFORM_H,
      type,
      vx,
      alive: true,
      breaking: false,
      breakAt: 0,
      hasCounted: false,
    });
  }

  // ===== 输入绑定 =====
  private bindInput() {
    window.addEventListener('keydown', this.keyDownHandler, { passive: false });
    window.addEventListener('keyup', this.keyUpHandler);
    this.canvas.addEventListener('touchstart', this.touchStartHandler, { passive: false });
    this.canvas.addEventListener('touchend', this.touchEndHandler, { passive: false });
    this.canvas.addEventListener('touchcancel', this.touchEndHandler, { passive: false });
    window.addEventListener('resize', this.resizeHandler);
  }

  private unbindInput() {
    window.removeEventListener('keydown', this.keyDownHandler);
    window.removeEventListener('keyup', this.keyUpHandler);
    this.canvas.removeEventListener('touchstart', this.touchStartHandler);
    this.canvas.removeEventListener('touchend', this.touchEndHandler);
    this.canvas.removeEventListener('touchcancel', this.touchEndHandler);
    window.removeEventListener('resize', this.resizeHandler);
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (this.isOver) return;
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A':
        e.preventDefault();
        this.leftHeld = true;
        this.startIfIdle();
        break;
      case 'ArrowRight': case 'd': case 'D':
        e.preventDefault();
        this.rightHeld = true;
        this.startIfIdle();
        break;
      case ' ':
        e.preventDefault();
        if (!e.repeat) this.togglePause();
        break;
    }
  }

  private handleKeyUp(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A':
        this.leftHeld = false;
        break;
      case 'ArrowRight': case 'd': case 'D':
        this.rightHeld = false;
        break;
    }
  }

  private handleTouchStart(e: TouchEvent) {
    if (this.isOver) return;
    e.preventDefault();
    this.refreshTouchState(e.touches);
    this.startIfIdle();
  }

  private handleTouchEnd(e: TouchEvent) {
    this.refreshTouchState(e.touches);
  }

  /** 根据当前 touches 列表重新计算左右触摸状态 */
  private refreshTouchState(touches: TouchList) {
    this.touchLeft = false;
    this.touchRight = false;
    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      const x = this.clientXToCanvasX(t.clientX);
      if (x < this.W / 2) this.touchLeft = true;
      else this.touchRight = true;
    }
  }

  private clientXToCanvasX(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0) return this.W / 2;
    const scale = this.W / rect.width;
    return (clientX - rect.left) * scale;
  }

  private startIfIdle() {
    if (this.state === 'idle') {
      this.state = 'running';
      this.startLoop();
    }
  }

  private togglePause() {
    if (this.isOver) return;
    if (this.state === 'running') {
      this.state = 'idle';
      this.stopLoop();
      this.render();
    } else if (this.state === 'idle') {
      this.state = 'running';
      this.startLoop();
    }
  }

  // ===== 主循环 =====
  private startLoop() {
    if (this.rafId !== null) return;
    const loop = () => {
      if (this.state !== 'running') {
        this.rafId = null;
        return;
      }
      this.update();
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private update() {
    // ---- 横向移动：按住加速、松开减速 ----
    const ACC = 0.6;
    const FRICTION = 0.85;
    const MAX_VX = 6;
    let dir = 0;
    if (this.leftHeld || this.touchLeft) dir -= 1;
    if (this.rightHeld || this.touchRight) dir += 1;
    if (dir !== 0) {
      this.player.vx += dir * ACC;
      this.player.facing = dir;
    } else {
      this.player.vx *= FRICTION;
    }
    if (this.player.vx > MAX_VX) this.player.vx = MAX_VX;
    if (this.player.vx < -MAX_VX) this.player.vx = -MAX_VX;
    this.player.x += this.player.vx;
    // 左右环绕
    if (this.player.x < -this.PLAYER_R) this.player.x = this.W + this.PLAYER_R;
    if (this.player.x > this.W + this.PLAYER_R) this.player.x = -this.PLAYER_R;

    // ---- 重力 ----
    this.player.vy += this.GRAVITY;
    this.player.y += this.player.vy;

    // ---- 弹性形变（上升拉伸，下降压扁）----
    const stretchTarget = this.player.vy < 0 ? 1.2 : 0.85;
    this.player.scaleY += (stretchTarget - this.player.scaleY) * 0.2;
    this.player.scaleX += (2 - stretchTarget - this.player.scaleX) * 0.2;

    // ---- 平台碰撞（仅在下落时检测，使用扫掠判断防穿透）----
    if (this.player.vy > 0) {
      const playerBottom = this.player.y + this.PLAYER_R;
      const prevBottom = playerBottom - this.player.vy;
      for (const p of this.platforms) {
        if (!p.alive) continue;
        // 水平重叠（玩家有效宽度取半径的一半，避免边缘误触）
        if (this.player.x + this.PLAYER_R * 0.5 > p.x &&
            this.player.x - this.PLAYER_R * 0.5 < p.x + p.w) {
          const platTop = p.y;
          // 上一帧底在平台顶之上或之内、当前帧底已到平台顶之下
          if (playerBottom >= platTop && prevBottom <= platTop + p.h) {
            this.player.y = platTop - this.PLAYER_R;
            this.player.vy = this.JUMP_VY;
            // 易碎平台：触发 0.5s 后消失
            if (p.type === 'fragile' && !p.breaking) {
              p.breaking = true;
              p.breakAt = Date.now() + 500;
            }
            // 移动平台计数（同一平台只计一次，鼓励玩家接触不同移动平台）
            if (p.type === 'moving' && !p.hasCounted) {
              p.hasCounted = true;
              this.movingPlatformCount += 1;
              if (this.movingPlatformCount >= 5) {
                const isNew = storage.unlock('doodle_use_moving');
                if (isNew) this.eventCb?.('achievement-unlocked', 'doodle_use_moving');
              }
            }
            break;
          }
        }
      }
    }

    // ---- 易碎平台消失 & 移动平台来回 ----
    const now = Date.now();
    for (const p of this.platforms) {
      if (p.breaking && now >= p.breakAt) {
        p.alive = false;
      }
      if (p.type === 'moving' && p.alive) {
        p.x += p.vx;
        if (p.x < 0) { p.x = 0; p.vx = -p.vx; }
        if (p.x + p.w > this.W) { p.x = this.W - p.w; p.vx = -p.vx; }
      }
    }

    // ---- 相机：上升至屏幕上半部时跟随上移，下落不跟随 ----
    const screenY = this.player.y - this.cameraY;
    if (screenY < this.H / 2) {
      const shift = this.H / 2 - screenY;
      this.cameraY -= shift;
    }

    // ---- 高度与计分 ----
    if (this.player.y < this.maxHeight) this.maxHeight = this.player.y;
    const climbed = Math.max(0, this.START_Y - this.maxHeight);
    const newScore = Math.floor(climbed / 10);
    if (newScore !== this.score) {
      this.score = newScore;
      if (this.score > this.best) this.best = this.score;
      this.scoreCb?.(this.score);
      this.checkHeightAchievements();
    }

    // ---- 上方继续生成新平台 ----
    let topY = Infinity;
    for (const p of this.platforms) {
      if (p.y < topY) topY = p.y;
    }
    const ceilingWorld = this.cameraY - 100;
    while (topY > ceilingWorld) {
      const gap = this.computeGap(climbed);
      topY -= gap;
      this.spawnPlatformAt(topY);
    }

    // ---- 清理屏幕下方平台 ----
    const bottomWorld = this.cameraY + this.H + 50;
    this.platforms = this.platforms.filter((p) => p.y < bottomWorld);

    // ---- 失败检测：玩家整体掉出屏幕底部 ----
    if (this.player.y - this.PLAYER_R > this.cameraY + this.H) {
      this.endGame();
    }
  }

  /** 平台间距：基础 60，随攀登高度增大间距与抖动范围 */
  private computeGap(climbed: number): number {
    const base = 60;
    const extra = Math.min(80, climbed / 80);
    const range = 40 + Math.min(40, climbed / 200);
    return base + extra + Math.random() * range;
  }

  private checkHeightAchievements() {
    if (this.score >= 100) {
      const isNew = storage.unlock('doodle_height_100');
      if (isNew) this.eventCb?.('achievement-unlocked', 'doodle_height_100');
    }
    if (this.score >= 500) {
      const isNew = storage.unlock('doodle_height_500');
      if (isNew) this.eventCb?.('achievement-unlocked', 'doodle_height_500');
    }
    if (this.score >= 1000) {
      const isNew = storage.unlock('doodle_height_1000');
      if (isNew) this.eventCb?.('achievement-unlocked', 'doodle_height_1000');
    }
  }

  // ===== 渲染 =====
  private render() {
    const ctx = this.ctx;
    // 背景渐变（底 #16213e → 顶 #0f3460）
    const grad = ctx.createLinearGradient(0, this.H, 0, 0);
    grad.addColorStop(0, '#16213e');
    grad.addColorStop(1, '#0f3460');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.W, this.H);

    // 远景星星（视差跟随相机）
    const parallax = this.cameraY * 0.15;
    for (const s of this.stars) {
      let sy = s.y - parallax;
      sy = ((sy % this.H) + this.H) % this.H;
      ctx.fillStyle = `rgba(230, 230, 230, ${s.alpha})`;
      ctx.beginPath();
      ctx.arc(s.x, sy, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 平台
    for (const p of this.platforms) {
      if (!p.alive) continue;
      const sy = p.y - this.cameraY;
      if (sy < -this.PLATFORM_H || sy > this.H) continue;
      let color = '#2d8f47';
      if (p.type === 'moving') color = '#3a7bd5';
      else if (p.type === 'fragile') color = p.breaking ? '#8b5a2b' : '#b8860b';
      ctx.fillStyle = color;
      this.roundedRect(p.x, sy, p.w, p.h, 4);
      ctx.fill();
      // 顶部高光
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      this.roundedRect(p.x, sy, p.w, 3, 2);
      ctx.fill();
    }

    // 玩家
    const px = this.player.x;
    const py = this.player.y - this.cameraY;
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(this.player.scaleX, this.player.scaleY);
    ctx.fillStyle = '#4ecca3';
    ctx.beginPath();
    ctx.arc(0, 0, this.PLAYER_R, 0, Math.PI * 2);
    ctx.fill();
    // 眼睛（朝向跟随 facing）
    const eyeOff = this.player.facing >= 0 ? 2 : -2;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-4 + eyeOff, -3, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(5 + eyeOff, -3, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(-4 + eyeOff + this.player.facing, -3, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(5 + eyeOff + this.player.facing, -3, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 提示层（idle）
    if (this.state === 'idle') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.fillStyle = '#e6e6e6';
      ctx.font = '18px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('按 ←/→ 或点击左右半屏开始移动', this.W / 2, this.H / 2);
      ctx.fillStyle = '#a0a0b8';
      ctx.font = '13px -apple-system, sans-serif';
      ctx.fillText('空格暂停', this.W / 2, this.H / 2 + 26);
    }
  }

  private roundedRect(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  private showOverlay() {
    if (this.overlayEl) this.overlayEl.remove();
    const overlay = document.createElement('div');
    overlay.className = 'doodle-overlay';
    overlay.innerHTML = `
      <h3>💀 游戏结束</h3>
      <p>高度分 ${this.score} · 最高 ${this.best}</p>
      <div class="doodle-overlay-actions">
        <button class="btn-primary" data-action="restart">再来一局</button>
      </div>
    `;
    this.canvas.parentElement!.appendChild(overlay);
    this.overlayEl = overlay;
    overlay.querySelector('[data-action=restart]')?.addEventListener('click', () => {
      overlay.remove();
      this.overlayEl = null;
      this.resetGame();
      this.render();
      this.scoreCb?.(this.score);
    });
  }

  private endGame() {
    this.isOver = true;
    this.state = 'over';
    this.stopLoop();
    storage.recordScore('doodlejump', this.score);
    storage.markPlayed('doodlejump');
    const newly = checkMilestones(storage.load());
    for (const id of newly) {
      storage.markMilestone(id);
      this.eventCb?.('milestone-reached', id);
    }
    this.showOverlay();
  }

  destroy(): void {
    this.unbindInput();
    this.stopLoop();
    if (this.overlayEl) this.overlayEl.remove();
    // 若未结束就退出，仍记录分数和游玩
    if (!this.isOver && this.score > 0) {
      storage.recordScore('doodlejump', this.score);
      storage.markPlayed('doodlejump');
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
    return '使用方向键或屏幕左右半屏控制小人，自动跳跃踩平台，越跳越高，掉落即失败';
  }
}
