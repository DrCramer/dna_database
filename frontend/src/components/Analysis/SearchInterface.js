import React, { useEffect, useState } from 'react';
import { dnaAnalysisService } from '../../services/dnaAnalysisService';
import { settingsService } from '../../services/settingsService';
import { usePreventDuplicateSubmission } from '../../hooks/usePreventDuplicateSubmission';
import { useAuth } from '../../contexts/AuthContext';
import ResultsDisplay from './ResultsDisplay';

const SearchInterface = () => {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState('');
  const [searchSettings, setSearchSettings] = useState({
    threshold: 80,
    includePartialMatches: true,
    maxResults: 100,
    sortBy: 'match_percentage',
    sortOrder: 'desc',
    searchScope: 'department'
  });
  const [searchResults, setSearchResults] = useState(null);
  const [error, setError] = useState(null);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [organizationalContext, setOrganizationalContext] = useState(null);
  const [loadingContext, setLoadingContext] = useState(true);

  const { isSubmitting: searching, submit: handleSearchSubmit } = usePreventDuplicateSubmission(
    async (searchType) => {
      setError(null);
      setSearchResults(null);

      const searchParams = {
        threshold: searchSettings.threshold,
        includePartialMatches: searchSettings.includePartialMatches,
        maxResults: searchSettings.maxResults,
        sortBy: searchSettings.sortBy,
        sortOrder: searchSettings.sortOrder,
        searchScope: searchSettings.searchScope
      };

      if (searchType === 'single') {
        if (!selectedProfile) {
          throw new Error('Выберите профиль для поиска');
        }

        const results = await dnaAnalysisService.searchProfile(selectedProfile, searchParams);
        setSearchResults(results);
      } else if (searchType === 'bulk') {
        if (profiles.length === 0) {
          throw new Error('Нет профилей для пакетного поиска');
        }

        const results = await dnaAnalysisService.bulkSearch(searchParams);
        setSearchResults(results);
      }
    },
    3000
  );

  useEffect(() => {
    loadProfiles();
    loadSavedSettings();
    loadOrganizationalContext();
  }, [user]);

  const loadOrganizationalContext = async () => {
    if (!user) return;

    try {
      setLoadingContext(true);
      const response = await fetch('/api/users/context', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        const context = await response.json();
        setOrganizationalContext(context);
      }
    } catch (err) {
      console.error('Failed to load organizational context:', err);
    } finally {
      setLoadingContext(false);
    }
  };

  const loadProfiles = async () => {
    try {
      setLoadingProfiles(true);
      const data = await dnaAnalysisService.getProfiles({
        scope: searchSettings.searchScope
      });
      setProfiles(data);
    } catch (err) {
      setError('Не удалось загрузить ДНК-профили');
      console.error('Error loading profiles:', err);
    } finally {
      setLoadingProfiles(false);
    }
  };

  const loadSavedSettings = async () => {
    try {
      const savedSettings = await settingsService.getSearchSettings();
      if (savedSettings) {
        setSearchSettings((prev) => ({ ...prev, ...savedSettings }));
      }
    } catch (err) {
      console.error('Не удалось загрузить сохраненные параметры поиска, используются значения по умолчанию:', err);
    }
  };

  const saveSettings = async (newSettings) => {
    try {
      await settingsService.updateSearchSettings(newSettings);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  const handleSettingsChange = (key, value) => {
    const newSettings = { ...searchSettings, [key]: value };
    setSearchSettings(newSettings);
    saveSettings(newSettings);

    if (key === 'searchScope') {
      loadProfiles();
    }
  };

  const clearResults = () => {
    setSearchResults(null);
    setError(null);
  };

  if (loadingProfiles) {
    return (
      <div className="card">
        <div className="table-loading">Загрузка профилей...</div>
      </div>
    );
  }

  return (
    <div className="analysis-result-shell">
      {!loadingContext && organizationalContext && (
        <div className="analysis-context-card">
          <h3 className="analysis-context-title">Контекст поиска</h3>
          <p className="analysis-subtle">
            <strong>Организация:</strong> {organizationalContext.organization?.name || 'Неизвестно'} |
            <strong> Отдел:</strong> {organizationalContext.department?.name || 'Неизвестно'}
          </p>
          <p className="analysis-subtle">
            Область поиска может включать личные профили, мастер-массив отдела или оба источника одновременно.
          </p>
        </div>
      )}

      <div className="card analysis-result-shell">
        <h2 className="population-section-title">Поиск и сравнение ДНК-профилей</h2>
        <p className="analysis-subtle">
          Сопоставление профилей выполняется по STR-локусам с учетом выбранного порога и области поиска.
        </p>

        {error && (
          <div className="alert alert-danger">
            <div className="alert-content">
              <div className="alert-title">Ошибка</div>
              <p className="alert-message">{error}</p>
            </div>
          </div>
        )}

        <div className="analysis-search-grid">
          <div className="analysis-result-shell">
            <h3 className="population-section-title">Выбор профиля</h3>
            <div className="form-group">
              <label className="form-label">Профиль для поиска</label>
              <select
                className="form-select"
                value={selectedProfile}
                onChange={(event) => setSelectedProfile(event.target.value)}
                disabled={searching}
              >
                <option value="">Выберите профиль...</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.sample_name} ({new Date(profile.upload_date).toLocaleDateString('ru-RU')})
                  </option>
                ))}
              </select>
            </div>

            <div className="analysis-toolbar">
              <button className="btn btn-primary" onClick={() => handleSearchSubmit('single')} disabled={searching || !selectedProfile}>
                {searching ? 'Поиск...' : 'Искать по выбранному профилю'}
              </button>
              <button className="btn btn-secondary" onClick={() => handleSearchSubmit('bulk')} disabled={searching || profiles.length === 0}>
                {searching ? 'Поиск...' : 'Пакетный поиск по всем профилям'}
              </button>
            </div>
          </div>

          <div className="analysis-result-shell">
            <h3 className="population-section-title">Параметры поиска</h3>

            <div className="form-group">
              <label className="form-label">Порог совпадения: {searchSettings.threshold}%</label>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={searchSettings.threshold}
                onChange={(event) => handleSettingsChange('threshold', parseInt(event.target.value, 10))}
                disabled={searching}
                className="form-input"
              />
              <div className="analysis-toolbar">
                <span className="analysis-subtle">0%</span>
                <span className="analysis-subtle">50%</span>
                <span className="analysis-subtle">100%</span>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Область поиска</label>
              <select
                className="form-select"
                value={searchSettings.searchScope}
                onChange={(event) => handleSettingsChange('searchScope', event.target.value)}
                disabled={searching}
              >
                <option value="department">Отдел (мои профили + мастер-массив)</option>
                <option value="user_only">Только мои профили</option>
                <option value="master_only">Только мастер-массив отдела</option>
              </select>
              <div className="form-hint">
                {searchSettings.searchScope === 'department' && 'Поиск выполняется и по личным профилям, и по мастер-массиву отдела.'}
                {searchSettings.searchScope === 'user_only' && 'Поиск ограничен только вашими личными загруженными профилями.'}
                {searchSettings.searchScope === 'master_only' && 'Поиск ограничен только мастер-массивом отдела.'}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Максимум результатов</label>
              <select
                className="form-select"
                value={searchSettings.maxResults}
                onChange={(event) => handleSettingsChange('maxResults', parseInt(event.target.value, 10))}
                disabled={searching}
              >
                <option value={50}>50 результатов</option>
                <option value={100}>100 результатов</option>
                <option value={200}>200 результатов</option>
                <option value={500}>500 результатов</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Сортировать по</label>
              <select
                className="form-select"
                value={searchSettings.sortBy}
                onChange={(event) => handleSettingsChange('sortBy', event.target.value)}
                disabled={searching}
              >
                <option value="match_percentage">Процент совпадения</option>
                <option value="sample_name">Имя образца</option>
                <option value="upload_date">Дата загрузки</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Порядок сортировки</label>
              <select
                className="form-select"
                value={searchSettings.sortOrder}
                onChange={(event) => handleSettingsChange('sortOrder', event.target.value)}
                disabled={searching}
              >
                <option value="desc">По убыванию</option>
                <option value="asc">По возрастанию</option>
              </select>
            </div>

            <label className="form-checkbox">
              <input
                type="checkbox"
                checked={searchSettings.includePartialMatches}
                onChange={(event) => handleSettingsChange('includePartialMatches', event.target.checked)}
                disabled={searching}
              />
              <span>Учитывать частичные совпадения</span>
            </label>
          </div>
        </div>

        {searching && (
          <div className="analysis-detail-card">
            <div className="table-loading">Идет анализ ДНК-профилей и расчет процента совпадения...</div>
            <p className="analysis-subtle">Время зависит от количества профилей и выбранной области поиска.</p>
          </div>
        )}

        {searchResults && (
          <div className="analysis-toolbar">
            <button className="btn btn-secondary" onClick={clearResults}>
              Очистить результаты
            </button>
          </div>
        )}
      </div>

      {searchResults && <ResultsDisplay results={searchResults} searchSettings={searchSettings} />}

      <div className="card analysis-result-shell">
        <h3 className="population-section-title">Справка по поиску</h3>
        <ul className="analysis-list">
          <li><strong>Поиск по одному профилю:</strong> выбранный профиль сравнивается со всеми доступными профилями базы.</li>
          <li><strong>Пакетный поиск:</strong> все профили сравниваются между собой для поиска возможных совпадений.</li>
          <li><strong>Порог совпадения:</strong> в выдаче остаются только результаты выше указанного значения.</li>
          <li><strong>Частичные совпадения:</strong> позволяют включать профили с неполным набором локусов.</li>
        </ul>
        <div className="analysis-detail-card">
          <div className="analysis-mini-label">Интерпретация процента совпадения</div>
          <ul className="analysis-list">
            <li><strong>90-100%:</strong> очень высокое совпадение, возможен тот же человек или близкое родство.</li>
            <li><strong>70-89%:</strong> высокое совпадение, возможна семейная связь.</li>
            <li><strong>50-69%:</strong> умеренное совпадение, возможна дальняя связь.</li>
            <li><strong>ниже 50%:</strong> связь маловероятна.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default SearchInterface;
