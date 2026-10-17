/**
 * 游戏注册中心
 *
 * 所有游戏在此注册，主菜单据此渲染卡片。
 * 新增游戏只需：
 *   1. 实现 GameInstance 接口
 *   2. 在下方 GAMES 数组添加一项
 */
import type { GameRegistration } from '../types';
import { Game2048Factory } from '../games/game2048';
import { SnakeFactory } from '../games/snake';
import { SokobanFactory } from '../games/sokoban';
import { TetrisFactory } from '../games/tetris';
import { BreakoutFactory } from '../games/breakout';
import { MemoryFactory } from '../games/memory';
import { MinesweeperFactory } from '../games/minesweeper';
import { HexmatchFactory } from '../games/hexmatch';
import { SudokuFactory } from '../games/sudoku';
import { LiankanFactory } from '../games/liankan';
import { ZumaFactory } from '../games/zuma';

export const GAMES: GameRegistration[] = [
  {
    id: '2048',
    name: '2048',
    icon: '🔢',
    category: 'puzzle',
    description: '合并相同数字，挑战 2048',
    factory: Game2048Factory,
  },
  {
    id: 'snake',
    name: '贪吃蛇',
    icon: '🐍',
    category: 'action',
    description: '吃豆豆变长，别撞墙别咬自己',
    factory: SnakeFactory,
  },
  {
    id: 'sokoban',
    name: '推箱子',
    icon: '📦',
    category: 'puzzle',
    description: '把所有箱子推到目标点',
    factory: SokobanFactory,
  },
  {
    id: 'tetris',
    name: '俄罗斯方块',
    icon: '🟦',
    category: 'action',
    description: '旋转方块消除整行',
    factory: TetrisFactory,
  },
  {
    id: 'breakout',
    name: '打砖块',
    icon: '🧱',
    category: 'action',
    description: '控制挡板弹球，击碎所有砖块',
    factory: BreakoutFactory,
  },
  {
    id: 'memory',
    name: '记忆翻牌',
    icon: '🧠',
    category: 'puzzle',
    description: '翻开相同图案配对，挑战最少步数',
    factory: MemoryFactory,
  },
  {
    id: 'minesweeper',
    name: '扫雷',
    icon: '💣',
    category: 'puzzle',
    description: '标记地雷，翻开所有安全格',
    factory: MinesweeperFactory,
  },
  {
    id: 'hexmatch',
    name: '六边形消除',
    icon: '🔷',
    category: 'casual',
    description: '交换相邻六边形，消除同色连线',
    factory: HexmatchFactory,
  },
  {
    id: 'sudoku',
    name: '数独',
    icon: '🧩',
    category: 'logic',
    description: '填入 1-9 数字，挑战数独逻辑',
    factory: SudokuFactory,
  },
  {
    id: 'liankan',
    name: '连连看',
    icon: '🀄',
    category: 'puzzle',
    description: '消除相同图案，路径最多两次转折',
    factory: LiankanFactory,
  },
  {
    id: 'zuma',
    name: '祖玛',
    icon: '🎱',
    category: 'action',
    description: '发射彩球消除同色链，阻止球链进洞',
    factory: ZumaFactory,
  },
];

/** 按 id 查游戏 */
export function findGame(id: string): GameRegistration | undefined {
  return GAMES.find((g) => g.id === id);
}
