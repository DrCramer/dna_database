/**
 * Help System Component
 * 
 * Provides contextual help and documentation for the Bayesian analysis system
 * Requirements: 9.1 - Contextual help for each function
 */

import React, { useState, useCallback } from 'react';
import './BayesianAnalysis.css';

const HelpSystem = ({ topic = 'main', onClose }) => {
    const [currentTopic, setCurrentTopic] = useState(topic);
    const [searchTerm, setSearchTerm] = useState('');

    // Help content database
    const helpContent = {
        main: {
            title: 'Модуль байесовского анализа и сравнения генотипов',
            content: `
                <h3>Добро пожаловать в систему байесовского анализа генотипов!</h3>
                <p>Эта система предназначена для анализа качества генетических образцов и сравнения генотипов с использованием статистических методов.</p>
                
                <h4>Основные функции:</h4>
                <ul>
                    <li><strong>Контроль качества</strong> - анализ полноты профиля, гетерозиготности, деградации и контаминации</li>
                    <li><strong>Сравнение генотипов</strong> - статистическое сравнение образцов с расчетом Likelihood Ratio</li>
                </ul>
                
                <h4>Навигация:</h4>
                <p>Используйте вкладки в верхней части для переключения между разделами. Кнопки справки (❓) доступны в каждом разделе для получения контекстной помощи.</p>
            `
        },
        'quality-control': {
            title: 'Контроль качества образцов',
            content: `
                <h3>Анализ качества генетических образцов</h3>
                <p>Раздел контроля качества выполняет комплексную оценку пригодности образца для дальнейшего анализа.</p>
                
                <h4>Этапы анализа:</h4>
                <ol>
                    <li><strong>Выбор образца</strong> - выберите образец из базы данных</li>
                    <li><strong>Запуск анализа</strong> - система автоматически выполнит все проверки</li>
                    <li><strong>Просмотр результатов</strong> - изучите детальные результаты с цветовой маркировкой</li>
                </ol>
                
                <h4>Показатели качества:</h4>
                <ul>
                    <li><strong>PCI</strong> - индекс полноты профиля</li>
                    <li><strong>Гетерозиготность</strong> - анализ распределения аллелей</li>
                    <li><strong>Деградация</strong> - оценка сохранности ДНК</li>
                    <li><strong>Контаминация</strong> - поиск загрязнения сотрудниками</li>
                    <li><strong>Дубликаты</strong> - поиск повторяющихся образцов</li>
                </ul>
            `
        },
        'genotype-comparison': {
            title: 'Сравнение генотипов',
            content: `
                <h3>Статистическое сравнение генетических профилей</h3>
                <p>Раздел сравнения генотипов позволяет выполнять различные типы сравнений с расчетом статистической значимости.</p>
                
                <h4>Типы сравнений:</h4>
                <ul>
                    <li><strong>Образец vs Образец</strong> - прямое сравнение двух образцов</li>
                    <li><strong>Образец vs Эталон</strong> - сравнение с эталонным профилем</li>
                    <li><strong>Поиск в базе данных</strong> - поиск совпадений во всей базе</li>
                </ul>
                
                <h4>Результаты сравнения:</h4>
                <ul>
                    <li><strong>Общая статистика</strong> - процент совпадения и распределение по типам</li>
                    <li><strong>Likelihood Ratio</strong> - статистическая значимость совпадения</li>
                    <li><strong>Детальная таблица</strong> - сравнение по каждому локусу</li>
                </ul>
            `
        },
        pci: {
            title: 'Индекс полноты профиля (PCI)',
            content: `
                <h3>Profile Completeness Index (PCI)</h3>
                <p>PCI показывает долю успешно проанализированных локусов от общего количества локусов в системе.</p>
                
                <h4>Расчет:</h4>
                <p><code>PCI = (Количество проанализированных локусов) / (Общее количество локусов)</code></p>
                
                <h4>Классификация:</h4>
                <ul>
                    <li><span style="color: #2d8f2d;">■</span> <strong>Полный профиль</strong> - PCI ≥ 80%</li>
                    <li><span style="color: #f39c12;">■</span> <strong>Умеренно неполный</strong> - 60% ≤ PCI < 80%</li>
                    <li><span style="color: #e67e22;">■</span> <strong>Сильно неполный</strong> - 40% ≤ PCI < 60%</li>
                    <li><span style="color: #e74c3c;">■</span> <strong>Критически неполный</strong> - PCI < 40%</li>
                </ul>
                
                <h4>Интерпретация:</h4>
                <p>Высокий PCI указывает на хорошее качество образца и пригодность для сравнительного анализа. Низкий PCI может быть результатом деградации ДНК или технических проблем.</p>
            `
        },
        heterozygosity: {
            title: 'Анализ гетерозиготности',
            content: `
                <h3>Анализ гетерозиготности локусов</h3>
                <p>Гетерозиготность характеризует разнообразие аллелей в образце и может указывать на качество ДНК.</p>
                
                <h4>Показатели:</h4>
                <ul>
                    <li><strong>Наблюдаемая гетерозиготность</strong> - фактическая доля гетерозиготных локусов</li>
                    <li><strong>Ожидаемая гетерозиготность</strong> - теоретическая доля по формуле Харди-Вайнберга</li>
                </ul>
                
                <h4>Формула ожидаемой гетерозиготности:</h4>
                <p><code>He = 1 - (p₁² + p₂²)</code></p>
                <p>где p₁ и p₂ - частоты аллелей в популяции</p>
                
                <h4>Интерпретация:</h4>
                <p>Значительное отклонение наблюдаемой гетерозиготности от ожидаемой может указывать на:</p>
                <ul>
                    <li>Деградацию ДНК (снижение гетерозиготности)</li>
                    <li>Контаминацию (повышение гетерозиготности)</li>
                    <li>Технические артефакты</li>
                </ul>
            `
        },
        degradation: {
            title: 'Индекс деградации',
            content: `
                <h3>Оценка деградации ДНК</h3>
                <p>Индекс деградации показывает степень разрушения ДНК в образце на основе потери гетерозиготности.</p>
                
                <h4>Расчет:</h4>
                <p><code>Индекс деградации = (He_ожидаемая - He_наблюдаемая) / He_ожидаемая</code></p>
                
                <h4>Классификация:</h4>
                <ul>
                    <li><span style="color: #2d8f2d;">■</span> <strong>Минимальная</strong> - индекс < 0.20</li>
                    <li><span style="color: #f39c12;">■</span> <strong>Умеренная</strong> - 0.20 ≤ индекс < 0.40</li>
                    <li><span style="color: #e74c3c;">■</span> <strong>Сильная</strong> - индекс ≥ 0.40</li>
                </ul>
                
                <h4>Влияние на анализ:</h4>
                <ul>
                    <li><strong>Минимальная деградация</strong> - образец пригоден для всех видов анализа</li>
                    <li><strong>Умеренная деградация</strong> - возможны ограничения для сложных анализов</li>
                    <li><strong>Сильная деградация</strong> - результаты требуют осторожной интерпретации</li>
                </ul>
            `
        },
        contamination: {
            title: 'Выявление контаминации',
            content: `
                <h3>Контаминация сотрудников и смеси</h3>
                <p>Система автоматически проверяет образцы на возможную контаминацию ДНК сотрудников лаборатории.</p>
                
                <h4>Критерии контаминации:</h4>
                <ul>
                    <li><strong>Контаминация сотрудников</strong> - совпадение ≥3 локусов с профилем сотрудника</li>
                    <li><strong>Подозрение на смесь</strong> - наличие локусов с 3+ аллелями</li>
                </ul>
                
                <h4>Индикаторы:</h4>
                <ul>
                    <li><span style="color: #2d8f2d;">■</span> <strong>Не обнаружена</strong> - образец чистый</li>
                    <li><span style="color: #e74c3c;">■</span> <strong>Обнаружена</strong> - требуется повторный анализ</li>
                </ul>
                
                <h4>Действия при обнаружении:</h4>
                <ol>
                    <li>Проверить процедуры отбора и обработки образца</li>
                    <li>Рассмотреть возможность повторного анализа</li>
                    <li>Исключить образец из базы данных при подтверждении</li>
                </ol>
            `
        },
        duplicates: {
            title: 'Поиск дубликатов',
            content: `
                <h3>Выявление дублирующихся образцов</h3>
                <p>Система автоматически ищет образцы с высокой степенью совпадения, которые могут быть дубликатами.</p>
                
                <h4>Критерии дубликатов:</h4>
                <p><code>Процент совпадения = (Совпавшие локусы) / (Общие локусы) × 100%</code></p>
                
                <h4>Пороговые значения:</h4>
                <ul>
                    <li><strong>≥95%</strong> - вероятный дубликат, рекомендуется объединение</li>
                    <li><strong>85-94%</strong> - возможное родство или частичное совпадение</li>
                    <li><strong><85%</strong> - различные образцы</li>
                </ul>
                
                <h4>Рекомендации:</h4>
                <ul>
                    <li>Проверить метаданные образцов (даты, источники)</li>
                    <li>Объединить подтвержденные дубликаты</li>
                    <li>Сохранить историю объединения для аудита</li>
                </ul>
            `
        },
        perspective: {
            title: 'Категории перспективности',
            content: `
                <h3>Итоговая оценка перспективности образца</h3>
                <p>Система присваивает каждому образцу категорию перспективности на основе всех показателей качества.</p>
                
                <h4>Категории:</h4>
                <ul>
                    <li><span style="color: #2d8f2d;">■</span> <strong>ВЫСОКАЯ ПЕРСПЕКТИВНОСТЬ</strong>
                        <br>PCI ≥ 60%, нет контаминации, пригоден для всех анализов</li>
                    <li><span style="color: #f39c12;">■</span> <strong>СРЕДНЯЯ ПЕРСПЕКТИВНОСТЬ</strong>
                        <br>40% ≤ PCI < 60%, нет контаминации, деградация < 50%</li>
                    <li><span style="color: #e67e22;">■</span> <strong>НИЗКАЯ ПЕРСПЕКТИВНОСТЬ</strong>
                        <br>PCI < 40% или сильная деградация ≥ 50%</li>
                    <li><span style="color: #e74c3c;">■</span> <strong>ЗАГРЯЗНЕННЫЙ</strong>
                        <br>Обнаружена контаминация, требуется исключение</li>
                </ul>
                
                <h4>Использование категорий:</h4>
                <ul>
                    <li><strong>Высокая</strong> - приоритет для сравнительного анализа</li>
                    <li><strong>Средняя</strong> - можно использовать с ограничениями</li>
                    <li><strong>Низкая</strong> - осторожная интерпретация результатов</li>
                    <li><strong>Загрязненный</strong> - исключить из анализа</li>
                </ul>
            `
        },
        'match-statistics': {
            title: 'Статистика совпадений',
            content: `
                <h3>Интерпретация результатов сравнения</h3>
                <p>Статистика совпадений показывает степень сходства между сравниваемыми генетическими профилями.</p>
                
                <h4>Типы совпадений локусов:</h4>
                <ul>
                    <li><span style="color: #2d8f2d;">■</span> <strong>Полное совпадение</strong> - оба аллеля идентичны</li>
                    <li><span style="color: #f39c12;">■</span> <strong>Частичное совпадение</strong> - один аллель совпадает</li>
                    <li><span style="color: #e74c3c;">■</span> <strong>Несовпадение</strong> - аллели различны</li>
                </ul>
                
                <h4>Общий процент совпадения:</h4>
                <p><code>Процент = (Полные совпадения × 2 + Частичные совпадения) / (Общие локусы × 2) × 100%</code></p>
                
                <h4>Интерпретация:</h4>
                <ul>
                    <li><strong>>95%</strong> - вероятная идентичность или близкое родство</li>
                    <li><strong>80-95%</strong> - возможное родство</li>
                    <li><strong>50-80%</strong> - отдаленное родство или случайное совпадение</li>
                    <li><strong><50%</strong> - различные индивидуумы</li>
                </ul>
            `
        },
        'likelihood-ratio': {
            title: 'Likelihood Ratio (LR)',
            content: `
                <h3>Отношение правдоподобия</h3>
                <p>Likelihood Ratio - статистическая мера, показывающая во сколько раз более вероятно наблюдаемое совпадение при гипотезе родства по сравнению с гипотезой случайного совпадения.</p>
                
                <h4>Расчет LR:</h4>
                <p><code>LR = P(Evidence | H₁) / P(Evidence | H₂)</code></p>
                <ul>
                    <li>H₁ - гипотеза родства/идентичности</li>
                    <li>H₂ - гипотеза случайного совпадения</li>
                </ul>
                
                <h4>Интерпретация значений:</h4>
                <ul>
                    <li><strong>LR > 1,000,000</strong> - очень сильная поддержка H₁</li>
                    <li><strong>10,000 < LR ≤ 1,000,000</strong> - сильная поддержка H₁</li>
                    <li><strong>100 < LR ≤ 10,000</strong> - умеренная поддержка H₁</li>
                    <li><strong>1 < LR ≤ 100</strong> - слабая поддержка H₁</li>
                    <li><strong>LR ≤ 1</strong> - нет поддержки H₁</li>
                </ul>
                
                <h4>Вероятность совпадения:</h4>
                <p><code>P = LR / (1 + LR) × 100%</code></p>
                
                <h4>Поправка Бреннера:</h4>
                <p>Для неполных профилей применяется консервативная поправка, снижающая LR для учета неопределенности.</p>
            `
        },
        'database-search': {
            title: 'Поиск в базе данных',
            content: `
                <h3>Поиск совпадений в базе данных</h3>
                <p>Функция поиска в базе данных сравнивает выбранный образец со всеми образцами в системе для поиска потенциальных совпадений.</p>
                
                <h4>Процесс поиска:</h4>
                <ol>
                    <li>Извлечение данных выбранного образца</li>
                    <li>Последовательное сравнение с каждым образцом в базе</li>
                    <li>Расчет статистик совпадения для каждой пары</li>
                    <li>Ранжирование результатов по степени совпадения</li>
                </ol>
                
                <h4>Результаты поиска:</h4>
                <ul>
                    <li><strong>Процент совпадения</strong> - общая степень сходства</li>
                    <li><strong>Likelihood Ratio</strong> - статистическая значимость</li>
                    <li><strong>Количество совпавших локусов</strong> - детальная статистика</li>
                </ul>
                
                <h4>Фильтрация результатов:</h4>
                <p>Система автоматически исключает из результатов:</p>
                <ul>
                    <li>Сам исходный образец</li>
                    <li>Образцы с критически низким качеством</li>
                    <li>Заведомо контаминированные образцы</li>
                </ul>
            `
        }
    };

    // Get filtered topics for search
    const getFilteredTopics = useCallback(() => {
        if (!searchTerm) return Object.keys(helpContent);
        
        return Object.keys(helpContent).filter(key => {
            const content = helpContent[key];
            const searchLower = searchTerm.toLowerCase();
            return content.title.toLowerCase().includes(searchLower) ||
                   content.content.toLowerCase().includes(searchLower);
        });
    }, [searchTerm]);

    // Handle topic change
    const handleTopicChange = useCallback((newTopic) => {
        setCurrentTopic(newTopic);
        setSearchTerm('');
    }, []);

    // Handle search
    const handleSearch = useCallback((e) => {
        setSearchTerm(e.target.value);
    }, []);

    const currentContent = helpContent[currentTopic] || helpContent.main;
    const filteredTopics = getFilteredTopics();

    return (
        <div className="help-system-overlay">
            <div className="help-system">
                <div className="help-header">
                    <h2>Справочная система</h2>
                    <button className="close-button" onClick={onClose}>✕</button>
                </div>

                <div className="help-content">
                    <div className="help-sidebar">
                        <div className="search-section">
                            <input
                                type="text"
                                placeholder="Поиск по справке..."
                                value={searchTerm}
                                onChange={handleSearch}
                                className="search-input"
                            />
                        </div>

                        <div className="topics-list">
                            <h3>Разделы справки</h3>
                            {filteredTopics.map(topicKey => (
                                <button
                                    key={topicKey}
                                    className={`topic-button ${currentTopic === topicKey ? 'active' : ''}`}
                                    onClick={() => handleTopicChange(topicKey)}
                                >
                                    {helpContent[topicKey].title}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="help-main">
                        <div className="help-article">
                            <h1>{currentContent.title}</h1>
                            <div 
                                className="help-text"
                                dangerouslySetInnerHTML={{ __html: currentContent.content }}
                            />
                        </div>
                    </div>
                </div>

                <div className="help-footer">
                    <div className="help-navigation">
                        <button 
                            className="nav-button"
                            onClick={() => handleTopicChange('main')}
                        >
                            🏠 Главная
                        </button>
                        <button 
                            className="nav-button"
                            onClick={() => handleTopicChange('quality-control')}
                        >
                            🔍 Контроль качества
                        </button>
                        <button 
                            className="nav-button"
                            onClick={() => handleTopicChange('genotype-comparison')}
                        >
                            📊 Сравнение генотипов
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default HelpSystem;