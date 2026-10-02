import './styles/index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import FixedApp from './App-fixed';
// Все стили импортируются через единый файл

console.log('Fixed React: Starting application with custom router...');

const rootElement = document.getElementById('root');

if (rootElement) {
  console.log('Fixed React: Root element found, rendering...');
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <FixedApp />
    </React.StrictMode>
  );
  console.log('Fixed React: Application with custom router rendered successfully!');
} else {
  console.error('Fixed React: Root element not found!');
}