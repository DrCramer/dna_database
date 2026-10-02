/**
 * Sample Selector Component
 *
 * Provides interface for selecting genetic samples from database
 * Supports filtering by type (regular samples, reference profiles)
 * Requirements: 9.1 - Sample selection interface
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

// Format date to user-friendly format
const formatDate = (dateString) => {
    if (!dateString) return 'Дата неизвестна';

    try {
        const date = new Date(dateString);

        // Проверяем, что дата валидна
        if (isNaN(date.getTime())) {
            return 'Дата неизвестна';
        }

        // Форматируем в российском формате: ДД.ММ.ГГГГ ЧЧ:ММ
        return date.toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (error) {
        console.warn('Error formatting date:', error);
        return 'Дата неизвестна';
    }
};

// Calculate quality indicator from profile data
const calculateQualityFromProfile = (profile) => {
    // Проверяем разные возможные поля для STR данных
    const strDataField = profile.strData || profile.str_data || profile.profile_data || profile.loci_data;
    if (!strDataField) return 'low';

    try {
        const strData = typeof strDataField === 'string' ? JSON.parse(strDataField) : strDataField;
        if (!strData || typeof strData !== 'object') return 'low';

        // Count analyzed loci
        let analyzedLoci = 0;
        let totalLoci = 0;

        for (const [locus, data] of Object.entries(strData)) {
            totalLoci++;
            if (data && data.allele1 && data.allele2 &&
                data.allele1 !== '0' && data.allele2 !== '0' &&
                data.allele1 !== '' && data.allele2 !== '' &&
                data.allele1 !== 'null' && data.allele2 !== 'null') {
                analyzedLoci++;
            }
        }

        const completeness = totalLoci > 0 ? analyzedLoci / totalLoci : 0;

        if (completeness >= 0.8) return 'high';
        if (completeness >= 0.6) return 'medium';
        return 'low';
    } catch (error) {
        console.warn('Error calculating quality:', error);
        return 'low';
    }
};

// Highlight search term in text
const highlightSearchTerm = (text, searchTerm) => {
    if (!searchTerm || !text) return text;

    const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, index) =>
        regex.test(part) ?
            React.createElement('mark', { key: index, style: { backgroundColor: '#fff3cd', padding: '0 2px' } }, part) :
            part
    );
};

const SampleSelector = ({
    selectedSample,
    onSampleSelect,
    disabled = false,
    placeholder = "Поиск по номеру образца, ID или привозу",
    excludeSample = null,
    filterType = "all" // "all", "reference", "regular"
}) => {
    const [samples, setSamples] = useState([]);
    const [filteredSamples, setFilteredSamples] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);

    // Refs for dynamic positioning
    const selectorRef = useRef(null);
    const dropdownRef = useRef(null);
    const inputRef = useRef(null);

    // Dynamic dropdown positioning function
    const positionDropdown = useCallback(() => {
        if (!selectorRef.current || !dropdownRef.current) return;

        const selectElement = selectorRef.current;
        const dropdownElement = dropdownRef.current;
        const rect = selectElement.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;

        // Сброс всех стилей позиционирования
        dropdownElement.style.position = 'fixed';
        dropdownElement.style.left = `${rect.left}px`;
        dropdownElement.style.width = `${rect.width}px`;
        dropdownElement.style.zIndex = '99999';

        // Определяем направление открытия
        if (spaceBelow >= 200 || spaceBelow > spaceAbove) {
            // Открываем вниз
            dropdownElement.style.top = `${rect.bottom + 2}px`;
            dropdownElement.style.bottom = 'auto';
            dropdownElement.style.maxHeight = `${Math.min(spaceBelow - 20, 300)}px`;
            dropdownElement.style.borderRadius = '8px';
        } else {
            // Открываем вверх
            dropdownElement.style.bottom = `${viewportHeight - rect.top + 2}px`;
            dropdownElement.style.top = 'auto';
            dropdownElement.style.maxHeight = `${Math.min(spaceAbove - 20, 300)}px`;
            dropdownElement.style.borderRadius = '8px';
        }

        // Проверяем, не выходит ли за правый край экрана
        if (rect.left + rect.width > viewportWidth - 20) {
            dropdownElement.style.left = `${viewportWidth - rect.width - 20}px`;
        }

        // Проверяем, не выходит ли за левый край экрана
        if (rect.left < 20) {
            dropdownElement.style.left = '20px';
            dropdownElement.style.width = `${Math.min(rect.width, viewportWidth - 40)}px`;
        }

        console.log('Dropdown positioned:', {
            spaceBelow,
            spaceAbove,
            direction: spaceBelow >= 200 || spaceBelow > spaceAbove ? 'down' : 'up',
            rect: rect,
            styles: {
                position: dropdownElement.style.position,
                top: dropdownElement.style.top,
                bottom: dropdownElement.style.bottom,
                left: dropdownElement.style.left,
                width: dropdownElement.style.width,
                maxHeight: dropdownElement.style.maxHeight
            }
        });
    }, []);

    // Update dropdown position when it's shown
    useEffect(() => {
        if (showDropdown) {
            positionDropdown();

            // Reposition on window resize or scroll
            const handleReposition = () => {
                if (showDropdown) {
                    positionDropdown();
                }
            };

            window.addEventListener('resize', handleReposition);
            window.addEventListener('scroll', handleReposition, true);

            return () => {
                window.removeEventListener('resize', handleReposition);
                window.removeEventListener('scroll', handleReposition, true);
            };
        }
    }, [showDropdown, positionDropdown]);

    // Mock sample data - in real app would come from API
    const mockSamples = [
        { id: 'S001', name: 'Образец 001', sampleName: 'Sample_001_Test', privoz: 'Привоз_А1', type: 'regular', date: formatDate('2024-01-15T10:30:00Z'), quality: 'high' },
        { id: 'S002', name: 'Образец 002', sampleName: 'Sample_002_Test', privoz: 'Привоз_Б2', type: 'regular', date: formatDate('2024-01-16T14:20:00Z'), quality: 'medium' },
        { id: 'S003', name: 'Образец 003', sampleName: 'Sample_003_Test', privoz: 'Привоз_В3', type: 'regular', date: formatDate('2024-01-17T09:15:00Z'), quality: 'high' },
        { id: 'REF001', name: 'Эталон 001', sampleName: 'Reference_001', privoz: 'Эталон_Привоз1', type: 'reference', date: formatDate('2024-01-10T16:45:00Z'), quality: 'high' },
        { id: 'REF002', name: 'Эталон 002', sampleName: 'Reference_002', privoz: 'Эталон_Привоз2', type: 'reference', date: formatDate('2024-01-11T11:30:00Z'), quality: 'high' },
        { id: 'S004', name: 'Образец 004', sampleName: 'Sample_004_Test', privoz: 'Привоз_Г4', type: 'regular', date: formatDate('2024-01-18T13:25:00Z'), quality: 'low' },
        { id: 'S005', name: 'Образец 005', sampleName: 'Sample_005_Test', privoz: 'Привоз_Д5', type: 'regular', date: formatDate('2024-01-19T08:40:00Z'), quality: 'medium' },
        { id: 'S006', name: 'Образец 006', sampleName: 'Sample_006_Test', privoz: 'Привоз_Е6', type: 'regular', date: formatDate('2024-01-20T15:10:00Z'), quality: 'high' }
    ];

    // Load samples from database using accessible profiles API
    useEffect(() => {
        const loadSamples = async () => {
            setIsLoading(true);
            try {
                // Get auth token from localStorage
                const token = localStorage.getItem('token');
                if (!token) {
                    console.error('No auth token found - user needs to login');
                    setSamples([]);
                    return;
                }

                let apiUrl;
                if (searchTerm && searchTerm.trim().length > 0) {
                    // Use search API for specific search terms
                    apiUrl = `/api/profiles/search?q=${encodeURIComponent(searchTerm.trim())}&limit=50`;
                } else {
                    // For initial load, use the accessible profiles endpoint
                    apiUrl = '/api/profiles/accessible?limit=100';
                }

                console.log('=== SampleSelector Debug ===');
                console.log('Search term:', searchTerm);
                console.log('API URL:', apiUrl);
                console.log('Token present:', !!token);
                console.log('Token preview:', token ? token.substring(0, 50) + '...' : 'none');

                const response = await fetch(apiUrl, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                console.log('API Response status:', response.status);
                console.log('API Response ok:', response.ok);

                if (response.ok) {
                    const data = await response.json();
                    const profiles = data.profiles || data || [];

                    console.log('=== SampleSelector API Success ===');
                    console.log('Profiles count:', profiles.length);
                    console.log('Total accessible profiles:', data.pagination?.total || profiles.length);

                    if (profiles.length > 0) {
                        console.log('First profile structure:', profiles[0]);
                        console.log('First profile sample_name:', profiles[0].sample_name);
                        console.log('First profile internal_number:', profiles[0].internal_number);
                        console.log('First profile import_number:', profiles[0].import_number || profiles[0].privoz);
                    } else {
                        console.warn('API returned empty profiles array');
                        console.log('Full API response:', data);
                    }

                    // Convert API data to our format
                    const convertedSamples = profiles.map(profile => {
                        // Определяем отображаемое имя: ВСЕГДА приоритет internal_number
                        let displayName;
                        if (profile.internal_number && profile.internal_number.trim()) {
                            // Если есть internal_number (оригинальный номер из Excel), ВСЕГДА используем его
                            displayName = profile.internal_number.trim();
                        } else {
                            // Fallback только если internal_number отсутствует
                            displayName = profile.sample_name || `Образец неизвестен`;
                        }

                        const converted = {
                            id: profile.id, // Используем реальный UUID как ID
                            name: displayName, // Понятное имя для пользователя
                            sampleName: profile.sample_name || profile.sampleName || '', // Сгенерированный уникальный идентификатор (для технических целей)
                            internalNumber: profile.internal_number || '', // Оригинальный номер из Excel (Sample Name)
                            import_number: profile.import_number || profile.privoz || '', // Номер привоза
                            privoz: profile.import_number || profile.privoz || '', // Для обратной совместимости
                            type: profile.profile_type === 'reference' ? 'reference' : 'regular',
                            date: formatDate(profile.upload_date || profile.uploadDate || profile.created_at),
                            quality: calculateQualityFromProfile(profile),
                            // Добавляем поисковую строку для клиентского поиска
                            searchString: [
                                displayName,
                                profile.sample_name || '',
                                profile.internal_number || '',
                                profile.import_number || profile.privoz || ''
                            ].filter(Boolean).join(' ').toLowerCase(),
                            rawData: {
                                ...profile,
                                str_data: profile.strData || profile.str_data || profile.profile_data // Нормализуем поле STR данных
                            }
                        };

                        // Логируем конвертированный образец для отладки
                        if (profile.internal_number || profile.sample_name || profile.privoz) {
                            console.log('Converted sample with data:', {
                                id: converted.id,
                                name: converted.name, // Понятное имя для пользователя
                                sampleName: converted.sampleName, // Сгенерированный ID (скрыт от пользователя)
                                internalNumber: converted.internalNumber, // Оригинальный номер
                                privoz: converted.privoz,
                                original_internal_number: profile.internal_number,
                                original_sample_name: profile.sample_name,
                                original_privoz: profile.privoz
                            });
                        }

                        return converted;
                    });

                    console.log('Converted samples count:', convertedSamples.length);
                    console.log('Samples with sampleName:', convertedSamples.filter(s => s.sampleName).length);
                    console.log('Samples with import_number:', convertedSamples.filter(s => s.import_number).length);

                    setSamples(convertedSamples);
                } else if (response.status === 401) {
                    console.error('=== SampleSelector Auth Error ===');
                    console.error('Authentication failed - token expired or invalid');
                    console.error('Response status:', response.status);
                    const errorText = await response.text();
                    console.error('Error response:', errorText);
                    // Не используем mock данные при ошибке авторизации
                    setSamples([]);
                } else {
                    console.warn('=== SampleSelector API Error ===');
                    console.warn(`API request failed with status ${response.status}`);
                    const errorData = await response.text();
                    console.warn('Error response:', errorData);
                    setSamples([]);
                }
            } catch (error) {
                console.error('=== SampleSelector Network Error ===');
                console.error('Failed to load samples:', error);
                console.error('Error details:', error.message);
                // Не используем mock данные при ошибках сети
                setSamples([]);
            } finally {
                setIsLoading(false);
            }
        };

        // Debounce search requests
        const timeoutId = setTimeout(() => {
            loadSamples();
        }, searchTerm ? 300 : 0); // 300ms delay for search, immediate for initial load

        return () => clearTimeout(timeoutId);
    }, [searchTerm]); // Re-run when search term changes

    // Filter samples based on type filter, exclusions, and client-side search
    useEffect(() => {
        let filtered = samples;

        // Apply client-side search if we have a search term
        if (searchTerm && searchTerm.trim().length > 0) {
            const searchLower = searchTerm.toLowerCase().trim();
            filtered = filtered.filter(sample =>
                sample.searchString && sample.searchString.includes(searchLower)
            );
        }

        // Apply type filter
        if (filterType === 'reference') {
            filtered = filtered.filter(sample => sample.type === 'reference');
        } else if (filterType === 'regular') {
            filtered = filtered.filter(sample => sample.type === 'regular');
        }

        // Exclude specific sample
        if (excludeSample) {
            filtered = filtered.filter(sample => sample.id !== excludeSample.id);
        }

        setFilteredSamples(filtered);
    }, [samples, filterType, excludeSample, searchTerm]); // Added searchTerm back for client-side filtering

    // Handle search input change
    const handleSearchChange = useCallback((e) => {
        setSearchTerm(e.target.value);
        setShowDropdown(true);
    }, []);

    // Handle sample selection
    const handleSampleClick = useCallback((sample) => {
        onSampleSelect(sample);
        setShowDropdown(false);
        setSearchTerm('');
    }, [onSampleSelect]);

    // Handle input focus
    const handleInputFocus = useCallback(() => {
        if (!disabled) {
            setShowDropdown(true);
        }
    }, [disabled]);

    // Handle input blur (with delay to allow clicks)
    const handleInputBlur = useCallback(() => {
        setTimeout(() => setShowDropdown(false), 200);
    }, []);

    // Handle dropdown click outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (selectorRef.current && !selectorRef.current.contains(event.target) &&
                dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setShowDropdown(false);
            }
        };

        if (showDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => {
                document.removeEventListener('mousedown', handleClickOutside);
            };
        }
    }, [showDropdown]);

    // Clear selection
    const clearSelection = useCallback(() => {
        if (!disabled) {
            onSampleSelect(null);
            setSearchTerm('');
        }
    }, [disabled, onSampleSelect]);

    // Get quality indicator color
    const getQualityColor = (quality) => {
        switch (quality) {
            case 'high': return '#2d8f2d';
            case 'medium': return '#f39c12';
            case 'low': return '#e74c3c';
            default: return '#95a5a6';
        }
    };

    return (
        <>
            <div className={`sample-selector ${disabled ? 'disabled' : ''}`} ref={selectorRef}>
                <div className="selector-input-container input-group">
                    <input
                        ref={inputRef}
                        type="text"
                        className="selector-input form-input"
                        placeholder={selectedSample ? selectedSample.name : placeholder}
                        value={searchTerm}
                        onChange={handleSearchChange}
                        onFocus={handleInputFocus}
                        onBlur={handleInputBlur}
                        disabled={disabled}
                    />

                    {selectedSample && (
                        <button
                            className="clear-button btn btn-secondary btn-icon btn-sm"
                            onClick={clearSelection}
                            disabled={disabled}
                            title="Очистить выбор"
                        >
                            ✕
                        </button>
                    )}

                    <div className="dropdown-arrow">▼</div>
                </div>

                {/* Selected Sample Info */}
                {selectedSample && !showDropdown && (
                    <div className="selected-sample-info">
                        <div className="sample-details">
                            <span className="sample-id">{selectedSample.name}</span> {/* Понятное имя пользователя */}
                            {selectedSample.sampleName && selectedSample.sampleName.trim() && (
                                <span className="sample-name-tech" title="Техническое имя образца">
                                    📋 {selectedSample.sampleName}
                                </span>
                            )}
                            {selectedSample.import_number && selectedSample.import_number.trim() && (
                                <span className="sample-privoz" title="Привоз">
                                    🚚 {selectedSample.import_number}
                                </span>
                            )}
                            <span className="sample-date">{selectedSample.date}</span>
                            <div
                                className="quality-indicator"
                                style={{ backgroundColor: getQualityColor(selectedSample.quality) }}
                                title={`Качество: ${selectedSample.quality}`}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Dropdown List - Rendered as Portal */}
            {showDropdown && (
                <div className="selector-dropdown" ref={dropdownRef}>
                    {isLoading ? (
                        <div className="dropdown-loading">Загрузка образцов...</div>
                    ) : filteredSamples.length === 0 ? (
                        <div className="dropdown-empty">
                            {searchTerm ? 'Образцы не найдены' :
                             !localStorage.getItem('token') ? 'Войдите в систему для загрузки образцов' :
                             'Нет доступных образцов'}
                        </div>
                    ) : (
                        <div className="dropdown-list">
                            {filteredSamples.map(sample => (
                                <div
                                    key={sample.id}
                                    className={`dropdown-item ${selectedSample?.id === sample.id ? 'selected' : ''}`}
                                    onClick={() => handleSampleClick(sample)}
                                >
                                    <div className="sample-info">
                                        <div className="sample-header">
                                            <span className="sample-name">
                                                {searchTerm ? highlightSearchTerm(sample.name, searchTerm) : sample.name}
                                            </span>
                                            <span className="sample-type">
                                                {sample.type === 'reference' ? 'Эталон' : 'Образец'}
                                            </span>
                                        </div>
                                        <div className="sample-meta">
                                            <span className="sample-id">
                                                Номер: {searchTerm ? highlightSearchTerm(sample.internalNumber || sample.name, searchTerm) : (sample.internalNumber || sample.name)}
                                            </span>
                                            {sample.sampleName && sample.sampleName.trim() && (
                                                <span className="sample-name-tech" title="Техническое имя образца">
                                                    📋 {searchTerm ? highlightSearchTerm(sample.sampleName, searchTerm) : sample.sampleName}
                                                </span>
                                            )}
                                            {sample.import_number && sample.import_number.trim() && (
                                                <span className="sample-privoz" title="Привоз">
                                                    🚚 {searchTerm ? highlightSearchTerm(sample.import_number, searchTerm) : sample.import_number}
                                                </span>
                                            )}
                                            <span className="sample-date">{sample.date}</span>
                                            <div
                                                className="quality-indicator"
                                                style={{ backgroundColor: getQualityColor(sample.quality) }}
                                                title={`Качество: ${sample.quality}`}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </>
    );
};

export default SampleSelector;
