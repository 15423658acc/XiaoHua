/**
 * 迁移码弹窗 —— 纯文本短码导入导出
 *
 * 不使用二维码，避免相机权限问题
 * 用户体验：
 *   导出 → 自动复制到剪贴板 + 文本框展示 → 用户自行转发（微信、邮件等）
 *   导入 → 粘贴短码 → 校验 → 还原存档
 */
import { storage } from '../core/Storage';
import { exportSave, importSave } from '../core/Migration';
import { checkMilestones, MILESTONES } from '../core/Achievements';

export class MigrationModal {
  static open(onChange?: () => void): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div class="modal-title">迁移存档</div>
          <button class="modal-close" data-action="close" aria-label="关闭">×</button>
        </div>
        <div class="modal-body">
          <div class="migration-section">
            <h3>📤 导出存档（迁移到其他设备）</h3>
            <textarea class="migration-textarea" id="export-code" readonly placeholder="点击下方按钮生成迁移码"></textarea>
            <div class="migration-actions">
              <button class="btn-primary" data-action="generate">生成迁移码</button>
              <button class="btn-secondary" data-action="copy">复制到剪贴板</button>
            </div>
            <div class="migration-tip">
              将此码保存或转发到任意设备，在新设备打开本游戏，粘贴到下方"导入"框即可还原全部分数、成就与里程碑。
            </div>
          </div>

          <div class="migration-section">
            <h3>📥 导入存档（从其他设备迁移过来）</h3>
            <textarea class="migration-textarea" id="import-code" placeholder="在此粘贴迁移码（XH1. 开头）"></textarea>
            <div class="migration-actions">
              <button class="btn-primary" data-action="import">还原存档</button>
              <button class="btn-secondary" data-action="clear-import">清空</button>
            </div>
            <div class="migration-tip">
              ⚠️ 导入会覆盖当前设备的存档。建议先导出当前存档备份。
            </div>
            <div id="import-toast"></div>
          </div>
        </div>
      </div>
    `;

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('[data-action=close]')!.addEventListener('click', close);

    overlay.querySelector('[data-action=generate]')!.addEventListener('click', async () => {
      const ta = overlay.querySelector<HTMLTextAreaElement>('#export-code')!;
      ta.value = '生成中...';
      try {
        const code = await exportSave(storage.load());
        ta.value = code;
      } catch (err) {
        ta.value = '生成失败：' + (err instanceof Error ? err.message : String(err));
      }
    });

    overlay.querySelector('[data-action=copy]')!.addEventListener('click', async () => {
      const ta = overlay.querySelector<HTMLTextAreaElement>('#export-code')!;
      if (!ta.value || ta.value === '生成中...') {
        showToast('请先生成迁移码', 'error');
        return;
      }
      try {
        await navigator.clipboard.writeText(ta.value);
        showToast('已复制到剪贴板', 'success');
      } catch {
        // 降级：选中文本
        ta.select();
        document.execCommand('copy');
        showToast('已复制（兼容模式）', 'success');
      }
    });

    overlay.querySelector('[data-action=clear-import]')!.addEventListener('click', () => {
      (overlay.querySelector('#import-code') as HTMLTextAreaElement).value = '';
      (overlay.querySelector('#import-toast') as HTMLElement).innerHTML = '';
    });

    overlay.querySelector('[data-action=import]')!.addEventListener('click', async () => {
      const ta = overlay.querySelector<HTMLTextAreaElement>('#import-code')!;
      const toastEl = overlay.querySelector<HTMLElement>('#import-toast')!;
      const code = ta.value.trim();
      if (!code) {
        toastEl.innerHTML = '<div class="migration-toast error">请粘贴迁移码</div>';
        return;
      }
      try {
        const data = await importSave(code);
        storage.replace(data);
        // 校验里程碑
        const refreshed = storage.load();
        const newlyReached = checkMilestones(refreshed);
        for (const id of newlyReached) {
          storage.markMilestone(id);
        }
        const milestoneCount = newlyReached.length;
        toastEl.innerHTML = `
          <div class="migration-toast success">
            ✅ 还原成功！分数 ${Object.keys(data.scores).length} 项，成就 ${data.achievements.length} 个
            ${milestoneCount > 0 ? `，新达成 ${milestoneCount} 个里程碑` : ''}
          </div>
        `;
        onChange?.();
      } catch (err) {
        toastEl.innerHTML = `<div class="migration-toast error">❌ ${
          err instanceof Error ? err.message : String(err)
        }</div>`;
      }
    });

    function showToast(msg: string, type: 'success' | 'error') {
      const container = document.querySelector('.toast-container') || createToastContainer();
      const t = document.createElement('div');
      t.className = 'toast' + (type === 'error' ? ' error' : '');
      t.textContent = msg;
      container.appendChild(t);
      setTimeout(() => t.remove(), 2200);
    }

    function createToastContainer(): HTMLElement {
      const c = document.createElement('div');
      c.className = 'toast-container';
      document.body.appendChild(c);
      return c;
    }

    return overlay;
  }
}
