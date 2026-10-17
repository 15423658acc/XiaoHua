/**
 * 迁移码系统 —— 纯文本短码，无二维码
 *
 * 流程：
 *   导出：SaveData → JSON → 浏览器原生 deflate 压缩 → Base64 → "XH1.xxxx" 短码
 *   导入：短码 → Base64 解码 → 解压 → JSON → SaveData
 *
 * 优点：
 * - 不依赖 pako 等第三方库，使用浏览器原生 CompressionStream / DecompressionStream
 * - 短码纯文本，可通过任何方式传输（微信、邮件、便签）
 * - 用户粘贴短码即可还原，无需相机权限
 *
 * 注意：CompressionStream 在 Chrome 80+ / Firefox 113+ / Safari 16.4+ 支持
 *      若遇老浏览器会回退到未压缩的 Base64
 */
import type { SaveData } from '../types';

const PREFIX = 'XH1.'; // 版本前缀，未来升级编码方式时区分

/** ArrayBuffer <-> Base64 */
function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** 检查浏览器是否支持原生压缩流 */
function supportsCompressionStream(): boolean {
  return typeof CompressionStream !== 'undefined';
}

/** 压缩字符串到 Base64 */
async function compressDeflate(text: string): Promise<string> {
  if (!supportsCompressionStream()) {
    // 回退：直接 Base64 编码 UTF-8 文本
    return 'P.' + btoa(unescape(encodeURIComponent(text)));
  }
  const stream = new Blob([text]).stream().pipeThrough(
    new CompressionStream('deflate-raw')
  );
  const buf = await new Response(stream).arrayBuffer();
  return 'C.' + bufToBase64(buf);
}

/** 解压 Base64（自动识别压缩 / 未压缩前缀） */
async function decompress(code: string): Promise<string> {
  if (code.startsWith('C.')) {
    const buf = base64ToBuf(code.slice(2));
    const stream = new Blob([buf]).stream().pipeThrough(
      new DecompressionStream('deflate-raw')
    );
    const decompressed = await new Response(stream).arrayBuffer();
    return new TextDecoder().decode(decompressed);
  }
  if (code.startsWith('P.')) {
    return decodeURIComponent(escape(atob(code.slice(2))));
  }
  throw new Error('不识别的编码格式');
}

/** 导出存档为短码 */
export async function exportSave(data: SaveData): Promise<string> {
  const json = JSON.stringify(data);
  const compressed = await compressDeflate(json);
  return PREFIX + compressed;
}

/** 导入短码还原存档，失败抛错 */
export async function importSave(code: string): Promise<SaveData> {
  const trimmed = code.trim();
  if (!trimmed.startsWith(PREFIX)) {
    throw new Error('迁移码格式不正确，请检查是否完整复制');
  }
  const body = trimmed.slice(PREFIX.length);
  try {
    const json = await decompress(body);
    const data = JSON.parse(json) as SaveData;
    if (typeof data !== 'object' || data === null) {
      throw new Error('迁移码内容无效');
    }
    // 字段补全
    return {
      version: data.version ?? 1,
      timestamp: data.timestamp ?? Date.now(),
      scores: data.scores ?? {},
      achievements: data.achievements ?? [],
      milestones: data.milestones ?? [],
      playCount: data.playCount ?? 0,
      playedGames: data.playedGames ?? [],
      settings: data.settings ?? {},
    };
  } catch (err) {
    throw new Error(
      '迁移码解析失败：' +
        (err instanceof Error ? err.message : String(err))
    );
  }
}

/** 估算短码字符数（用于 UI 提示） */
export function estimateCodeLength(data: SaveData): number {
  // 经验值：压缩后 200~500 字符，未压缩 800~2000 字符
  const roughJson = JSON.stringify(data).length;
  return supportsCompressionStream()
    ? Math.ceil(roughJson * 0.5) + PREFIX.length + 2
    : roughJson + PREFIX.length + 2;
}
