/**
 * 2048 棋盘核心逻辑（纯函数，无 DOM 耦合）
 *
 * 网格：4x4，0 表示空格
 * 操作：上下左右移动，合并相同数字
 */

export type Direction = 'up' | 'down' | 'left' | 'right';
export type Grid = number[][]; // [row][col]

export interface MoveResult {
  grid: Grid;
  moved: boolean;
  /** 本次合并得分增量 */
  scoreGain: number;
  /** 本次合成出的最大数字（用于成就检测） */
  maxTileAfterMove: number;
  /** 新生成的格子坐标（用于动画） */
  newTile: { row: number; col: number; value: number } | null;
  /** 被合并的格子坐标（用于动画） */
  mergedCells: { row: number; col: number }[];
}

export function createEmptyGrid(): Grid {
  return [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
}

export function cloneGrid(g: Grid): Grid {
  return g.map((row) => [...row]);
}

/** 随机生成 2 或 4，2 概率 90% */
function randomValue(): number {
  return Math.random() < 0.9 ? 2 : 4;
}

/** 在随机空格放置新数字 */
export function addRandomTile(grid: Grid): { row: number; col: number; value: number } | null {
  const empties: { row: number; col: number }[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (grid[r][c] === 0) empties.push({ row: r, col: c });
    }
  }
  if (empties.length === 0) return null;
  const { row, col } = empties[Math.floor(Math.random() * empties.length)];
  const value = randomValue();
  grid[row][col] = value;
  return { row, col, value };
}

/** 向左移动一行（核心：合并逻辑） */
function slideLeft(row: number[]): {
  row: number[];
  moved: boolean;
  scoreGain: number;
  mergedIndices: number[];
  maxTile: number;
} {
  const filtered = row.filter((v) => v !== 0);
  const merged: number[] = [];
  const mergedIndices: number[] = [];
  let scoreGain = 0;
  let maxTile = 0;
  let i = 0;
  while (i < filtered.length) {
    if (i + 1 < filtered.length && filtered[i] === filtered[i + 1]) {
      const val = filtered[i] * 2;
      merged.push(val);
      mergedIndices.push(merged.length - 1);
      scoreGain += val;
      if (val > maxTile) maxTile = val;
      i += 2;
    } else {
      merged.push(filtered[i]);
      if (filtered[i] > maxTile) maxTile = filtered[i];
      i += 1;
    }
  }
  while (merged.length < 4) merged.push(0);
  const moved = merged.some((v, idx) => v !== row[idx]);
  return { row: merged, moved, scoreGain, mergedIndices, maxTile };
}

/** 反转一行/数组 */
function reverse<T>(arr: T[]): T[] {
  return [...arr].reverse();
}

/** 转置（行列互换） */
function transpose(grid: Grid): Grid {
  const g = createEmptyGrid();
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) g[c][r] = grid[r][c];
  return g;
}

/** 应用一次移动，返回结果（含动画信息） */
export function move(grid: Grid, dir: Direction): MoveResult {
  const before = cloneGrid(grid);
  let working = cloneGrid(grid);
  let scoreGain = 0;
  let maxTileAfterMove = 0;
  const mergedCells: { row: number; col: number }[] = [];

  // 转换为"向左移动"的统一处理
  if (dir === 'right') {
    working = working.map((row) => reverse(row));
  } else if (dir === 'up') {
    working = transpose(working);
  } else if (dir === 'down') {
    working = transpose(working).map((row) => reverse(row));
  }

  for (let r = 0; r < 4; r++) {
    const result = slideLeft(working[r]);
    working[r] = result.row;
    scoreGain += result.scoreGain;
    if (result.maxTile > maxTileAfterMove) maxTileAfterMove = result.maxTile;
    // 记录被合并的位置（在转换后的 working 坐标系）
    for (const idx of result.mergedIndices) {
      mergedCells.push({ row: r, col: idx });
    }
  }

  // 反向转换回原坐标系
  if (dir === 'right') {
    working = working.map((row) => reverse(row));
  } else if (dir === 'up') {
    working = transpose(working);
  } else if (dir === 'down') {
    working = transpose(working.map((row) => reverse(row)));
  }

  // 把 mergedCells 转换回原坐标系
  const originalMergedCells = mergedCells.map((mc) => {
    let row = mc.row, col = mc.col;
    if (dir === 'right') {
      col = 3 - col;
    } else if (dir === 'up') {
      // working 是 transpose(before)，所以 (r, idx) 对应原 (idx, r)
      const tmp = row; row = col; col = tmp;
    } else if (dir === 'down') {
      const tmp = row; row = 3 - col; col = tmp;
    }
    return { row, col };
  });

  const moved = JSON.stringify(before) !== JSON.stringify(working);
  let newTile: { row: number; col: number; value: number } | null = null;
  if (moved) {
    newTile = addRandomTile(working);
    // 检查所有格子，更新最大值
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      if (working[r][c] > maxTileAfterMove) maxTileAfterMove = working[r][c];
    }
  }

  return {
    grid: working,
    moved,
    scoreGain,
    maxTileAfterMove,
    newTile,
    mergedCells: originalMergedCells,
  };
}

/** 是否还能移动（用于判定游戏结束） */
export function canMove(grid: Grid): boolean {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (grid[r][c] === 0) return true;
      if (c < 3 && grid[r][c] === grid[r][c + 1]) return true;
      if (r < 3 && grid[r][c] === grid[r + 1][c]) return true;
    }
  }
  return false;
}

/** 当前最大数字 */
export function maxTile(grid: Grid): number {
  let max = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    if (grid[r][c] > max) max = grid[r][c];
  }
  return max;
}
