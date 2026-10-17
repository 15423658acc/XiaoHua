/**
 * 祖玛 —— 实现 GameInstance 接口
 *
 * 渲染：Canvas + requestAnimationFrame
 * 输入：鼠标 mousemove / 触屏 touchmove 控制发射器角度，点击/触屏发射
 * 玩法：消除 3+ 同色连续球，球链前端到达洞口则失败
 * 关卡：3 关递增（球数 15→25→35，速度 0.5→0.7→0.9）
 * 成就：通关第 1 关、通关全部 3 关、单次发射 3 连锁
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';

export function ZumaFactory(): GameInstance {
  return new Zuma();
}

interface Ball {
  t: number; // 在路径上的位置参数（0=起点，pathLength=洞口）
  color: string;
  radius: number;
}

interface FlyingBall {
  x: number;
  y: number;
  dx: number;
  dy: number;
  color: string;
}

type GameState = 'running' | 'over' | 'level-clear' | 'all-clear';

class Zuma implements GameInstance {
  private root!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private overlayEl: HTMLElement | null = null;
  private levelEl: HTMLElement | null = null;
  private ballsEl: HTMLElement | null = null;

  private readonly W = 400;
  private readonly H = 500;
  private readonly BALL_R = 12;
  private readonly LAUNCHER_X = 200;
  private readonly LAUNCHER_Y = 440;
  private readonly FLY_SPEED = 8;
  private readonly COLORS = ['#e94560', '#4ecca3', '#ffd369', '#5e72e4', '#fb923c'];

  private readonly LEVELS = [
    { balls: 15, speed: 0.5 },
    { balls: 25, speed: 0.7 },
    { balls: 35, speed: 0.9 },
  ];

  // 折线路径：起点为球链生成点，终点为洞口
  private readonly pathPoints = [
    { x: 60, y: 50 },
    { x: 340, y: 50 },
    { x: 340, y: 110 },
    { x: 60, y: 110 },
    { x: 60, y: 170 },
    { x: 340, y: 170 },
    { x: 340, y: 230 },
    { x: 60, y: 230 },
    { x: 60, y: 290 },
    { x: 340, y: 290 },
    { x: 340, y: 350 },
    { x: 200, y: 350 },
    { x: 200, y: 400 },
  ];
  private segLengths: number[] = [];
  private cumLengths: number[] = [];
  private pathLength = 0;

  private balls: Ball[] = [];
  private flying: FlyingBall[] = [];
  private currentColor = '';
  private nextColor = '';
  private angle = -Math.PI / 2; // 默认朝上
  private hasAimed = false; // 移动端是否已瞄准（两段式触摸状态）
  private touchStartPos = { x: 0, y: 0 };

  private score = 0;
  private best = 0;
  private level = 0;
  private state: GameState = 'running';
  private isOver = false;

  private rafId: number | null = null;

  private scoreCb: ((score: number) => void) | null = null;
  private eventCb: ((event: string, payload?: unknown) => void) | null = null;

  private mouseMoveHandler = (e: MouseEvent) => this.handleMouseMove(e);
  private clickHandler = (e: MouseEvent) => this.handleClick(e);
  private touchMoveHandler = (e: TouchEvent) => this.handleTouchMove(e);
  private touchStartHandler = (e: TouchEvent) => this.handleTouchStart(e);
  private touchEndHandler = (e: TouchEvent) => this.handleTouchEnd(e);

  private loop = () => {
    if (this.state !== 'running') {
      this.rafId = null;
      return;
    }
    this.update();
    this.render();
    this.rafId = requestAnimationFrame(this.loop);
  };

  start(container: HTMLElement): void {
    const save = storage.load();
    this.best = save.scores['zuma'] ?? 0;

    this.root = container;
    this.root.innerHTML = `
      <div class="zuma-wrap">
        <div class="zuma-header">
          <span class="zuma-level">第 1 关</span>
          <span class="zuma-balls">剩余球: 15</span>
        </div>
        <div class="zuma-board-wrap">
          <canvas id="zuma-canvas"></canvas>
          <div class="zuma-overlay" hidden></div>
        </div>
        <div class="zuma-instructions">桌面：鼠标移动瞄准·点击发射；移动端：触摸屏幕拖动选择方向·松开后再次触摸即发射</div>
      </div>
    `;
    this.canvas = this.root.querySelector('#zuma-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.levelEl = this.root.querySelector('.zuma-level');
    this.ballsEl = this.root.querySelector('.zuma-balls');
    this.overlayEl = this.root.querySelector('.zuma-overlay');

    this.setupCanvas();
    this.computePath();
    this.score = 0;
    this.startLevel(0);
    this.bindInput();
    this.render();
    this.scoreCb?.(this.score);
  }

  private setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.W * dpr;
    this.canvas.height = this.H * dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
  }

  private computePath() {
    this.segLengths = [];
    this.cumLengths = [0];
    let total = 0;
    for (let i = 0; i < this.pathPoints.length - 1; i++) {
      const a = this.pathPoints[i];
      const b = this.pathPoints[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      this.segLengths.push(len);
      total += len;
      this.cumLengths.push(total);
    }
    this.pathLength = total;
  }

  /** 根据 t 值（路径距离）取得路径上的坐标，t<0 向起点前外推 */
  private getPointAt(t: number): { x: number; y: number } {
    if (t <= 0) {
      const a = this.pathPoints[0];
      const b = this.pathPoints[1];
      const segLen = this.segLengths[0] || 1;
      const ux = (b.x - a.x) / segLen;
      const uy = (b.y - a.y) / segLen;
      return { x: a.x + t * ux, y: a.y + t * uy };
    }
    if (t >= this.pathLength) {
      const last = this.pathPoints[this.pathPoints.length - 1];
      return { x: last.x, y: last.y };
    }
    for (let i = 0; i < this.segLengths.length; i++) {
      if (t <= this.cumLengths[i + 1]) {
        const segT = this.segLengths[i] > 0 ? (t - this.cumLengths[i]) / this.segLengths[i] : 0;
        const a = this.pathPoints[i];
        const b = this.pathPoints[i + 1];
        return { x: a.x + segT * (b.x - a.x), y: a.y + segT * (b.y - a.y) };
      }
    }
    const last = this.pathPoints[this.pathPoints.length - 1];
    return { x: last.x, y: last.y };
  }

  /** 将 (x,y) 投影到路径，返回对应 t 值 */
  private projectToPath(x: number, y: number): number {
    let bestT = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.segLengths.length; i++) {
      const a = this.pathPoints[i];
      const b = this.pathPoints[i + 1];
      const segLen = this.segLengths[i];
      if (segLen === 0) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const r = ((x - a.x) * dx + (y - a.y) * dy) / (segLen * segLen);
      const tc = Math.max(0, Math.min(1, r));
      const px = a.x + tc * dx;
      const py = a.y + tc * dy;
      const dist = Math.hypot(x - px, y - py);
      if (dist < bestDist) {
        bestDist = dist;
        bestT = this.cumLengths[i] + tc * segLen;
      }
    }
    return bestT;
  }

  private randomColor(exclude: string[] = []): string {
    const choices = this.COLORS.filter((c) => !exclude.includes(c));
    return choices[Math.floor(Math.random() * choices.length)] ?? this.COLORS[0];
  }

  /** 从剩余球链中随机取一种颜色，保证发射的球能命中 */
  private randomChainColor(): string {
    if (this.balls.length === 0) return this.COLORS[Math.floor(Math.random() * this.COLORS.length)];
    const present = [...new Set(this.balls.map((b) => b.color))];
    return present[Math.floor(Math.random() * present.length)] ?? this.COLORS[0];
  }

  private generateChain(n: number): Ball[] {
    const balls: Ball[] = [];
    const minDist = 2 * this.BALL_R;
    for (let i = 0; i < n; i++) {
      const exclude: string[] = [];
      const prev1 = balls[i - 1]?.color;
      const prev2 = balls[i - 2]?.color;
      if (prev1 && prev2 && prev1 === prev2) exclude.push(prev1);
      const color = this.randomColor(exclude);
      balls.push({ t: -i * minDist, color, radius: this.BALL_R });
    }
    return balls;
  }

  private startLevel(idx: number) {
    this.level = idx;
    const cfg = this.LEVELS[idx];
    this.balls = this.generateChain(cfg.balls);
    this.flying = [];
    this.currentColor = this.randomChainColor();
    this.nextColor = this.randomChainColor();
    this.state = 'running';
    this.isOver = false;
    this.hasAimed = false; // 新关卡重置瞄准状态，要求重新瞄准后再发射
    if (this.levelEl) this.levelEl.textContent = `第 ${idx + 1} 关`;
    this.updateBallsDisplay();
    this.startLoop();
  }

  private updateBallsDisplay() {
    if (this.ballsEl) this.ballsEl.textContent = `剩余球: ${this.balls.length}`;
  }

  private bindInput() {
    this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.addEventListener('click', this.clickHandler);
    this.canvas.addEventListener('touchstart', this.touchStartHandler, { passive: false });
    this.canvas.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
    this.canvas.addEventListener('touchend', this.touchEndHandler, { passive: false });
  }

  private unbindInput() {
    this.canvas.removeEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.removeEventListener('click', this.clickHandler);
    this.canvas.removeEventListener('touchstart', this.touchStartHandler);
    this.canvas.removeEventListener('touchmove', this.touchMoveHandler);
    this.canvas.removeEventListener('touchend', this.touchEndHandler);
  }

  private clientToCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0) return { x: this.W / 2, y: this.H / 2 };
    return {
      x: ((clientX - rect.left) / rect.width) * this.W,
      y: ((clientY - rect.top) / rect.height) * this.H,
    };
  }

  private updateAngle(x: number, y: number) {
    const dx = x - this.LAUNCHER_X;
    const dy = y - this.LAUNCHER_Y;
    let a = Math.atan2(dy, dx);
    // 限制角度在上半圆 [-π+0.1, -0.1]，避免向下发射
    if (a > -0.1) a = -0.1;
    if (a < -Math.PI + 0.1) a = -Math.PI + 0.1;
    this.angle = a;
  }

  private handleMouseMove(e: MouseEvent) {
    if (this.isOver) return;
    const p = this.clientToCanvas(e.clientX, e.clientY);
    this.updateAngle(p.x, p.y);
    if (this.state !== 'running') this.render();
  }

  private handleTouchMove(e: TouchEvent) {
    if (this.isOver) return;
    e.preventDefault();
    if (e.touches.length !== 1) return;
    const p = this.clientToCanvas(e.touches[0].clientX, e.touches[0].clientY);
    this.updateAngle(p.x, p.y);
  }

  private handleClick(e: MouseEvent) {
    if (this.isOver) return;
    const p = this.clientToCanvas(e.clientX, e.clientY);
    this.updateAngle(p.x, p.y);
    this.shoot();
  }

  private handleTouchStart(e: TouchEvent) {
    if (this.isOver) return;
    e.preventDefault();
    if (e.touches.length !== 1) return;
    const p = this.clientToCanvas(e.touches[0].clientX, e.touches[0].clientY);
    if (this.hasAimed) {
      // 已瞄准过，这次 touchstart 触发发射
      this.updateAngle(p.x, p.y);
      this.shoot();
      this.hasAimed = false; // 重置，下次需重新瞄准
    } else {
      // 第一次触摸，仅记录起点开始瞄准（touchmove 会持续更新）
      this.touchStartPos = p;
      this.updateAngle(p.x, p.y);
      this.hasAimed = true;
    }
  }

  private handleTouchEnd(_e: TouchEvent) {
    // 松手不发射，hasAimed 保持，等下次 touchstart 触发发射
  }

  private shoot() {
    if (this.state !== 'running') return;
    if (this.balls.length === 0) return;
    const color = this.currentColor;
    this.currentColor = this.nextColor;
    this.nextColor = this.randomChainColor();
    this.flying.push({
      x: this.LAUNCHER_X,
      y: this.LAUNCHER_Y,
      dx: Math.cos(this.angle) * this.FLY_SPEED,
      dy: Math.sin(this.angle) * this.FLY_SPEED,
      color,
    });
  }

  private startLoop() {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(this.loop);
  }

  private stopLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private update() {
    this.updateChain();
    this.updateFlying();
  }

  private updateChain() {
    const speed = this.LEVELS[this.level].speed;
    const minDist = 2 * this.BALL_R;
    // 全部前进
    for (const b of this.balls) {
      b.t += speed;
    }
    // 从前向后：重叠推回 + 间隙追赶
    for (let i = 1; i < this.balls.length; i++) {
      const front = this.balls[i - 1];
      const back = this.balls[i];
      const dist = front.t - back.t;
      if (dist < minDist) {
        back.t = front.t - minDist;
      } else if (dist > minDist + 0.5) {
        const catchUp = speed * 2;
        back.t += catchUp;
        if (front.t - back.t < minDist) {
          back.t = front.t - minDist;
        }
      }
    }
    // 到达洞口
    if (this.balls.length > 0 && this.balls[0].t >= this.pathLength - this.BALL_R) {
      this.endGame();
      return;
    }
    this.updateBallsDisplay();
  }

  private updateFlying() {
    const minDist = 2 * this.BALL_R;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.x += f.dx;
      f.y += f.dy;
      if (f.x < -20 || f.x > this.W + 20 || f.y < -20 || f.y > this.H + 20) {
        this.flying.splice(i, 1);
        continue;
      }
      let hit = false;
      for (const b of this.balls) {
        const p = this.getPointAt(b.t);
        if (Math.hypot(f.x - p.x, f.y - p.y) < minDist) {
          hit = true;
          break;
        }
      }
      if (hit) {
        const ft = this.projectToPath(f.x, f.y);
        this.flying.splice(i, 1);
        this.insertBall(ft, f.color);
      }
    }
  }

  private insertBall(ft: number, color: string) {
    // 找到插入位置（按 t 降序，front=idx 0）
    let idx = this.balls.length;
    for (let i = 0; i < this.balls.length; i++) {
      if (this.balls[i].t < ft) {
        idx = i;
        break;
      }
    }
    const newBall: Ball = { t: ft, color, radius: this.BALL_R };
    this.balls.splice(idx, 0, newBall);
    // 从插入点向后处理重叠（后段被推后）
    for (let i = idx; i < this.balls.length; i++) {
      if (i === 0) continue;
      const front = this.balls[i - 1];
      const back = this.balls[i];
      if (front.t - back.t < 2 * this.BALL_R) {
        back.t = front.t - 2 * this.BALL_R;
      }
    }
    // 消除处理（含连锁）
    const chains = this.processMatchesAt(idx);
    if (chains >= 3) {
      const isNew = storage.unlock('zuma_combo_3');
      if (isNew) this.eventCb?.('achievement-unlocked', 'zuma_combo_3');
    }
    this.updateBallsDisplay();
    // 通关
    if (this.balls.length === 0) {
      this.clearLevel();
    }
  }

  /** balls[i-1] 与 balls[i] 是否接触 */
  private touching(i: number, j: number): boolean {
    return this.balls[i].t - this.balls[j].t <= 2 * this.BALL_R + 0.5;
  }

  /**
   * 在 idx 附近查找并消除同色连续球（≥3）。
   * bridgeIdx 表示允许跨越的唯一间隙索引（消除后边界），用于连锁。
   */
  private findAndEliminateRun(
    idx: number,
    bridgeIdx: number = -1
  ): { eliminated: boolean; nextCheckIdx: number; count: number } {
    if (idx < 0 || idx >= this.balls.length) {
      return { eliminated: false, nextCheckIdx: -1, count: 0 };
    }
    const color = this.balls[idx].color;
    let lo = idx;
    while (
      lo > 0 &&
      this.balls[lo - 1].color === color &&
      (this.touching(lo - 1, lo) || lo === bridgeIdx)
    ) {
      lo--;
    }
    let hi = idx;
    while (
      hi < this.balls.length - 1 &&
      this.balls[hi + 1].color === color &&
      (this.touching(hi, hi + 1) || hi + 1 === bridgeIdx)
    ) {
      hi++;
    }
    const count = hi - lo + 1;
    if (count >= 3) {
      this.balls.splice(lo, count);
      return { eliminated: true, nextCheckIdx: lo, count };
    }
    return { eliminated: false, nextCheckIdx: -1, count: 0 };
  }

  private processMatchesAt(idx: number): number {
    let chains = 0;
    let bridgeIdx = -1;
    let checkIdx = idx;
    for (;;) {
      const result = this.findAndEliminateRun(checkIdx, bridgeIdx);
      if (!result.eliminated) break;
      chains++;
      const base = result.count >= 5 ? 100 : result.count === 4 ? 60 : 30;
      const multiplier = 1 + (chains - 1) * 0.5;
      const gained = Math.round(base * multiplier);
      this.score += gained;
      if (this.score > this.best) this.best = this.score;
      this.scoreCb?.(this.score);
      bridgeIdx = result.nextCheckIdx;
      checkIdx = result.nextCheckIdx;
      if (checkIdx < 0 || checkIdx >= this.balls.length) break;
    }
    return chains;
  }

  private clearLevel() {
    this.stopLoop();
    if (this.level === 0) {
      const isNew = storage.unlock('zuma_clear_1');
      if (isNew) this.eventCb?.('achievement-unlocked', 'zuma_clear_1');
    }
    if (this.level >= this.LEVELS.length - 1) {
      const isNew = storage.unlock('zuma_clear_all');
      if (isNew) this.eventCb?.('achievement-unlocked', 'zuma_clear_all');
      this.state = 'all-clear';
      this.isOver = true;
      storage.recordScore('zuma', this.score);
      storage.markPlayed('zuma');
      const newly = checkMilestones(storage.load());
      for (const id of newly) {
        storage.markMilestone(id);
        this.eventCb?.('milestone-reached', id);
      }
      this.showOverlay('all-clear');
    } else {
      this.state = 'level-clear';
      this.showOverlay('level-clear');
    }
  }

  private endGame() {
    this.isOver = true;
    this.state = 'over';
    this.stopLoop();
    storage.recordScore('zuma', this.score);
    storage.markPlayed('zuma');
    const newly = checkMilestones(storage.load());
    for (const id of newly) {
      storage.markMilestone(id);
      this.eventCb?.('milestone-reached', id);
    }
    this.showOverlay('over');
  }

  private showOverlay(type: 'level-clear' | 'all-clear' | 'over') {
    const overlay = this.overlayEl;
    if (!overlay) return;
    overlay.hidden = false;
    if (type === 'level-clear') {
      overlay.innerHTML = `
        <h3>🎉 第 ${this.level + 1} 关通过</h3>
        <p>得分 ${this.score}</p>
        <div class="zuma-overlay-actions">
          <button class="btn-primary" data-action="next">下一关</button>
        </div>
      `;
      const btn = overlay.querySelector('[data-action=next]');
      btn?.addEventListener('click', () => {
        overlay.hidden = true;
        this.startLevel(this.level + 1);
      });
    } else if (type === 'all-clear') {
      overlay.innerHTML = `
        <h3>👑 全部通关</h3>
        <p>最终得分 ${this.score} · 最高 ${this.best}</p>
        <div class="zuma-overlay-actions">
          <button class="btn-primary" data-action="restart">再来一局</button>
        </div>
      `;
      const btn = overlay.querySelector('[data-action=restart]');
      btn?.addEventListener('click', () => {
        overlay.hidden = true;
        this.restart();
      });
    } else {
      overlay.innerHTML = `
        <h3>💀 游戏结束</h3>
        <p>得分 ${this.score} · 最高 ${this.best}</p>
        <div class="zuma-overlay-actions">
          <button class="btn-primary" data-action="restart">再来一局</button>
        </div>
      `;
      const btn = overlay.querySelector('[data-action=restart]');
      btn?.addEventListener('click', () => {
        overlay.hidden = true;
        this.restart();
      });
    }
  }

  private restart() {
    this.score = 0;
    this.startLevel(0);
    this.scoreCb?.(this.score);
  }

  private render() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#0f0f1e';
    ctx.fillRect(0, 0, this.W, this.H);
    this.drawPath();
    this.drawHole();
    this.drawBalls();
    this.drawFlying();
    this.drawLauncher();
    ctx.restore();
  }

  private drawPath() {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = this.BALL_R * 2 + 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(this.pathPoints[0].x, this.pathPoints[0].y);
    for (let i = 1; i < this.pathPoints.length; i++) {
      ctx.lineTo(this.pathPoints[i].x, this.pathPoints[i].y);
    }
    ctx.stroke();
  }

  private drawHole() {
    const ctx = this.ctx;
    const hole = this.pathPoints[this.pathPoints.length - 1];
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, this.BALL_R + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(233, 69, 96, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private drawBalls() {
    const ctx = this.ctx;
    for (const b of this.balls) {
      const p = this.getPointAt(b.t);
      // 阴影
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.arc(p.x + 1, p.y + 2, this.BALL_R, 0, Math.PI * 2);
      ctx.fill();
      // 球体
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.BALL_R, 0, Math.PI * 2);
      ctx.fill();
      // 边框
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // 高光
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(p.x - this.BALL_R * 0.3, p.y - this.BALL_R * 0.3, this.BALL_R * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawFlying() {
    const ctx = this.ctx;
    for (const f of this.flying) {
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.arc(f.x, f.y, this.BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(f.x - this.BALL_R * 0.3, f.y - this.BALL_R * 0.3, this.BALL_R * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** 沿当前 angle 绘制发射轨迹预览虚线，命中球或边界则停止 */
  private drawAimingTrajectory() {
    const ctx = this.ctx;
    const dx = Math.cos(this.angle);
    const dy = Math.sin(this.angle);
    const step = 4;
    const maxSteps = 200;
    const hitR = 2 * this.BALL_R; // 与球碰撞距离
    let x = this.LAUNCHER_X;
    let y = this.LAUNCHER_Y;
    let endX = x;
    let endY = y;
    let hit = false;
    for (let i = 0; i < maxSteps; i++) {
      x += dx * step;
      y += dy * step;
      // 边界检测（含顶部）
      if (x < 0 || x > this.W || y < 0 || y > this.H) {
        endX = Math.max(0, Math.min(this.W, x));
        endY = Math.max(0, Math.min(this.H, y));
        break;
      }
      // 球碰撞检测
      let collided = false;
      for (const b of this.balls) {
        const p = this.getPointAt(b.t);
        if (Math.hypot(x - p.x, y - p.y) < hitR) {
          collided = true;
          break;
        }
      }
      if (collided) {
        endX = x;
        endY = y;
        hit = true;
        break;
      }
      endX = x;
      endY = y;
    }
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(this.LAUNCHER_X, this.LAUNCHER_Y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    // 命中球时画终点小圆点标记
    if (hit) {
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(endX, endY, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawLauncher() {
    const ctx = this.ctx;
    // 瞄准轨迹预览（先画，使发射器覆盖虚线起点）
    this.drawAimingTrajectory();
    // 底座
    ctx.fillStyle = '#2a2a4a';
    ctx.beginPath();
    ctx.arc(this.LAUNCHER_X, this.LAUNCHER_Y, this.BALL_R + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 炮管方向线
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(this.LAUNCHER_X, this.LAUNCHER_Y);
    ctx.lineTo(
      this.LAUNCHER_X + Math.cos(this.angle) * (this.BALL_R + 12),
      this.LAUNCHER_Y + Math.sin(this.angle) * (this.BALL_R + 12)
    );
    ctx.stroke();
    // 当前球
    ctx.fillStyle = this.currentColor;
    ctx.beginPath();
    ctx.arc(this.LAUNCHER_X, this.LAUNCHER_Y, this.BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(this.LAUNCHER_X - this.BALL_R * 0.3, this.LAUNCHER_Y - this.BALL_R * 0.3, this.BALL_R * 0.35, 0, Math.PI * 2);
    ctx.fill();
    // 下一球预览
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(this.LAUNCHER_X - 30, this.LAUNCHER_Y, this.BALL_R - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = this.nextColor;
    ctx.beginPath();
    ctx.arc(this.LAUNCHER_X - 30, this.LAUNCHER_Y, this.BALL_R - 4, 0, Math.PI * 2);
    ctx.fill();
    // 移动端瞄准状态指示点：已瞄准绿点，待瞄准灰点
    ctx.fillStyle = this.hasAimed ? '#4ecca3' : 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.arc(this.LAUNCHER_X + 30, this.LAUNCHER_Y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  destroy(): void {
    this.unbindInput();
    this.stopLoop();
    // 若未结束就退出，仍记录分数和游玩
    if (!this.isOver && this.score > 0) {
      storage.recordScore('zuma', this.score);
      storage.markPlayed('zuma');
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
    return '移动鼠标/手指瞄准发射器，点击发射彩球，消除 3 个以上同色球，阻止球链到达洞口';
  }
}
