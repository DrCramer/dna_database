/**
 * Genotype Comparison Panel - UI for genotype comparison analysis
 * 
 * This component provides interface for genotype comparison including:
 * - Sample vs Sample comparison
 * - Sample vs Reference comparison
 * - Database search
 * - Detailed locus-by-locus comparison tables
 * - Likelihood Ratio calculations
 * 
 * Requirements: 9.1, 9.3 - Comparison section with detailed comparison tables
 */

import React, { useState, useCallback } from 'react';
import SampleSelector from './SampleSelector';
import ComparisonResults from './ComparisonResults';
import ComparisonReports from './ComparisonReports';
import './BayesianAnalysis.css';

const GenotypeComparisonPanel = ({ 
    onStartProcessing, 
    onStopProcessing, 
    onUpdateProgress, 
    onShowHelp,
    isProcessing 
}) => {
    // Component state
    const [comparisonType, setComparisonType] = useState('sample-vs-sample');
    const [sample1, setSample1] = useState(null);
    const [sample2, setSample2] = useState(null);
    const [referenceProfile, setReferenceProfile] = useState(null);
    const [comparisonResults, setComparisonResults] = useState(null);
    const [comparisonHistory, setComparisonHistory] = useState([]);
    const [showReports, setShowReports] = useState(false);

    // Sample selection handlers
    const handleSample1Select = useCallback((sample) => {
        if (!isProcessing) {
            setSample1(sample);
            setComparisonResults(null);
        }
    }, [isProcessing]);

    const handleSample2Select = useCallback((sample) => {
        if (!isProcessing) {
            setSample2(sample);
            setComparisonResults(null);
        }
    }, [isProcessing]);

    const handleReferenceSelect = useCallback((profile) => {
        if (!isProcessing) {
            setReferenceProfile(profile);
            setComparisonResults(null);
        }
    }, [isProcessing]);

    // Comparison type change handler
    const handleComparisonTypeChange = useCallback((type) => {
        if (!isProcessing) {
            setComparisonType(type);
            setComparisonResults(null);
            // Clear inappropriate selections
            if (type !== 'sample-vs-sample') {
                setSample2(null);
            }
            if (type !== 'sample-vs-reference') {
                setReferenceProfile(null);
            }
        }
    }, [isProcessing]);

    // Comparison execution
    const runComparison = useCallback(async () => {
        // Validation
        if (!sample1) {
            alert('Пожалуйста, выберите первый образец');
            return;
        }

        if (comparisonType === 'sample-vs-sample' && !sample2) {
            alert('Пожалуйста, выберите второй образец для сравнения');
            return;
        }

        if (comparisonType === 'sample-vs-reference' && !referenceProfile) {
            alert('Пожалуйста, выберите эталонный профиль');
            return;
        }

        try {
            onStartProcessing('Запуск сравнения генотипов...');
            
            // Progress updates
            onUpdateProgress(15, 'Извлечение данных локусов...');
            await new Promise(resolve => setTimeout(resolve, 200));
            
            onUpdateProgress(30, 'Отправка запроса на сервер...');
            await new Promise(resolve => setTimeout(resolve, 200));
            
            onUpdateProgress(50, 'Сравнение локусов по парам...');
            
            // Real API call instead of mock data
            let apiResults;
            
            if (comparisonType === 'sample-vs-sample') {
                // Call real comparison API
                const response = await fetch('/api/bayesian/compare', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    },
                    body: JSON.stringify({
                        profile1Id: sample1.id,
                        profile2Id: sample2.id,
                        populationId: 'default'
                    })
                });
                
                if (!response.ok) {
                    throw new Error(`API Error: ${response.status} ${response.statusText}`);
                }
                
                const apiData = await response.json();
                if (!apiData.success) {
                    throw new Error(apiData.message || 'API returned error');
                }
                
                apiResults = apiData.data.analysis;
                
                onUpdateProgress(70, 'Обработка результатов API...');
                await new Promise(resolve => setTimeout(resolve, 200));
                
            } else if (comparisonType === 'database-search') {
                // Call duplicates search API
                const response = await fetch('/api/bayesian/duplicates', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    },
                    body: JSON.stringify({
                        targetProfileId: sample1.id,
                        populationId: 'default'
                    })
                });
                
                if (!response.ok) {
                    throw new Error(`API Error: ${response.status} ${response.statusText}`);
                }
                
                const apiData = await response.json();
                if (!apiData.success) {
                    throw new Error(apiData.message || 'API returned error');
                }
                
                // Convert duplicates results to comparison format
                const formattedDuplicates = (apiData.data.duplicates || []).map(dup => {
                    const profile = dup.matchedProfile || {};
                    
                    // Извлекаем номер привоза
                    let importNumber = profile.import_number || profile.privoz || '';
                    
                    // Fallback на notes если нет import_number
                    if (!importNumber) {
                        try {
                            if (profile.notes) {
                                const notesData = typeof profile.notes === 'string' ? JSON.parse(profile.notes) : profile.notes;
                                importNumber = notesData?.additionalData?.privoz || '';
                            }
                        } catch (e) {
                            // Игнорируем ошибки парсинга
                        }
                    }
                    
                    // Формируем читаемое название: "внутренний_номер | название_образца | 🚚 привоз"
                    const parts = [
                        profile.internal_number || profile.internalNumber,
                        profile.sample_name || profile.sampleName
                    ].filter(Boolean);
                    
                    if (privozNumber) {
                        parts.push(`🚚 ${privozNumber}`);
                    }
                    
                    const displayName = parts.join(' | ') || profile.id || 'N/A';
                    
                    return {
                        targetSampleId: displayName,
                        targetSampleName: profile.sample_name || profile.sampleName || 'N/A',
                        internalNumber: profile.internal_number || profile.internalNumber || 'N/A',
                        privozNumber: privozNumber || 'N/A',
                        matchPercentage: dup.comparisonMetadata?.matchPercentage || 
                                        ((dup.matchingLoci / dup.totalLoci) * 100) || 0,
                        likelihoodRatio: dup.lrScore || 0,
                        probability: dup.probability || 0,
                        matchingLoci: dup.matchingLoci || 0,
                        totalLoci: dup.totalLoci || 0
                    };
                });
                
                apiResults = {
                    overallLR: 0,
                    significance: 'DATABASE_SEARCH',
                    colorCode: '#17a2b8',
                    searchResults: formattedDuplicates,
                    calculationMetadata: {
                        timestamp: new Date(),
                        method: 'Database Search',
                        commonLoci: 0,
                        searchSpaceSize: apiData.data.searchStatistics?.searchSpaceSize || 0,
                        warnings: []
                    }
                };
                
                onUpdateProgress(70, 'Обработка результатов поиска...');
                await new Promise(resolve => setTimeout(resolve, 200));
                
            } else {
                // For sample-vs-reference, use mock data for now
                // TODO: Implement reference comparison API
                throw new Error('Сравнение с эталоном пока не реализовано');
            }
            
            onUpdateProgress(85, 'Формирование отчета...');
            await new Promise(resolve => setTimeout(resolve, 200));
            
            onUpdateProgress(95, 'Завершение...');
            await new Promise(resolve => setTimeout(resolve, 200));

            // Format results for display
            const formattedResults = {
                comparisonType,
                sample1Id: sample1.internalNumber || sample1.name || sample1.sampleName,
                sample2Id: sample2?.internalNumber || sample2?.name || sample2?.sampleName || referenceProfile?.internalNumber || referenceProfile?.name || 'database',
                overallMatch: {
                    totalLoci: 0, // Will be calculated from actual locus data
                    fullMatches: 0, // Will be calculated from locusComparisons if available
                    partialMatches: 0,
                    noMatches: 0,
                    matchPercentage: 0
                },
                locusComparisons: apiResults.locusComparisons || [],
                likelihoodRatio: apiResults.overallLR || 0,
                matchProbability: apiResults.matchProbability || 0,
                confidenceInterval: apiResults.confidenceInterval || [0, 0],
                significance: apiResults.significance || 'UNKNOWN',
                colorCode: apiResults.colorCode || '#6c757d',
                populationUsed: 'default',
                calculationMetadata: {
                    timestamp: new Date(),
                    method: apiResults.calculationMetadata?.method || 'API',
                    commonLoci: apiResults.calculationMetadata?.commonLoci || 0,
                    totalLoci1: apiResults.calculationMetadata?.totalLoci1 || 0,
                    totalLoci2: apiResults.calculationMetadata?.totalLoci2 || 0,
                    errors: apiResults.calculationMetadata?.errors || [],
                    warnings: apiResults.calculationMetadata?.warnings || []
                },
                searchResults: apiResults.searchResults || []
            };

            // Calculate match statistics from locus LRs if available
            if (apiResults.locusLRs && Object.keys(apiResults.locusLRs).length > 0) {
                let fullMatches = 0;
                let partialMatches = 0;
                let noMatches = 0;
                
                // Convert locusLRs to locusComparisons format for display
                const locusComparisons = [];
                
                Object.entries(apiResults.locusLRs).forEach(([locusName, locusData]) => {
                    let matchType = 'NO_MATCH';
                    let lr = 0;
                    let significance = 'UNKNOWN';
                    
                    if (typeof locusData === 'object' && locusData !== null) {
                        lr = locusData.lr || 0;
                        significance = locusData.significance || 'UNKNOWN';
                    } else if (typeof locusData === 'number') {
                        lr = locusData;
                        // Determine significance based on LR value
                        if (lr >= 1000000) significance = 'EXTREMELY_STRONG';
                        else if (lr >= 10000) significance = 'VERY_STRONG';
                        else if (lr >= 100) significance = 'STRONG';
                        else if (lr >= 10) significance = 'MODERATE';
                        else if (lr >= 1) significance = 'WEAK';
                        else significance = 'EXCLUSION';
                    }
                    
                    // Правильная логика определения совпадений:
                    // LR = 0 означает ИСКЛЮЧЕНИЕ (аллели не совпадают)
                    // LR > 0 означает СОВПАДЕНИЕ с разной степенью поддержки
                    // ИГНОРИРУЕМ significance от API, так как он может быть неправильным
                    if (lr === 0) {
                        matchType = 'NO_MATCH';
                        noMatches++;
                    } else if (lr >= 100) {
                        matchType = 'FULL_MATCH';
                        fullMatches++;
                    } else if (lr > 0) {
                        // LR > 0 но < 100 - это все равно совпадение, но с меньшей поддержкой
                        matchType = 'FULL_MATCH';
                        fullMatches++;
                    } else {
                        matchType = 'NO_MATCH';
                        noMatches++;
                    }
                    
                    locusComparisons.push({
                        locusName: locusName,
                        matchType: matchType,
                        profile1Alleles: (typeof locusData === 'object' && locusData.alleles) ? locusData.alleles.join('/') : 'N/A',
                        profile2Alleles: (typeof locusData === 'object' && locusData.alleles) ? locusData.alleles.join('/') : 'N/A',
                        lr: lr,
                        significance: significance,
                        colorCode: (typeof locusData === 'object' && locusData.colorCode) ? locusData.colorCode : '#6c757d'
                    });
                });
                
                formattedResults.locusComparisons = locusComparisons;
                formattedResults.overallMatch.fullMatches = fullMatches;
                formattedResults.overallMatch.partialMatches = partialMatches;
                formattedResults.overallMatch.noMatches = noMatches;
                formattedResults.overallMatch.totalLoci = fullMatches + partialMatches + noMatches;
                formattedResults.overallMatch.matchPercentage = 
                    formattedResults.overallMatch.totalLoci > 0 ? 
                    (fullMatches / formattedResults.overallMatch.totalLoci) * 100 : 0;
                    
                console.log('🔍 DEBUG: Locus LRs processing:', {
                    totalLocusLRs: Object.keys(apiResults.locusLRs).length,
                    fullMatches,
                    partialMatches,
                    noMatches,
                    totalLoci: fullMatches + partialMatches + noMatches,
                    matchPercentage: formattedResults.overallMatch.matchPercentage
                });
            } else if (formattedResults.locusComparisons && formattedResults.locusComparisons.length > 0) {
                // Fallback to original locusComparisons processing
                let fullMatches = 0;
                let partialMatches = 0;
                let noMatches = 0;
                
                formattedResults.locusComparisons.forEach(lc => {
                    if (lc.matchType === 'FULL_MATCH' || lc.matchType === 'полное совпадение') {
                        fullMatches++;
                    } else if (lc.matchType === 'PARTIAL_MATCH' || lc.matchType === 'частичное совпадение') {
                        partialMatches++;
                    } else {
                        noMatches++;
                    }
                });
                
                formattedResults.overallMatch.fullMatches = fullMatches;
                formattedResults.overallMatch.partialMatches = partialMatches;
                formattedResults.overallMatch.noMatches = noMatches;
                formattedResults.overallMatch.totalLoci = fullMatches + partialMatches + noMatches;
                formattedResults.overallMatch.matchPercentage = 
                    formattedResults.overallMatch.totalLoci > 0 ? 
                    (fullMatches / formattedResults.overallMatch.totalLoci) * 100 : 0;
            }

            setComparisonResults(formattedResults);
            
            // Add to history
            setComparisonHistory(prev => [
                ...prev,
                {
                    ...formattedResults,
                    timestamp: new Date()
                }
            ]);

            onStopProcessing('Сравнение генотипов завершено');
            
        } catch (error) {
            console.error('Comparison failed:', error);
            onStopProcessing('Ошибка сравнения генотипов');
            alert('Произошла ошибка при сравнении: ' + error.message);
        }
    }, [sample1, sample2, referenceProfile, comparisonType, onStartProcessing, onStopProcessing, onUpdateProgress]);

    // Clear results
    const clearResults = useCallback(() => {
        if (!isProcessing) {
            setComparisonResults(null);
            setSample1(null);
            setSample2(null);
            setReferenceProfile(null);
        }
    }, [isProcessing]);

    // Show reports panel
    const toggleReports = useCallback(() => {
        setShowReports(prev => !prev);
    }, []);

    return (
        <div className="genotype-comparison-panel">
            <div className="panel-header">
                <h2>Сравнение генотипов</h2>
                <div className="panel-controls">
                    <button 
                        className="help-button"
                        onClick={() => onShowHelp('genotype-comparison')}
                        title="Справка по сравнению генотипов"
                    >
                        ❓
                    </button>
                </div>
            </div>

            <div className="panel-content">
                {/* Comparison Type Selection */}
                <section className="comparison-type-section">
                    <h3>Тип сравнения</h3>
                    <div className="comparison-type-selector">
                        <label className="radio-option">
                            <input
                                type="radio"
                                name="comparisonType"
                                value="sample-vs-sample"
                                checked={comparisonType === 'sample-vs-sample'}
                                onChange={(e) => handleComparisonTypeChange(e.target.value)}
                                disabled={isProcessing}
                            />
                            <span>Образец vs Образец</span>
                        </label>
                        
                        <label className="radio-option">
                            <input
                                type="radio"
                                name="comparisonType"
                                value="sample-vs-reference"
                                checked={comparisonType === 'sample-vs-reference'}
                                onChange={(e) => handleComparisonTypeChange(e.target.value)}
                                disabled={isProcessing}
                            />
                            <span>Образец vs Эталон</span>
                        </label>
                        
                        <label className="radio-option">
                            <input
                                type="radio"
                                name="comparisonType"
                                value="database-search"
                                checked={comparisonType === 'database-search'}
                                onChange={(e) => handleComparisonTypeChange(e.target.value)}
                                disabled={isProcessing}
                            />
                            <span>Поиск в базе данных</span>
                        </label>
                    </div>
                </section>

                {/* Sample Selection Section */}
                <section className="sample-selection-section">
                    <h3>Выбор образцов</h3>
                    
                    <div className="sample-selectors">
                        <div className="sample-selector-group">
                            <label>Первый образец:</label>
                            <SampleSelector
                                selectedSample={sample1}
                                onSampleSelect={handleSample1Select}
                                disabled={isProcessing}
                                placeholder="Выберите первый образец"
                            />
                        </div>

                        {comparisonType === 'sample-vs-sample' && (
                            <div className="sample-selector-group">
                                <label>Второй образец:</label>
                                <SampleSelector
                                    selectedSample={sample2}
                                    onSampleSelect={handleSample2Select}
                                    disabled={isProcessing}
                                    placeholder="Выберите второй образец"
                                    excludeSample={sample1}
                                />
                            </div>
                        )}

                        {comparisonType === 'sample-vs-reference' && (
                            <div className="sample-selector-group">
                                <label>Эталонный профиль:</label>
                                <SampleSelector
                                    selectedSample={referenceProfile}
                                    onSampleSelect={handleReferenceSelect}
                                    disabled={isProcessing}
                                    placeholder="Выберите эталонный профиль"
                                    filterType="reference"
                                />
                            </div>
                        )}
                    </div>
                </section>

                {/* Analysis Controls */}
                <section className="analysis-controls">
                    <div className="control-buttons">
                        <button 
                            className="primary-button"
                            onClick={runComparison}
                            disabled={!sample1 || isProcessing || 
                                (comparisonType === 'sample-vs-sample' && !sample2) ||
                                (comparisonType === 'sample-vs-reference' && !referenceProfile)
                            }
                        >
                            {isProcessing ? 'Сравнение...' : 'Запустить сравнение'}
                        </button>
                        
                        <button 
                            className="secondary-button"
                            onClick={clearResults}
                            disabled={isProcessing}
                        >
                            Очистить результаты
                        </button>

                        <button 
                            className="secondary-button"
                            onClick={toggleReports}
                            disabled={!comparisonResults}
                        >
                            {showReports ? 'Скрыть отчеты' : 'Показать отчеты'}
                        </button>
                    </div>
                </section>

                {/* Results Section */}
                {comparisonResults && (
                    <section className="results-section">
                        <ComparisonResults 
                            results={comparisonResults}
                            onShowHelp={onShowHelp}
                        />
                    </section>
                )}

                {/* Reports Section */}
                {showReports && comparisonResults && (
                    <section className="reports-section">
                        <ComparisonReports 
                            results={comparisonResults}
                            comparisonHistory={comparisonHistory}
                            onShowHelp={onShowHelp}
                        />
                    </section>
                )}

                {/* Comparison History */}
                {comparisonHistory.length > 0 && (
                    <section className="history-section">
                        <h3>История сравнений ({comparisonHistory.length})</h3>
                        <div className="history-list">
                            {comparisonHistory.slice(-5).reverse().map((comparison, index) => (
                                <div key={index} className="history-item">
                                    <span className="history-type">{comparison.comparisonType}</span>
                                    <span className="history-samples">
                                        {comparison.sample1Id} vs {comparison.sample2Id}
                                    </span>
                                    <span className="history-match">
                                        {comparison.overallMatch.matchPercentage ? comparison.overallMatch.matchPercentage.toFixed(1) : '0.0'}%
                                    </span>
                                    <span className="history-date">
                                        {comparison.timestamp.toLocaleString('ru-RU')}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
};

export default GenotypeComparisonPanel;