import './styles/main.css';
import('./qr.ts')
  .then(() => {
    console.log('qr.js loaded and initialized successfully');
  })
  .catch((error) => {
    console.error('Failed to load qr.js:', error);
  });