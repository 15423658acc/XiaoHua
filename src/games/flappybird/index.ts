/**
 * Flappy Bird —— 实现 GameInstance 接口
 *
 * 渲染：Canvas（400x600，响应式 max-width 100%）
 * 输入：空格 / 点击 canvas / 点击窗口 / 触摸 canvas
 * 重力：每帧 vy += 0.5（约 60fps）
 * 跳跃：vy = -8
 * 管道：从右侧滚动进入，初始速度 3px/帧（每 10 分 +0.5，封顶 6px/帧）
 *       间隙 130px，管道宽 60px，横向间距 240px
 * 计分：每通过一对管道 +1
 * 失败：撞管道 / 撞地面 / 撞天花板（顶部不反弹）
 * 难度递增：每 10 分管道速度 +0.5（封顶 6px/帧）
 * 成就：单局 5/15/30、连续 5 局得分 ≥5
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';

const GAME_ID = 'flappybird';
const COMBO_KEY = 'flappybird:combo';

// 画布逻辑尺寸
const W = 400;
const H = 600;
const GROUND_H = 60;
const BIRD_X = 100;
const BIRD_R = 14;
const GRAVITY = 0.5;
const JUMP_VY = -8;
const PIPE_W = 60;
const PIPE_GAP = 130;
const PIPE_SPACING = 240;
const BASE_SPEED = 3;
const SPEED_STEP = 0.5;
const SPEED_STEP_EVERY = 10;
const MAX_SPEED = 6;

// 颜色（canvas 不能直接用 CSS 变量，需写死 hex）
const COLOR_SKY = '#16213e';
const COLOR_BIRD = '#ffd369';
const COLOR_BIRD_DARK = '#e0a93a';
const COLOR_BEAK = '#ff9f40';
const COLOR_PIPE = '#2d8f47';
const COLOR_PIPE_LIGHT = '#3aab58';
const COLOR_PIPE_DARK = '#1f6b34';
const COLOR_GROUND = '#4ecca3';
const COLOR_GROUND_DARK = '#3aa382';

interface Pipe {
  x: number;
  gapY: number; // 间隙中心 Y
  passed: boolean;
  pulseUntil: number; // 通过后白边闪烁截止时间戳
}

type GameState = 'idle' | 'running' | 'over';

export function FlappybirdFactory(): GameInstance {
  return new Flappybird();
}

class Flappybird implements GameInstance {
  private root!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private overlayEl: HTMLElement | null = null;

  private birdY = H / 2;
  private vy = 0;
  private pipes: Pipe[] = [];
  private score = 0;
  private best = 0;
  private state: GameState = 'idle';
  private isOver = false;
  private speed = BASE_SPEED;
  private groundOffset = 0;
  private rafId: number | null = null;

  private scoreCb: ((s: number) => void) | null = null;
  private eventCb: ((e: string, p?: unknown) => void) | null = null;

  private keyHandler = (e: KeyboardEvent) => this.handleKey(e);
  private canvasClickHandler = () => this.handleInput();
  private windowClickHandler = () => this.handleInput();
  private touchStartHandler = (e: TouchEvent) => this.handleTouch(e);

  start(container: HTMLElement): void {
    const save = storage.load();
    this.best = save.scores[GAME_ID] ?? 0;

    this.root = container;
    this.root.innerHTML = `
      <div class="flappy-wrap">
        <div class="flappy-instructions">
          点击屏幕 / 空格让鸟向上飞 · 穿越管道间隙 · 撞到管道/地面/天花板即结束
        </div>
        <div class="flappy-board">
          <canvas class="flappy-canvas" width="${W}" height="${H}"></canvas>
        </div>
      </div>
    `;
    this.canvas = this.root.querySelector('.flappy-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;

    this.resetState();
    this.bindInput();
    this.render();
    this.scoreCb?.(this.score);
  }

  private resetState() {
    this.birdY = H / 2;
    this.vy = 0;
    this.pipes = [];
    this.score = 0;
    this.speed = BASE_SPEED;
    this.groundOffset = 0;
    this.state = 'idle';
    this.isOver = false;
  }

  private bindInput() {
    window.addEventListener('keydown', this.keyHandler, { passive: false });
    this.canvas.addEventListener('click', this.canvasClickHandler);
    window.addEventListener('click', this.windowClickHandler);
    this.canvas.addEventListener('touchstart', this.touchStartHandler, { passive: false });
  }

  private unbindInput() {
    window.removeEventListener('keydown', this.keyHandler);
    this.canvas.removeEventListener('click', this.canvasClickHandler);
    window.removeEventListener('click', this.windowClickHandler);
    this.canvas.removeEventListener('touchstart', this.touchStartHandler);
  }

  private handleKey(e: KeyboardEvent) {
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) this.handleInput();
    }
  }

  private handleTouch(e: TouchEvent) {
    e.preventDefault();
    this.handleInput();
  }

  private handleInput() {
    if (this.state === 'idle') {
      this.state = 'running';
      this.vy = JUMP_VY;
      this.startLoop();
    } else if (this.state === 'running') {
      this.vy = JUMP_VY;
    }
    // 'over' 状态由 overlay 上的按钮处理
  }

  private startLoop() {
    if (this.rafId !== null) return;
    const loop = () => {
      if (this.state !== 'running') {
        this.rafId = null;
        return;
      }
      this.update();
      this.render();
      if (this.state === 'running') {
        this.rafId = requestAnimationFrame(loop);
      } else {
        this.rafId = null;
      }
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
    // 重力
    this.vy += GRAVITY;
    this.birdY += this.vy;

    // 顶部天花板（撞到就死，不反弹）
    if (this.birdY - BIRD_R < 0) {
      this.birdY = BIRD_R;
      this.endGame();
      return;
    }
    // 地面（撞到就死）
    if (this.birdY + BIRD_R > H - GROUND_H) {
      this.birdY = H - GROUND_H - BIRD_R;
      this.endGame();
      return;
    }

    // 生成新管道：当没有管道或最右管道距离右边界 >= PIPE_SPACING 时
    let rightmost = -Infinity;
    for (const p of this.pipes) {
      if (p.x > rightmost) rightmost = p.x;
    }
    if (this.pipes.length === 0 || rightmost <= W - PIPE_SPACING) {
      // 间隙中心 Y 限制在合理范围，避免贴边
      const minGapY = PIPE_GAP / 2 + 40;
      const maxGapY = H - GROUND_H - PIPE_GAP / 2 - 40;
      const gapY = minGapY + Math.random() * (maxGapY - minGapY);
      this.pipes.push({ x: W, gapY, passed: false, pulseUntil: 0 });
    }

    // 移动管道
    for (const p of this.pipes) {
      p.x -= this.speed;
    }
    // 移除离开屏幕的管道
    this.pipes = this.pipes.filter((p) => p.x + PIPE_W > -20);

    // 计分与碰撞
    for (const p of this.pipes) {
      // 通过管道：管道右边缘已过鸟中心
      if (!p.passed && p.x + PIPE_W < BIRD_X) {
        p.passed = true;
        this.score += 1;
        if (this.score > this.best) this.best = this.score;
        this.scoreCb?.(this.score);
        // 视觉脉冲：管道边框闪白
        p.pulseUntil = Date.now() + 200;
        // 难度递增
        this.updateSpeed();
        // 成就检测
        this.checkScoreAchievements();
      }
      // 碰撞检测（圆形 bounding box 近似）
      if (this.collidesWithPipe(p)) {
        this.endGame();
        return;
      }
    }

    // 地面滚动（视觉运动感）
    this.groundOffset = (this.groundOffset + this.speed) % 40;
  }

  private updateSpeed() {
    const steps = Math.floor(this.score / SPEED_STEP_EVERY);
    this.speed = Math.min(MAX_SPEED, BASE_SPEED + steps * SPEED_STEP);
  }

  private collidesWithPipe(p: Pipe): boolean {
    // 鸟在管道 x 范围内
    if (BIRD_X + BIRD_R <= p.x || BIRD_X - BIRD_R >= p.x + PIPE_W) return false;
    const topY = p.gapY - PIPE_GAP / 2;
    const botY = p.gapY + PIPE_GAP / 2;
    if (this.birdY - BIRD_R < topY) return true; // 撞上管道
    if (this.birdY + BIRD_R > botY) return true; // 撞下管道
    return false;
  }

  private checkScoreAchievements() {
    if (this.score >= 5) {
      const isNew = storage.unlock('flappy_score_5');
      if (isNew) this.eventCb?.('achievement-unlocked', 'flappy_score_5');
    }
    if (this.score >= 15) {
      const isNew = storage.unlock('flappy_score_15');
      if (isNew) this.eventCb?.('achievement-unlocked', 'flappy_score_15');
    }
    if (this.score >= 30) {
      const isNew = storage.unlock('flappy_score_30');
      if (isNew) this.eventCb?.('achievement-unlocked', 'flappy_score_30');
    }
  }

  private getBirdAngle(): number {
    // vy <= 0: -15°；vy >= 10: +20°；中间按 vy 线性插值
    if (this.vy <= 0) return (-15 * Math.PI) / 180;
    const t = Math.min(1, this.vy / 10);
    return ((-15 + t * 35) * Math.PI) / 180;
  }

  private render() {
    const ctx = this.ctx;
    // 天空背景
    ctx.fillStyle = COLOR_SKY;
    ctx.fillRect(0, 0, W, H);
    // 管道
    for (const p of this.pipes) {
      this.drawPipe(p);
    }
    // 地面
    this.drawGround();
    // 小鸟
    this.drawBird();
    // 顶部得分
    if (this.state === 'running' || this.state === 'over') {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.lineWidth = 3;
      ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.strokeText(String(this.score), W / 2, 20);
      ctx.fillText(String(this.score), W / 2, 20);
    }
    // idle 提示
    if (this.state === 'idle') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = COLOR_BIRD;
      ctx.font = 'bold 26px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('点击或空格开始', W / 2, H / 2 - 16);
      ctx.fillStyle = '#e6e6e6';
      ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText('穿越管道间隙，越远越好', W / 2, H / 2 + 20);
    }
  }

  private drawGround() {
    const ctx = this.ctx;
    const groundY = H - GROUND_H;
    // 上层草地
    ctx.fillStyle = COLOR_GROUND;
    ctx.fillRect(0, groundY, W, 18);
    // 顶部条纹（滚动制造运动感）
    ctx.fillStyle = COLOR_GROUND_DARK;
    const stripeW = 40;
    const offset = -this.groundOffset;
    for (let x = offset - stripeW * 2; x < W + stripeW * 2; x += stripeW * 2) {
      ctx.fillRect(x, groundY, stripeW, 6);
    }
    // 顶部边线
    ctx.fillStyle = COLOR_GROUND_DARK;
    ctx.fillRect(0, groundY, W, 2);
    // 下层暗土
    ctx.fillStyle = COLOR_GROUND_DARK;
    ctx.fillRect(0, groundY + 18, W, GROUND_H - 18);
  }

  private drawPipe(p: Pipe) {
    const ctx = this.ctx;
    const topY = p.gapY - PIPE_GAP / 2;
    const botY = p.gapY + PIPE_GAP / 2;
    const capH = 16;
    const capExtra = 4;
    const capX = p.x - capExtra;
    const capW = PIPE_W + capExtra * 2;

    // 上管道主体
    ctx.fillStyle = COLOR_PIPE;
    ctx.fillRect(p.x, 0, PIPE_W, topY - capH);
    // 上管道帽（圆角底）
    ctx.fillStyle = COLOR_PIPE;
    this.fillCap(capX, topY - capH, capW, capH, false, true);
    // 上管道高光
    ctx.fillStyle = COLOR_PIPE_LIGHT;
    ctx.fillRect(p.x + 4, 0, 4, topY - capH);
    ctx.fillRect(capX + 4, topY - capH, 4, capH);
    // 上管道阴影
    ctx.fillStyle = COLOR_PIPE_DARK;
    ctx.fillRect(p.x + PIPE_W - 8, 0, 4, topY - capH);
    ctx.fillRect(capX + capW - 8, topY - capH, 4, capH);

    // 下管道主体
    ctx.fillStyle = COLOR_PIPE;
    ctx.fillRect(p.x, botY + capH, PIPE_W, H - GROUND_H - botY - capH);
    // 下管道帽（圆角顶）
    ctx.fillStyle = COLOR_PIPE;
    this.fillCap(capX, botY, capW, capH, true, false);
    // 下管道高光
    ctx.fillStyle = COLOR_PIPE_LIGHT;
    ctx.fillRect(p.x + 4, botY + capH, 4, H - GROUND_H - botY - capH);
    ctx.fillRect(capX + 4, botY, 4, capH);
    // 下管道阴影
    ctx.fillStyle = COLOR_PIPE_DARK;
    ctx.fillRect(p.x + PIPE_W - 8, botY + capH, 4, H - GROUND_H - botY - capH);
    ctx.fillRect(capX + capW - 8, botY, 4, capH);

    // 通过管道瞬间白边脉冲
    if (Date.now() < p.pulseUntil) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 3;
      this.strokeCap(capX, topY - capH, capW, capH, false, true);
      this.strokeCap(capX, botY, capW, capH, true, false);
    }
  }

  private fillCap(x: number, y: number, w: number, h: number, roundTop: boolean, roundBottom: boolean) {
    const ctx = this.ctx;
    ctx.beginPath();
    this.traceCapPath(x, y, w, h, roundTop, roundBottom);
    ctx.fill();
  }

  private strokeCap(x: number, y: number, w: number, h: number, roundTop: boolean, roundBottom: boolean) {
    const ctx = this.ctx;
    ctx.beginPath();
    this.traceCapPath(x, y, w, h, roundTop, roundBottom);
    ctx.stroke();
  }

  private traceCapPath(x: number, y: number, w: number, h: number, roundTop: boolean, roundBottom: boolean) {
    const ctx = this.ctx;
    const r = 6;
    // 从左上开始顺时针
    if (roundTop) {
      ctx.moveTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
    }
    if (roundBottom) {
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    } else {
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
    }
    ctx.closePath();
  }

  private drawBird() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(BIRD_X, this.birdY);
    ctx.rotate(this.getBirdAngle());

    // 翅膀（在身体后侧）
    ctx.fillStyle = COLOR_BIRD_DARK;
    ctx.beginPath();
    ctx.ellipse(-3, 3, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 身体
    ctx.fillStyle = COLOR_BIRD;
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLOR_BIRD_DARK;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 喙（右侧三角形）
    ctx.fillStyle = COLOR_BEAK;
    ctx.beginPath();
    ctx.moveTo(BIRD_R - 4, -3);
    ctx.lineTo(BIRD_R + 7, 0);
    ctx.lineTo(BIRD_R - 4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#cc7a1f';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 眼白
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(5, -5, 4, 0, Math.PI * 2);
    ctx.fill();

    // 瞳孔
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(6, -5, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private showOverlay() {
    if (this.overlayEl) this.overlayEl.remove();
    const overlay = document.createElement('div');
    overlay.className = 'flappy-overlay';
    overlay.innerHTML = `
      <h3>💀 游戏结束</h3>
      <p>得分 ${this.score} · 最高 ${this.best}</p>
      <div class="flappy-overlay-actions">
        <button class="btn-primary" data-action="restart" type="button">再来一局</button>
      </div>
    `;
    this.canvas.parentElement!.appendChild(overlay);
    this.overlayEl = overlay;
    // 阻止 overlay 内部点击冒泡到 window，避免触发跳跃
    overlay.addEventListener('click', (e) => e.stopPropagation());
    const btn = overlay.querySelector('[data-action=restart]');
    btn?.addEventListener('click', () => {
      overlay.remove();
      this.overlayEl = null;
      this.restart();
    });
  }

  private restart() {
    this.resetState();
    this.render();
    this.scoreCb?.(this.score);
  }

  private endGame() {
    if (this.isOver) return; // 防止重复触发
    this.isOver = true;
    this.state = 'over';
    this.stopLoop();

    storage.recordScore(GAME_ID, this.score);
    storage.markPlayed(GAME_ID);

    // combo：连续 5 局每局得分 ≥5
    if (this.score >= 5) {
      const newCombo = this.getComboCount() + 1;
      this.setComboCount(newCombo);
      if (newCombo >= 5) {
        const isNew = storage.unlock('flappy_combo_5');
        if (isNew) this.eventCb?.('achievement-unlocked', 'flappy_combo_5');
      }
    } else {
      // 中途失败（得分 < 5）则重置 combo
      this.setComboCount(0);
    }

    // 里程碑检测
    const newly = checkMilestones(storage.load());
    for (const id of newly) {
      storage.markMilestone(id);
      this.eventCb?.('milestone-reached', id);
    }

    this.showOverlay();
  }

  private getComboCount(): number {
    try {
      return parseInt(sessionStorage.getItem(COMBO_KEY) ?? '0', 10) || 0;
    } catch {
      return 0;
    }
  }

  private setComboCount(v: number) {
    try {
      sessionStorage.setItem(COMBO_KEY, String(v));
    } catch {
      // sessionStorage 不可用时静默失败，combo 成就无法跨局累计
    }
  }

  destroy(): void {
    this.unbindInput();
    this.stopLoop();
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    // 若未结束（over 状态未到达）但有分数：记录分数 + 标记游玩 + 检查里程碑
    if (!this.isOver && this.score > 0) {
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
    return '点击屏幕或按空格让小鸟向上飞，穿越绿色管道间隙，撞到管道/地面/天花板即结束';
  }
}
