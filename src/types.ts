/**
 * 全局类型定义
 */

/** 游戏分类 */
export type GameCategory = 'puzzle' | 'action' | 'logic' | 'casual';

/** 游戏注册元数据 */
export interface GameMeta {
  id: string;
  name: string;
  icon: string; // emoji 或字符图标，避免依赖图片资源
  category: GameCategory;
  description: string;
}

/** 游戏实例接口 —— 所有游戏必须实现 */
export interface GameInstance {
  /** 启动游戏，传入挂载容器 */
  start(container: HTMLElement): void | Promise<void>;
  /** 销毁游戏，清理事件、定时器、DOM */
  destroy(): void;
  /** 监听分数变化 */
  onScoreChange(cb: (score: number) => void): void;
  /** 监听游戏事件（用于触发成就），事件名自定义 */
  onEvent(cb: (event: string, payload?: unknown) => void): void;
  /** 玩法说明文本 */
  getInstructions(): string;
}

/** 游戏工厂函数：创建一个游戏实例 */
export type GameFactory = () => GameInstance;

/** 完整的游戏注册项 */
export interface GameRegistration extends GameMeta {
  factory: GameFactory;
}

/** 存档数据结构（版本化，方便未来迁移） */
export interface SaveData {
  version: number;
  timestamp: number;
  /** 各游戏最高分 game_id -> best_score */
  scores: Record<string, number>;
  /** 已解锁成就 id 列表 */
  achievements: string[];
  /** 已达成里程碑 id 列表 */
  milestones: string[];
  /** 累计游玩局数 */
  playCount: number;
  /** 玩过哪些游戏 */
  playedGames: string[];
  /** 用户设置 */
  settings: Record<string, unknown>;
}

/** 成就定义 */
export interface Achievement {
  id: string;
  name: string;
  description: string;
  /** 关联游戏 id，'*' 表示全局 */
  game: string;
  icon: string;
}

/** 里程碑定义（全局累积型） */
export interface Milestone {
  id: string;
  name: string;
  description: string;
  /** 达成条件检查函数 */
  check: (save: SaveData) => boolean;
  icon: string;
}
