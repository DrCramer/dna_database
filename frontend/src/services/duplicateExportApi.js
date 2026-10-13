export async function requestDuplicateXlsx({ snapshotIds, options, token, activeDepartmentId }) {
  const response = await fetch('/api/export/duplicates/excel', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Active-Department-Id': activeDepartmentId,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ snapshotIds, options })
  });
  if (!response.ok) {
    let message = 'Не удалось сформировать Excel-файл.';
    try { message = (await response.json()).message || message; } catch { /* server returned a non-JSON error */ }
    throw new Error(message);
  }
  const contentDisposition = response.headers.get('Content-Disposition') || '';
  const encodedFilename = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const filename = encodedFilename ? decodeURIComponent(encodedFilename) : 'Дубликаты.xlsx';
  return { blob: await response.blob(), filename };
}
