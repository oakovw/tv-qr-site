import './styles/main.css';

// // Переключаем loading/loaded вручную до загрузки qr.js
// const loadingElement = document.getElementById('loading');
// const loadedElement = document.getElementById('loaded');

// if (loadingElement) {
//     loadingElement.hidden = true;
// }
// if (loadedElement) {
//     loadedElement.hidden = false;
// }

// Загружаем qr.js
import('./qr.ts')
  .then(() => {
    console.log('qr.js loaded and initialized successfully');
  })
  .catch((error) => {
    console.error('Failed to load qr.js:', error);
    // if (loadingElement) {
    //   loadingElement.innerHTML = '<p style="color: red;">Ошибка загрузки приложения QR-кода</p>';
    // }
  });