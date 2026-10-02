import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { loadRuntimeConfig } from './lib/runtimeConfig';

// 先拉取后端运行限制配置，确保各处上传阈值与后端一致后再渲染
void loadRuntimeConfig().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
