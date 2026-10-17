/**
 * 打砖块 —— 实现 GameInstance 接口
 *
 * 渲染：Canvas
 * 输入：鼠标 mousemove / 触屏 touchmove 控制挡板 x，空格开始/暂停
 * 球速：每关递增，初始向下 45°
 * 反弹：挡板中心垂直反弹，两端 ±60° 偏角
 * 通关：通过 5 个关卡后全部通关
 * 失败：球碰底
 * 成就：单局消砖 50/200、单局分数 500/2000、单局全消
 */
import type { GameInstance } from '../../types';
import { storage } from '../../core/Storage';
import { checkMilestones } from '../../core/Achievements';
import './styles.css';

export function BreakoutFactory(): GameInstance {
  return new Breakout();
}

interface Brick {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  points: number;
  alive: boolean;
}

type GameState = 'idle' | 'running' | 'paused' | 'over';

interface LevelLayout {
  rows: string[]; // 砖块布局
  speed: number; // 该关球速
}

// 关卡布局定义：每关是一个字符串数组，每个字符代表一种砖块
// 'R'=红(6分) 'P'=紫(5分) 'G'=绿(4分) 'Y'=黄(3分) 'B'=蓝(2分) 'S'=灰(1分) ' '=无
const LEVELS: LevelLayout[] = [
  // 第1关：基础满铺 6行8列
  {
    rows: [
      'RRRRRRRR',
      'PPPPPPPP',
      'GGGGGGGG',
      'YYYYYYYY',
      'BBBBBBBB',
      'SSSSSSSS',
    ],
    speed: 5,
  },
  // 第2关：中间空出（菱形）
  {
    rows: [
      '        ',
      ' RR  RR ',
      ' PPPPPP ',
      'GGGGGGGG',
      ' YYYYYY ',
      '  BBBB  ',
    ],
    speed: 5.5,
  },
  // 第3关：左右分开
  {
    rows: [
      'RRR  RRR',
      'PPP  PPP',
      'GGG  GGG',
      'YYY  YYY',
      'BBB  BBB',
      '        ',
    ],
    speed: 6,
  },
  // 第4关：交错排列
  {
    rows: [
      'R R R R ',
      ' P P P P',
      'R R R R ',
      ' P P P P',
      'GGGGGGGG',
      'YYYYYYYY',
    ],
    speed: 6.5,
  },
  // 第5关：金字塔
  {
    rows: [
      '        ',
      '   RR   ',
      '  PPPP  ',
      ' GGGGGG ',
      'YYYYYYYY',
      'BBBBBBBB',
    ],
    speed: 7,
  },
];

class Breakout implements GameInstance {
  private root!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private overlayEl: HTMLElement | null = null;

  private readonly W = 400;
  private readonly H = 500;
  private readonly BALL_R = 8;
  private readonly PADDLE_W = 80;
  private readonly PADDLE_H = 10;
  private readonly PADDLE_Y = 470;
  private readonly BRICK_GAP = 4;

  private readonly BRICK_COLORS: Record<string, { color: string; points: number }> = {
    'R': { color: '#e94560', points: 6 },
    'P': { color: '#533483', points: 5 },
    'G': { color: '#4ecca3', points: 4 },
    'Y': { color: '#ffd369', points: 3 },
    'B': { color: '#5e72e4', points: 2 },
    'S': { color: '#a0a0b8', points: 1 },
  };

  private ball = { x: 200, y: 250, dx: 0, dy: 0 };
  private paddle = { x: 160 };
  private bricks: Brick[] = [];

  private score = 0;
  private best = 0;
  private bricksCleared = 0;
  private level = 1;
  private ballSpeed = 5;
  private state: GameState = 'idle';
  private isOver = false;
  private levelBannerUntil = 0;

  private rafId: number | null = null;

  private scoreCb: ((score: number) => void) | null = null;
  private eventCb: ((event: string, payload?: unknown) => void) | null = null;

  private keyHandler = (e: KeyboardEvent) => this.handleKey(e);
  private mouseMoveHandler = (e: MouseEvent) => this.handleMouseMove(e);
  private touchMoveHandler = (e: TouchEvent) => this.handleTouchMove(e);

