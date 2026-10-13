import './styles/index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Все стили импортируются через единый файл

console.log('React: Starting application with custom router...');

const rootElement = document.getElementById('root');

if (rootElement) {
  console.log('React: Root element found, rendering...');
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  console.log('React: Application with custom router rendered successfully!');
} else {
  console.error('React: Root element not found!');
}