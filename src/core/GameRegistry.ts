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
import { FlappybirdFactory } from '../games/flappybird';
import { DoodlejumpFactory } from '../games/doodlejump';
import { TictactoeFactory } from '../games/tictactoe';
import { GomokuFactory } from '../games/gomoku';
import { WordsearchFactory } from '../games/wordsearch';
import { BullscowsFactory } from '../games/bullscows';

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
    description: '填入 1-9 数字，同行同列同小九宫不能有一样的数字',
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
  {
    id: 'flappybird',
    name: 'Flappy Bird',
    icon: '🐤',
    category: 'action',
    description: '点击让小鸟跳跃穿越管道间隙，挑战极限',
    factory: FlappybirdFactory,
  },
  {
    id: 'doodlejump',
    name: '跳跃塔',
    icon: '🦘',
    category: 'action',
    description: '自动跳跃踩平台上升，掉落即失败',
    factory: DoodlejumpFactory,
  },
  {
    id: 'tictactoe',
    name: '井字棋',
    icon: '❌',
    category: 'logic',
    description: '三连成线胜出，AI 用 Minimax 算法',
    factory: TictactoeFactory,
  },
  {
    id: 'gomoku',
    name: '五子棋残局',
    icon: '⚫',
    category: 'logic',
    description: '预设残局中找到致胜走法，挑战 5 局',
    factory: GomokuFactory,
  },
  {
    id: 'wordsearch',
    name: '单词搜索',
    icon: '🔤',
    category: 'puzzle',
    description: '在字母网格中找出隐藏单词',
    factory: WordsearchFactory,
  },
  {
    id: 'bullscows',
    name: '猜数字',
    icon: '🔢',
    category: 'logic',
    description: '根据 A/B 反馈推理出 4 位密码',
    factory: BullscowsFactory,
  },
];

/** 按 id 查游戏 */
export function findGame(id: string): GameRegistration | undefined {
  return GAMES.find((g) => g.id === id);
}
