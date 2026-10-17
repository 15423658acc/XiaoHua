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

  // 贪吃蛇成就
  {
    id: 'snake_len_10',
    name: '小蛇初长',
    description: '在贪吃蛇中长度达到 10',
    game: 'snake',
    icon: '🐛',
  },
  {
    id: 'snake_len_20',
    name: '长蛇出洞',
    description: '在贪吃蛇中长度达到 20',
    game: 'snake',
    icon: '🐍',
  },
  {
    id: 'snake_len_30',
    name: '巨蟒之王',
    description: '在贪吃蛇中长度达到 30',
    game: 'snake',
    icon: '🐉',
  },
  {
    id: 'snake_score_100',
    name: '蛇王百点',
    description: '在贪吃蛇单局得分突破 100',
    game: 'snake',
    icon: '💯',
  },
  {
    id: 'snake_score_500',
    name: '蛇皇五百',
    description: '在贪吃蛇单局得分突破 500',
    game: 'snake',
    icon: '👑',
  },

  // 推箱子成就
  {
    id: 'sokoban_clear_1',
    name: '推门见山',
    description: '通关推箱子第 1 关',
    game: 'sokoban',
    icon: '🚪',
  },
  {
    id: 'sokoban_clear_3',
    name: '推动渐入',
    description: '通关推箱子第 3 关',
    game: 'sokoban',
    icon: '📦',
  },
  {
    id: 'sokoban_clear_all',
    name: '推箱大师',
    description: '通关推箱子全部 10 关',
    game: 'sokoban',
    icon: '🏆',
  },

  // 俄罗斯方块成就
  {
    id: 'tetris_lines_10',
    name: '消行入门',
    description: '在俄罗斯方块中累计消 10 行',
    game: 'tetris',
    icon: '📊',
  },
  {
    id: 'tetris_lines_50',
    name: '消行熟手',
    description: '在俄罗斯方块中累计消 50 行',
    game: 'tetris',
    icon: '📈',
  },
  {
    id: 'tetris_lines_100',
    name: '消行大师',
    description: '在俄罗斯方块中累计消 100 行',
    game: 'tetris',
    icon: '🎯',
  },
  {
    id: 'tetris_score_1000',
    name: '千分小成',
    description: '在俄罗斯方块单局得分突破 1000',
    game: 'tetris',
    icon: '⭐',
  },
  {
    id: 'tetris_score_5000',
    name: '五千分高手',
    description: '在俄罗斯方块单局得分突破 5000',
    game: 'tetris',
    icon: '🌟',
  },
  {
    id: 'tetris_clear_4',
    name: '一次四消',
    description: '在俄罗斯方块中一次消 4 行',
    game: 'tetris',
    icon: '⚡',
  },

  // 打砖块成就
  {
    id: 'breakout_clear_50',
    name: '砖墙初破',
    description: '在打砖块单局消 50 块砖',
    game: 'breakout',
    icon: '🧱',
  },
  {
    id: 'breakout_clear_200',
    name: '砖墙粉碎',
    description: '在打砖块单局消 200 块砖',
    game: 'breakout',
    icon: '💥',
  },
  {
    id: 'breakout_score_500',
    name: '砖块五百',
    description: '在打砖块单局得分突破 500',
    game: 'breakout',
    icon: '🎯',
  },
  {
    id: 'breakout_score_2000',
    name: '砖块两千',
    description: '在打砖块单局得分突破 2000',
    game: 'breakout',
    icon: '🏆',
  },
  {
    id: 'breakout_clear_all',
    name: '全砖清场',
    description: '在打砖块中一局清光所有砖块',
    game: 'breakout',
    icon: '🎆',
  },

  // 记忆翻牌成就
  {
    id: 'memory_clear',
    name: '记忆通关',
    description: '完成一局记忆翻牌',
    game: 'memory',
    icon: '🧠',
  },
  {
    id: 'memory_steps_20',
    name: '神速记忆',
    description: '在 20 步内通关记忆翻牌',
    game: 'memory',
    icon: '⚡',
  },
  {
    id: 'memory_time_30s',
    name: '极速翻牌',
    description: '在 30 秒内通关记忆翻牌',
    game: 'memory',
    icon: '⏱️',
  },
  {
    id: 'memory_perfect',
    name: '过目不忘',
    description: '在记忆翻牌中零错误通关',
    game: 'memory',
    icon: '💎',
  },

  // 扫雷成就
  {
    id: 'minesweeper_clear',
    name: '排雷成功',
    description: '通关扫雷',
    game: 'minesweeper',
    icon: '🚩',
  },
  {
    id: 'minesweeper_time_60s',
    name: '神速排雷',
    description: '在扫雷中 60 秒内通关',
    game: 'minesweeper',
    icon: '⚡',
  },
  {
    id: 'minesweeper_no_flag',
    name: '无旗通关',
    description: '在扫雷中不使用标记通关',
    game: 'minesweeper',
    icon: '🧠',
  },

  // 六边形消除成就
  {
    id: 'hexmatch_score_100',
    name: '六边初成',
    description: '在六边形消除单局得分突破 100',
    game: 'hexmatch',
    icon: '⬡',
  },
  {
    id: 'hexmatch_score_500',
    name: '六边大师',
    description: '在六边形消除单局得分突破 500',
    game: 'hexmatch',
    icon: '🔷',
  },
  {
    id: 'hexmatch_clear_4',
    name: '四连消除',
    description: '在六边形消除中一次消除 4 连',
    game: 'hexmatch',
    icon: '💥',
  },

  // 数独成就
  {
    id: 'sudoku_clear',
    name: '数独通关',
    description: '完成一局数独',
    game: 'sudoku',
    icon: '✏️',
  },
  {
    id: 'sudoku_hard',
    name: '困难大师',
    description: '在困难难度下通关数独',
    game: 'sudoku',
    icon: '🏆',
  },
  {
    id: 'sudoku_no_error',
    name: '无错通关',
    description: '在数独中无任何错误通关',
    game: 'sudoku',
    icon: '💎',
  },

  // 连连看成就
  {
    id: 'liankan_clear',
    name: '连连通关',
    description: '通关连连看任意一关',
    game: 'liankan',
    icon: '🀄',
  },
  {
    id: 'liankan_clear_3',
    name: '连连中盘',
    description: '通关连连看第 3 关',
    game: 'liankan',
    icon: '🎯',
  },
  {
    id: 'liankan_clear_all',
    name: '连连大师',
    description: '通关连连看全部 5 关',
    game: 'liankan',
    icon: '🏆',
  },
  {
    id: 'liankan_no_hint',
    name: '无提示通关',
    description: '在连连看中不使用提示通关全部 5 关',
    game: 'liankan',
    icon: '💎',
  },
  {
    id: 'liankan_time_180s',
    name: '极速连连',
    description: '在连连看第 1 关 90 秒内通关',
    game: 'liankan',
    icon: '⚡',
  },

  // 祖玛成就
  {
    id: 'zuma_clear_1',
    name: '祖玛初胜',
    description: '通关祖玛第 1 关',
    game: 'zuma',
    icon: '🎱',
  },
  {
    id: 'zuma_clear_all',
    name: '祖玛大师',
    description: '通关祖玛全部 3 关',
    game: 'zuma',
    icon: '👑',
  },
  {
    id: 'zuma_combo_3',
    name: '三连消球',
    description: '在祖玛中单次发射产生 3 次连锁',
    game: 'zuma',
    icon: '🔥',
  },

  // Flappy Bird 成就
  {
    id: 'flappy_score_5',
    name: '飞鸟起步',
    description: '在 Flappy Bird 单局得分达到 5',
    game: 'flappybird',
    icon: '🐤',
  },
  {
    id: 'flappy_score_15',
    name: '飞鸟老手',
    description: '在 Flappy Bird 单局得分达到 15',
    game: 'flappybird',
    icon: '✈️',
  },
  {
    id: 'flappy_score_30',
    name: '飞鸟大师',
    description: '在 Flappy Bird 单局得分达到 30',
    game: 'flappybird',
    icon: '🏆',
  },
  {
    id: 'flappy_combo_5',
    name: '飞鸟连击',
    description: '在 Flappy Bird 中连续 5 局每局都得分 ≥ 5',
    game: 'flappybird',
    icon: '🔥',
  },

  // 跳跃塔成就
  {
    id: 'doodle_height_100',
    name: '跳跃入门',
    description: '在跳跃塔中高度分达到 100',
    game: 'doodlejump',
    icon: '🪜',
  },
  {
    id: 'doodle_height_500',
    name: '跳跃高手',
    description: '在跳跃塔中高度分达到 500',
    game: 'doodlejump',
    icon: '⛰️',
  },
  {
    id: 'doodle_height_1000',
    name: '跳跃大师',
    description: '在跳跃塔中高度分达到 1000',
    game: 'doodlejump',
    icon: '🏔️',
  },
  {
    id: 'doodle_use_moving',
    name: '移动跳手',
    description: '在跳跃塔中踩到 5 次横向移动平台',
    game: 'doodlejump',
    icon: '🎯',
  },

  // 井字棋成就
  {
    id: 'tictactoe_win_medium',
    name: '智胜中等',
    description: '在井字棋中等难度下击败 AI',
    game: 'tictactoe',
    icon: '🎯',
  },
  {
    id: 'tictactoe_draw_hard',
    name: '困境求和',
    description: '在井字棋困难难度下平局 3 次',
    game: 'tictactoe',
    icon: '🤝',
  },
  {
    id: 'tictactoe_streak_3',
    name: '三局不败',
    description: '在井字棋中连续 3 局不输',
    game: 'tictactoe',
    icon: '⚡',
  },
  {
    id: 'tictactoe_play_10',
    name: '井字常客',
    description: '在井字棋中累计游玩 10 局',
    game: 'tictactoe',
    icon: '🎮',
  },

  // 五子棋残局成就
  {
    id: 'gomoku_clear_1',
    name: '残局入门',
    description: '通关五子棋残局第 1 局',
    game: 'gomoku',
    icon: '🎯',
  },
  {
    id: 'gomoku_clear_3',
    name: '中盘巧胜',
    description: '通关五子棋残局第 3 局',
    game: 'gomoku',
    icon: '⚡',
  },
  {
    id: 'gomoku_clear_all',
    name: '残局大师',
    description: '通关五子棋残局全部 5 局',
    game: 'gomoku',
    icon: '👑',
  },
  {
    id: 'gomoku_no_hint',
    name: '无师自通',
    description: '在五子棋残局中未使用任何提示通关全部 5 局',
    game: 'gomoku',
    icon: '💎',
  },

  // 单词搜索成就
  {
    id: 'wordsearch_clear_1',
    name: '寻词起步',
    description: '通关单词搜索第 1 关',
    game: 'wordsearch',
    icon: '🔤',
  },
  {
    id: 'wordsearch_clear_3',
    name: '寻词熟手',
    description: '通关单词搜索第 3 关',
    game: 'wordsearch',
    icon: '📖',
  },
  {
    id: 'wordsearch_clear_all',
    name: '寻词大师',
    description: '通关单词搜索全部 5 关',
    game: 'wordsearch',
    icon: '🏆',
  },
  {
    id: 'wordsearch_no_wrong',
    name: '一击即中',
    description: '通关单词搜索全部 5 关未出现错误选词',
    game: 'wordsearch',
    icon: '💎',
  },

  // 猜数字成就
  {
    id: 'bullscows_win',
    name: '破解密码',
    description: '在猜数字中胜利 1 次',
    game: 'bullscows',
    icon: '🔓',
  },
  {
    id: 'bullscows_win_5',
    name: '灵犀一指',
    description: '在猜数字中 5 次以内猜中',
    game: 'bullscows',
    icon: '⚡',
  },
  {
    id: 'bullscows_win_3',
    name: '读心大师',
    description: '在猜数字中 3 次以内猜中',
    game: 'bullscows',
    icon: '🔮',
  },
  {
    id: 'bullscows_no_hint',
    name: '无提示破译',
    description: '在猜数字中未使用提示胜利 3 次',
    game: 'bullscows',
    icon: '💎',
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
  {
    id: 'm_explore_10_games',
    name: '十款游戏',
    description: '玩过 10 款不同游戏',
    icon: '🌐',
    check: (s: SaveData) => s.playedGames.length >= 10,
  },
  {
    id: 'm_explore_all_games',
    name: '游戏全收藏',
    description: '玩过 15 款不同游戏',
    icon: '👑',
    check: (s: SaveData) => s.playedGames.length >= 15,
  },
  {
    id: 'm_total_score_50k',
    name: '分数王者',
    description: '所有游戏最高分总和突破 50000',
    icon: '💎',
    check: (s: SaveData) =>
      Object.values(s.scores).reduce((a, b) => a + b, 0) >= 50000,
  },
  {
    id: 'm_total_score_100k',
    name: '分数传说',
    description: '所有游戏最高分总和突破 100000',
    icon: '🌟',
    check: (s: SaveData) =>
      Object.values(s.scores).reduce((a, b) => a + b, 0) >= 100000,
  },
  {
    id: 'm_play_count_200',
    name: '游戏狂人',
    description: '累计游玩 200 局',
    icon: '🃏',
    check: (s: SaveData) => s.playCount >= 200,
  },
  {
    id: 'm_play_count_500',
    name: '游戏宗师',
    description: '累计游玩 500 局',
    icon: '🏅',
    check: (s: SaveData) => s.playCount >= 500,
  },
  {
    id: 'm_achievements_5',
    name: '初露锋芒',
    description: '解锁 5 项成就',
    icon: '🌱',
    check: (s: SaveData) => s.achievements.length >= 5,
  },
  {
    id: 'm_achievements_15',
    name: '成就收集者',
    description: '解锁 15 项成就',
    icon: '⛏️',
    check: (s: SaveData) => s.achievements.length >= 15,
  },
  {
    id: 'm_achievements_30',
    name: '成就达人',
    description: '解锁 30 项成就',
    icon: '🏆',
    check: (s: SaveData) => s.achievements.length >= 30,
  },
  {
    id: 'm_achievements_50',
    name: '成就大师',
    description: '解锁 50 项成就',
    icon: '👑',
    check: (s: SaveData) => s.achievements.length >= 50,
  },
  {
    id: 'm_milestones_5',
    name: '里程碑起步',
    description: '达成 5 项里程碑',
    icon: '🚩',
    check: (s: SaveData) => s.milestones.length >= 5,
  },
  {
    id: 'm_milestones_10',
    name: '里程碑熟手',
    description: '达成 10 项里程碑',
    icon: '🚀',
    check: (s: SaveData) => s.milestones.length >= 10,
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
