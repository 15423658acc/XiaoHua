/**
 * 成就 & 里程碑系统
 *
 * 设计原则：
 * - 成就：游戏内具体目标（合成 256、合成 1024 等），离散布尔值，跨设备对齐友好
 * - 里程碑：全局累积型目标（总分破万、累计 10 局等），由 SaveData 计算
 * - 不做全球排行榜，避免无后端场景下的作弊问题
 */
import type { Achievement, Milestone, SaveData } from '../types';

export const ACHIEVEMENTS: Achievement[] = [
  // 全局成就
  {
    id: 'global_first_open',
    name: '初次启动',
    description: '首次打开小华游戏',
    game: '*',
    icon: '🌱',
  },
  {
    id: 'global_play_3_games',
    name: '游戏探索者',
    description: '游玩至少 3 款不同游戏',
    game: '*',
    icon: '🎮',
  },
  {
    id: 'global_play_5_games',
    name: '游戏达人',
    description: '游玩至少 5 款不同游戏',
    game: '*',
    icon: '🏆',
  },

  // 2048 成就
  {
    id: 'g2048_tile_128',
    name: '初出茅庐',
    description: '在 2048 中合成出 128',
    game: '2048',
    icon: '🎯',
  },
  {
    id: 'g2048_tile_256',
    name: '渐入佳境',
    description: '在 2048 中合成出 256',
    game: '2048',
    icon: '🔥',
  },
  {
    id: 'g2048_tile_512',
    name: '熟能生巧',
    description: '在 2048 中合成出 512',
    game: '2048',
    icon: '⚡',
  },
  {
    id: 'g2048_tile_1024',
    name: '炉火纯青',
    description: '在 2048 中合成出 1024',
    game: '2048',
    icon: '💎',
  },
  {
    id: 'g2048_tile_2048',
    name: '通关达人',
    description: '在 2048 中合成出 2048',
    game: '2048',
    icon: '👑',
  },
  {
    id: 'g2048_score_5000',
    name: '五千分',
    description: '在 2048 单局得分突破 5000',
    game: '2048',
    icon: '⭐',
  },
  {
    id: 'g2048_score_20000',
    name: '两万分大师',
    description: '在 2048 单局得分突破 20000',
    game: '2048',
    icon: '🌟',
  },
];

/** 里程碑：基于 SaveData 计算的全局累积型目标 */
export const MILESTONES: Milestone[] = [
  {
    id: 'm_total_score_1k',
    name: '积少成多',
    description: '所有游戏最高分总和突破 1000',
    icon: '📦',
    check: (s: SaveData) =>
      Object.values(s.scores).reduce((a, b) => a + b, 0) >= 1000,
  },
  {
    id: 'm_total_score_10k',
    name: '分数大师',
    description: '所有游戏最高分总和突破 10000',
    icon: '🎯',
    check: (s: SaveData) =>
      Object.values(s.scores).reduce((a, b) => a + b, 0) >= 10000,
  },
  {
    id: 'm_play_count_10',
    name: '玩家入门',
    description: '累计游玩 10 局',
    icon: '🎲',
    check: (s: SaveData) => s.playCount >= 10,
  },
  {
    id: 'm_play_count_50',
    name: '资深玩家',
    description: '累计游玩 50 局',
    icon: '🎰',
    check: (s: SaveData) => s.playCount >= 50,
  },
  {
    id: 'm_play_count_100',
    name: '老玩家',
    description: '累计游玩 100 局',
    icon: '🎖️',
    check: (s: SaveData) => s.playCount >= 100,
  },
  {
    id: 'm_explore_3_games',
    name: '三款游戏',
    description: '玩过 3 款不同游戏',
    icon: '🧭',
    check: (s: SaveData) => s.playedGames.length >= 3,
  },
  {
    id: 'm_explore_5_games',
    name: '五款游戏',
    description: '玩过 5 款不同游戏',
    icon: '🗺️',
    check: (s: SaveData) => s.playedGames.length >= 5,
  },
];

/** 根据事件名解锁成就（事件名 = 成就 id 的简化版） */
export function achievementsByEvent(): Record<string, string> {
  // 事件名 -> 成就 id 的映射
  // 例如 'g2048_tile_2048' 事件直接对应同名成就
  const map: Record<string, string> = {};
  for (const a of ACHIEVEMENTS) {
    map[a.id] = a.id;
  }
  return map;
}

/** 检查并刷新所有里程碑（基于当前存档） */
export function checkMilestones(save: SaveData): string[] {
  const newlyReached: string[] = [];
  for (const m of MILESTONES) {
    if (!save.milestones.includes(m.id) && m.check(save)) {
      newlyReached.push(m.id);
    }
  }
  return newlyReached;
}
