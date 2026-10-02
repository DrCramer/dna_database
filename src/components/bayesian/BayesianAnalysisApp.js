/**
 * Bayesian Analysis App - Main UI Component
 * 
 * This is the main application component for Bayesian genotype analysis.
 * Requirements: 9.1 - Main form with separate sections for quality control and genotype comparison
 */

import React, { useState, useCallback } from 'react';
import './BayesianAnalysis.css';

// Import sub-components
import QualityControlPanel from './QualityControlPanel';
import GenotypeComparisonPanel from './GenotypeComparisonPanel';
import ProgressIndicator from './ProgressIndicator';
import StatusMessages from './StatusMessages';
import HelpSystem from './HelpSystem';

const BayesianAnalysisApp = () => {
    // Main application state
    const [activeTab, setActiveTab] = useState('quality');
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusMessage, setStatusMessage] = useState('');
    const [showHelp, setShowHelp] = useState(false);
    const [currentHelpTopic, setCurrentHelpTopic] = useState('');

    // Progress and status management
    const updateProgress = useCallback((value, message = '') => {
        setProgress(value);
        if (message) {
            setStatusMessage(message);
        }
    }, []);

    const startProcessing = useCallback((message = 'Обработка...') => {
        setIsProcessing(true);
        setProgress(0);
        setStatusMessage(message);
    }, []);

    const stopProcessing = useCallback((message = 'Готово') => {
        setIsProcessing(false);
        setProgress(100);
        setStatusMessage(message);
        
        // Clear status after 3 seconds
        setTimeout(() => {
            setStatusMessage('');
            setProgress(0);
        }, 3000);
    }, []);

    // Help system management
    const showHelpFor = useCallback((topic) => {
        setCurrentHelpTopic(topic);
        setShowHelp(true);
    }, []);

    const hideHelp = useCallback(() => {
        setShowHelp(false);
        setCurrentHelpTopic('');
    }, []);

    // Tab switching
    const switchTab = useCallback((tab) => {
        if (!isProcessing) {
            setActiveTab(tab);
        }
    }, [isProcessing]);

    return (
        <div className="bayesian-analysis-app">
            {/* Header */}
            <header className="app-header">
                <h1>Модуль байесовского анализа и сравнения генотипов</h1>
                <div className="header-controls">
                    <button 
                        className="help-button"
                        onClick={() => showHelpFor('main')}
                        title="Справка"
                    >
                        ❓
                    </button>
                </div>
            </header>

            {/* Progress Indicator */}
            {isProcessing && (
                <ProgressIndicator 
                    progress={progress}
                    message={statusMessage}
                />
            )}

            {/* Status Messages */}
            <StatusMessages 
                message={statusMessage}
                isVisible={!!statusMessage && !isProcessing}
            />

            {/* Main Navigation Tabs */}
            <nav className="main-navigation">
                <button 
                    className={`nav-tab ${activeTab === 'quality' ? 'active' : ''}`}
                    onClick={() => switchTab('quality')}
                    disabled={isProcessing}
                >
                    Контроль качества
                </button>
                <button 
                    className={`nav-tab ${activeTab === 'comparison' ? 'active' : ''}`}
                    onClick={() => switchTab('comparison')}
                    disabled={isProcessing}
                >
                    Сравнение генотипов
                </button>
            </nav>

            {/* Main Content Area */}
            <main className="main-content">
                {activeTab === 'quality' && (
                    <QualityControlPanel
                        onStartProcessing={startProcessing}
                        onStopProcessing={stopProcessing}
                        onUpdateProgress={updateProgress}
                        onShowHelp={showHelpFor}
                        isProcessing={isProcessing}
                    />
                )}

                {activeTab === 'comparison' && (
                    <GenotypeComparisonPanel
                        onStartProcessing={startProcessing}
                        onStopProcessing={stopProcessing}
                        onUpdateProgress={updateProgress}
                        onShowHelp={showHelpFor}
                        isProcessing={isProcessing}
                    />
                )}
            </main>

            {/* Help System */}
            {showHelp && (
                <HelpSystem
                    topic={currentHelpTopic}
                    onClose={hideHelp}
                />
            )}
        </div>
    );
};

export default BayesianAnalysisApp;