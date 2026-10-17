import { defineConfig } from 'vite';

// 部署在 GitHub Pages 子路径下，需要设置 base
// 仓库名 XiaoHua → 路径 /XiaoHua/
// 若部署到自定义域名或根路径，改为 './' 即可
const repoName = 'XiaoHua';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? `/${repoName}/` : './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
  },
  server: {
    port: 5173,
    open: true,
  },
});
