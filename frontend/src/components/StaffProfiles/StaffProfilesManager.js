/**
 * Компонент для управления профилями сотрудников
 */

import React, { useState, useEffect } from 'react';
import './StaffProfilesManager.css';

const StaffProfilesManager = () => {
    const [staffProfiles, setStaffProfiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [selectedProfile, setSelectedProfile] = useState(null);
    const [filters, setFilters] = useState({
        name: '',
        department: '',
        position: ''
    });
    const [pagination, setPagination] = useState({
        page: 1,
        limit: 20,
        total: 0,
        pages: 0
    });

    // Загрузка профилей сотрудников
    const loadStaffProfiles = async () => {
        try {
            setLoading(true);
            const queryParams = new URLSearchParams({
                page: pagination.page,
                limit: pagination.limit,
                ...Object.fromEntries(Object.entries(filters).filter(([_, v]) => v))
            });

            const response = await fetch(`/api/staff-profiles?${queryParams}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });

            if (!response.ok) {
                throw new Error('Ошибка при загрузке профилей сотрудников');
            }

            const data = await response.json();
            setStaffProfiles(data.data);
            setPagination(data.pagination);
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Загрузка файла с профилями
    const handleFileUpload = async (file) => {
        if (!file) return;

        try {
            setLoading(true);
            setError(null);

            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/staff-profiles/upload', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || errorData.message || 'Ошибка при загрузке файла');
            }

            const result = await response.json();
            
            // Формируем сообщение о результате
            let message = `✅ Успешно загружено профилей: ${result.profilesCount || result.summary?.created || 0}`;
            if (result.errors && result.errors.length > 0) {
                message += `\n⚠️ Ошибок: ${result.errors.length}`;
            }
            if (result.summary?.failed > 0) {
                message += `\n❌ Не удалось загрузить: ${result.summary.failed}`;
            }
            
            alert(message);
            
            // Перезагрузить список
            await loadStaffProfiles();
        } catch (err) {
            setError(err.message);
            alert(`❌ Ошибка: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadStaffProfiles();
    }, [pagination.page, filters]);

    // Обработка фильтров
    const handleFilterChange = (field, value) => {
        setFilters(prev => ({
            ...prev,
            [field]: value
        }));
        setPagination(prev => ({ ...prev, page: 1 }));
    };

    // Анализ контаминации для образца
    const analyzeContamination = async (sampleId) => {
        try {
            setLoading(true);
            const response = await fetch(`/api/staff-profiles/analyze-contamination/${sampleId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    threshold: 5.0,
                    method: 'direct_comparison'
                })
            });

            if (!response.ok) {
                throw new Error('Ошибка при анализе контаминации');
            }

            const result = await response.json();
            return result.data;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    // Получение статистики
    const loadStatistics = async () => {
        try {
            const response = await fetch('/api/staff-profiles/statistics', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });

            if (!response.ok) {
                throw new Error('Ошибка при загрузке статистики');
            }

            const data = await response.json();
            return data.data;
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    if (loading && staffProfiles.length === 0) {
        return (
            <div className="staff-profiles-manager">
                <div className="loading">Загрузка профилей сотрудников...</div>
            </div>
        );
    }

    return (
        <div className="staff-profiles-manager">
            <div className="header staff-manager-hero">
                <div>
                    <h2>Профили сотрудников</h2>
                    <p className="staff-manager-subtitle">Загрузка, фильтрация и просмотр штатных ДНК-профилей сотрудников.</p>
                </div>
                <div className="header-actions">
                    <button 
                        className="btn btn-primary"
                        onClick={() => setShowAddForm(true)}
                    >
                        Добавить сотрудника
                    </button>
                    <button 
                        className="btn btn-primary"
                        onClick={() => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = '.xlsx,.xls';
                            input.style.display = 'none';
                            input.onchange = (e) => {
                                handleFileUpload(e.target.files[0]);
                                document.body.removeChild(input);
                            };
                            document.body.appendChild(input);
                            input.click();
                        }}
                    >
                        📁 Загрузить из файла
                    </button>
                    <button 
                        className="btn btn-secondary"
                        onClick={loadStatistics}
                    >
                        Статистика
                    </button>
                </div>
            </div>

            {error && (
                <div className="error-message">
                    <strong>Ошибка:</strong> {error}
                </div>
            )}

            {/* Фильтры */}
            <div className="filters staff-manager-filters">
                <div className="filter-group">
                    <label>Поиск по имени:</label>
                    <input
                        type="text"
                        value={filters.name}
                        onChange={(e) => handleFilterChange('name', e.target.value)}
                        placeholder="Введите имя сотрудника"
                    />
                </div>
                <div className="filter-group">
                    <label>Отдел:</label>
                    <input
                        type="text"
                        value={filters.department}
                        onChange={(e) => handleFilterChange('department', e.target.value)}
                        placeholder="Введите название отдела"
                    />
                </div>
                <div className="filter-group">
                    <label>Должность:</label>
                    <input
                        type="text"
                        value={filters.position}
                        onChange={(e) => handleFilterChange('position', e.target.value)}
                        placeholder="Введите должность"
                    />
                </div>
            </div>

            {/* Таблица профилей */}
            <div className="profiles-table staff-manager-table-shell">
                <table>
                    <thead>
                        <tr>
                            <th>ID сотрудника</th>
                            <th>ФИО</th>
                            <th>Отдел</th>
                            <th>Должность</th>
                            <th>Дата добавления</th>
                            <th>Статус</th>
                            <th>Действия</th>
                        </tr>
                    </thead>
                    <tbody>
                        {staffProfiles.map(profile => (
                            <tr key={profile.id}>
                                <td>{profile.staff_id}</td>
                                <td>{profile.full_name}</td>
                                <td>{profile.department || 'Не указан'}</td>
                                <td>{profile.position || 'Не указана'}</td>
                                <td>{new Date(profile.date_added).toLocaleDateString('ru-RU')}</td>
                                <td>
                                    <span className={`status ${profile.is_active ? 'active' : 'inactive'}`}>
                                        {profile.is_active ? 'Активен' : 'Неактивен'}
                                    </span>
                                </td>
                                <td>
                                    <div className="actions">
                                        <button
                                            className="btn btn-sm btn-info"
                                            onClick={() => setSelectedProfile(profile)}
                                        >
                                            Просмотр
                                        </button>
                                        <button
                                            className="btn btn-sm btn-warning"
                                            onClick={() => {/* Редактирование */}}
                                        >
                                            Редактировать
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Пагинация */}
            {pagination.pages > 1 && (
                <div className="pagination">
                    <button
                        className="btn btn-sm"
                        disabled={pagination.page === 1}
                        onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                    >
                        Предыдущая
                    </button>
                    <span className="page-info">
                        Страница {pagination.page} из {pagination.pages}
                    </span>
                    <button
                        className="btn btn-sm"
                        disabled={pagination.page === pagination.pages}
                        onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                    >
                        Следующая
                    </button>
                </div>
            )}

            {/* Модальное окно с деталями профиля */}
            {selectedProfile && (
                <ProfileDetailsModal
                    profile={selectedProfile}
                    onClose={() => setSelectedProfile(null)}
                    onAnalyzeContamination={analyzeContamination}
                />
            )}

            {/* Форма добавления нового профиля */}
            {showAddForm && (
                <AddProfileForm
                    onClose={() => setShowAddForm(false)}
                    onSuccess={() => {
                        setShowAddForm(false);
                        loadStaffProfiles();
                    }}
                />
            )}
        </div>
    );
};

// Компонент модального окна с деталями профиля
const ProfileDetailsModal = ({ profile, onClose, onAnalyzeContamination }) => {
    const [contaminationResults, setContaminationResults] = useState(null);
    const [analyzing, setAnalyzing] = useState(false);

    const handleAnalyzeContamination = async () => {
        try {
            setAnalyzing(true);
            // Здесь нужно будет получить ID образца для анализа
            // Пока что показываем заглушку
            alert('Для анализа контаминации необходимо выбрать образец');
        } catch (error) {
            console.error('Ошибка анализа контаминации:', error);
        } finally {
            setAnalyzing(false);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <h3>Профиль сотрудника: {profile.full_name}</h3>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>
                <div className="modal-body">
                    <div className="profile-info">
                        <div className="info-row">
                            <strong>ID сотрудника:</strong> {profile.staff_id}
                        </div>
                        <div className="info-row">
                            <strong>ФИО:</strong> {profile.full_name}
                        </div>
                        <div className="info-row">
                            <strong>Отдел:</strong> {profile.department || 'Не указан'}
                        </div>
                        <div className="info-row">
                            <strong>Должность:</strong> {profile.position || 'Не указана'}
                        </div>
                        <div className="info-row">
                            <strong>Дата добавления:</strong> {new Date(profile.date_added).toLocaleString('ru-RU')}
                        </div>
                        <div className="info-row">
                            <strong>Статус:</strong> {profile.is_active ? 'Активен' : 'Неактивен'}
                        </div>
                        {profile.notes && (
                            <div className="info-row">
                                <strong>Заметки:</strong> {profile.notes}
                            </div>
                        )}
                    </div>

                    <div className="genetic-data">
                        <h4>Генетические данные</h4>
                        <div className="loci-grid">
                            {Object.entries(profile.str_data || {}).map(([locus, alleles]) => (
                                <div key={locus} className="locus-item">
                                    <strong>{locus}:</strong> {Array.isArray(alleles) ? alleles.join(', ') : alleles}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="modal-footer">
                    <button
                        className="btn btn-primary"
                        onClick={handleAnalyzeContamination}
                        disabled={analyzing}
                    >
                        {analyzing ? 'Анализ...' : 'Анализ контаминации'}
                    </button>
                    <button className="btn btn-secondary" onClick={onClose}>
                        Закрыть
                    </button>
                </div>
            </div>
        </div>
    );
};

// Компонент формы добавления профиля
const AddProfileForm = ({ onClose, onSuccess }) => {
    const [formData, setFormData] = useState({
        staff_id: '',
        full_name: '',
        department: '',
        position: '',
        notes: '',
        str_data: {}
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        try {
            setSubmitting(true);
            setError(null);

            const response = await fetch('/api/staff-profiles', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify(formData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Ошибка при создании профиля');
            }

            onSuccess();
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleInputChange = (field, value) => {
        setFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <h3>Добавить профиль сотрудника</h3>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        {error && (
                            <div className="error-message">
                                <strong>Ошибка:</strong> {error}
                            </div>
                        )}

                        <div className="form-group">
                            <label>ID сотрудника *</label>
                            <input
                                type="text"
                                value={formData.staff_id}
                                onChange={(e) => handleInputChange('staff_id', e.target.value)}
                                required
                                placeholder="Введите уникальный ID сотрудника"
                            />
                        </div>

                        <div className="form-group">
                            <label>ФИО *</label>
                            <input
                                type="text"
                                value={formData.full_name}
                                onChange={(e) => handleInputChange('full_name', e.target.value)}
                                required
                                placeholder="Введите полное имя сотрудника"
                            />
                        </div>

                        <div className="form-group">
                            <label>Отдел</label>
                            <input
                                type="text"
                                value={formData.department}
                                onChange={(e) => handleInputChange('department', e.target.value)}
                                placeholder="Введите название отдела"
                            />
                        </div>

                        <div className="form-group">
                            <label>Должность</label>
                            <input
                                type="text"
                                value={formData.position}
                                onChange={(e) => handleInputChange('position', e.target.value)}
                                placeholder="Введите должность"
                            />
                        </div>

                        <div className="form-group">
                            <label>Заметки</label>
                            <textarea
                                value={formData.notes}
                                onChange={(e) => handleInputChange('notes', e.target.value)}
                                placeholder="Дополнительные заметки"
                                rows="3"
                            />
                        </div>

                        <div className="form-group">
                            <label>Генетические данные (JSON) *</label>
                            <textarea
                                value={JSON.stringify(formData.str_data, null, 2)}
                                onChange={(e) => {
                                    try {
                                        const parsed = JSON.parse(e.target.value);
                                        handleInputChange('str_data', parsed);
                                    } catch (err) {
                                        // Игнорируем ошибки парсинга во время ввода
                                    }
                                }}
                                placeholder='{"D3S1358": ["15", "16"], "vWA": ["17", "18"]}'
                                rows="6"
                                required
                            />
                            <small>Введите генетические данные в формате JSON</small>
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={submitting}
                        >
                            {submitting ? 'Создание...' : 'Создать профиль'}
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={onClose}
                        >
                            Отмена
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default StaffProfilesManager;
