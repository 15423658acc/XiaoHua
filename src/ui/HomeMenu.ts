/**
 * 主菜单：游戏卡片网格 + 顶部统计 + 工具栏
 *
 * 启动时检查里程碑（基于累积存档）
 */
import { GAMES } from '../core/GameRegistry';
import { storage } from '../core/Storage';
import { checkMilestones, ACHIEVEMENTS, MILESTONES } from '../core/Achievements';
import { MigrationModal } from './MigrationModal';
import { AchievementsModal } from './AchievementsModal';

export class HomeMenu {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    // 首次启动解锁"初次启动"成就
    storage.unlock('global_first_open');
    // 基于当前存档检查里程碑
    this.refreshMilestones();
  }

  /** 校验里程碑，返回新达成列表（用于 toast 提示） */
  private refreshMilestones(): string[] {
    const save = storage.load();
    const newly = checkMilestones(save);
    for (const id of newly) {
      storage.markMilestone(id);
    }
    return newly;
  }

  render(): void {
    this.container.innerHTML = `
      <header class="app-header">
        <div class="app-title">小华游戏</div>
        <div class="app-header-actions">
          <button class="icon-btn" data-action="achievements" aria-label="成就">🏆</button>
          <button class="icon-btn" data-action="migration" aria-label="迁移存档">☁️</button>
        </div>
      </header>
      <main class="home">
        <div class="home-intro">
          <h2>挑一款喜欢的开始吧</h2>
          <p>纯前端，无需登录，离线可玩</p>
        </div>
        <div class="stats-row">
          <div class="stat-item">
            <div class="stat-num" id="stat-games">0</div>
            <div class="stat-label">已玩过游戏</div>
          </div>
          <div class="stat-item">
            <div class="stat-num" id="stat-achievements">0</div>
            <div class="stat-label">成就解锁</div>
          </div>
          <div class="stat-item">
            <div class="stat-num" id="stat-milestones">0</div>
            <div class="stat-label">里程碑达成</div>
          </div>
          <div class="stat-item">
            <div class="stat-num" id="stat-playcount">0</div>
            <div class="stat-label">累计局数</div>
          </div>
        </div>
        <div class="games-grid" id="games-grid"></div>
      </main>
    `;

    this.renderCards();
    this.updateStats();
    this.bindActions();
  }

  private renderCards() {
    const grid = this.container.querySelector<HTMLElement>('#games-grid')!;
    const save = storage.load();
    if (GAMES.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-state-icon">🎮</div>
          <div>暂未上架游戏，敬请期待</div>
        </div>
      `;
      return;
    }
    grid.innerHTML = GAMES.map((g) => {
      const best = save.scores[g.id] ?? 0;
      const catLabel = {
        puzzle: '益智',
        action: '动作',
        logic: '逻辑',
        casual: '休闲',
      }[g.category];
      return `
        <div class="game-card" data-game-id="${g.id}">
          <div class="game-card-cat">${catLabel}</div>
          <div class="game-card-icon">${g.icon}</div>
          <div class="game-card-name">${g.name}</div>
          <div class="game-card-desc">${g.description}</div>
          <div class="game-card-score">${best > 0 ? '最高分 ' + best : '尚未游玩'}</div>
        </div>
      `;
    }).join('');
  }

  private updateStats() {
    const save = storage.load();
    this.container.querySelector('#stat-games')!.textContent = String(save.playedGames.length);
    this.container.querySelector('#stat-achievements')!.textContent =
      `${save.achievements.length}/${ACHIEVEMENTS.length}`;
    this.container.querySelector('#stat-milestones')!.textContent =
      `${save.milestones.length}/${MILESTONES.length}`;
    this.container.querySelector('#stat-playcount')!.textContent = String(save.playCount);
  }

  private bindActions() {
    // 卡片点击 → 启动游戏
    this.container.querySelectorAll('.game-card').forEach((card) => {
      card.addEventListener('click', () => {
        const gameId = (card as HTMLElement).dataset.gameId!;
        const game = GAMES.find((g) => g.id === gameId);
        if (!game) return;
        // 通知外部启动游戏（main.ts 监听）
        this.container.dispatchEvent(new CustomEvent('launch-game', {
          bubbles: true,
          detail: { gameId },
        }));
      });
    });

    // 工具栏按钮
    this.container.querySelector('[data-action=achievements]')!.addEventListener('click', () => {
      document.body.appendChild(AchievementsModal.open());
    });
    this.container.querySelector('[data-action=migration]')!.addEventListener('click', () => {
      const modal = MigrationModal.open(() => {
        // 导入后刷新主菜单
        this.render();
      });
      document.body.appendChild(modal);
    });
  }
}
