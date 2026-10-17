/**
 * 存储封装 —— 基于 localStorage，单设备存储
 *
 * 跨设备同步通过 Migration.ts 的迁移码完成
 * 数据格式见 SaveData 类型
 */
import type { SaveData } from '../types';

const STORAGE_KEY = 'xiaohua:save:v1';
const SAVE_VERSION = 1;

function createDefaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    timestamp: Date.now(),
    scores: {},
    achievements: [],
    milestones: [],
    playCount: 0,
    playedGames: [],
    settings: {},
  };
}

class StorageManager {
  private cache: SaveData | null = null;

  /** 读取存档（带缓存） */
  load(): SaveData {
    if (this.cache) return this.cache;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.cache = createDefaultSave();
        return this.cache;
      }
      const parsed = JSON.parse(raw) as SaveData;
      // 简单版本兼容：未来可加迁移逻辑
      this.cache = { ...createDefaultSave(), ...parsed };
      return this.cache;
    } catch (err) {
      console.warn('[XiaoHua] 存档读取失败，重置为默认', err);
      this.cache = createDefaultSave();
      return this.cache;
    }
  }

  /** 持久化存档 */
  save(data: SaveData): void {
    data.version = SAVE_VERSION;
    data.timestamp = Date.now();
    this.cache = data;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.error('[XiaoHua] 存档保存失败', err);
    }
  }

  /** 直接覆盖整个存档（导入时用） */
  replace(data: SaveData): void {
    this.cache = { ...createDefaultSave(), ...data, version: SAVE_VERSION };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cache));
    } catch (err) {
      console.error('[XiaoHua] 存档写入失败', err);
    }
  }

  /** 清空存档（危险操作） */
  clear(): void {
    this.cache = createDefaultSave();
    localStorage.removeItem(STORAGE_KEY);
  }

  /** 记录一局游戏得分，返回是否破纪录 */
  recordScore(gameId: string, score: number): boolean {
    const save = this.load();
    const prev = save.scores[gameId] ?? 0;
    const isRecord = score > prev;
    if (isRecord) save.scores[gameId] = score;
    this.save(save);
    return isRecord;
  }

  /** 标记游玩过某游戏 */
  markPlayed(gameId: string): void {
    const save = this.load();
    save.playCount += 1;
    if (!save.playedGames.includes(gameId)) {
      save.playedGames.push(gameId);
    }
    this.save(save);
  }

  /** 解锁成就，返回是否新解锁 */
  unlock(achievementId: string): boolean {
    const save = this.load();
    if (save.achievements.includes(achievementId)) return false;
    save.achievements.push(achievementId);
    this.save(save);
    return true;
  }

  /** 标记里程碑达成 */
  markMilestone(milestoneId: string): boolean {
    const save = this.load();
    if (save.milestones.includes(milestoneId)) return false;
    save.milestones.push(milestoneId);
    this.save(save);
    return true;
  }
}

export const storage = new StorageManager();