  start(container: HTMLElement): void {
    const save = storage.load();
    this.best = save.scores['breakout'] ?? 0;

    // 每次进入游戏都从第 1 关开始
    this.level = 1;
    this.score = 0;
    this.bricksCleared = 0;
    this.ballSpeed = LEVELS[0].speed;
    this.isOver = false;
    this.state = 'idle';
    this.levelBannerUntil = 0;

    this.root = container;
    this.root.innerHTML = `
      <div class="breakout-wrap">
        <div class="breakout-instructions">
          移动鼠标/手指控制挡板 · 空格暂停 · 击碎所有砖块通关
        </div>
        <div class="breakout-board-wrap">
          <canvas id="breakout-canvas" width="${this.W}" height="${this.H}"></canvas>
        </div>
      </div>
    `;
    this.canvas = this.root.querySelector('#breakout-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;

    this.resetBall();
    this.buildBricks();
    this.bindInput();
    this.render();
    this.scoreCb?.(this.score);
  }

  private resetBall() {
    this.ball.x = this.W / 2;
    this.ball.y = this.H / 2;
    // 初始 45° 向下，左右随机
    const angle = (Math.random() < 0.5 ? -1 : 1) * Math.PI / 4;
    this.ball.dx = this.ballSpeed * Math.sin(angle);
    this.ball.dy = this.ballSpeed * Math.cos(angle); // 向下为正
    this.paddle.x = (this.W - this.PADDLE_W) / 2;
  }

  private buildBricks() {
    this.bricks = [];
    const layout = LEVELS[Math.min(this.level - 1, LEVELS.length - 1)];
    const rows = layout.rows;
    const cols = rows[0].length;
    // 动态计算砖块尺寸以适配 canvas 宽度
    const totalGap = (cols - 1) * this.BRICK_GAP;
    const brickW = (this.W - 4 - totalGap) / cols; // 留 2px 边距
    const brickH = 20;
    const startX = 2;
    const startY = 40;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < cols; c++) {
        const ch = rows[r][c];
        if (ch === ' ') continue;
        const info = this.BRICK_COLORS[ch];
        if (!info) continue;
        this.bricks.push({
          x: startX + c * (brickW + this.BRICK_GAP),
          y: startY + r * (brickH + this.BRICK_GAP),
          w: brickW,
          h: brickH,
          color: info.color,
          points: info.points,
          alive: true,
        });
      }
    }
  }

  private bindInput() {
    window.addEventListener('keydown', this.keyHandler, { passive: false });
    this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
  }

  private unbindInput() {
    window.removeEventListener('keydown', this.keyHandler);
    this.canvas.removeEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.removeEventListener('touchmove', this.touchMoveHandler);
  }

  private handleKey(e: KeyboardEvent) {
    if (e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) this.togglePause();
    }
  }

  private togglePause() {
    if (this.isOver) return;
    if (this.state === 'idle' || this.state === 'paused') {
      this.state = 'running';
      this.startLoop();
    } else if (this.state === 'running') {
      this.state = 'paused';
      this.stopLoop();
      this.render();
    }
  }

  /** 将客户端 X 坐标转换为 canvas 内部坐标 X */
  private clientXToCanvasX(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0) return this.paddle.x + this.PADDLE_W / 2;
    const scale = this.W / rect.width;
    return (clientX - rect.left) * scale;
  }

  private handleMouseMove(e: MouseEvent) {
    if (this.isOver) return;
    const x = this.clientXToCanvasX(e.clientX);
    this.setPaddleX(x);
    if (this.state === 'idle') {
      this.state = 'running';
      this.startLoop();
    } else if (this.state !== 'running') {
      this.render();
    }
  }

  private handleTouchMove(e: TouchEvent) {
    if (this.isOver) return;
    e.preventDefault();
    if (e.touches.length !== 1) return;
    const x = this.clientXToCanvasX(e.touches[0].clientX);
    this.setPaddleX(x);
    if (this.state === 'idle') {
      this.state = 'running';
      this.startLoop();
    } else if (this.state !== 'running') {
      this.render();
    }
  }

  private setPaddleX(centerX: number) {
    let x = centerX - this.PADDLE_W / 2;
    if (x < 0) x = 0;
    if (x > this.W - this.PADDLE_W) x = this.W - this.PADDLE_W;
    this.paddle.x = x;
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
    // 移动球
    this.ball.x += this.ball.dx;
    this.ball.y += this.ball.dy;
    // 左右墙
    if (this.ball.x - this.BALL_R < 0) {
      this.ball.x = this.BALL_R;
      this.ball.dx = -this.ball.dx;
    } else if (this.ball.x + this.BALL_R > this.W) {
      this.ball.x = this.W - this.BALL_R;
      this.ball.dx = -this.ball.dx;
    }
    // 顶墙
    if (this.ball.y - this.BALL_R < 0) {
      this.ball.y = this.BALL_R;
      this.ball.dy = -this.ball.dy;
    }
    // 底部 = 失败
    if (this.ball.y + this.BALL_R > this.H) {
      this.endGame();
      return;
    }
    // 挡板碰撞
    if (
      this.ball.dy > 0 &&
      this.ball.y + this.BALL_R >= this.PADDLE_Y &&
      this.ball.y - this.BALL_R <= this.PADDLE_Y + this.PADDLE_H &&
      this.ball.x >= this.paddle.x &&
      this.ball.x <= this.paddle.x + this.PADDLE_W
    ) {
      // t: 0(左端) ~ 1(右端)，中心 = 0.5
      const t = (this.ball.x - this.paddle.x) / this.PADDLE_W;
      const angle = (t - 0.5) * ((120 * Math.PI) / 180); // ±60°
      const speed = Math.hypot(this.ball.dx, this.ball.dy);
      this.ball.dx = speed * Math.sin(angle);
      this.ball.dy = -Math.abs(speed * Math.cos(angle)); // 向上
      // 防止穿透
      this.ball.y = this.PADDLE_Y - this.BALL_R - 0.1;
    }
    // 砖块碰撞
    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      if (
        this.ball.x + this.BALL_R > brick.x &&
        this.ball.x - this.BALL_R < brick.x + brick.w &&
        this.ball.y + this.BALL_R > brick.y &&
        this.ball.y - this.BALL_R < brick.y + brick.h
      ) {
        // 计算重叠量，判断从哪一面进入
        const overlapLeft = this.ball.x + this.BALL_R - brick.x;
        const overlapRight = brick.x + brick.w - (this.ball.x - this.BALL_R);
        const overlapTop = this.ball.y + this.BALL_R - brick.y;
        const overlapBottom = brick.y + brick.h - (this.ball.y - this.BALL_R);
        const minH = Math.min(overlapLeft, overlapRight);
        const minV = Math.min(overlapTop, overlapBottom);
        if (minH < minV) {
          this.ball.dx = -this.ball.dx;
        } else {
          this.ball.dy = -this.ball.dy;
        }
        brick.alive = false;
        this.score += brick.points;
        this.bricksCleared += 1;
        if (this.score > this.best) this.best = this.score;
        this.scoreCb?.(this.score);
        this.checkBrickAchievements();
        this.checkScoreAchievements();
        break; // 每帧只处理一次碰撞
      }
    }
    // 通关检测
    if (this.bricks.every((b) => !b.alive)) {
      const isNew = storage.unlock('breakout_clear_all');
      if (isNew) this.eventCb?.('achievement-unlocked', 'breakout_clear_all');
      if (this.level < LEVELS.length) {
        // 进入下一关
        this.level += 1;
        this.ballSpeed = LEVELS[this.level - 1].speed;
        this.buildBricks();
        this.resetBall();
        // 缩放速度
        const curSpeed = Math.hypot(this.ball.dx, this.ball.dy);
        if (curSpeed > 0) {
          const scale = this.ballSpeed / curSpeed;
          this.ball.dx *= scale;
          this.ball.dy *= scale;
        }
        this.showLevelBanner();
      } else {
        // 全部通关
        this.endGame(true);
      }
    }
  }

  private showLevelBanner() {
    this.levelBannerUntil = Date.now() + 1500;
  }

  private checkBrickAchievements() {
    if (this.bricksCleared >= 50) {
      const isNew = storage.unlock('breakout_clear_50');
      if (isNew) this.eventCb?.('achievement-unlocked', 'breakout_clear_50');
    }
    if (this.bricksCleared >= 200) {
      const isNew = storage.unlock('breakout_clear_200');
      if (isNew) this.eventCb?.('achievement-unlocked', 'breakout_clear_200');
    }
  }

  private checkScoreAchievements() {
    if (this.score >= 500) {
      const isNew = storage.unlock('breakout_score_500');
      if (isNew) this.eventCb?.('achievement-unlocked', 'breakout_score_500');
    }
    if (this.score >= 2000) {
      const isNew = storage.unlock('breakout_score_2000');
      if (isNew) this.eventCb?.('achievement-unlocked', 'breakout_score_2000');
    }
  }

  private render() {
    const ctx = this.ctx;
    // 背景
    ctx.fillStyle = '#0f0f1e';
    ctx.fillRect(0, 0, this.W, this.H);
    // HUD - 当前关卡
    ctx.fillStyle = '#e6e6e6';
    ctx.font = '14px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`第 ${this.level} 关`, 8, 12);
    // 砖块
    for (const b of this.bricks) {
      if (!b.alive) continue;
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      // 高光
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.fillRect(b.x, b.y, b.w, 3);
      // 边框
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    }
    // 挡板
    ctx.fillStyle = '#e94560';
    ctx.fillRect(this.paddle.x, this.PADDLE_Y, this.PADDLE_W, this.PADDLE_H);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillRect(this.paddle.x, this.PADDLE_Y, this.PADDLE_W, 2);
    // 球
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(this.ball.x, this.ball.y, this.BALL_R, 0, Math.PI * 2);
    ctx.fill();
    // 关卡切换横幅
    if (Date.now() < this.levelBannerUntil) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.fillStyle = '#ffd369';
      ctx.font = 'bold 36px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`第 ${this.level} 关`, this.W / 2, this.H / 2 - 16);
      ctx.fillStyle = '#e6e6e6';
      ctx.font = '16px -apple-system, sans-serif';
      ctx.fillText('准备出发！', this.W / 2, this.H / 2 + 24);
    }
    // 提示层
    if (this.state === 'idle' || this.state === 'paused') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.fillStyle = '#e6e6e6';
      ctx.font = '22px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const msg = this.state === 'idle' ? '移动挡板 或 按 空格 开始' : '已暂停 · 按 空格 继续';
      ctx.fillText(msg, this.W / 2, this.H / 2);
    }
  }

  private showOverlay(cleared = false) {
    if (this.overlayEl) this.overlayEl.remove();
    const overlay = document.createElement('div');
    overlay.className = 'breakout-overlay';
    overlay.innerHTML = cleared
      ? `
      <h3>🎉 全部通关！</h3>
      <p>得分 ${this.score} · 最高 ${this.best}</p>
      <p>消除 ${this.bricksCleared} 砖</p>
      <div class="breakout-overlay-actions">
        <button class="btn-primary" data-action="restart">再来一局</button>
      </div>
    `
      : `
      <h3>💀 游戏结束</h3>
      <p>得分 ${this.score} · 最高 ${this.best}</p>
      <p>消除 ${this.bricksCleared} 砖</p>
      <div class="breakout-overlay-actions">
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
    this.level = 1;
    this.score = 0;
    this.bricksCleared = 0;
    this.ballSpeed = LEVELS[0].speed;
    this.isOver = false;
    this.state = 'idle';
    this.levelBannerUntil = 0;
    this.buildBricks();
    this.resetBall();
    this.scoreCb?.(this.score);
    this.render();
  }

  private endGame(cleared = false) {
    this.isOver = true;
    this.state = 'over';
    this.stopLoop();
    storage.recordScore('breakout', this.score);
    storage.markPlayed('breakout');
    const newly = checkMilestones(storage.load());
    for (const id of newly) {
      storage.markMilestone(id);
      this.eventCb?.('milestone-reached', id);
    }
    this.showOverlay(cleared);
  }

  destroy(): void {
    this.unbindInput();
    this.stopLoop();
    if (this.overlayEl) this.overlayEl.remove();
    // 若未结束就退出，仍记录分数和游玩
    if (!this.isOver && (this.score > 0 || this.bricksCleared > 0)) {
      storage.recordScore('breakout', this.score);
      storage.markPlayed('breakout');
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
    return '移动挡板反弹小球，击碎所有砖块；球落地即失败，全消后通关进入下一关';
  }
}
