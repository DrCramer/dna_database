import React, { useState, useRef, useEffect } from 'react';

// Предзаданная палитра цветов для DNA анализа
const PRESET_COLORS = [
  // Зелёные (полное совпадение)
  '#90EE90', '#98FB98', '#00FF00', '#32CD32', '#228B22',
  // Жёлто-коричневые (контаминация)
  '#9d8311', '#FFD700', '#FFA500', '#FF8C00', '#DAA520',
  // Синие (совпадающие аллели)
  '#1400e8', '#0000FF', '#4169E1', '#1E90FF', '#00BFFF',
  // Красные/розовые (несовпадение)
  '#FFB6C1', '#FF69B4', '#FF1493', '#DC143C', '#FF0000',
  // Дополнительные
  '#E8F5E9', '#E3F2FD', '#FFF3E0', '#FFFDE7', '#FFEBEE',
  '#9E9E9E', '#607D8B', '#795548', '#009688', '#673AB7'
];

const ColorPicker = ({ value, onChange, label = "Выбрать цвет" }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hexValue, setHexValue] = useState(value || '#1565C0');
  const popoverRef = useRef(null);

  // Синхронизация внутреннего стейта, если проп изменился извне
  useEffect(() => {
    if (value) setHexValue(value);
  }, [value]);

  // Закрытие по клику вне компонента
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleColorChange = (newColor) => {
    setHexValue(newColor);
    if (onChange) onChange(newColor);
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setHexValue(val);
    // Проверяем, валидный ли HEX перед отправкой наверх
    if (/^#([0-9A-F]{3}){1,2}$/i.test(val)) {
      if (onChange) onChange(val);
    }
  };

  return (
    <div className="cp-wrapper" ref={popoverRef}>
      {/* Кнопка-триггер */}
      <button
        type="button"
        className="cp-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={label}
      >
        <div
          className="cp-color-preview"
          style={{ '--cp-current-color': hexValue }}
        />
      </button>

      {/* Выпадающее окно */}
      {isOpen && (
        <div className="cp-popover">
          {/* Предзаданные цвета */}
          <div className="cp-palette">
            {PRESET_COLORS.map((presetColor) => (
              <div
                key={presetColor}
                className={`cp-swatch ${hexValue.toUpperCase() === presetColor.toUpperCase() ? 'selected' : ''}`}
                style={{ '--cp-swatch-color': presetColor }}
                onClick={() => handleColorChange(presetColor)}
                title={presetColor}
              />
            ))}
          </div>

          {/* Ручной ввод HEX */}
          <div className="cp-hex-input-group">
            <span className="cp-hex-label">HEX:</span>
            <input
              type="text"
              className="cp-hex-input"
              value={hexValue}
              onChange={handleInputChange}
              maxLength={7}
              placeholder="#000000"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ColorPicker;
