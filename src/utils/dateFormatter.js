/**
 * Утилиты для форматирования дат
 */

/**
 * Форматирует дату в российский формат ДД.ММ.ГГГГ ЧЧ:ММ
 * @param {Date|string} date - Дата для форматирования
 * @returns {string|null} Отформатированная дата или null
 */
function formatDateRu(date) {
  if (!date) return null;
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

/**
 * Форматирует дату в российский формат только дата ДД.ММ.ГГГГ
 * @param {Date|string} date - Дата для форматирования
 * @returns {string|null} Отформатированная дата или null
 */
function formatDateOnlyRu(date) {
  if (!date) return null;
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  
  return `${day}.${month}.${year}`;
}

module.exports = {
  formatDateRu,
  formatDateOnlyRu
};
