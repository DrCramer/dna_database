import React from 'react';

// Decorative icons share one stroke, size and colour across the application.
const paths = {
  home: 'm3 10 9-7 9 7v11h-6v-7H9v7H3V10Z',
  grid: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
  download: 'M12 3v13m-5-5 5 5 5-5M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  file: 'M14 2H5a1 1 0 0 0-1 1v18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8l-6-6Zm0 0v6h6M8 13h8m-8 4h5',
  archive: 'M3 3h18v5H3V3Zm2 5v13h14V8M9 12h6',
  calculator: 'M5 2h14v20H5V2Zm3 4h8v4H8V6Zm0 8h1m3 0h1m3 0h.1M8 18h1m3 0h1m3 0h.1',
  settings: 'M4 5h16M4 12h16M4 19h16M8 2v6m8 1v6m-7 1v6',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-8a4 4 0 0 1 0 8m5 10v-2a4 4 0 0 0-3-3.87',
  building: 'M3 21V3h12v18M15 9h6v12M7 7h4M7 11h4M7 15h4M8 21v-2h2v2M2 21h20',
  layers: 'm12 2 10 5-10 5L2 7l10-5ZM2 12l10 5 10-5M2 17l10 5 10-5',
  book: 'M12 5C9 2 4 2 2 3v17c3-1 7-1 10 1m0-16c3-3 8-3 10-2v17c-3-1-7-1-10 1V5Z',
  chart: 'M3 3v18h18M7 16l4-5 4 2 5-8',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  menu: 'M3 6h18M3 12h18M3 18h18',
  chevron: 'm6 9 6 6 6-6',
  edit: 'm16 3 5 5-13 13H3v-5L16 3Zm-3 3 5 5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  key: 'M21 3l-9 9m4-4 3 3m-6-6 3 3M8 21a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
  delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  logout: 'M9 3H3v18h6m6-14 5 5-5 5M8 12h12',
  plus: 'M12 5v14M5 12h14',
  back: 'm12 5-7 7 7 7M5 12h15',
  block: 'M5 5l14 14M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'
};

export default function UiIcon({ name, className = '' }) {
  return <svg className={`ui-icon ${className}`.trim()} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name] || paths.grid} /></svg>;
}
