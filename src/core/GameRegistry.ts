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

export const GAMES: GameRegistration[] = [
  {
    id: '2048',
    name: '2048',
    icon: '🔢',
    category: 'puzzle',
    description: '合并相同数字，挑战 2048',
    factory: Game2048Factory,
  },
  // 未来新增游戏在此追加：
  // {
  //   id: 'snake',
  //   name: '贪吃蛇',
  //   icon: '🐍',
  //   category: 'action',
  //   description: '吃豆豆、变长、别撞墙',
  //   factory: SnakeFactory,
  // },
  // {
  //   id: 'sokoban',
  //   name: '推箱子',
  //   icon: '📦',
  //   category: 'puzzle',
  //   description: '把所有箱子推到目标点',
  //   factory: SokobanFactory,
  // },
];

/** 按 id 查游戏 */
export function findGame(id: string): GameRegistration | undefined {
  return GAMES.find((g) => g.id === id);
}
