import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import './DepartmentSwitcher.css';

const DepartmentSwitcher = () => {
  const { accessibleDepartments, activeDepartmentId, setActiveDepartment } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const switcherRef = useRef(null);

  const activeDepartment = useMemo(
    () => accessibleDepartments?.find((department) => department.id === activeDepartmentId) || accessibleDepartments?.[0],
    [accessibleDepartments, activeDepartmentId]
  );

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleClickOutside = (event) => {
      if (switcherRef.current && !switcherRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  if (!accessibleDepartments || accessibleDepartments.length === 0) {
    return null;
  }

  return (
    <div
      ref={switcherRef}
      className={`department-switcher ${isOpen ? 'is-open' : ''}`}
      aria-label="Выбор активного отдела"
    >
      <span className="department-switcher__icon">🏛️</span>
      <button
        type="button"
        className="department-switcher__trigger"
        onClick={() => setIsOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="department-switcher__value">
          {activeDepartment?.name || 'Выберите отдел'}
        </span>
        <span className="department-switcher__chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none">
            <path
              d="M4 6.5L8 10L12 6.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="department-switcher__menu" role="listbox" aria-label="Список отделов">
          {accessibleDepartments.map((department) => {
            const isActive = department.id === activeDepartment?.id;

            return (
              <button
                key={department.id}
                type="button"
                className={`department-switcher__option ${isActive ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveDepartment(department.id);
                  setIsOpen(false);
                }}
                role="option"
                aria-selected={isActive}
              >
                <span className="department-switcher__option-name">{department.name}</span>
                {isActive && <span className="department-switcher__option-check">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DepartmentSwitcher;
