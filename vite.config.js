import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  // 扩展里用相对路径加载资源
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup/index.html'),
        sidepanel: resolve(__dirname, 'sidepanel/index.html'),
        background: resolve(__dirname, 'src/background/index.js'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background.js'
          if (chunkInfo.name === 'sidepanel') return 'sidepanel.js'
          return 'assets/[name].js'
        },
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
      // 外部化 Node.js 内置模块，LangGraph 会在运行时处理
      external: ['node:async_hooks', 'async_hooks', 'node:fs', 'node:path'],
    },
  },
  optimizeDeps: {
    // 排除 LangGraph 相关依赖，避免预构建问题
    exclude: ['@langchain/langgraph', '@langchain/langgraph-checkpoint', '@langchain/langgraph-sdk'],
  },
  define: {
    // 如果 LangGraph 检测 Node.js 环境，强制设为 false
    'process.env.IS_BROWSER': JSON.stringify(true),
  },
})
