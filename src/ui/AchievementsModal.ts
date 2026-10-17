/**
 * 成就 / 里程碑 弹窗
 *
 * Tab 切换：
 *   成就：游戏内具体目标
 *   里程碑：全局累积型目标
 */
import { ACHIEVEMENTS, MILESTONES } from '../core/Achievements';
import { storage } from '../core/Storage';
import { GAMES } from '../core/GameRegistry';

export class AchievementsModal {
  static open(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div class="modal-title">成就 & 里程碑</div>
          <button class="modal-close" data-action="close" aria-label="关闭">×</button>
        </div>
        <div class="modal-body">
          <div class="achievement-tabs">
            <button class="achievement-tab active" data-tab="achievements">成就 (<span id="ach-count">0</span>)</button>
            <button class="achievement-tab" data-tab="milestones">里程碑 (<span id="ms-count">0</span>)</button>
          </div>
          <div id="tab-content"></div>
        </div>
      </div>
    `;

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector('[data-action=close]')!.addEventListener('click', close);

    const render = (tab: 'achievements' | 'milestones') => {
      const content = overlay.querySelector<HTMLElement>('#tab-content')!;
      const save = storage.load();

      if (tab === 'achievements') {
        const unlocked = new Set(save.achievements);
        // 按游戏分组
        const byGame: Record<string, typeof ACHIEVEMENTS> = {};
        for (const a of ACHIEVEMENTS) {
          const key = a.game;
          if (!byGame[key]) byGame[key] = [];
          byGame[key].push(a);
        }
        const html = Object.entries(byGame).map(([gameId, list]) => {
          const gameName = gameId === '*' ? '全局' : (GAMES.find((g) => g.id === gameId)?.name ?? gameId);
          const items = list.map((a) => {
            const isUnlocked = unlocked.has(a.id);
            return `
              <div class="achievement-item ${isUnlocked ? 'unlocked' : ''}">
                <div class="achievement-icon">${isUnlocked ? a.icon : '🔒'}</div>
                <div class="achievement-info">
                  <div class="achievement-name">${a.name}</div>
                  <div class="achievement-desc">${a.description}</div>
                </div>
                <div class="achievement-progress">${isUnlocked ? '✓' : ''}</div>
              </div>
            `;
          }).join('');
          return `<div style="margin-bottom:16px">
            <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">${gameName}</div>
            <div class="achievement-list">${items}</div>
          </div>`;
        }).join('');
        content.innerHTML = html;
      } else {
        const reached = new Set(save.milestones);
        const items = MILESTONES.map((m) => {
          const isReached = reached.has(m.id);
          return `
            <div class="milestone-item ${isReached ? 'unlocked' : ''}">
              <div class="milestone-icon">${isReached ? m.icon : '🔒'}</div>
              <div class="milestone-info">
                <div class="milestone-name">${m.name}</div>
                <div class="milestone-desc">${m.description}</div>
              </div>
              <div class="achievement-progress">${isReached ? '✓' : ''}</div>
            </div>
          `;
        }).join('');
        content.innerHTML = `<div class="milestone-list">${items}</div>`;
      }
    };

    const updateCounts = () => {
      const save = storage.load();
      overlay.querySelector('#ach-count')!.textContent =
        `${save.achievements.length}/${ACHIEVEMENTS.length}`;
      overlay.querySelector('#ms-count')!.textContent =
        `${save.milestones.length}/${MILESTONES.length}`;
    };

    overlay.querySelectorAll('.achievement-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.achievement-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        render((btn as HTMLElement).dataset.tab as 'achievements' | 'milestones');
      });
    });

    updateCounts();
    render('achievements');

    return overlay;
  }
}
