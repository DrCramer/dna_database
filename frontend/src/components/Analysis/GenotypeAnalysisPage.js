import React, { useState, useEffect, useRef } from 'react';
import ColorPicker from './ColorPicker';
import ProfileActionButtons from './ProfileActionButtons';
import ProfileCommentModal from './ProfileCommentModal';
import { useProfileFieldLabel } from '../../hooks/useProfileFieldLabel';

// Локусы для анализа (24 основных)
const ANALYSIS_LOCI = [
  'D3S1358', 'vWA', 'D16S539', 'CSF1PO', 'TPOX', 'Yindel', 'AMEL',
  'D8S1179', 'D21S11', 'D18S51', 'DYS391', 'D2S441', 'D19S433',
  'TH01', 'FGA', 'D22S1045', 'D5S818', 'D13S317', 'D7S820', 'SE33',
  'D10S1248', 'D1S1656', 'D12S391', 'D2S1338'
];

const PROFILE_COLUMN_WIDTHS = { year: 88, import_number: 120, sample_name: 176, internal_number: 144 };
const LOCUS_COLUMN_WIDTH = 112;
const ACTIONS_COLUMN_WIDTH = 120;
const ROW_HEIGHT = 48;
const HEADER_HEIGHT = 48;
const BUFFER_SIZE = 5;

/**
 * Главный компонент страницы анализа генотипов
 */
const GenotypeAnalysisPage = ({ onNavigate, selectedActiveTask }) => {
  const fieldLabel = useProfileFieldLabel();
  // Состояния
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('data');
  const [searchResults, setSearchResults] = useState([]);
  const [searchHistory, setSearchHistory] = useState([]);
  const [referenceProfile, setReferenceProfile] = useState(null); // Полные данные эталона для отображения
  const [minMatches, setMinMatches] = useState(() => {
    const saved = localStorage.getItem('minMatches');
    return saved ? parseInt(saved) : 15;
  });

  // Сохраняем minMatches
  useEffect(() => {
    localStorage.setItem('minMatches', minMatches.toString());
  }, [minMatches]);
  const [showSettings, setShowSettings] = useState(false);
  const [searching, setSearching] = useState(false);
  const [showDnaLoading, setShowDnaLoading] = useState(false);
  const [searchProgress, setSearchProgress] = useState({ stage: '', current: 0, total: 0 });
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [previousProfile, setPreviousProfile] = useState(null);

  // Режим поиска: 'task' или 'master_array'
  const [searchMode, setSearchMode] = useState('task');

  // Алгоритм сравнения: 'standard', 'contamination', 'duplicate_v5'
  const [comparisonAlgorithm, setComparisonAlgorithm] = useState(() => {
    const saved = localStorage.getItem('comparisonAlgorithm');
    return saved || 'standard';
  });

  // Сохраняем comparisonAlgorithm
  useEffect(() => {
    localStorage.setItem('comparisonAlgorithm', comparisonAlgorithm);
  }, [comparisonAlgorithm]);

  // Настройки алгоритма поиска дублей v5.0
  const [duplicateSettings, setDuplicateSettings] = useState(() => {
    const saved = localStorage.getItem('duplicateSettings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error loading duplicateSettings:', e);
      }
    }
    return {
      minScore: 15,
      minPercentage: 80,
      minLoci: 15,
      locusWeights: {}
    };
  });

  // Сохраняем duplicateSettings
  useEffect(() => {
    localStorage.setItem('duplicateSettings', JSON.stringify(duplicateSettings));
  }, [duplicateSettings]);

  // Виртуализация
  const [scrollTop, setScrollTop] = useState(0);
  const [tableHeight, setTableHeight] = useState(600);
  const tableContainerRef = useRef(null);

  // Эталонные значения для поиска
  const [referenceValues, setReferenceValues] = useState({
    sample_name: '',
    internal_number: '',
    import_number: '',
    loci: {}
  });

  // Чекбоксы игнорирования локусов (по умолчанию все включены)
  const [ignoredLoci, setIgnoredLoci] = useState(() => {
    const saved = localStorage.getItem('ignoredLoci');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error loading ignoredLoci:', e);
      }
    }
    return ANALYSIS_LOCI.reduce((acc, locus) => {
      acc[locus] = ['Yindel', 'AMEL', 'DYS391'].includes(locus);
      return acc;
    }, {});
  });

  // Сохраняем ignoredLoci
  useEffect(() => {
    localStorage.setItem('ignoredLoci', JSON.stringify(ignoredLoci));
  }, [ignoredLoci]);

  // Отслеживание изменений локусов после последнего поиска
  const [lastSearchLociState, setLastSearchLociState] = useState(null);
  const [lociChanged, setLociChanged] = useState(false);

  // Состояние сворачивания панели эталонного профиля
  const [isReferencePanelCollapsed, setIsReferencePanelCollapsed] = useState(true);

  // Модальные окна для полного поиска
  const [showFullSearchConfirm, setShowFullSearchConfirm] = useState(false);
  const [showFullSearchResults, setShowFullSearchResults] = useState(false);
  const [fullSearchStats, setFullSearchStats] = useState(null);
  const [isModalClosing, setIsModalClosing] = useState(false);

  // Модальные окна для поиска внутри задачи
  const [showTaskSearchConfirm, setShowTaskSearchConfirm] = useState(false);
  const [showTaskSearchResults, setShowTaskSearchResults] = useState(false);
  const [taskSearchStats, setTaskSearchStats] = useState(null);
  const [taskSearchMode, setTaskSearchMode] = useState('task'); // 'task' или 'master_array'

  // Модальные окна для поиска в задачах отдела
  const [showDepartmentSearchConfirm, setShowDepartmentSearchConfirm] = useState(false);
  const [showDepartmentSearchResults, setShowDepartmentSearchResults] = useState(false);
  const [departmentSearchStats, setDepartmentSearchStats] = useState(null);

  // Модальное окно результатов контаминации
  const [showContaminationResults, setShowContaminationResults] = useState(false);
  const [contaminationStats, setContaminationStats] = useState(null);

  // Вкладка контаминации
  const [contaminationDetails, setContaminationDetails] = useState(null);

  // Модальное окно комментариев
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [commentModalProfile, setCommentModalProfile] = useState(null);

  // Модальное окно деактивации профиля
  const [deactivateModalOpen, setDeactivateModalOpen] = useState(false);
  const [deactivateModalProfile, setDeactivateModalProfile] = useState(null);
  const [deactivateReason, setDeactivateReason] = useState('');
  const [deactivateLoading, setDeactivateLoading] = useState(false);

  // Настройки алгоритма контаминации
  const [contaminationSettings, setContaminationSettings] = useState(() => {
    // Загружаем настройки из localStorage при инициализации
    const saved = localStorage.getItem('genotypeAnalysisSettings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          threshold: 5.5,
          minLociMatch: 8,
          criticalAlleleCount: 3,
          weightCriticalLocus: 2,
          stutterThreshold: 0.15,
          useV4Algorithm: true,
          useV5Algorithm: true,
          searchInMasterArray: false,
          autoCommentDuplicates: true,
          locusWeights: {},
          matchCoefficients: {
            fullMatch: 1.0,
            partialMatch: 0.4,
            penalty: -1.0,
            inclusiveDropout: 0.85,
            overInclusiveMix: 0.7
          },
          colors: {
            fullMatch: '#90EE90',
            partialMatch: '#9d8311',
            partialMatchAllele: '#1400e8',
            noMatch: '#FFB6C1'
          },
          ...parsed  // Перезаписываем сохранёнными значениями
        };
      } catch (e) {
        console.error('Error loading settings from localStorage:', e);
      }
    }

    // Дефолтные настройки если ничего не сохранено
    return {
      threshold: 5.5,
      minLociMatch: 8,
      criticalAlleleCount: 3,
      weightCriticalLocus: 2,
      stutterThreshold: 0.15,
      useV4Algorithm: true,
      useV5Algorithm: true,
      searchInMasterArray: false,
      autoCommentDuplicates: true,
      locusWeights: {},
      matchCoefficients: {
        fullMatch: 1.0,
        partialMatch: 0.4,
        penalty: -1.0,
        inclusiveDropout: 0.85,
        overInclusiveMix: 0.7
      },
      colors: {
        fullMatch: '#90EE90',
        partialMatch: '#9d8311',
        partialMatchAllele: '#1400e8',
        noMatch: '#FFB6C1'
      }
    };
  });

  // Сохраняем настройки в localStorage при изменении
  useEffect(() => {
    localStorage.setItem('genotypeAnalysisSettings', JSON.stringify(contaminationSettings));
  }, [contaminationSettings]);
  const [showContaminationSettings, setShowContaminationSettings] = useState(false);

  // Загрузка дефолтных параметров контаминации (только если нет сохранённых)
  useEffect(() => {
    const loadDefaultContaminationSettings = async () => {
      // Проверяем есть ли сохранённые настройки
      const savedSettings = localStorage.getItem('genotypeAnalysisSettings');
      if (savedSettings) {
        // Если есть сохранённые настройки, не загружаем с сервера
        return;
      }

      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/staff-contamination/default-parameters', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
          setContaminationSettings(prev => ({
            ...prev,
            threshold: data.data.options.threshold,
            minLociMatch: data.data.options.minLociMatch,
            criticalAlleleCount: data.data.options.criticalAlleleCount || 3,
            weightCriticalLocus: data.data.options.weightCriticalLocus || 2,
            stutterThreshold: data.data.options.stutterThreshold || 0.15,
            useV4Algorithm: data.data.options.useV4Algorithm,
            useV5Algorithm: data.data.options.useV5Algorithm || false,
            locusWeights: data.data.locusWeights || {},
            matchCoefficients: data.data.matchCoefficients || {
              fullMatch: 1.0,
              partialMatch: 0.4,
              penalty: -1.0,
              inclusiveDropout: 0.85,
              overInclusiveMix: 0.7
            }
          }));
        }
      } catch (error) {
        console.error('Ошибка загрузки дефолтных настроек контаминации:', error);
      }
    };
    loadDefaultContaminationSettings();
  }, []);

  /**
   * Закрытие модального окна с анимацией
   */
  const closeModal = (setModalState) => {
    setIsModalClosing(true);
    setTimeout(() => {
      setModalState(false);
      setIsModalClosing(false);
    }, 300); // Длительность анимации
  };

  // Порядок колонок локусов (можно перетаскивать)
  const [lociOrder, setLociOrder] = useState([...ANALYSIS_LOCI]);

  // Порядок базовых колонок (можно перетаскивать)
  const [baseColumnsOrder, setBaseColumnsOrder] = useState([
    { key: 'year', label: 'Год' },
    { key: 'import_number', label: 'Привоз' },
    { key: 'sample_name', label: '№ в в\\ч' },
    { key: 'internal_number', label: '№' }
  ]);

  // Фильтрация деактивированных профилей
  const [hideDeactivated, setHideDeactivated] = useState(() => {
    const saved = localStorage.getItem('hideDeactivatedProfiles');
    return saved === 'true';
  });

  // Сохраняем hideDeactivated
  useEffect(() => {
    localStorage.setItem('hideDeactivatedProfiles', hideDeactivated.toString());
  }, [hideDeactivated]);

  // Фильтрация профилей с комментариями
  const [showOnlyWithComments, setShowOnlyWithComments] = useState(() => {
    const saved = localStorage.getItem('showOnlyWithComments');
    return saved === 'true';
  });

  // Сохраняем showOnlyWithComments
  useEffect(() => {
    localStorage.setItem('showOnlyWithComments', showOnlyWithComments.toString());
  }, [showOnlyWithComments]);

  // Состояние для drag-and-drop
  const [draggedLocus, setDraggedLocus] = useState(null);
  const [dragOverLocus, setDragOverLocus] = useState(null);
  const [draggedColumn, setDraggedColumn] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);

  // Вычисляем список активных локусов (не игнорируемых) с учетом порядка
  const activeLoci = lociOrder.filter(locus => !ignoredLoci[locus]);
  const tableColumnCount = baseColumnsOrder.length + activeLoci.length + 1;
  const tableMinWidth = baseColumnsOrder.reduce((width, column) => width + PROFILE_COLUMN_WIDTHS[column.key], 0)
    + activeLoci.length * LOCUS_COLUMN_WIDTH + ACTIONS_COLUMN_WIDTH;

  // Размер области меняется при сворачивании эталона и изменении окна.
  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container) return;
    const measure = () => setTableHeight(container.clientHeight);
    measure();
    setScrollTop(container.scrollTop);
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [activeTab, loading]);

  useEffect(() => {
    if (tableContainerRef.current) tableContainerRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [selectedActiveTask?.id, hideDeactivated, showOnlyWithComments]);

  // Фильтруем и сортируем профили
  const filteredProfiles = profiles
    .filter(profile => {
      // Фильтр по деактивированным
      if (hideDeactivated && profile.is_active === false) {
        return false;
      }
      // Фильтр по комментариям
      if (showOnlyWithComments && !profile.expert_comment) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      // Сортировка по internal_number от меньшего к большему
      const numA = parseInt(a.internal_number) || 0;
      const numB = parseInt(b.internal_number) || 0;
      return numA - numB;
    });

  const deactivatedCount = profiles.filter(p => p.is_active === false).length;
  const withCommentsCount = profiles.filter(p => p.expert_comment).length;

  // Вычисление видимых строк
  const bodyScrollTop = Math.max(0, scrollTop - HEADER_HEIGHT);
  const startIndex = Math.min(Math.max(0, filteredProfiles.length - 1), Math.max(0, Math.floor(bodyScrollTop / ROW_HEIGHT) - BUFFER_SIZE));
  const endIndex = Math.min(
    filteredProfiles.length,
    Math.ceil((bodyScrollTop + tableHeight) / ROW_HEIGHT) + BUFFER_SIZE
  );
  const visibleProfiles = filteredProfiles.slice(startIndex, endIndex);
  const offsetY = startIndex * ROW_HEIGHT;
  const remainingHeight = (filteredProfiles.length - endIndex) * ROW_HEIGHT;

  // Обработчик скролла
  const handleScroll = (e) => {
    setScrollTop(e.target.scrollTop);
  };

  // Загрузка профилей при монтировании и при изменении задачи
  useEffect(() => {
    loadProfiles();
  }, [selectedActiveTask]);

  // Отслеживание изменений в ignoredLoci
  useEffect(() => {
    if (lastSearchLociState !== null) {
      // Проверяем изменились ли локусы
      const changed = JSON.stringify(ignoredLoci) !== JSON.stringify(lastSearchLociState);
      setLociChanged(changed);
    }
  }, [ignoredLoci, lastSearchLociState]);

  /**
   * Загрузка профилей из текущей задачи
   */
  const loadProfiles = async () => {
    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem('token');

      if (!token) {
        setError('Токен авторизации не найден. Пожалуйста, войдите в систему.');
        return;
      }

      // Проверка наличия активной задачи
      if (!selectedActiveTask) {
        setError('Выберите активную задачу для загрузки профилей');
        setProfiles([]);
        return;
      }

      // Загружаем только профили из текущей задачи
      const response = await fetch(`/api/tasks/${selectedActiveTask.id}/profiles`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      // Проверка статуса ответа
      if (response.status === 401) {
        setError('❌ Unauthorized - Токен авторизации истек или недействителен. Пожалуйста, войдите в систему заново.');
        // Очистка токена и перенаправление на логин
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setTimeout(() => {
          window.location.href = '/login';
        }, 2000);
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        // Backend возвращает profiles в data.data.profiles с camelCase полями
        // Преобразуем в snake_case для совместимости с компонентом
        const taskProfiles = (data.data?.profiles || data.profiles || []).map(profile => {
          // Парсим str_data в loci если это JSON строка
          let loci = profile.strData || profile.str_data;
          if (typeof loci === 'string') {
            try {
              loci = JSON.parse(loci);
            } catch (e) {
              console.error('Error parsing str_data:', e);
              loci = {};
            }
          }

          return {
            id: profile.id,
            sample_name: profile.sampleName || profile.sample_name,
            internal_number: profile.internalNumber || profile.internal_number,
            import_number: profile.importNumber || profile.import_number,
            year: profile.year,
            str_data: profile.strData || profile.str_data,
            loci: loci, // Добавляем распарсенные локусы
            upload_date: profile.uploadDate || profile.upload_date,
            file_source: profile.fileSource || profile.file_source,
            notes: profile.notes,
            // Новые поля для деактивации и комментариев
            is_active: profile.is_active !== undefined ? profile.is_active : true,
            deactivated_by: profile.deactivated_by,
            deactivated_at: profile.deactivated_at,
            deactivation_reason: profile.deactivation_reason,
            expert_comment: profile.expert_comment,
            comment_updated_at: profile.comment_updated_at,
            comment_updated_by: profile.comment_updated_by
          };
        });

        setProfiles(taskProfiles);
      } else {
        setError(data.error || 'Ошибка загрузки профилей');
      }
    } catch (err) {
      setError('Ошибка соединения с сервером: ' + err.message);
      console.error('Ошибка загрузки профилей:', err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Форматирование комментария о дубликатах
   */
  const formatDuplicateComment = (duplicates) => {
    if (!duplicates || duplicates.length === 0) return '';

    // Используем фиксированную ширину для всех колонок для единообразия
    const INTERNAL_WIDTH = 10;  // Ширина для internal_number
    const SAMPLE_WIDTH = 12;    // Ширина для sample_name

    const formatProfile = (profile) => {
      const internal = (profile.internal_number || 'N/A').padEnd(INTERNAL_WIDTH);
      const sample = (profile.sample_name || 'N/A').padEnd(SAMPLE_WIDTH);
      const importNum = profile.import_number ? `Привоз №${profile.import_number}` : 'Привоз N/A';
      const year = profile.year || 'N/A';

      return `${internal} | ${sample} | ${importNum} | ${year}`;
    };

    if (duplicates.length === 1) {
      return `Дубликат: ${formatProfile(duplicates[0])}`;
    }

    const lines = duplicates.map(d => `• ${formatProfile(d)}`);
    return `Дубликаты:\n${lines.join('\n')}`;
  };

  /**
   * Автоматическое комментирование дубликатов
   */
  const autoCommentDuplicates = async (referenceProfile, duplicates) => {
    if (!contaminationSettings.autoCommentDuplicates) return false;
    if (!duplicates || duplicates.length === 0) return false;

    const token = localStorage.getItem('token');
    const commentedProfiles = [];

    try {
      // Создаём полный список всех профилей в группе (эталон + дубликаты)
      const allProfilesInGroup = [referenceProfile, ...duplicates];

      // Комментируем каждый профиль в группе
      for (const profile of allProfilesInGroup) {
        if (!profile.id) {
          console.warn('Profile without ID:', profile.internal_number, profile.sample_name);
          continue;
        }

        // Для каждого профиля создаём список ВСЕХ остальных профилей (кроме него самого)
        const otherProfiles = allProfilesInGroup.filter(p =>
          p.internal_number !== profile.internal_number ||
          p.sample_name !== profile.sample_name
        );

        const comment = formatDuplicateComment(otherProfiles);

        const response = await fetch(`/api/profiles/${profile.id}/comment`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ comment })
        });

        if (response.ok) {
          commentedProfiles.push(profile.id);
        }
      }

      // Возвращаем true если хотя бы один профиль был прокомментирован
      return commentedProfiles.length > 0;
    } catch (error) {
      console.error('Error auto-commenting duplicates:', error);
      return false;
    }
  };

  /**
   * Выполнение поиска совпадений
   */
  const performSearch = async () => {
    if (!referenceValues.sample_name && Object.keys(referenceValues.loci).length === 0) {
      alert('Введите эталонные значения для поиска');
      return;
    }

    try {
      setSearching(true);
      setError(null);

      const token = localStorage.getItem('token');

      // Формируем список игнорируемых локусов
      const ignoredLociList = Object.keys(ignoredLoci).filter(locus => ignoredLoci[locus]);

      const response = await fetch('/api/genotype-analysis/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          referenceProfile: referenceValues,
          minMatches: minMatches,
          ignoredLoci: ignoredLociList,
          excludeProfileId: selectedProfile?.id
        })
      });

      const data = await response.json();

      if (data.success) {
        setSearchResults(data.matches);

        // Автоматическое комментирование дубликатов
        if (data.matches && data.matches.length > 0) {
          await autoCommentDuplicates(
            { ...referenceValues, id: selectedProfile?.id },
            data.matches
          );
        }

        // Добавляем в историю
        setSearchHistory(prev => [...prev, {
          sample_name: referenceValues.sample_name,
          internal_number: referenceValues.internal_number,
          import_number: referenceValues.import_number,
          matchCount: data.count,
          timestamp: new Date(),
          results: data.matches
        }]);

        // Переключаемся на вкладку результатов
        setActiveTab('results');

        if (data.count === 0) {
          alert('Совпадений не найдено');
        }
      } else {
        setError(data.error || 'Ошибка выполнения поиска');
      }
    } catch (err) {
      setError('Ошибка соединения с сервером');
      console.error('Ошибка поиска:', err);
    } finally {
      setSearching(false);
    }
  };

  /**
   * Массовый поиск
   */
  const performMassSearch = async (mode = searchMode) => {
    // Проверка наличия активной задачи
    if (!selectedActiveTask) {
      setError('Выберите активную задачу на главной странице перед началом анализа');
      return;
    }

    // Сохраняем режим и показываем модальное окно подтверждения
    setTaskSearchMode(mode);
    setShowTaskSearchConfirm(true);
  };

  /**
   * Выполнение поиска после подтверждения
   */
  const executeTaskSearch = async () => {
    setShowTaskSearchConfirm(false);

    // Очищаем историю перед началом нового поиска
    setSearchHistory([]);

    try {
      setSearching(true);
      setShowDnaLoading(true);
      setError(null);

      const token = localStorage.getItem('token');
      const ignoredLociList = Object.keys(ignoredLoci).filter(locus => ignoredLoci[locus]);

      const response = await fetch('/api/genotype-analysis/task-search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          taskId: selectedActiveTask.id,
          searchMode: taskSearchMode,
          minMatches: minMatches,
          ignoredLoci: ignoredLociList,
          comparisonAlgorithm: comparisonAlgorithm,
          useV5Algorithm: contaminationSettings.useV5Algorithm !== undefined ? contaminationSettings.useV5Algorithm : true,
          duplicateSettings: comparisonAlgorithm === 'duplicate_v5' ? duplicateSettings : undefined
        })
      });

      const data = await response.json();

      // Обработка ошибки доступа (403)
      if (response.status === 403) {
        setError(data.message || data.error);
        return;
      }

      if (data.success) {
        // Автоматическое комментирование дубликатов для каждого найденного совпадения
        let anyCommented = false;
        if (data.results && data.results.length > 0) {
          for (const result of data.results) {
            if (result.matches && result.matches.length > 0) {
              const commented = await autoCommentDuplicates(result.reference, result.matches);
              if (commented) anyCommented = true;
            }
          }
        }

        // Перезагружаем профили один раз после всех комментариев
        if (anyCommented) {
          await loadProfiles();
        }

        // Добавляем все результаты в историю
        const newHistoryItems = data.results.map(result => ({
          sample_name: result.reference.sample_name,
          internal_number: result.reference.internal_number,
          import_number: result.reference.import_number,
          year: result.reference.year,
          matchCount: result.matchCount,
          displayedCount: result.displayedCount || result.matchCount,
          timestamp: new Date(),
          results: result.matches,
          searchMode: data.searchMode
        }));

        setSearchHistory(prev => [...prev, ...newHistoryItems]);

        const stats = data.statistics || {};

        // Сохраняем статистику и показываем модальное окно результатов
        setTaskSearchStats({
          searchMode: data.searchMode,
          totalAnalyzed: data.totalAnalyzed,
          resultsWithMatches: data.resultsWithMatches,
          durationSeconds: stats.durationSeconds || 'N/A',
          comparisons: stats.comparisons ? stats.comparisons.toLocaleString('ru-RU') : 'N/A'
        });
        setShowTaskSearchResults(true);

        // Переключаемся на вкладку истории
        setActiveTab('history');

        // Сохраняем текущее состояние локусов после успешного поиска
        setLastSearchLociState(JSON.parse(JSON.stringify(ignoredLoci)));
        setLociChanged(false);
      } else {
        setError(data.error || 'Ошибка поиска');
      }
    } catch (err) {
      setError('Ошибка соединения с сервером');
      console.error('Ошибка поиска:', err);
    } finally {
      setSearching(false);
      setShowDnaLoading(false);
    }
  };

  /**
   * Массовый поиск внутри задачи
   * Использует новый endpoint task-search с режимом 'task'
   */
  const performTaskSearch = async () => {
    performMassSearch('task');
  };

  /**
   * Массовый поиск в мастер массиве
   */
  const performMasterArraySearch = () => {
    performMassSearch('master_array');
  };

  /**
   * Поиск в активных задачах отдела
   */
  const performDepartmentTasksSearch = async () => {
    if (!selectedActiveTask) {
      setError('Выберите активную задачу');
      return;
    }

    // Показываем модальное окно подтверждения
    setShowDepartmentSearchConfirm(true);
  };

  /**
   * Выполнение поиска в задачах отдела после подтверждения
   */
  const executeDepartmentTasksSearch = async () => {
    setShowDepartmentSearchConfirm(false);

    // Очищаем историю перед началом нового поиска
    setSearchHistory([]);

    try {
      setSearching(true);
      setShowDnaLoading(true);
      setError(null);
      setActiveTab('results');

      const token = localStorage.getItem('token');

      // Сохраняем состояние локусов для отслеживания изменений
      setLastSearchLociState(JSON.parse(JSON.stringify(ignoredLoci)));
      setLociChanged(false);

      const response = await fetch('/api/genotype-analysis/department-tasks-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          taskId: selectedActiveTask.id,
          minMatches: minMatches,
          ignoredLoci: Object.keys(ignoredLoci).filter(locus => ignoredLoci[locus]),
          comparisonAlgorithm: comparisonAlgorithm,
          duplicateSettings: comparisonAlgorithm === 'duplicate_v5' ? duplicateSettings : undefined
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Ошибка поиска в задачах отдела');
      }

      const data = await response.json();

      if (data.results.length === 0) {
        setError(data.message || 'Совпадений не найдено в активных задачах отдела');
        setSearchResults([]);
        return;
      }

      // Автоматическое комментирование дубликатов для каждого найденного совпадения
      let anyCommented = false;
      if (data.results && data.results.length > 0) {
        for (const result of data.results) {
          if (result.matches && result.matches.length > 0) {
            const commented = await autoCommentDuplicates(result.reference, result.matches);
            if (commented) anyCommented = true;
          }
        }
      }

      // Перезагружаем профили один раз после всех комментариев
      if (anyCommented) {
        await loadProfiles();
      }

      // Преобразуем результаты в формат для отображения
      const formattedResults = [];

      data.results.forEach(result => {
        result.matches.forEach(match => {
          formattedResults.push({
            ...match,
            referenceProfile: result.reference,
            searchMode: 'department_tasks'
          });
        });
      });

      // Сортируем результаты по количеству совпадений (от большего к меньшему)
      formattedResults.sort((a, b) => {
        const matchCountA = a.matchedLoci ? a.matchedLoci.length : 0;
        const matchCountB = b.matchedLoci ? b.matchedLoci.length : 0;
        return matchCountB - matchCountA;
      });

      setSearchResults(formattedResults);

      // Добавляем в историю - каждый профиль отдельно с его совпадениями
      // Сохраняем информацию о задаче и эксперте для каждого совпадения
      const newHistoryItems = data.results.map(result => ({
        sample_name: result.reference.sample_name,
        internal_number: result.reference.internal_number,
        import_number: result.reference.import_number,
        year: result.reference.year,
        matchCount: result.matchCount,
        displayedCount: result.displayedCount || result.matchCount,
        timestamp: new Date(),
        results: result.matches.map(match => ({
          ...match,
          task_name: match.task_name,
          task_owner: match.task_owner
        })),
        searchMode: 'department_tasks'
      }));

      setSearchHistory(prev => [...newHistoryItems, ...prev]);

      // Показываем модальное окно с результатами
      setDepartmentSearchStats({
        totalProfiles: data.results.length,
        totalTasks: data.stats.departmentTasksCount,
        totalMatches: formattedResults.length,
        durationSeconds: data.stats?.durationSeconds || 'N/A'
      });
      setShowDepartmentSearchResults(true);

    } catch (err) {
      setError(err.message || 'Ошибка поиска в задачах отдела');
      console.error('Ошибка поиска в задачах отдела:', err);
    } finally {
      setSearching(false);
      setShowDnaLoading(false);
    }
  };

  /**
   * Поиск контаминаций сотрудников
   * Отдельная функция для анализа только контаминации
   */
  const performContaminationSearch = async () => {
    if (!selectedActiveTask) {
      setError('Выберите активную задачу на главной странице перед началом анализа');
      return;
    }

    try {
      setSearching(true);
      setShowDnaLoading(true);
      setError(null);
      setSearchProgress({ stage: 'Анализ контаминации сотрудников...', current: 1, total: 1 });

      const token = localStorage.getItem('token');

      // Анализ контаминации с алгоритмом v4.0
      const contaminationResponse = await fetch('/api/staff-contamination/analyze-task', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          taskId: selectedActiveTask.id,
          options: {
            ...contaminationSettings
          }
        })
      });

      const contaminationData = await contaminationResponse.json();

      setSearchProgress({ stage: 'Поиск завершен!', current: 1, total: 1 });

      // Формируем историю
      const newHistoryItems = [];

      // Добавляем результаты контаминации
      if (contaminationData.success && contaminationData.data && contaminationData.data.length > 0) {
        contaminationData.data.forEach(contamination => {
          newHistoryItems.push({
            sample_name: contamination.sampleProfile.sample_name,
            internal_number: contamination.sampleProfile.internal_number,
            import_number: contamination.sampleProfile.import_number,
            year: contamination.sampleProfile.year,
            matchCount: 1,
            displayedCount: 1,
            timestamp: new Date(),
            results: [],
            searchMode: 'staff_contamination',
            fullSearchGroup: 'contamination',
            staffProfile: contamination.staffProfile,
            matchScore: contamination.matchScore,
            matchedLoci: contamination.matchedLoci,
            detailedMatches: contamination.detailedMatches,
            criticalAlleles: contamination.criticalAlleles
          });
        });
      }

      // Добавляем в историю
      setSearchHistory(prev => [...newHistoryItems, ...prev]);

      // Показываем результаты в модальном окне
      const contaminationCases = newHistoryItems.length;

      setContaminationStats({
        contaminationCases
      });
      setShowContaminationResults(true);

    } catch (err) {
      console.error('Contamination search error:', err);
      setError(err.message || 'Ошибка при поиске контаминаций');
    } finally {
      setSearching(false);
      setShowDnaLoading(false);
    }
  };

  /**
   * Полный поиск - объединяет все три типа анализа
   * 1. Поиск внутри задачи (дубликаты)
   * 2. Поиск в мастер массиве (идентификация)
   * 3. Контаминация сотрудников (только внутри задачи)
   */
  const performFullSearch = async () => {
    if (!selectedActiveTask) {
      alert('Выберите активную задачу на главной странице перед началом анализа');
      return;
    }

    // Показываем модальное окно подтверждения
    setShowFullSearchConfirm(true);
  };

  /**
   * Выполнение полного поиска после подтверждения
   */
  const executeFullSearch = async () => {
    setShowFullSearchConfirm(false);

    // Очищаем историю перед началом нового поиска
    setSearchHistory([]);

    try {
      setSearching(true);
      setShowDnaLoading(true);
      setError(null);
      setSearchProgress({ stage: 'Подготовка к поиску...', current: 0, total: 3 });

      const token = localStorage.getItem('token');
      const ignoredLociList = Object.keys(ignoredLoci).filter(locus => ignoredLoci[locus]);

      // 1. Поиск внутри задачи
      setSearchProgress({ stage: 'Поиск дубликатов в задаче...', current: 1, total: 3 });
      const taskSearchResponse = await fetch('/api/genotype-analysis/task-search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          taskId: selectedActiveTask.id,
          searchMode: 'task',
          minMatches: minMatches,
          ignoredLoci: ignoredLociList,
          comparisonAlgorithm: comparisonAlgorithm,
          useV5Algorithm: contaminationSettings.useV5Algorithm !== undefined ? contaminationSettings.useV5Algorithm : true,
          duplicateSettings: comparisonAlgorithm === 'duplicate_v5' ? duplicateSettings : undefined
        })
      });

      const taskSearchData = await taskSearchResponse.json();

      // 2. Поиск в мастер массиве
      setSearchProgress({ stage: 'Поиск в мастер массиве...', current: 2, total: 3 });
      const masterSearchResponse = await fetch('/api/genotype-analysis/task-search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          taskId: selectedActiveTask.id,
          searchMode: 'master_array',
          minMatches: minMatches,
          ignoredLoci: ignoredLociList,
          comparisonAlgorithm: comparisonAlgorithm,
          useV5Algorithm: contaminationSettings.useV5Algorithm !== undefined ? contaminationSettings.useV5Algorithm : true,
          duplicateSettings: comparisonAlgorithm === 'duplicate_v5' ? duplicateSettings : undefined
        })
      });

      const masterSearchData = await masterSearchResponse.json();

      // 3. Контаминация сотрудников
      setSearchProgress({ stage: 'Анализ контаминации сотрудников...', current: 3, total: 3 });
      const contaminationResponse = await fetch('/api/staff-contamination/analyze-task', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          taskId: selectedActiveTask.id,
          options: {
            minLociMatch: contaminationSettings.minLociMatch,
            criticalAlleleCount: contaminationSettings.criticalAlleleCount,
            weightCriticalLocus: contaminationSettings.weightCriticalLocus,
            stutterThreshold: contaminationSettings.stutterThreshold,
            threshold: contaminationSettings.threshold,
            useV4Algorithm: contaminationSettings.useV4Algorithm,
            searchInMasterArray: contaminationSettings.searchInMasterArray,
            locusWeights: contaminationSettings.locusWeights,
            matchCoefficients: contaminationSettings.matchCoefficients
          }
        })
      });

      const contaminationData = await contaminationResponse.json();

      // Завершение
      setSearchProgress({ stage: 'Поиск завершен!', current: 3, total: 3 });

      // Формируем историю с группировкой
      const newHistoryItems = [];

      // Добавляем результаты поиска внутри задачи
      if (taskSearchData.success && taskSearchData.results) {
        taskSearchData.results.forEach(result => {
          newHistoryItems.push({
            sample_name: result.reference.sample_name,
            internal_number: result.reference.internal_number,
            import_number: result.reference.import_number,
            year: result.reference.year,
            matchCount: result.matchCount,
            displayedCount: result.displayedCount || result.matchCount,
            timestamp: new Date(),
            results: result.matches,
            searchMode: 'task',
            fullSearchGroup: 'task' // Маркер для группировки
          });
        });
      }

      // Добавляем результаты поиска в мастер массиве
      if (masterSearchData.success && masterSearchData.results) {
        masterSearchData.results.forEach(result => {
          newHistoryItems.push({
            sample_name: result.reference.sample_name,
            internal_number: result.reference.internal_number,
            import_number: result.reference.import_number,
            year: result.reference.year,
            matchCount: result.matchCount,
            displayedCount: result.displayedCount || result.matchCount,
            timestamp: new Date(),
            results: result.matches,
            searchMode: 'master_array',
            fullSearchGroup: 'master' // Маркер для группировки
          });
        });
      }

      // Добавляем результаты контаминации
      if (contaminationData.success && contaminationData.data && contaminationData.data.length > 0) {
        contaminationData.data.forEach((contamination, idx) => {
          newHistoryItems.push({
            sample_name: contamination.sampleProfile.sample_name,
            internal_number: contamination.sampleProfile.internal_number,
            import_number: contamination.sampleProfile.import_number,
            year: contamination.sampleProfile.year,
            matchCount: 1, // Контаминация = 1 совпадение с сотрудником
            timestamp: new Date(contamination.timestamp),
            results: [], // Для контаминации результаты хранятся отдельно
            searchMode: 'staff_contamination',
            fullSearchGroup: 'contamination', // Маркер для группировки
            staffProfile: contamination.staffProfile,
            matchScore: contamination.matchScore,
            matchedLoci: contamination.matchedLoci,
            detailedMatches: contamination.detailedMatches,
            criticalAlleles: contamination.criticalAlleles
          });
        });
      }

      // Добавляем все результаты в историю
      setSearchHistory(prev => [...newHistoryItems, ...prev]);

      // Сохраняем текущее состояние локусов
      setLastSearchLociState(JSON.parse(JSON.stringify(ignoredLoci)));
      setLociChanged(false);

      // Статистика
      const taskMatches = taskSearchData.resultsWithMatches || 0;
      const masterMatches = masterSearchData.resultsWithMatches || 0;
      const contaminationCases = contaminationData.data?.length || 0;
      const taskTime = taskSearchData.statistics?.durationSeconds || 0;
      const masterTime = masterSearchData.statistics?.durationSeconds || 0;
      const totalTime = taskTime + masterTime;

      // Сохраняем статистику для модального окна
      setFullSearchStats({
        taskMatches,
        masterMatches,
        contaminationCases,
        totalMatches: taskMatches + masterMatches + contaminationCases,
        profilesAnalyzed: profiles.length,
        totalTime: typeof totalTime === 'number' ? totalTime.toFixed(1) : '0.0'
      });

      // Показываем модальное окно с результатами
      setShowFullSearchResults(true);

      // Переключаемся на вкладку истории
      setActiveTab('history');

    } catch (err) {
      setError('Ошибка полного поиска: ' + err.message);
      console.error('Ошибка полного поиска:', err);
    } finally {
      setSearching(false);
      setShowDnaLoading(false);
    }
  };

  /**
   * Выбор профиля из таблицы (автозаполнение эталона)
   */
  const selectProfile = (profile) => {
    setPreviousProfile(selectedProfile);
    setSelectedProfile(profile);

    // Формируем значения локусов для эталона
    const lociValues = {};
    if (profile.loci) {
      ANALYSIS_LOCI.forEach(locus => {
        const locusData = profile.loci[locus];
        if (locusData) {
          // Используем formatLocusValue для единообразного форматирования
          lociValues[locus] = formatLocusValue(locusData);
        }
      });
    }

    setReferenceValues({
      sample_name: profile.sample_name,
      internal_number: profile.internal_number,
      import_number: profile.import_number || '',
      loci: lociValues
    });
  };

  /**
   * Очистка полей ввода
   */
  const clearFields = () => {
    setReferenceValues({
      sample_name: '',
      internal_number: '',
      import_number: '',
      loci: {}
    });
    setSelectedProfile(null);
  };

  /**
   * Переключение чекбокса игнорирования локуса
   */
  const toggleIgnoreLocus = (locus) => {
    setIgnoredLoci(prev => ({
      ...prev,
      [locus]: !prev[locus]
    }));
  };

  /**
   * Изменение значения локуса
   */
  const handleLocusChange = (locus, value) => {
    setReferenceValues(prev => ({
      ...prev,
      loci: {
        ...prev.loci,
        [locus]: value
      }
    }));
  };

  /**
   * Обработчики drag-and-drop для перестановки колонок
   */
  const handleDragStart = (e, locus) => {
    setDraggedLocus(locus);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target);
    e.target.style.opacity = '0.5';
  };

  const handleDragEnd = (e) => {
    e.target.style.opacity = '1';
    setDraggedLocus(null);
    setDragOverLocus(null);
  };

  const handleDragOver = (e, locus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (draggedLocus && draggedLocus !== locus) {
      setDragOverLocus(locus);
    }
  };

  const handleDragLeave = (e, locus) => {
    // Проверяем что мы действительно покинули элемент
    if (e.currentTarget === e.target) {
      setDragOverLocus(null);
    }
  };

  const handleDrop = (e, targetLocus) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedLocus || draggedLocus === targetLocus) {
      return;
    }

    // Создаем новый порядок колонок
    const newOrder = [...lociOrder];
    const draggedIndex = newOrder.indexOf(draggedLocus);
    const targetIndex = newOrder.indexOf(targetLocus);

    // Удаляем перетаскиваемый элемент
    newOrder.splice(draggedIndex, 1);
    // Вставляем на новое место
    newOrder.splice(targetIndex, 0, draggedLocus);

    setLociOrder(newOrder);
    setDraggedLocus(null);
    setDragOverLocus(null);
  };

  /**
   * Сброс порядка колонок к исходному
   */
  const resetLociOrder = () => {
    setLociOrder([...ANALYSIS_LOCI]);
  };

  /**
   * Обработчики drag-and-drop для базовых колонок
   */
  const handleColumnDragStart = (e, columnKey) => {
    setDraggedColumn(columnKey);
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.5';
  };

  const handleColumnDragEnd = (e) => {
    e.target.style.opacity = '1';
    setDraggedColumn(null);
    setDragOverColumn(null);
  };

  const handleColumnDragOver = (e, columnKey) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (draggedColumn && draggedColumn !== columnKey) {
      setDragOverColumn(columnKey);
    }
  };

  const handleColumnDragLeave = (e, columnKey) => {
    if (e.currentTarget === e.target) {
      setDragOverColumn(null);
    }
  };

  const handleColumnDrop = (e, targetColumnKey) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedColumn || draggedColumn === targetColumnKey) {
      return;
    }

    // Создаем новый порядок колонок
    const newOrder = [...baseColumnsOrder];
    const draggedIndex = newOrder.findIndex(col => col.key === draggedColumn);
    const targetIndex = newOrder.findIndex(col => col.key === targetColumnKey);

    // Удаляем перетаскиваемый элемент
    const [removed] = newOrder.splice(draggedIndex, 1);
    // Вставляем на новое место
    newOrder.splice(targetIndex, 0, removed);

    setBaseColumnsOrder(newOrder);
    setDraggedColumn(null);
    setDragOverColumn(null);
  };

  /**
   * Сброс порядка базовых колонок к исходному
   */
  const resetBaseColumnsOrder = () => {
    setBaseColumnsOrder([
      { key: 'year', label: 'Год' },
      { key: 'sample_name', label: '№ в в\\ч' },
      { key: 'internal_number', label: '№' },
      { key: 'import_number', label: 'Привоз' }
    ]);
  };

  /**
   * Обработчик деактивации профиля
   */
  const handleProfileDeactivate = (profileId, newStatus) => {
    // Обновляем профиль в списке
    setProfiles(prev => prev.map(p =>
      p.id === profileId ? { ...p, is_active: newStatus } : p
    ));

    // Обновляем в результатах поиска если есть
    setSearchResults(prev => prev.map(r =>
      r.profile.id === profileId ? { ...r, profile: { ...r.profile, is_active: newStatus } } : r
    ));
  };

  /**
   * Обработчик открытия модального окна комментариев
   */
  const handleCommentClick = (profile) => {
    setCommentModalProfile(profile);
    setCommentModalOpen(true);
  };

  /**
   * Обработчик переключения активности профиля (деактивация/активация)
   */
  const handleToggleActive = async (profile, isCurrentlyActive) => {
    // Проверка наличия ID профиля
    if (!profile || !profile.id) {
      console.error('Profile ID is missing:', profile);
      alert('Ошибка: ID профиля не найден. Возможно, это временный профиль из результатов поиска.');
      return;
    }

    // Если профиль активен - открываем модальное окно для деактивации
    if (isCurrentlyActive) {
      setDeactivateModalProfile(profile);
      setDeactivateReason('');
      setDeactivateModalOpen(true);
    } else {
      // Если профиль неактивен - активируем сразу без модального окна
      await performToggleActive(profile, true, null);
    }
  };

  /**
   * Выполнение деактивации/активации профиля
   */
  const performToggleActive = async (profile, newStatus, reason) => {
    try {
      const token = localStorage.getItem('token');

      const response = await fetch(`/api/profiles/${profile.id}/toggle-active`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          is_active: newStatus,
          reason: reason || (newStatus ? 'Активирован' : 'Деактивирован через интерфейс')
        })
      });

      if (!response.ok) {
        throw new Error('Ошибка при изменении статуса профиля');
      }

      // Обновляем профиль в списке
      setProfiles(prev => prev.map(p =>
        p.id === profile.id ? { ...p, is_active: newStatus } : p
      ));

      // Обновляем в результатах поиска если есть
      setSearchResults(prev => prev.map(r =>
        r.id === profile.id ? { ...r, is_active: newStatus } : r
      ));

      // Закрываем модальное окно
      setDeactivateModalOpen(false);
      setDeactivateModalProfile(null);
      setDeactivateReason('');
    } catch (error) {
      console.error('Error toggling profile active status:', error);
      alert('Ошибка при изменении статуса профиля');
    }
  };

  /**
   * Обработчик подтверждения деактивации из модального окна
   */
  const handleConfirmDeactivate = async () => {
    if (!deactivateModalProfile) return;

    setDeactivateLoading(true);
    try {
      await performToggleActive(deactivateModalProfile, false, deactivateReason);
    } finally {
      setDeactivateLoading(false);
    }
  };

  /**
   * Обработчик открытия модального окна комментариев (новое название)
   */
  const handleOpenCommentModal = async (profile) => {
    // Если это временный профиль (из результатов поиска), нужно найти реальный профиль в БД
    if (profile._isTemporary) {
      // Ищем в уже загруженных профилях
      const realProfile = profiles.find(p =>
        (p.internal_number && p.internal_number === profile.internal_number) ||
        (p.sample_name && p.sample_name === profile.sample_name)
      );

      if (realProfile) {
        setCommentModalProfile(realProfile);
        setCommentModalOpen(true);
        return;
      }

      // Если не нашли в загруженных, пробуем загрузить из БД
      try {
        const token = localStorage.getItem('token');
        const searchParams = new URLSearchParams();
        if (profile.internal_number) {
          searchParams.append('internal_number', profile.internal_number);
        }
        if (profile.sample_name) {
          searchParams.append('sample_name', profile.sample_name);
        }
        if (profile.year) {
          searchParams.append('year', profile.year);
        }

        const response = await fetch(`/api/tasks/${selectedActiveTask.id}/profiles?${searchParams}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.profiles && data.profiles.length > 0) {
            setCommentModalProfile(data.profiles[0]);
            setCommentModalOpen(true);
            return;
          }
        }
      } catch (error) {
        console.error('Error loading profile from database:', error);
      }

      // Если не нашли, показываем ошибку
      alert('Не удалось найти профиль в базе данных. Возможно, он из другой задачи.');
      return;
    }

    // Обычный профиль с ID
    setCommentModalProfile(profile);
    setCommentModalOpen(true);
  };

  /**
   * Обработчик сохранения комментария
   */
  const handleCommentSave = async (comment) => {
    if (!commentModalProfile) return;

    try {
      const profileId = commentModalProfile.id;
      const sampleName = commentModalProfile.sample_name || commentModalProfile.sampleName;
      const internalNumber = commentModalProfile.internal_number || commentModalProfile.internalNumber;

      const token = localStorage.getItem('token');

      // СНАЧАЛА сохраняем комментарий через PUT
      const saveResponse = await fetch(`/api/profiles/${profileId}/comment`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ comment })
      });

      if (!saveResponse.ok) {
        throw new Error('Failed to save comment');
      }

      // ПОТОМ получаем обновлённые данные профиля с сервера
      const getResponse = await fetch(`/api/profiles/${profileId}/comment`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      let updatedCommentData = {
        expert_comment: comment,
        comment_updated_at: new Date().toLocaleString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      };

      if (getResponse.ok) {
        const data = await getResponse.json();
        updatedCommentData = {
          expert_comment: data.comment || data.expert_comment,
          comment_updated_at: data.updated_at || data.comment_updated_at,
          comment_updated_by: data.updated_by || data.comment_updated_by
        };
      }

      // Обновляем профиль в списке
      setProfiles(prev => {
        const profileExists = prev.some(p => p.id === profileId);
        if (profileExists) {
          return prev.map(p => p.id === profileId ? { ...p, ...updatedCommentData } : p);
        }
        return prev;
      });

      // Обновляем эталонный профиль если это он
      setReferenceProfile(prev => {
        if (prev && (prev.id === profileId ||
            prev.sample_name === sampleName ||
            prev.internal_number === internalNumber)) {
          return { ...prev, ...updatedCommentData };
        }
        return prev;
      });

      // Обновляем в результатах поиска если есть
      setSearchResults(prev => {
        const updated = prev.map(r => {
          if (r.id === profileId ||
              r.sample_name === sampleName ||
              r.internal_number === internalNumber) {
            return { ...r, ...updatedCommentData };
          }
          return r;
        });
        return [...updated]; // Создаём новый массив для принудительного ре-рендера
      });

      // Обновляем в истории поиска
      setSearchHistory(prev => {
        const updated = prev.map(historyItem => {
          // Обновляем в allProfiles если есть
          if (historyItem.allProfiles) {
            const updatedProfiles = historyItem.allProfiles.map(p => {
              if (p.id === profileId ||
                  p.sample_name === sampleName ||
                  p.internal_number === internalNumber) {
                return { ...p, ...updatedCommentData };
              }
              return p;
            });
            return { ...historyItem, allProfiles: updatedProfiles };
          }

          // Обновляем если это сам профиль (для контаминации)
          if (historyItem.sample_name === sampleName ||
              historyItem.internal_number === internalNumber) {
            return { ...historyItem, ...updatedCommentData };
          }

          return historyItem;
        });

        return updated;
      });

      // Закрываем модальное окно
      setCommentModalOpen(false);
      setCommentModalProfile(null);
    } catch (error) {
      console.error('Error in handleCommentSave:', error);
      // Всё равно закрываем окно даже при ошибке
      setCommentModalOpen(false);
      setCommentModalProfile(null);
    }
  };

  /**
   * Форматирование значения локуса для отображения
   * Поддерживает:
   * - Массивы: ["14", "17"] → "14,17"
   * - Объекты: {allele1: "14", allele2: "17"} → "14,17"
   * - Строки: "14,17" → "14,17"
   */
  const formatLocusValue = (locusData) => {
    if (!locusData) return '';

    // Поддержка массивов (новый формат БД)
    if (Array.isArray(locusData)) {
      // Фильтруем пустые значения и специальные символы
      const validAlleles = locusData.filter(a =>
        a && a !== '' && a !== '.' && a !== '*' && a !== '**' && a !== '?'
      );
      return validAlleles.join(',');
    }

    // Поддержка объектов (старый формат)
    if (typeof locusData === 'object') {
      const alleles = [];
      if (locusData.allele1 && locusData.allele1 !== '' && locusData.allele1 !== '.' && locusData.allele1 !== '*') {
        alleles.push(locusData.allele1);
      }
      if (locusData.allele2 && locusData.allele2 !== '' && locusData.allele2 !== '.' && locusData.allele2 !== '*') {
        alleles.push(locusData.allele2);
      }
      return alleles.join(',');
    }

    // Поддержка строк
    return locusData.toString();
  };

  /**
   * Форматирование локуса с подсветкой совпадающих аллелей
   * Используется для частичных совпадений (контаминация)
   */
  const formatLocusWithHighlight = (locusData, refLocusData) => {
    if (!locusData) return '';
    if (!refLocusData) return formatLocusValue(locusData);

    // Получаем массивы аллелей
    const getAlleles = (data) => {
      if (!data) return [];
      if (Array.isArray(data)) {
        return data.filter(a => a && a !== '' && a !== '.' && a !== '*' && a !== '**' && a !== '?');
      }
      if (typeof data === 'object') {
        const alleles = [];
        if (data.allele1 && data.allele1 !== '' && data.allele1 !== '.' && data.allele1 !== '*') {
          alleles.push(data.allele1);
        }
        if (data.allele2 && data.allele2 !== '' && data.allele2 !== '.' && data.allele2 !== '*') {
          alleles.push(data.allele2);
        }
        return alleles;
      }
      return [data.toString()];
    };

    const refAlleles = getAlleles(refLocusData);
    const compAlleles = getAlleles(locusData);

    if (refAlleles.length === 0 || compAlleles.length === 0) {
      return formatLocusValue(locusData);
    }

    // Создаем Set для быстрой проверки
    const refSet = new Set(refAlleles);

    // Подсвечиваем совпадающие аллели синим цветом
    return (
      <span className="locus-highlight-list">
        {compAlleles.map((allele, idx) => {
          const isMatched = refSet.has(allele);
          return (
            <React.Fragment key={idx}>
              {idx > 0 && ','}
              <span
                className={isMatched ? 'locus-highlight-match' : 'locus-highlight-default'}
                style={
                  isMatched
                    ? { '--locus-highlight-color': contaminationSettings.colors?.partialMatchAllele || '#1400e8' }
                    : undefined
                }
              >
                {allele}
              </span>
            </React.Fragment>
          );
        })}
      </span>
    );
  };

  /**
   * Обогащение истории актуальными комментариями из БД
   * Эта функция берёт данные из searchHistory и добавляет к ним актуальные комментарии из profiles
   */
  const enrichHistoryWithComments = (history) => {
    if (!history || history.length === 0) {
      return history;
    }

    // Создаём карту комментариев из текущих профилей
    const commentsMap = new Map();
    profiles.forEach(profile => {
      if (profile.expert_comment) {
        const key = profile.internal_number || profile.sample_name;
        commentsMap.set(key, {
          expert_comment: profile.expert_comment,
          comment_updated_at: profile.comment_updated_at,
          comment_updated_by: profile.comment_updated_by
        });
      }
    });

    // Обогащаем историю актуальными комментариями
    return history.map((historyItem) => {
      // Обновляем allProfiles если есть
      if (historyItem.allProfiles) {
        const updatedProfiles = historyItem.allProfiles.map(p => {
          const key = p.internal_number || p.sample_name;
          const comment = commentsMap.get(key);
          if (comment) {
            return { ...p, ...comment };
          }
          return p;
        });
        return { ...historyItem, allProfiles: updatedProfiles };
      }

      // Начинаем с копии элемента истории
      let enrichedItem = { ...historyItem };

      // Добавляем комментарий к самому элементу если есть (для контаминации)
      const key = historyItem.internal_number || historyItem.sample_name;
      const comment = commentsMap.get(key);
      if (comment) {
        enrichedItem = { ...enrichedItem, ...comment };
      }

      // Обновляем results если есть (для обычных поисков)
      if (historyItem.results && historyItem.results.length > 0) {
        const enrichedResults = historyItem.results.map(result => {
          const resultKey = result.internal_number || result.sample_name;
          const resultComment = commentsMap.get(resultKey);
          if (resultComment) {
            return { ...result, ...resultComment };
          }
          return result;
        });
        enrichedItem = { ...enrichedItem, results: enrichedResults };
      }

      return enrichedItem;
    });
  };

  /**
   * Группировка истории по генотипу с объединением связанных профилей
   * Использует Union-Find для объединения всех профилей, которые связаны через совпадения
   */
  const groupHistoryByGenotype = (history) => {
    if (!history || history.length === 0) return [];

    // Создаем карту всех профилей
    const profileMap = new Map();

    // Собираем все профили из истории
    history.forEach(item => {
      // Используем internal_number как ключ, если он есть, иначе sample_name
      const key = item.internal_number || item.sample_name;
      if (!profileMap.has(key)) {
        profileMap.set(key, {
          sample_name: item.sample_name,
          internal_number: item.internal_number,
          import_number: item.import_number,
          year: item.year,
          timestamp: item.timestamp,
          searchMode: item.searchMode,
          matches: [],
          task_name: item.task_name, // Добавляем информацию о задаче
          task_owner: item.task_owner, // Добавляем информацию об эксперте
          expert_comment: item.expert_comment, // Добавляем комментарий
          comment_updated_at: item.comment_updated_at, // Добавляем дату обновления комментария
          comment_updated_by: item.comment_updated_by // Добавляем кто обновил комментарий
        });
      }

      // Добавляем совпадения
      if (item.results && item.results.length > 0) {
        item.results.forEach(match => {
          const matchKey = match.internal_number || match.sample_name;
          profileMap.get(key).matches.push(matchKey);

          // Добавляем совпавший профиль в карту, если его еще нет
          if (!profileMap.has(matchKey)) {
            profileMap.set(matchKey, {
              sample_name: match.sample_name,
              internal_number: match.internal_number,
              import_number: match.import_number,
              year: match.year,
              timestamp: item.timestamp,
              searchMode: item.searchMode,
              matches: [],
              task_name: match.task_name, // Информация о задаче из совпадения
              task_owner: match.task_owner, // Информация об эксперте из совпадения
              expert_comment: match.expert_comment, // Комментарий из совпадения
              comment_updated_at: match.comment_updated_at, // Дата обновления комментария
              comment_updated_by: match.comment_updated_by // Кто обновил комментарий
            });
          }
        });
      }
    });

    // Union-Find для объединения связанных профилей
    const parent = new Map();
    const rank = new Map();

    // Инициализация
    profileMap.forEach((_, key) => {
      parent.set(key, key);
      rank.set(key, 0);
    });

    // Функция поиска корня
    const find = (x) => {
      if (parent.get(x) !== x) {
        parent.set(x, find(parent.get(x))); // Сжатие пути
      }
      return parent.get(x);
    };

    // Функция объединения
    const union = (x, y) => {
      const rootX = find(x);
      const rootY = find(y);

      if (rootX !== rootY) {
        if (rank.get(rootX) < rank.get(rootY)) {
          parent.set(rootX, rootY);
        } else if (rank.get(rootX) > rank.get(rootY)) {
          parent.set(rootY, rootX);
        } else {
          parent.set(rootY, rootX);
          rank.set(rootX, rank.get(rootX) + 1);
        }
      }
    };

    // Объединяем все связанные профили
    profileMap.forEach((profile, key) => {
      profile.matches.forEach(matchKey => {
        if (profileMap.has(matchKey)) {
          union(key, matchKey);
        }
      });
    });

    // Группируем профили по корневому элементу
    const groups = new Map();
    profileMap.forEach((profile, key) => {
      const root = find(key);
      if (!groups.has(root)) {
        groups.set(root, []);
      }
      groups.get(root).push(profile);
    });

    // Формируем результат
    const groupedHistory = [];
    groups.forEach((profiles, root) => {
      // Берем самый ранний timestamp из группы
      const timestamps = profiles.map(p => new Date(p.timestamp));
      const earliestTimestamp = new Date(Math.min(...timestamps));

      // Собираем все уникальные номера
      const allInternalNumbers = [...new Set(profiles.map(p => p.internal_number).filter(Boolean))];
      const allImportNumbers = [...new Set(profiles.map(p => p.import_number).filter(Boolean))];
      const allSampleNames = profiles.map(p => p.sample_name);

      // Берем первый профиль как основной
      const mainProfile = profiles[0];

      groupedHistory.push({
        sample_name: allSampleNames.join(' | '),
        internal_number: mainProfile.internal_number,
        internal_numbers: allInternalNumbers.join(' | '),
        import_numbers: allImportNumbers.join(' | '),
        matchCount: profiles.length - 1, // Количество совпадений = количество профилей - 1
        timestamp: earliestTimestamp,
        allProfiles: profiles,
        isGroup: profiles.length > 1,
        searchMode: mainProfile.searchMode
      });
    });

    // Сортируем по времени (новые сверху)
    groupedHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return groupedHistory;
  };

  /**
   * Восстановление результатов из истории с загрузкой полных данных
   */
  const restoreFromHistory = async (historyItem) => {
    // Получаем ссылку на панель для прокрутки
    const panelElement = document.querySelector('.input-panel');

    // Добавляем класс анимации
    if (panelElement) {
      panelElement.classList.add('auto-collapsing');
      setTimeout(() => {
        panelElement.classList.remove('auto-collapsing');
      }, 600);
    }

    // Автоматически сворачиваем эталонный профиль для удобства
    setIsReferencePanelCollapsed(true);

    // Плавная прокрутка к панели после небольшой задержки
    setTimeout(() => {
      if (panelElement) {
        panelElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    }, 100);

    // Если это группа, показываем все профили группы
    if (historyItem.allProfiles && historyItem.allProfiles.length > 0) {
      try {
        const token = localStorage.getItem('token');

        // Определяем режим поиска из первого элемента группы
        const searchMode = historyItem.searchMode ||
                          historyItem.allProfiles[0]?.searchMode ||
                          'task';

        // Загружаем профили задачи
        const taskResponse = await fetch(`/api/tasks/${selectedActiveTask.id}/profiles`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!taskResponse.ok) {
          throw new Error('Failed to load task profiles');
        }

        const taskData = await taskResponse.json();
        const taskProfiles = taskData.data.profiles;

        // Если поиск был в мастер массиве, загружаем и их тоже
        let masterProfiles = [];
        if (searchMode === 'master' || searchMode === 'master_array') {
          const masterResponse = await fetch('/api/genotype-analysis/profiles', {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });

          if (masterResponse.ok) {
            const masterData = await masterResponse.json();
            masterProfiles = masterData.profiles || [];
          }
        }

        // Если поиск был в задачах отдела, загружаем профили из всех задач отдела
        let departmentProfiles = [];
        if (searchMode === 'department_tasks') {
          try {
            const departmentResponse = await fetch('/api/genotype-analysis/department-profiles', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                taskId: selectedActiveTask.id
              })
            });

            if (departmentResponse.ok) {
              const departmentData = await departmentResponse.json();
              departmentProfiles = departmentData.profiles || [];
            }
          } catch (err) {
            console.warn('Failed to load department profiles:', err);
          }
        }

        // Объединяем все профили для поиска
        const allProfiles = [...taskProfiles, ...masterProfiles, ...departmentProfiles];

        // Обогащаем профили группы данными локусов
        const enrichedProfiles = historyItem.allProfiles.map(profile => {
          // Ищем профиль по sample_name и internal_number (более надежный поиск)
          let fullProfile = allProfiles.find(p => {
            const pSampleName = p.sampleName || p.sample_name;
            const pInternalNumber = p.internalNumber || p.internal_number;

            return (
              pSampleName === profile.sample_name &&
              pInternalNumber === profile.internal_number
            );
          });

          // Если не нашли, пробуем по year + internal_number
          if (!fullProfile) {
            fullProfile = allProfiles.find(p => {
              const pInternalNumber = p.internalNumber || p.internal_number;
              return (
                p.year === profile.year &&
                pInternalNumber === profile.internal_number
              );
            });
          }

          if (fullProfile) {
            const enriched = {
              id: fullProfile.id,
              sample_name: profile.sample_name,
              internal_number: profile.internal_number,
              import_number: fullProfile.importNumber || fullProfile.import_number || profile.import_number,
              year: fullProfile.year || profile.year,
              loci: fullProfile.strData || fullProfile.loci,
              // Добавляем поля комментариев
              expert_comment: fullProfile.expert_comment,
              comment_updated_at: fullProfile.comment_updated_at,
              comment_updated_by: fullProfile.comment_updated_by,
              is_active: fullProfile.is_active
            };
            return enriched;
          }

          console.warn('⚠️ Profile not found:', profile.sample_name, 'internal_number:', profile.internal_number, 'year:', profile.year);
          return {
            sample_name: profile.sample_name,
            internal_number: profile.internal_number,
            import_number: profile.import_number,
            year: profile.year,
            loci: null
          };
        });

        // Первый профиль = эталон
        const refProfile = enrichedProfiles[0];
        setReferenceProfile(refProfile);

        // Остальные = совпадения
        const matches = enrichedProfiles.slice(1);

        // Вычисляем совпадающие локусы для каждого совпадения
        const matchesWithLoci = matches.map((match, idx) => {
          const matchedLoci = [];
          if (refProfile.loci && match.loci) {
            ANALYSIS_LOCI.forEach(locus => {
              if (ignoredLoci[locus]) return;

              const refData = refProfile.loci[locus];
              const compData = match.loci[locus];

              if (!refData || !compData) return;

              // Получаем массивы аллелей
              const getAlleles = (data) => {
                if (!data) return [];
                if (Array.isArray(data)) {
                  return data.filter(a => a && a !== '' && a !== '.' && a !== '*' && a !== '**' && a !== '?');
                }
                if (typeof data === 'object') {
                  const alleles = [];
                  if (data.allele1 && data.allele1 !== '' && data.allele1 !== '.' && data.allele1 !== '*') {
                    alleles.push(data.allele1);
                  }
                  if (data.allele2 && data.allele2 !== '' && data.allele2 !== '.' && data.allele2 !== '*') {
                    alleles.push(data.allele2);
                  }
                  return alleles;
                }
                return [];
              };

              const refAlleles = getAlleles(refData);
              const compAlleles = getAlleles(compData);

              if (refAlleles.length === 0 || compAlleles.length === 0) return;

              // Базовый алгоритм: все аллели референса должны быть в сравниваемом
              const compSet = new Set(compAlleles);
              const isMatch = refAlleles.every(a => compSet.has(a));

              if (isMatch) {
                matchedLoci.push(locus);
              }
            });
          }

          // Получаем информацию о задаче и эксперте из allProfiles
          const originalProfile = historyItem.allProfiles[idx + 1]; // +1 потому что первый - эталон

          return {
            id: match.id,
            sample_name: match.sample_name,
            internal_number: match.internal_number,
            import_number: match.import_number,
            year: match.year,
            loci: match.loci,
            matchedLoci,
            searchMode: searchMode,
            task_name: originalProfile?.task_name,
            task_owner: originalProfile?.task_owner,
            // Добавляем комментарии
            expert_comment: match.expert_comment,
            comment_updated_at: match.comment_updated_at,
            comment_updated_by: match.comment_updated_by,
            is_active: match.is_active
          };
        });

        setSearchResults(matchesWithLoci);
        setReferenceValues({
          sample_name: refProfile.sample_name,
          internal_number: refProfile.internal_number,
          import_number: refProfile.import_number || '',
          loci: {}
        });
        setActiveTab('results');
        return;
      } catch (err) {
        console.error('Error loading group profiles:', err);
        alert('Ошибка загрузки данных профилей');
        return;
      }
    }

    // Старая логика для одиночных элементов
    if (!historyItem.results || historyItem.results.length === 0) {
      alert('Нет сохраненных результатов для этого поиска');
      return;
    }

    // Проверяем, есть ли данные локусов
    const hasLoci = historyItem.results[0] && historyItem.results[0].loci;

    if (!hasLoci) {
      // Загружаем полные данные профилей по ID
      try {
        const token = localStorage.getItem('token');
        const profileIds = historyItem.results.map(r => r.id);

        // Загружаем все профили
        const response = await fetch('/api/genotype-analysis/profiles', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          const allProfiles = data.profiles;

          // Обогащаем результаты данными локусов
          const enrichedResults = historyItem.results.map(result => {
            const fullProfile = allProfiles.find(p => p.id === result.id);
            if (fullProfile) {
              return {
                ...result,
                loci: fullProfile.loci
              };
            }
            return result;
          });

          setSearchResults(enrichedResults);

          // Загружаем эталонный профиль
          const refProfile = allProfiles.find(p =>
            p.sample_name === historyItem.sample_name &&
            p.internal_number === historyItem.internal_number
          );
          setReferenceProfile(refProfile || null);
        } else {
          // Если не удалось загрузить, показываем как есть
          setSearchResults(historyItem.results);
          setReferenceProfile(null);
        }
      } catch (err) {
        console.error('Error loading full profiles:', err);
        setSearchResults(historyItem.results);
        setReferenceProfile(null);
      }
    } else {
      setSearchResults(historyItem.results);

      // Пытаемся найти эталонный профиль в загруженных данных
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/genotype-analysis/profiles', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          const refProfile = data.profiles.find(p =>
            p.sample_name === historyItem.sample_name &&
            p.internal_number === historyItem.internal_number
          );
          setReferenceProfile(refProfile || null);
        }
      } catch (err) {
        console.error('Error loading reference profile:', err);
        setReferenceProfile(null);
      }
    }

    setReferenceValues({
      sample_name: historyItem.sample_name,
      internal_number: historyItem.internal_number,
      import_number: historyItem.import_number || '',
      loci: {}
    });
    setActiveTab('results');
  };

  // Рендер компонента
  return (
    <div className="genotype-analysis-page">
      <header className="analysis-header">
        <div className="header-content">
          <h1>Анализ генотипов</h1>
          <p className="header-subtitle">
            Сравнение профилей, поиск совпадений, контроль контаминации и работа с историей анализа.
          </p>
        </div>
        <div className="header-actions">
          {selectedActiveTask?.title && (
            <div className="analysis-task-badge" title="Текущая активная задача">
              <span className="analysis-task-label">Активная задача</span>
              <strong>{selectedActiveTask.title}</strong>
            </div>
          )}
        </div>
      </header>

      {/* Панель ввода эталонных значений */}
      <div className={`input-panel ${isReferencePanelCollapsed ? 'collapsed' : ''}`}>
        <div
          className="panel-header clickable"
          onClick={() => setIsReferencePanelCollapsed(!isReferencePanelCollapsed)}
          title={isReferencePanelCollapsed ? 'Нажмите для разворачивания' : 'Нажмите для сворачивания'}
        >
          <div className="panel-title">
            <span className={`collapse-icon ${isReferencePanelCollapsed ? 'collapsed' : ''}`}>
              ▼
            </span>
            <h3>Эталонный профиль</h3>
          </div>
          <div className="panel-actions" onClick={(e) => e.stopPropagation()}>
            <button onClick={clearFields} className="btn-small btn btn-secondary btn-sm">Очистить</button>
          </div>
        </div>

        <div className={`panel-content ${isReferencePanelCollapsed ? 'collapsed' : ''}`}>
          <div className="reference-profile-picker">
            <div className="info-field">
              <label>Выбор эталонного объекта</label>
              <select
                value={selectedProfile?.id || ''}
                onChange={(e) => {
                  const nextProfile = profiles.find((profile) => profile.id === e.target.value);
                  if (nextProfile) {
                    selectProfile(nextProfile);
                  } else {
                    clearFields();
                  }
                }}
               className="form-select">
                <option value="">Выберите объект из задачи</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.sample_name || 'Без названия'}
                    {profile.internal_number ? ` | ${profile.internal_number}` : ''}
                    {profile.import_number ? ` | ${profile.import_number}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="reference-info">
            <div className="info-field">
              <label>{fieldLabel('sample_name', '№ в в\\ч')}:</label>
              <input
                type="text"
                value={referenceValues.sample_name}
                onChange={(e) => setReferenceValues(prev => ({...prev, sample_name: e.target.value}))}
                placeholder={fieldLabel('sample_name', '№ присвоенный в в/ч')}
                readOnly={!!selectedProfile}
               className="form-input"/>
            </div>
            <div className="info-field">
              <label>{fieldLabel('internal_number', '№')}:</label>
              <input
                type="text"
                value={referenceValues.internal_number}
                onChange={(e) => setReferenceValues(prev => ({...prev, internal_number: e.target.value}))}
                placeholder={fieldLabel('internal_number', 'Внутренний номер')}
                readOnly={!!selectedProfile}
               className="form-input"/>
            </div>
            <div className="info-field">
              <label>Привоз:</label>
              <input
                type="text"
                value={referenceValues.import_number}
                onChange={(e) => setReferenceValues(prev => ({...prev, import_number: e.target.value}))}
                placeholder="Номер привоза"
                readOnly={!!selectedProfile}
               className="form-input"/>
            </div>
          </div>

          <div className="loci-grid">
            {lociOrder.map(locus => (
              <div key={locus} className="locus-cell">
                <label className="locus-header">
                  <span className="locus-name">{locus}</span>
                  <input
                    type="checkbox"
                    checked={!ignoredLoci[locus]}
                    onChange={() => toggleIgnoreLocus(locus)}
                    className="locus-checkbox"
                  />
                </label>
                <input
                  type="text"
                  value={referenceValues.loci[locus] || ''}
                  onChange={(e) => handleLocusChange(locus, e.target.value)}
                  placeholder="12,13"
                  disabled={ignoredLoci[locus]}
                  className={ignoredLoci[locus] ? 'disabled' : ''}
                />
              </div>
            ))}
          </div>

          {/* Кнопка сброса порядка колонок */}
          <div className="panel-footer-actions">
            <button
              onClick={() => {
                resetBaseColumnsOrder();
                resetLociOrder();
              }}
              className="btn btn-secondary btn-sm"
              title="Вернуть исходный порядок всех колонок"
            >
              🔄 Сбросить порядок колонок
            </button>
          </div>
        </div>
      </div>

      {/* Кнопки действий */}
      <div className="action-buttons">
        <button
          onClick={performSearch}
          disabled={searching}
          className="btn btn-primary search-action-button search-action-button-primary"
        >
          {searching ? 'Поиск...' : 'Поиск'}
        </button>
        <button
          onClick={performTaskSearch}
          disabled={searching}
          className="btn btn-primary search-action-button"
        >
          Искать внутри задачи
        </button>
        <button
          onClick={performMasterArraySearch}
          disabled={searching}
          className="btn btn-primary search-action-button"
        >
          Искать в мастер массиве
        </button>
        <button
          onClick={performDepartmentTasksSearch}
          disabled={searching}
          className="btn btn-primary search-action-button"
          title="Поиск дубликатов в активных задачах других пользователей отдела"
        >
          Искать в задачах отдела
        </button>
        <div className="action-split-button">
          <div className="action-split-button-group">
            <button
              onClick={performContaminationSearch}
              disabled={searching}
              className="btn btn-warning action-split-main search-action-button search-action-button-warning"
              title="Поиск контаминаций сотрудников (алгоритм v4.0)"
            >
              {searching ? 'Контаминация...' : 'Поиск контаминаций'}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowContaminationSettings(true);
              }}
              className="btn btn-warning action-split-toggle"
              title="Настройки алгоритма контаминации"
            >
              ⚙
            </button>
          </div>
        </div>
        <button
          onClick={performFullSearch}
          disabled={searching}
          className="btn btn-primary btn-full-search search-action-button search-action-button-full"
          title="Полный поиск: дубликаты + мастер массив + контаминация"
        >
          {searching ? 'Полный поиск...' : 'Полный поиск'}
        </button>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowSettings(true);
          }}
          className="btn btn-secondary search-action-button search-action-button-secondary"
          title="Настройки параметров поиска"
        >
          Настройки поиска
        </button>
      </div>

      {/* Ошибки */}
      {error && (
        <div className="error-message">
          ❌ {error}
        </div>
      )}

      {/* Вкладки */}
      <div className="tabs analysis-tabs-shell">
        <div className="analysis-tabs-list">
          <button
            className={`tab ${activeTab === 'data' ? 'active' : ''}`}
            onClick={() => setActiveTab('data')}
          >
            📊 Данные из БД ({filteredProfiles.length})
          </button>
          <button
            className={`tab ${activeTab === 'results' ? 'active' : ''}`}
            onClick={() => setActiveTab('results')}
          >
            ✅ Результаты сравнения ({searchResults.length})
          </button>
          <button
            className={`tab ${activeTab === 'contamination-details' ? 'active' : ''}`}
            onClick={() => setActiveTab('contamination-details')}
            hidden={!contaminationDetails}
          >
            🔬 Детали контаминации
          </button>
          <button
            className={`tab ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            📜 История ({searchHistory.length})
          </button>
        </div>

        {/* Фильтры для вкладки "Данные из БД" */}
        {activeTab === 'data' && (
          <div className="analysis-tab-filters">
            {/* Чекбокс: Только с комментариями */}
            <button
              className={`tab tab-filter ${showOnlyWithComments ? 'active' : ''}`}
              onClick={() => setShowOnlyWithComments(!showOnlyWithComments)}
              title="Показать только профили с комментариями"
            >
              <input
                type="checkbox"
                checked={showOnlyWithComments}
                onChange={() => {}}
                className="tab-filter-checkbox"
              />
              <span className="tab-filter-label">
                💬 С комментариями
                {showOnlyWithComments && withCommentsCount > 0 && (
                  <span className="tab-filter-count">
                    ({withCommentsCount})
                  </span>
                )}
              </span>
            </button>

            {/* Чекбокс: Скрыть деактивированные */}
            <button
              className={`tab tab-filter ${hideDeactivated ? 'active' : ''}`}
              onClick={() => setHideDeactivated(!hideDeactivated)}
              title="Скрыть деактивированные профили"
            >
              <input
                type="checkbox"
                checked={hideDeactivated}
                onChange={() => {}}
                className="tab-filter-checkbox"
              />
              <span className="tab-filter-label">
                🚫 Скрыть деактивированные
                {hideDeactivated && deactivatedCount > 0 && (
                  <span className="tab-filter-count">
                    ({deactivatedCount})
                  </span>
                )}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Контент вкладок */}
      <div className="tab-content">
        {/* Вкладка: Данные из БД */}
        {activeTab === 'data' && (
          <div className="virtualized-wrapper">
            {loading ? (
              <div className="loading">⏳ Загрузка профилей...</div>
            ) : (
                <div
                  className="data-table-container"
                  ref={tableContainerRef}
                  onScroll={handleScroll}
                  tabIndex={0}
                  role="region"
                  aria-label="Профили активной задачи: прокручиваемая таблица"
                >
                  <table className="data-table" style={{ minWidth: `${tableMinWidth}px` }} aria-rowcount={filteredProfiles.length + 1}>
                    <colgroup>
                      {baseColumnsOrder.map(column => <col key={column.key} style={{ width: `${PROFILE_COLUMN_WIDTHS[column.key]}px` }} />)}
                      {activeLoci.map(locus => <col key={locus} style={{ width: `${LOCUS_COLUMN_WIDTH}px` }} />)}
                      <col style={{ width: `${ACTIONS_COLUMN_WIDTH}px` }} />
                    </colgroup>
                    <thead>
                      <tr style={{ height: `${HEADER_HEIGHT}px` }}>
                        {baseColumnsOrder.map(column => (
                          <th
                            key={column.key}
                            scope="col"
                            data-column={column.key}
                            draggable="true"
                            onDragStart={(e) => handleColumnDragStart(e, column.key)}
                            onDragEnd={handleColumnDragEnd}
                            onDragOver={(e) => handleColumnDragOver(e, column.key)}
                            onDragLeave={(e) => handleColumnDragLeave(e, column.key)}
                            onDrop={(e) => handleColumnDrop(e, column.key)}
                            className={`drag-header-cell ${dragOverColumn === column.key ? 'is-drag-target' : ''}`}
                            title="Перетащите для изменения порядка"
                          >
                            {fieldLabel(column.key, column.label)}
                          </th>
                        ))}
                        {activeLoci.map(locus => (
                          <th
                            key={locus}
                            scope="col"
                            data-column={locus}
                            draggable="true"
                            onDragStart={(e) => handleDragStart(e, locus)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => handleDragOver(e, locus)}
                            onDragLeave={(e) => handleDragLeave(e, locus)}
                            onDrop={(e) => handleDrop(e, locus)}
                            className={`drag-header-cell ${dragOverLocus === locus ? 'is-drag-target' : ''}`}
                            title="Перетащите для изменения порядка"
                          >
                            {locus}
                          </th>
                        ))}
                        <th data-column="actions" scope="col" className="table-actions-cell">
                          Действия
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {offsetY > 0 && <tr className="data-table-spacer" aria-hidden="true"><td colSpan={tableColumnCount} style={{ height: `${offsetY}px` }} /></tr>}
                      {visibleProfiles.map((profile, idx) => {
                        const isSelected = selectedProfile?.id === profile.id;
                        const isPrevious = previousProfile?.id === profile.id;
                        const isDeactivated = profile.is_active === false;

                        return (
                          <tr
                            key={profile.id}
                            aria-rowindex={startIndex + idx + 2}
                            onClick={() => selectProfile(profile)}
                            className={
                              isDeactivated ? 'deactivated' :
                              isSelected ? 'selected' :
                              isPrevious ? 'previous' : ''
                            }
                            style={{ height: `${ROW_HEIGHT}px` }}
                          >
                            {baseColumnsOrder.map(column => {
                              let value = '';
                              switch(column.key) {
                                case 'year':
                                  value = profile.year || '';
                                  break;
                                case 'sample_name':
                                  value = profile.sample_name;
                                  break;
                                case 'internal_number':
                                  value = profile.internal_number;
                                  break;
                                case 'import_number':
                                  value = profile.import_number || '';
                                  break;
                              }
                              return <td key={column.key} data-column={column.key} title={String(value ?? '')}>{value}</td>;
                            })}
                            {activeLoci.map(locus => {
                              // Проверяем совпадение с эталоном если он выбран
                              let cellClass = '';
                              let cellStyle = {};
                              if (selectedProfile && selectedProfile.id !== profile.id && referenceValues.loci[locus]) {
                                const refValue = referenceValues.loci[locus];
                                const profileValue = formatLocusValue(profile.loci ? profile.loci[locus] : null);

                                if (refValue && profileValue) {
                                  // Нормализуем значения для сравнения
                                  const refNormalized = refValue.split(',').sort().join(',');
                                  const profileNormalized = profileValue.split(',').sort().join(',');

                                  if (refNormalized === profileNormalized) {
                                    cellClass = 'matched';
                                    // Применяем цвет из настроек
                                    cellStyle = {
                                      background: contaminationSettings.colors?.fullMatch || '#90EE90',
                                      fontWeight: 600
                                    };
                                  }
                                }
                              }

                              return (
                                <td key={locus} data-column={locus} className={cellClass} style={cellStyle} title={profile.loci ? formatLocusValue(profile.loci[locus]) : ''}>
                                  {profile.loci ? formatLocusValue(profile.loci[locus]) : ''}
                                </td>
                              );
                            })}
                            <td data-column="actions" className="table-actions-cell">
                              <ProfileActionButtons
                                profile={profile}
                                onToggleActive={handleToggleActive}
                                onOpenComment={handleOpenCommentModal}
                              />
                            </td>
                          </tr>
                        );
                      })}
                      {remainingHeight > 0 && <tr className="data-table-spacer" aria-hidden="true"><td colSpan={tableColumnCount} style={{ height: `${remainingHeight}px` }} /></tr>}
                      {filteredProfiles.length === 0 && <tr className="data-table-empty"><td colSpan={tableColumnCount}>Нет профилей для отображения.</td></tr>}
                    </tbody>
                    </table>
                </div>
            )}
          </div>
        )}

        {/* Вкладка: Результаты сравнения */}
        {activeTab === 'results' && (
          <div className="results-container">
            {searchResults.length === 0 ? (
              <div className="no-results">
                Нет результатов. Выполните поиск.
              </div>
            ) : (
              <>
                <div className="results-header">
                  <h3>Найдено совпадений: {searchResults.length}</h3>
                  <div className="reference-row">
                    <strong>Эталон:</strong>
                    <span>{referenceValues.sample_name}</span>
                    <span>({referenceValues.internal_number})</span>
                    <span>{referenceValues.import_number}</span>
                  </div>
                  {searchResults.length > 0 && searchResults[0] && !searchResults[0].loci && !referenceProfile?.loci && (
                    <div className="analysis-warning-inline">
                      ⚠️ Это старые результаты без данных локусов. Выполните новый массовый поиск для получения полных данных.
                    </div>
                  )}
                </div>

                <table className="results-table">
                  <thead>
                    <tr>
                      <th>Год</th>
                      <th>Привоз</th>
                      <th>{fieldLabel('sample_name', '№ в в\\ч')}</th>
                      <th>{fieldLabel('internal_number', '№')}</th>
                      {searchResults.length > 0 && searchResults[0].searchMode === 'department_tasks' && (
                        <>
                          <th>Задача</th>
                          <th>Эксперт</th>
                        </>
                      )}
                      {activeLoci.map(locus => (
                        <th
                          key={locus}
                          className={`drag-header-cell${dragOverLocus === locus ? ' is-drag-target' : ''}`}
                          draggable="true"
                          onDragStart={(e) => handleDragStart(e, locus)}
                          onDragEnd={handleDragEnd}
                          onDragOver={(e) => handleDragOver(e, locus)}
                          onDragLeave={(e) => handleDragLeave(e, locus)}
                          onDrop={(e) => handleDrop(e, locus)}
                          title="Перетащите для изменения порядка"
                        >
                          {locus}
                        </th>
                      ))}
                      <th className="results-table-actions">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Эталонный профиль - первая строка */}
                    {referenceProfile && (
                      <tr className="results-table-reference-row">
                        <td>{referenceProfile.year || 'N/A'}</td>
                        <td>{referenceProfile.import_number || ''}</td>
                        <td>{referenceProfile.sample_name}</td>
                        <td>{referenceProfile.internal_number}</td>
                        {searchResults.length > 0 && searchResults[0].searchMode === 'department_tasks' && (
                          <>
                            <td>Текущая задача</td>
                            <td>-</td>
                          </>
                        )}
                        {activeLoci.map(locus => {
                          // Проверяем есть ли этот локус в совпадениях хотя бы у одного результата
                          const isMatchedInAny = searchResults.some(result =>
                            result.matchedLoci && result.matchedLoci.includes(locus)
                          );

                          return (
                            <td
                              key={locus}
                              className={isMatchedInAny ? 'matched reference-locus-match' : ''}
                              style={
                                isMatchedInAny
                                  ? { '--reference-match-bg': contaminationSettings.colors?.fullMatch || '#90EE90' }
                                  : undefined
                              }
                            >
                              {formatLocusValue(referenceProfile.loci ? referenceProfile.loci[locus] : null)}
                            </td>
                          );
                        })}
                        <td>
                          <ProfileActionButtons
                            profile={referenceProfile}
                            onToggleActive={handleToggleActive}
                            onOpenComment={handleOpenCommentModal}
                          />
                        </td>
                      </tr>
                    )}

                    {/* Блок с комментарием для эталонного профиля */}
                    {referenceProfile && referenceProfile.expert_comment && (
                      <tr className="comment-row">
                        <td colSpan={activeLoci.length + (searchResults.length > 0 && searchResults[0].searchMode === 'department_tasks' ? 7 : 5)} className="comment-cell">
                          <div className="result-comment-block">
                            <div className="comment-icon">💬</div>
                            <div className="comment-content">
                              <div className="comment-header">
                                <strong>Комментарий:</strong>
                                {referenceProfile.comment_updated_at && (
                                  <span className="comment-meta">
                                    {referenceProfile.comment_updated_at}
                                  </span>
                                )}
                              </div>
                              <div className="comment-text">{referenceProfile.expert_comment}</div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Совпадения */}
                    {searchResults.map((result, idx) => {
                      // Сначала создаём базовый объект из result (он может содержать обновлённый комментарий)
                      let profileForActions = {
                        id: result.id,
                        sample_name: result.sample_name,
                        internal_number: result.internal_number,
                        year: result.year,
                        import_number: result.import_number,
                        is_active: result.is_active !== false,
                        expert_comment: result.expert_comment,
                        comment_updated_at: result.comment_updated_at,
                        comment_updated_by: result.comment_updated_by
                      };

                      // Ищем профиль в загруженных данных для дополнительной информации
                      const loadedProfile = profiles.find(p =>
                        (p.internal_number && p.internal_number === result.internal_number) ||
                        (p.sample_name && p.sample_name === result.sample_name)
                      );

                      // Если нашли в загруженных, дополняем данными (но комментарий берём из result)
                      if (loadedProfile) {
                        profileForActions = {
                          ...loadedProfile,
                          ...profileForActions, // Перезаписываем комментарий из result
                          _isTemporary: false
                        };
                      } else if (!result.id) {
                        profileForActions._isTemporary = true;
                        profileForActions.id = `temp-${result.sample_name}-${result.internal_number}`;
                      }

                      return (
                        <React.Fragment key={idx}>
                          <tr className={profileForActions && !profileForActions.is_active ? 'deactivated-row' : ''}>
                            <td>{result.year || 'N/A'}</td>
                            <td>{result.import_number || 'N/A'}</td>
                            <td>{result.sample_name || 'N/A'}</td>
                            <td>{result.internal_number || 'N/A'}</td>
                            {result.searchMode === 'department_tasks' && (
                              <>
                                <td title={result.task_name}>{result.task_name || 'N/A'}</td>
                                <td>{result.task_owner || 'N/A'}</td>
                              </>
                            )}
                            {activeLoci.map(locus => {
                              const isMatched = result.matchedLoci && result.matchedLoci.includes(locus);
                              const refLocusData = referenceProfile?.loci ? referenceProfile.loci[locus] : null;
                              const compLocusData = result.loci ? result.loci[locus] : null;

                              // Определяем тип совпадения для фона
                              let cellClass = '';
                              let isPartialMatch = false;

                              if (refLocusData && compLocusData) {
                                // Получаем аллели
                                const getAlleles = (data) => {
                                  if (!data) return [];
                                  if (Array.isArray(data)) {
                                    return data.filter(a => a && a !== '' && a !== '.' && a !== '*' && a !== '**' && a !== '?');
                                  }
                                  // Поддержка старого формата
                                  if (typeof data === 'object') {
                                    const alleles = [];
                                    if (data.allele1 && data.allele1 !== '' && data.allele1 !== '.' && data.allele1 !== '*') {
                                      alleles.push(data.allele1);
                                    }
                                    if (data.allele2 && data.allele2 !== '' && data.allele2 !== '.' && data.allele2 !== '*') {
                                      alleles.push(data.allele2);
                                    }
                                    return alleles;
                                  }
                                  return [];
                                };

                                const refAlleles = getAlleles(refLocusData);
                                const compAlleles = getAlleles(compLocusData);

                                if (refAlleles.length > 0 && compAlleles.length > 0) {
                                  // Проверяем полное совпадение: массивы должны быть идентичны
                                  const refSorted = [...refAlleles].sort().join(',');
                                  const compSorted = [...compAlleles].sort().join(',');

                                  if (refSorted === compSorted) {
                                    // Полное совпадение - аллели идентичны
                                    if (isMatched) {
                                      cellClass = 'matched';
                                    }
                                  } else {
                                    // Проверяем частичное совпадение (контаминация)
                                    // Контаминация: есть совпадающие аллели, но не все
                                    const refSet = new Set(refAlleles);
                                    const compSet = new Set(compAlleles);

                                    // Считаем совпадающие аллели
                                    let matchingCount = 0;
                                    for (const allele of refAlleles) {
                                      if (compSet.has(allele)) {
                                        matchingCount++;
                                      }
                                    }

                                    // Если есть хотя бы одно совпадение, это контаминация
                                    if (matchingCount > 0) {
                                      cellClass = 'matched-contamination';
                                      isPartialMatch = true;
                                    } else {
                                      // Полное несовпадение - нет ни одного совпадающего аллеля
                                      cellClass = 'no-match';
                                    }
                                  }
                                }
                              }

                              return (
                                <td
                                  key={locus}
                                  className={`results-locus-cell${cellClass ? ` ${cellClass}` : ''}`}
                                  style={
                                    cellClass === 'matched'
                                      ? { '--results-locus-bg': contaminationSettings.colors?.fullMatch || '#90EE90' }
                                      : cellClass === 'matched-contamination'
                                        ? { '--results-locus-bg': contaminationSettings.colors?.partialMatch || '#9d8311' }
                                        : cellClass === 'no-match'
                                          ? { '--results-locus-bg': contaminationSettings.colors?.noMatch || '#FFB6C1' }
                                          : undefined
                                  }
                                >
                                  {isPartialMatch ?
                                    formatLocusWithHighlight(compLocusData, refLocusData) :
                                    formatLocusValue(compLocusData)
                                  }
                                </td>
                              );
                            })}
                            <td>
                              {profileForActions && (
                                <ProfileActionButtons
                                  profile={profileForActions}
                                  onToggleActive={handleToggleActive}
                                  onOpenComment={handleOpenCommentModal}
                                />
                              )}
                            </td>
                          </tr>

                          {/* Блок с комментарием под строкой */}
                          {profileForActions && profileForActions.expert_comment && (
                            <tr className="comment-row">
                              <td colSpan={activeLoci.length + (result.searchMode === 'department_tasks' ? 7 : 5)} className="comment-cell">
                                <div className="result-comment-block">
                                  <div className="comment-icon">💬</div>
                                  <div className="comment-content">
                                    <div className="comment-header">
                                      <strong>Комментарий:</strong>
                                      {profileForActions.comment_updated_at && (
                                        <span className="comment-meta">
                                          {profileForActions.comment_updated_at}
                                        </span>
                                      )}
                                    </div>
                                    <div className="comment-text">{profileForActions.expert_comment}</div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
        {/* Вкладка: Детали контаминации */}
        {activeTab === 'contamination-details' && contaminationDetails && (
          <div className="contamination-details-tab">
            <h2>📊 Результаты анализа контаминации</h2>

            {/* Образец и Сотрудник в одной секции (две колонки) */}
            <div className="contamination-section two-columns">
              <div className="column">
                <h3>🧬 Образец</h3>
                <div className="section-divider"></div>
                <p><strong>{fieldLabel('sample_name', '№ в в\\ч')}:</strong> {contaminationDetails.sample.sample_name}</p>
                <p><strong>{fieldLabel('internal_number', 'Номер')}:</strong> {contaminationDetails.sample.internal_number}</p>
                <p><strong>Привоз:</strong> {contaminationDetails.sample.import_number || 'N/A'}</p>
                {contaminationDetails.sample.year && (
                  <p><strong>Год:</strong> {contaminationDetails.sample.year}</p>
                )}
              </div>

              <div className="column-divider"></div>

              <div className="column">
                <h3>👤 Сотрудник</h3>
                <div className="section-divider"></div>
                <p><strong>ФИО:</strong> {contaminationDetails.staff.full_name}</p>
              </div>
            </div>

            {/* Результаты сравнения */}
            <div className="contamination-section">
              <h3>📈 Результаты сравнения</h3>
              <div className="section-divider"></div>
              <p><strong>Балл совпадения:</strong> {typeof contaminationDetails.matchScore === 'number' ? contaminationDetails.matchScore.toFixed(1) : contaminationDetails.matchScore} / 30</p>
              <p><strong>Совпавшие локусы:</strong> {contaminationDetails.matchedLoci.length} / 24</p>

              {/* Критические аллели с разделением по ценности */}
              {contaminationDetails.detailedMatches && contaminationDetails.detailedMatches.length > 0 && (() => {
                const strongCritical = contaminationDetails.detailedMatches.filter(m => m.isStrongCritical);
                const normalCritical = contaminationDetails.detailedMatches.filter(m => m.isCritical && !m.isStrongCritical);

                return (
                  <div className="critical-alleles-section">
                    <p className="critical-alleles-heading"><strong>Критические аллели:</strong></p>
                    <div className="critical-alleles-container">
                      {strongCritical.length > 0 && (
                        <div className="critical-alleles-group strong">
                          <span className="critical-alleles-label">🔴 Сильные критические ({strongCritical.length}):</span>
                          <div className="critical-alleles-list">
                            {strongCritical.map((match, idx) => (
                              <span key={idx} className="critical-allele-badge strong">
                                {match.locus}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {normalCritical.length > 0 && (
                        <div className="critical-alleles-group normal">
                          <span className="critical-alleles-label">🟡 Обычные критические ({normalCritical.length}):</span>
                          <div className="critical-alleles-list">
                            {normalCritical.map((match, idx) => (
                              <span key={idx} className="critical-allele-badge normal">
                                {match.locus}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {strongCritical.length === 0 && normalCritical.length === 0 && (
                        <p className="critical-alleles-empty">Критических аллелей не обнаружено</p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Таблица совпадающих локусов */}
              {contaminationDetails.detailedMatches && contaminationDetails.detailedMatches.length > 0 && (
                <details className="detailed-matches" open>
                  <summary>Детальное совпадение по локусам ({contaminationDetails.detailedMatches.length})</summary>
                  <div className="matches-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Локус</th>
                          <th>Образец</th>
                          <th>Сотрудник</th>
                          <th>Совпадение</th>
                          <th>Вес локуса</th>
                          <th>Коэфф.</th>
                          <th>Балл</th>
                          <th>Тип</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...contaminationDetails.detailedMatches].sort((a, b) => {
                          const indexA = ANALYSIS_LOCI.indexOf(a.locus);
                          const indexB = ANALYSIS_LOCI.indexOf(b.locus);
                          return indexA - indexB;
                        }).map((match, idx) => (
                          <tr
                            key={idx}
                            className={
                              match.isStrongCritical ? 'strong-critical-row' :
                              match.isCritical ? 'critical-row' : ''
                            }
                          >
                            <td><strong>{match.locus}</strong></td>
                            <td>{match.sampleAlleles && match.sampleAlleles.length > 0 ? match.sampleAlleles.join(', ') : '—'}</td>
                            <td>{match.staffAlleles && match.staffAlleles.length > 0 ? match.staffAlleles.join(', ') : '—'}</td>
                            <td className="match-alleles">
                              {match.explainedAlleles && match.explainedAlleles.length > 0 ? match.explainedAlleles.join(', ') : '—'}
                            </td>
                            <td><strong>{match.locusWeight ? match.locusWeight.toFixed(1) : '1.0'}</strong></td>
                            <td>{match.matchCoeff ? match.matchCoeff.toFixed(1) : '0.0'}</td>
                            <td><strong>{match.locusScore || '0.0'}</strong></td>
                            <td>
                              {match.isStrongCritical && <span className="badge strong-critical">Сильный критический</span>}
                              {match.isCritical && !match.isStrongCritical && <span className="badge critical">Критический</span>}
                              {match.isFullMatch && <span className="badge full-match">Полное совпадение</span>}
                              {!match.isCritical && !match.isFullMatch && <span className="badge normal">Обычный</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          </div>
        )}

        {/* Вкладка: История */}
        {activeTab === 'history' && (
          <div className="history-container">
            {searchHistory.length === 0 ? (
              <div className="no-results">
                История пуста. Выполните поиск.
              </div>
            ) : (
              <div className="history-scroll">
                <div className="history-toolbar">
                  <h3 className="history-toolbar-title">История ({groupHistoryByGenotype(enrichHistoryWithComments(searchHistory)).filter(g => g.matchCount > 0).length} групп)</h3>
                  <button
                    onClick={() => {
                      if (confirm('Очистить всю историю поиска?')) {
                        setSearchHistory([]);
                      }
                    }}
                    className="btn btn-danger btn-sm"
                  >
                    🗑️ Очистить историю
                  </button>
                </div>

                {/* Группируем по типу поиска */}
                {(() => {
                  // Проверяем есть ли результаты полного поиска
                  const hasFullSearchResults = searchHistory.some(item => item.fullSearchGroup);

                  if (hasFullSearchResults) {
                    // Обогащаем историю актуальными комментариями из БД
                    const enrichedHistory = enrichHistoryWithComments(searchHistory);

                    // Группируем результаты полного поиска
                    const taskGroups = groupHistoryByGenotype(enrichedHistory.filter(item => item.fullSearchGroup === 'task')).filter(g => g.matchCount > 0);
                    const masterGroups = groupHistoryByGenotype(enrichedHistory.filter(item => item.fullSearchGroup === 'master')).filter(g => g.matchCount > 0);
                    const contaminationGroups = enrichedHistory
                      .filter(item => item.fullSearchGroup === 'contamination')
                      .sort((a, b) => {
                        // Сортируем по баллу от большего к меньшему
                        const scoreA = typeof a.matchScore === 'number' ? a.matchScore : 0;
                        const scoreB = typeof b.matchScore === 'number' ? b.matchScore : 0;
                        return scoreB - scoreA;
                      });

                    return (
                      <>
                        {/* Группа 1: Совпадения в данной задаче */}
                        {taskGroups.length > 0 && (
                          <div className="history-group">
                            <h3 className="history-group-title">Совпадения в данной задаче</h3>
                            <div className="history-group-divider"></div>
                            <div className="history-grid">
                              {taskGroups.map((group, idx) => {
                                const matchCount = group.matchCount;

                                return (
                                  <div
                                    key={idx}
                                    className="history-card"
                                    onClick={() => restoreFromHistory(group)}
                                  >
                                    <div className="history-card-header">
                                      <strong>
                                        {group.isGroup
                                          ? `Группа из ${group.allProfiles.length} профилей`
                                          : `${group.sample_name}${group.internal_number ? ` | ${group.internal_number}` : ''}`
                                        }
                                      </strong>
                                      <span className="match-badge">
                                        {matchCount}
                                      </span>
                                    </div>
                                    <div className="history-card-body">
                                      <table className="history-data-table">
                                        <thead>
                                          <tr>
                                            <th>Год</th>
                                            <th>Привоз</th>
                                            <th>{fieldLabel('sample_name', '№ в в/ч')}</th>
                                            <th>{fieldLabel('internal_number', '№')}</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {group.allProfiles.map((profile, pIdx) => (
                                            <tr key={pIdx}>
                                              <td>{profile.year || '—'}</td>
                                              <td>{profile.import_number || '—'}</td>
                                              <td>{profile.sample_name || '—'}</td>
                                              <td>{profile.internal_number || '—'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                    <div className="timestamp">
                                      {new Date(group.timestamp).toLocaleString('ru-RU', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit'
                                      })}
                                    </div>

                                    {/* Комментарий эксперта */}
                                    {group.allProfiles.some(p => p.expert_comment) && (
                                      <div className="history-card-comment">
                                        <div className="comment-icon">💬</div>
                                        <div className="comment-text">
                                          {group.allProfiles
                                            .filter(p => p.expert_comment)
                                            .map((p, cIdx) => (
                                              <div key={cIdx} className="comment-item">
                                                <strong>{p.internal_number || p.sample_name}:</strong> {p.expert_comment}
                                              </div>
                                            ))
                                          }
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Группа 2: Совпадения с мастер массивом */}
                        {masterGroups.length > 0 && (
                          <div className="history-group">
                            <h3 className="history-group-title">Совпадения с мастер массивом</h3>
                            <div className="history-group-divider"></div>
                            <div className="history-grid">
                              {masterGroups.map((group, idx) => {
                                const matchCount = group.matchCount;

                                return (
                                  <div
                                    key={idx}
                                    className="history-card"
                                    onClick={() => restoreFromHistory(group)}
                                  >
                                    <div className="history-card-header">
                                      <strong>
                                        {group.isGroup
                                          ? `Группа из ${group.allProfiles.length} профилей`
                                          : `${group.sample_name}${group.internal_number ? ` | ${group.internal_number}` : ''}`
                                        }
                                      </strong>
                                      <span className="match-badge">
                                        {matchCount}
                                      </span>
                                    </div>
                                    <div className="history-card-body">
                                      <table className="history-data-table">
                                        <thead>
                                          <tr>
                                            <th>Год</th>
                                            <th>Привоз</th>
                                            <th>{fieldLabel('sample_name', '№ в в/ч')}</th>
                                            <th>{fieldLabel('internal_number', '№')}</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {group.allProfiles.map((profile, pIdx) => (
                                            <tr key={pIdx}>
                                              <td>{profile.year || '—'}</td>
                                              <td>{profile.import_number || '—'}</td>
                                              <td>{profile.sample_name || '—'}</td>
                                              <td>{profile.internal_number || '—'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                    <div className="timestamp">
                                      {new Date(group.timestamp).toLocaleString('ru-RU', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit'
                                      })}
                                    </div>

                                    {/* Комментарий эксперта */}
                                    {group.allProfiles.some(p => p.expert_comment) && (
                                      <div className="history-card-comment">
                                        <div className="comment-icon">💬</div>
                                        <div className="comment-text">
                                          {group.allProfiles
                                            .filter(p => p.expert_comment)
                                            .map((p, cIdx) => (
                                              <div key={cIdx} className="comment-item">
                                                <strong>{p.internal_number || p.sample_name}:</strong> {p.expert_comment}
                                              </div>
                                            ))
                                          }
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Группа 3: Контаминация сотрудниками */}
                        {contaminationGroups.length > 0 && (
                          <div className="history-group">
                            <h3 className="history-group-title">Контаминация сотрудниками</h3>
                            <div className="history-group-divider"></div>
                            <div className="history-grid">
                              {contaminationGroups.map((item, idx) => {
                                return (
                                  <div
                                    key={idx}
                                    className="history-card staff-contamination-card"
                                    onClick={() => {
                                      // Автоматически сворачиваем эталонный профиль для удобства
                                      const panelElement = document.querySelector('.input-panel');

                                      // Добавляем класс анимации
                                      if (panelElement) {
                                        panelElement.classList.add('auto-collapsing');
                                        setTimeout(() => {
                                          panelElement.classList.remove('auto-collapsing');
                                        }, 600);
                                      }

                                      // Сворачиваем панель
                                      setIsReferencePanelCollapsed(true);

                                      // Плавная прокрутка к панели после небольшой задержки
                                      setTimeout(() => {
                                        if (panelElement) {
                                          panelElement.scrollIntoView({
                                            behavior: 'smooth',
                                            block: 'start'
                                          });
                                        }
                                      }, 100);

                                      // Устанавливаем детальные данные контаминации
                                      setContaminationDetails({
                                        sample: {
                                          sample_name: item.sample_name,
                                          internal_number: item.internal_number,
                                          import_number: item.import_number,
                                          year: item.year
                                        },
                                        staff: {
                                          full_name: item.staffProfile.full_name
                                        },
                                        matchScore: item.matchScore,
                                        matchedLoci: item.matchedLoci,
                                        detailedMatches: item.detailedMatches,
                                        criticalAlleles: item.criticalAlleles
                                      });
                                      // Переключаемся на вкладку контаминации
                                      setActiveTab('contamination-details');
                                    }}
                                  >
                                    <div className="history-card-header">
                                      <strong>👤 {item.staffProfile.full_name}</strong>
                                    </div>
                                    <div className="history-card-body">
                                      <p><strong>{fieldLabel('sample_name', '№ в в\\ч')}:</strong> {item.sample_name}</p>
                                      <p><strong>{fieldLabel('internal_number', 'Номер')}:</strong> {item.internal_number}</p>
                                      <p><strong>Привоз:</strong> {item.import_number || 'N/A'}</p>
                                      <p><strong>Балл:</strong> {typeof item.matchScore === 'number' ? item.matchScore.toFixed(1) : item.matchScore} / 30</p>
                                    </div>
                                    <div className="timestamp">
                                      {new Date(item.timestamp).toLocaleString('ru-RU', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit'
                                      })}
                                    </div>

                                    {/* Комментарий эксперта */}
                                    {item.expert_comment && (
                                      <div className="history-card-comment">
                                        <div className="comment-icon">💬</div>
                                        <div className="comment-text">
                                          <div className="comment-item">
                                            <strong>{item.internal_number || item.sample_name}:</strong> {item.expert_comment}
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  } else {
                    // Обогащаем историю актуальными комментариями из БД
                    const enrichedHistory = enrichHistoryWithComments(searchHistory);

                    // Группируем по типу поиска (searchMode)
                    const taskGroups = groupHistoryByGenotype(enrichedHistory.filter(item => item.searchMode === 'task')).filter(g => g.matchCount > 0);
                    const masterGroups = groupHistoryByGenotype(enrichedHistory.filter(item => item.searchMode === 'master_array')).filter(g => g.matchCount > 0);
                    const departmentGroups = groupHistoryByGenotype(enrichedHistory.filter(item => item.searchMode === 'department_tasks')).filter(g => g.matchCount > 0);

                    return (
                      <>
                        {/* Группа 1: Поиск внутри задачи */}
                        {taskGroups.length > 0 && (
                          <div className="history-group">
                            <h3 className="history-group-title">🔄 Поиск внутри задачи</h3>
                            <div className="history-group-divider"></div>
                            <div className="history-grid">
                              {taskGroups.map((group, idx) => {
                                const matchCount = group.matchCount;

                                return (
                                  <div
                                    key={idx}
                                    className="history-card"
                                    onClick={() => restoreFromHistory(group)}
                                  >
                                    <div className="history-card-header">
                                      <strong>
                                        {group.isGroup
                                          ? `Группа из ${group.allProfiles.length} профилей`
                                          : `${group.sample_name}${group.internal_number ? ` | ${group.internal_number}` : ''}`
                                        }
                                      </strong>
                                      <span className="match-badge">
                                        {matchCount}
                                      </span>
                                    </div>
                                    <div className="history-card-body">
                                      <table className="history-data-table">
                                        <thead>
                                          <tr>
                                            <th>Год</th>
                                            <th>Привоз</th>
                                            <th>{fieldLabel('sample_name', '№ в в/ч')}</th>
                                            <th>{fieldLabel('internal_number', '№')}</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {group.allProfiles.map((profile, pIdx) => (
                                            <tr key={pIdx}>
                                              <td>{profile.year || '—'}</td>
                                              <td>{profile.import_number || '—'}</td>
                                              <td>{profile.sample_name || '—'}</td>
                                              <td>{profile.internal_number || '—'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                    <div className="timestamp">
                                      {new Date(group.timestamp).toLocaleString('ru-RU', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit'
                                      })}
                                    </div>

                                    {/* Комментарий эксперта */}
                                    {group.allProfiles.some(p => p.expert_comment) && (
                                      <div className="history-card-comment">
                                        <div className="comment-icon">💬</div>
                                        <div className="comment-text">
                                          {group.allProfiles
                                            .filter(p => p.expert_comment)
                                            .map((p, cIdx) => (
                                              <div key={cIdx} className="comment-item">
                                                <strong>{p.internal_number || p.sample_name}:</strong> {p.expert_comment}
                                              </div>
                                            ))
                                          }
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Группа 2: Поиск в мастер массиве */}
                        {masterGroups.length > 0 && (
                          <div className="history-group">
                            <h3 className="history-group-title">🗄️ Поиск в мастер массиве</h3>
                            <div className="history-group-divider"></div>
                            <div className="history-grid">
                              {masterGroups.map((group, idx) => {
                                const matchCount = group.matchCount;

                                return (
                                  <div
                                    key={idx}
                                    className="history-card"
                                    onClick={() => restoreFromHistory(group)}
                                  >
                                    <div className="history-card-header">
                                      <strong>
                                        {group.isGroup
                                          ? `Группа из ${group.allProfiles.length} профилей`
                                          : `${group.sample_name}${group.internal_number ? ` | ${group.internal_number}` : ''}`
                                        }
                                      </strong>
                                      <span className="match-badge">
                                        {matchCount}
                                      </span>
                                    </div>
                                    <div className="history-card-body">
                                      <table className="history-data-table">
                                        <thead>
                                          <tr>
                                            <th>Год</th>
                                            <th>Привоз</th>
                                            <th>{fieldLabel('sample_name', '№ в в/ч')}</th>
                                            <th>{fieldLabel('internal_number', '№')}</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {group.allProfiles.map((profile, pIdx) => (
                                            <tr key={pIdx}>
                                              <td>{profile.year || '—'}</td>
                                              <td>{profile.import_number || '—'}</td>
                                              <td>{profile.sample_name || '—'}</td>
                                              <td>{profile.internal_number || '—'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                    <div className="timestamp">
                                      {new Date(group.timestamp).toLocaleString('ru-RU', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit'
                                      })}
                                    </div>

                                    {/* Комментарий эксперта */}
                                    {group.allProfiles.some(p => p.expert_comment) && (
                                      <div className="history-card-comment">
                                        <div className="comment-icon">💬</div>
                                        <div className="comment-text">
                                          {group.allProfiles
                                            .filter(p => p.expert_comment)
                                            .map((p, cIdx) => (
                                              <div key={cIdx} className="comment-item">
                                                <strong>{p.internal_number || p.sample_name}:</strong> {p.expert_comment}
                                              </div>
                                            ))
                                          }
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Группа 3: Поиск в задачах отдела */}
                        {departmentGroups.length > 0 && (
                          <div className="history-group">
                            <h3 className="history-group-title">👥 Поиск в задачах отдела</h3>
                            <div className="history-group-divider"></div>
                            <div className="history-grid department-search">
                              {departmentGroups.map((group, idx) => {
                                const matchCount = group.matchCount;

                                return (
                                  <div
                                    key={idx}
                                    className="history-card"
                                    onClick={() => restoreFromHistory(group)}
                                  >
                                    <div className="history-card-header">
                                      <strong>
                                        {group.isGroup
                                          ? `Группа из ${group.allProfiles.length} профилей`
                                          : `${group.sample_name}${group.internal_number ? ` | ${group.internal_number}` : ''}`
                                        }
                                      </strong>
                                      <span className="match-badge">
                                        {matchCount}
                                      </span>
                                    </div>
                                    <div className="history-card-body">
                                      <table className="history-data-table">
                                        <thead>
                                          <tr>
                                            <th>Год</th>
                                            <th>Привоз</th>
                                            <th>{fieldLabel('sample_name', '№ в в/ч')}</th>
                                            <th>{fieldLabel('internal_number', '№')}</th>
                                            <th>Задача</th>
                                            <th>Эксперт</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {group.allProfiles.map((profile, pIdx) => (
                                            <tr key={pIdx}>
                                              <td>{profile.year || '—'}</td>
                                              <td>{profile.import_number || '—'}</td>
                                              <td>{profile.sample_name || '—'}</td>
                                              <td>{profile.internal_number || '—'}</td>
                                              <td title={profile.task_name}>{profile.task_name || '—'}</td>
                                              <td>{profile.task_owner || '—'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                    <div className="timestamp">
                                      {new Date(group.timestamp).toLocaleString('ru-RU', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit'
                                      })}
                                    </div>

                                    {/* Комментарий эксперта */}
                                    {group.allProfiles.some(p => p.expert_comment) && (
                                      <div className="history-card-comment">
                                        <div className="comment-icon">💬</div>
                                        <div className="comment-text">
                                          {group.allProfiles
                                            .filter(p => p.expert_comment)
                                            .map((p, cIdx) => (
                                              <div key={cIdx} className="comment-item">
                                                <strong>{p.internal_number || p.sample_name}:</strong> {p.expert_comment}
                                              </div>
                                            ))
                                          }
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  }
                })()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Модальное окно настроек */}
      {showSettings && (
        <div
          className="modal-overlay settings-modal-overlay"
          onClick={(e) => {
            // Закрываем только если клик на самом overlay
            if (e.target === e.currentTarget) {
              setShowSettings(false);
            }
          }}
        >
          <div className="modal-content settings-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>⚙️ Настройки поиска</h3>
              <button onClick={() => setShowSettings(false)} className="close-btn" aria-label="Закрыть">×</button>
            </div>
            <div className="modal-body">
              <div className="setting-row">
                <label>Минимум совпадений:</label>
                <input
                  type="number"
                  min="1"
                  max="24"
                  value={minMatches}
                  onChange={(e) => setMinMatches(parseInt(e.target.value) || 15)}
                 className="form-input"/>
              </div>
              <div className="setting-info">
                Для 24 локусов рекомендуется значение ≥ 15
              </div>

              <div className="setting-row settings-section-start">
                <label>Алгоритм сравнения:</label>
                <select
                  value={comparisonAlgorithm}
                  onChange={(e) => setComparisonAlgorithm(e.target.value)}
                  className="setting-select form-select"
                >
                  <option value="standard">Стандартный (точное совпадение)</option>
                  <option value="duplicate_v5">Поиск дублей v5.0 (рекомендуется) 🆕</option>
                  <option value="contamination">Контаминация (взвешенный)</option>
                </select>
              </div>
              <div className="setting-info">
                <strong>Стандартный:</strong> Требует точного совпадения всех аллелей локуса<br/>
                <strong>Поиск дублей v5.0:</strong> Учитывает гомозиготы, drop-out, контаминацию (оптимален для дублей) 🆕<br/>
                <strong>Контаминация:</strong> Для поиска контаминации сотрудниками (алгоритм v4.0)
              </div>

              {/* Настройки алгоритма v5.0 */}
              {comparisonAlgorithm === 'duplicate_v5' && (
                <>
                  <div className="settings-section-title">
                    Настройки алгоритма v5.0:
                  </div>

                  <div className="setting-row">
                    <label>Мин. балл: {duplicateSettings.minScore}</label>
                    <input
                      type="range"
                      min="5"
                      max="24"
                      step="1"
                      value={duplicateSettings.minScore}
                      onChange={(e) => setDuplicateSettings({
                        ...duplicateSettings,
                        minScore: parseInt(e.target.value)
                      })}
                      className="range-input-full"
                    />
                  </div>
                  <div className="setting-info">
                    Минимальный суммарный балл для считывания дубликатом
                  </div>

                  <div className="setting-row setting-row-stacked">
                    <label>Мин. процент: {duplicateSettings.minPercentage}%</label>
                    <input
                      type="range"
                      min="50"
                      max="100"
                      step="5"
                      value={duplicateSettings.minPercentage}
                      onChange={(e) => setDuplicateSettings({
                        ...duplicateSettings,
                        minPercentage: parseInt(e.target.value)
                      })}
                      className="range-input-full"
                    />
                  </div>
                  <div className="setting-info">
                    Минимальный процент совпадения (с учетом весов)
                  </div>

                  <div className="setting-row setting-row-stacked">
                    <label>Мин. локусов: {duplicateSettings.minLoci}</label>
                    <input
                      type="range"
                      min="8"
                      max="24"
                      step="1"
                      value={duplicateSettings.minLoci}
                      onChange={(e) => setDuplicateSettings({
                        ...duplicateSettings,
                        minLoci: parseInt(e.target.value)
                      })}
                      className="range-input-full"
                    />
                  </div>
                  <div className="setting-info">
                    Минимальное количество сравненных локусов
                  </div>

                  {/* Легенда типов совпадений */}
                  <div className="match-types-legend">
                    <h4>🎨 Цветовая подсветка локусов:</h4>
                    <div className="legend-items">
                      <div className="legend-item">
                        <div className="legend-color match"></div>
                        <span className="legend-label">Точное совпадение</span>
                        <span className="legend-description">1.0 балл</span>
                      </div>
                      <div className="legend-item">
                        <div className="legend-color contamination"></div>
                        <span className="legend-label">Контаминация</span>
                        <span className="legend-description">0.8 балл (вхождение в смесь)</span>
                      </div>
                      <div className="legend-item">
                        <div className="legend-color dropout"></div>
                        <span className="legend-label">Drop-out</span>
                        <span className="legend-description">0.6 балл (потеря аллеля)</span>
                      </div>
                      <div className="legend-item">
                        <div className="legend-color partial"></div>
                        <span className="legend-label">Частичное</span>
                        <span className="legend-description">-0.5 балл (пересечение)</span>
                      </div>
                      <div className="legend-item">
                        <div className="legend-color mismatch"></div>
                        <span className="legend-label">Несовпадение</span>
                        <span className="legend-description">-1.0 балл</span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Настройки цветов подсветки */}
              <div className="settings-section-title">
                🎨 Цвета подсветки локусов
              </div>
              <div>
                <h4 className="settings-section-title-lg">
                  Настройка цветов подсветки
                </h4>

                <div className="settings-grid">
                  {/* Полное совпадение */}
                  <div className="settings-color-row">
                    <label>
                      Полное совпадение:
                    </label>
                    <ColorPicker
                      value={contaminationSettings.colors?.fullMatch || '#90EE90'}
                      onChange={(value) => {
                        setContaminationSettings({
                          ...contaminationSettings,
                          colors: { ...contaminationSettings.colors, fullMatch: value }
                        });
                      }}
                      label="Полное совпадение"
                    />
                  </div>

                  {/* Частичное совпадение (фон) */}
                  <div className="settings-color-row">
                    <label>
                      Контаминация (фон):
                    </label>
                    <ColorPicker
                      value={contaminationSettings.colors?.partialMatch || '#9d8311'}
                      onChange={(value) => {
                        setContaminationSettings({
                          ...contaminationSettings,
                          colors: { ...contaminationSettings.colors, partialMatch: value }
                        });
                      }}
                      label="Контаминация (фон)"
                    />
                  </div>

                  {/* Совпадающие аллели при контаминации */}
                  <div className="settings-color-row">
                    <label>
                      Совпадающие аллели:
                    </label>
                    <ColorPicker
                      value={contaminationSettings.colors?.partialMatchAllele || '#1400e8'}
                      onChange={(value) => {
                        setContaminationSettings({
                          ...contaminationSettings,
                          colors: { ...contaminationSettings.colors, partialMatchAllele: value }
                        });
                      }}
                      label="Совпадающие аллели"
                    />
                  </div>

                  {/* Несовпадение */}
                  <div className="settings-color-row">
                    <label>
                      Несовпадение:
                    </label>
                    <ColorPicker
                      value={contaminationSettings.colors?.noMatch || '#FFB6C1'}
                      onChange={(value) => {
                        setContaminationSettings({
                          ...contaminationSettings,
                          colors: { ...contaminationSettings.colors, noMatch: value }
                        });
                      }}
                      label="Несовпадение"
                    />
                  </div>
                </div>

                {/* Кнопка сброса цветов */}
                <button
                  onClick={() => {
                    setContaminationSettings({
                      ...contaminationSettings,
                      colors: {
                        fullMatch: '#90EE90',
                        partialMatch: '#9d8311',
                        partialMatchAllele: '#1400e8',
                        noMatch: '#FFB6C1'
                      }
                    });
                  }}
                  className="btn btn-secondary btn-sm action-button-danger-subtle"
                >
                  🔄 Сбросить цвета по умолчанию
                </button>

                {/* Автокомментирование дубликатов */}
                <div className="settings-card">
                  <label className="settings-checkbox-label">
                    <input
                      type="checkbox"
                      checked={contaminationSettings.autoCommentDuplicates}
                      onChange={(e) => setContaminationSettings({
                        ...contaminationSettings,
                        autoCommentDuplicates: e.target.checked
                      })}
                    />
                    <span>💬 Автоматически комментировать дубликаты</span>
                  </label>
                  <div className="setting-info settings-subhint">
                    При обнаружении дубликатов автоматически добавляется комментарий с информацией о совпадениях
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                onClick={() => {
                  setMinMatches(15);
                  setComparisonAlgorithm('standard');
                  setDuplicateSettings({
                    minScore: 15,
                    minPercentage: 80,
                    minLoci: 15,
                    locusWeights: {}
                  });
                }}
                className="btn-secondary btn"
              >
                🔄 Сбросить по умолчанию
              </button>
              <button onClick={() => setShowSettings(false)} className="btn-primary btn">
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DNA Loading Animation */}
      {showDnaLoading && (
        <div className="dna-loading-overlay">
          <div className="dna-loading-container">
            <div className="dna">
              <div className="dna-dot"></div>
              <div className="dna-dot"></div>
              <div className="dna-dot"></div>
              <div className="dna-dot"></div>
              <div className="dna-dot"></div>
              <div className="dna-dot"></div>
              <div className="dna-dot"></div>
              <div className="dna-dot"></div>
              <div className="dna-dot"></div>
              <div className="dna-dot"></div>
              <div className="dna-dot"></div>
              <div className="dna-dot"></div>
            </div>
            <h2 className="dna-loading-title">🧬 Анализ генотипов</h2>
            <p className="dna-loading-message">
              {searchProgress.stage || 'Выполняется поиск совпадений...'}
            </p>

            {/* Progress Bar */}
            {searchProgress.total > 0 ? (
              <div className="analysis-progress">
                <div className="analysis-progress-track">
                  <div
                    className="analysis-progress-bar"
                    style={{ width: `${(searchProgress.current / searchProgress.total * 100).toFixed(1)}%` }}
                  />
                </div>
                <div className="analysis-progress-meta">
                  <span>Этап {searchProgress.current} из {searchProgress.total}</span>
                  <span>{((searchProgress.current / searchProgress.total) * 100).toFixed(0)}%</span>
                </div>
              </div>
            ) : (
              <div className="dna-loading-dots">
                <div className="dna-loading-dot"></div>
                <div className="dna-loading-dot"></div>
                <div className="dna-loading-dot"></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Модальное окно подтверждения полного поиска */}
      {showFullSearchConfirm && (
        <div
          className="modal-overlay fullsearch-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowFullSearchConfirm(false);
            }
          }}
        >
          <div
            className="modal-content fullsearch-modal-content modal-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>🔍 Полный поиск</h3>
              <button
                onClick={() => closeModal(setShowFullSearchConfirm)}
                className="close-modal-button"
               aria-label="Закрыть">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-info-card">
                <div className="info-row">
                  <span className="info-label">Задача:</span>
                  <span className="info-value">{selectedActiveTask?.title}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Профилей:</span>
                  <span className="info-value">{profiles.length}</span>
                </div>
              </div>

              <div className="modal-section">
                <h4>Будут выполнены следующие анализы:</h4>
                <div className="analysis-list">
                  <div className="analysis-item">
                    <span className="analysis-icon">🔄</span>
                    <div className="analysis-info">
                      <strong>Поиск дубликатов</strong>
                      <p>Поиск совпадений внутри задачи</p>
                    </div>
                  </div>
                  <div className="analysis-item">
                    <span className="analysis-icon">🗄️</span>
                    <div className="analysis-info">
                      <strong>Идентификация</strong>
                      <p>Поиск в мастер массиве</p>
                    </div>
                  </div>
                  <div className="analysis-item">
                    <span className="analysis-icon">👤</span>
                    <div className="analysis-info">
                      <strong>Контаминация</strong>
                      <p>Анализ контаминации сотрудниками</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                onClick={() => closeModal(setShowFullSearchConfirm)}
                className="btn btn-secondary"
              >
                Отмена
              </button>
              <button
                onClick={executeFullSearch}
                className="btn btn-primary"
              >
                Начать поиск
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно результатов полного поиска */}
      {showFullSearchResults && fullSearchStats && (
        <div
          className="modal-overlay fullsearch-results-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowFullSearchResults(false);
            }
          }}
        >
          <div
            className="modal-content fullsearch-results-modal-content modal-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>✅ Поиск завершен</h3>
              <button
                onClick={() => closeModal(setShowFullSearchResults)}
                className="close-modal-button"
               aria-label="Закрыть">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="results-grid">
                <div className="result-card">
                  <span className="result-icon">📊</span>
                  <div className="result-info">
                    <strong>{fullSearchStats.totalMatches} совпадений</strong>
                    <p>Общее число найденных совпадений</p>
                  </div>
                </div>
                <div className="result-card">
                  <span className="result-icon">🔄</span>
                  <div className="result-info">
                    <strong>{fullSearchStats.taskMatches} дубликатов</strong>
                    <p>Дубликаты в задаче</p>
                  </div>
                </div>
                <div className="result-card">
                  <span className="result-icon">🗄️</span>
                  <div className="result-info">
                    <strong>{fullSearchStats.masterMatches} совпадений</strong>
                    <p>Совпадения с мастер массивом</p>
                  </div>
                </div>
                <div className="result-card">
                  <span className="result-icon">👤</span>
                  <div className="result-info">
                    <strong>{fullSearchStats.contaminationCases} случаев</strong>
                    <p>Случаи контаминации</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                onClick={() => closeModal(setShowFullSearchResults)}
                className="btn btn-primary modal-action-full"
              >
                Понятно
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно настроек контаминации */}
      {showContaminationSettings && (
        <div
          className="modal-overlay settings-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowContaminationSettings(false);
            }
          }}
        >
          <div className="modal-content settings-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>⚙️ Настройки алгоритма контаминации</h3>
              <button onClick={() => setShowContaminationSettings(false)} className="close-btn" aria-label="Закрыть">×</button>
            </div>

            <div className="modal-body">
              {/* Выбор алгоритма */}
              <div className="setting-row">
                <label>Алгоритм:</label>
                <select
                  className="setting-select form-select"
                  value={
                    contaminationSettings.useV5Algorithm ? 'v5' :
                    contaminationSettings.useV4Algorithm ? 'v4' :
                    'v1.5'
                  }
                  onChange={(e) => {
                    const value = e.target.value;
                    setContaminationSettings({
                      ...contaminationSettings,
                      useV4Algorithm: value === 'v4',
                      useV5Algorithm: value === 'v5'
                    });
                  }}
                >
                  <option value="v1.5">v1.5 (Классический)</option>
                  <option value="v4">v4.0 (Нормализация)</option>
                  <option value="v5">v5.0 (LCN + Деградация) 🆕</option>
                </select>
              </div>
              <div className="setting-info">
                <strong>v1.5:</strong> Реконструкция профиля<br/>
                <strong>v4.0:</strong> Веса локусов, нормализация<br/>
                <strong>v5.0:</strong> Drop-out, редкие аллели (рекомендуется для LCN)
              </div>

              {/* Порог */}
              <div className="setting-row settings-section-start">
                <label>Порог (threshold): {contaminationSettings.threshold.toFixed(1)}</label>
                <input
                  type="range"
                  min="0.5"
                  max="20"
                  step="0.5"
                  value={contaminationSettings.threshold}
                  onChange={(e) => setContaminationSettings({
                    ...contaminationSettings,
                    threshold: parseFloat(e.target.value)
                  })}
                  className="range-input-full"
                />
              </div>
              <div className="setting-info">
                Минимальный процент для отображения результатов
              </div>

              {/* Мин. локусов */}
              <div className="setting-row settings-section-start">
                <label>Мин. локусов: {contaminationSettings.minLociMatch}</label>
                <input
                  type="range"
                  min="4"
                  max="15"
                  step="1"
                  value={contaminationSettings.minLociMatch}
                  onChange={(e) => setContaminationSettings({
                    ...contaminationSettings,
                    minLociMatch: parseInt(e.target.value)
                  })}
                  className="range-input-full"
                />
              </div>
              <div className="setting-info">
                Минимальное количество совпадающих локусов
              </div>

              {/* Крит. аллелей */}
              <div className="setting-row settings-section-start">
                <label>Крит. аллелей: {contaminationSettings.criticalAlleleCount}</label>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={contaminationSettings.criticalAlleleCount}
                  onChange={(e) => setContaminationSettings({
                    ...contaminationSettings,
                    criticalAlleleCount: parseInt(e.target.value)
                  })}
                  className="range-input-full"
                />
              </div>
              <div className="setting-info">
                Количество критических аллелей для подтверждения
              </div>

              {/* Коэффициенты v4.0 и v5.0 */}
              {(contaminationSettings.useV4Algorithm || contaminationSettings.useV5Algorithm) && (
                <>
                  <div className="settings-section-title">
                    Коэффициенты совпадения:
                  </div>

                  <div className="setting-row">
                    <label>Full Match: {contaminationSettings.matchCoefficients.fullMatch.toFixed(2)}</label>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={contaminationSettings.matchCoefficients.fullMatch}
                      onChange={(e) => setContaminationSettings({
                        ...contaminationSettings,
                        matchCoefficients: {
                          ...contaminationSettings.matchCoefficients,
                          fullMatch: parseFloat(e.target.value)
                        }
                      })}
                      className="range-input-full"
                    />
                  </div>

                  {/* Дополнительные коэффициенты для v5.0 */}
                  {contaminationSettings.useV5Algorithm && (
                    <>
                      <div className="setting-row setting-row-stacked">
                        <label>Inclusive Drop-out 🆕: {(contaminationSettings.matchCoefficients.inclusiveDropout || 0.85).toFixed(2)}</label>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={contaminationSettings.matchCoefficients.inclusiveDropout || 0.85}
                          onChange={(e) => setContaminationSettings({
                            ...contaminationSettings,
                            matchCoefficients: {
                              ...contaminationSettings.matchCoefficients,
                              inclusiveDropout: parseFloat(e.target.value)
                            }
                          })}
                          className="range-input-full"
                        />
                      </div>

                      <div className="setting-row setting-row-stacked">
                        <label>Over-Inclusive Mix 🆕: {(contaminationSettings.matchCoefficients.overInclusiveMix || 0.7).toFixed(2)}</label>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={contaminationSettings.matchCoefficients.overInclusiveMix || 0.7}
                          onChange={(e) => setContaminationSettings({
                            ...contaminationSettings,
                            matchCoefficients: {
                              ...contaminationSettings.matchCoefficients,
                              overInclusiveMix: parseFloat(e.target.value)
                            }
                          })}
                          className="range-input-full"
                        />
                      </div>
                    </>
                  )}

                  <div className="setting-row setting-row-stacked">
                    <label>Partial Mix: {contaminationSettings.matchCoefficients.partialMatch.toFixed(2)}</label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={contaminationSettings.matchCoefficients.partialMatch}
                      onChange={(e) => setContaminationSettings({
                        ...contaminationSettings,
                        matchCoefficients: {
                          ...contaminationSettings.matchCoefficients,
                          partialMatch: parseFloat(e.target.value)
                        }
                      })}
                      className="range-input-full"
                    />
                  </div>

                  <div className="setting-row setting-row-stacked">
                    <label>Mismatch: {contaminationSettings.matchCoefficients.penalty.toFixed(2)}</label>
                    <input
                      type="range"
                      min="-2"
                      max="0"
                      step="0.1"
                      value={contaminationSettings.matchCoefficients.penalty}
                      onChange={(e) => setContaminationSettings({
                        ...contaminationSettings,
                        matchCoefficients: {
                          ...contaminationSettings.matchCoefficients,
                          penalty: parseFloat(e.target.value)
                        }
                      })}
                      className="range-input-full"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="modal-footer">
              <button
                onClick={async () => {
                  try {
                    const token = localStorage.getItem('token');
                    const response = await fetch('/api/staff-contamination/default-parameters', {
                      headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const data = await response.json();
                    if (data.success) {
                      setContaminationSettings({
                        threshold: data.data.options.threshold,
                        minLociMatch: data.data.options.minLociMatch,
                        criticalAlleleCount: data.data.options.criticalAlleleCount || 3,
                        weightCriticalLocus: data.data.options.weightCriticalLocus || 2,
                        stutterThreshold: data.data.options.stutterThreshold || 0.15,
                        useV4Algorithm: data.data.options.useV4Algorithm,
                        useV5Algorithm: data.data.options.useV5Algorithm || false,
                        searchInMasterArray: false,
                        locusWeights: data.data.locusWeights || {},
                        matchCoefficients: data.data.matchCoefficients || {
                          fullMatch: 1.0,
                          partialMatch: 0.4,
                          penalty: -1.0,
                          inclusiveDropout: 0.85,
                          overInclusiveMix: 0.7
                        }
                      });
                    }
                  } catch (error) {
                    console.error('Ошибка загрузки дефолтных настроек:', error);
                  }
                }}
                className="btn-secondary btn"
              >
                🔄 Сбросить по умолчанию
              </button>
              <button onClick={() => setShowContaminationSettings(false)} className="btn-primary btn">
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно подтверждения поиска внутри задачи */}
      {showTaskSearchConfirm && (
        <div
          className="modal-overlay fullsearch-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowTaskSearchConfirm(false);
            }
          }}
        >
          <div
            className="modal-content fullsearch-modal-content modal-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>🔍 {taskSearchMode === 'task' ? 'Поиск внутри задачи' : 'Поиск в мастер массиве'}</h3>
              <button
                onClick={() => setShowTaskSearchConfirm(false)}
                className="close-modal-button"
               aria-label="Закрыть">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-info-card">
                <div className="info-row">
                  <span className="info-label">Задача:</span>
                  <span className="info-value">{selectedActiveTask?.title}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Профилей:</span>
                  <span className="info-value">{profiles.length}</span>
                </div>
              </div>

              <div className="modal-section">
                <h4>Будет выполнен анализ:</h4>
                <div className="analysis-list">
                  <div className="analysis-item">
                    <span className="analysis-icon">{taskSearchMode === 'task' ? '🔄' : '🗄️'}</span>
                    <div className="analysis-info">
                      <strong>{taskSearchMode === 'task' ? 'Поиск дубликатов' : 'Идентификация'}</strong>
                      <p>{taskSearchMode === 'task' ? 'Поиск совпадений внутри задачи' : 'Поиск в мастер массиве'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setShowTaskSearchConfirm(false)}
                className="btn btn-secondary"
              >
                Отмена
              </button>
              <button
                onClick={executeTaskSearch}
                className="btn btn-primary"
              >
                Начать поиск
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно результатов поиска внутри задачи */}
      {showTaskSearchResults && taskSearchStats && (
        <div
          className="modal-overlay fullsearch-results-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowTaskSearchResults(false);
            }
          }}
        >
          <div
            className="modal-content fullsearch-results-modal-content modal-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>✅ Поиск завершен</h3>
              <button
                onClick={() => setShowTaskSearchResults(false)}
                className="close-modal-button"
               aria-label="Закрыть">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="results-grid">
                <div className="result-card">
                  <span className="result-icon">📊</span>
                  <div className="result-info">
                    <strong>Режим: {taskSearchStats.searchMode === 'task' ? 'Внутри задачи' : 'В мастер массиве'}</strong>
                    <p>{taskSearchStats.searchMode === 'task' ? 'Поиск дубликатов' : 'Идентификация'}</p>
                  </div>
                </div>
                <div className="result-card">
                  <span className="result-icon">🔍</span>
                  <div className="result-info">
                    <strong>{taskSearchStats.totalAnalyzed} проанализировано</strong>
                    <p>Всего профилей</p>
                  </div>
                </div>
                <div className="result-card">
                  <span className="result-icon">✓</span>
                  <div className="result-info">
                    <strong>{taskSearchStats.resultsWithMatches} совпадений</strong>
                    <p>Найдено результатов</p>
                  </div>
                </div>
                <div className="result-card">
                  <span className="result-icon">⏱️</span>
                  <div className="result-info">
                    <strong>{taskSearchStats.durationSeconds} сек</strong>
                    <p>Время выполнения</p>
                  </div>
                </div>
                <div className="result-card">
                  <span className="result-icon">🔢</span>
                  <div className="result-info">
                    <strong>{taskSearchStats.comparisons}</strong>
                    <p>Сравнений выполнено</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setShowTaskSearchResults(false)}
                className="btn btn-primary modal-action-full"
              >
                Понятно
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно подтверждения поиска в задачах отдела */}
      {showDepartmentSearchConfirm && (
        <div
          className="modal-overlay fullsearch-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowDepartmentSearchConfirm(false);
            }
          }}
        >
          <div
            className="modal-content fullsearch-modal-content modal-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>🔍 Поиск в задачах отдела</h3>
              <button
                onClick={() => setShowDepartmentSearchConfirm(false)}
                className="close-modal-button"
               aria-label="Закрыть">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-info-card">
                <div className="info-row">
                  <span className="info-label">Задача:</span>
                  <span className="info-value">{selectedActiveTask?.title}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Профилей:</span>
                  <span className="info-value">{profiles.length}</span>
                </div>
              </div>

              <div className="modal-section">
                <h4>Будет выполнен анализ:</h4>
                <div className="analysis-list">
                  <div className="analysis-item">
                    <span className="analysis-icon">🔄</span>
                    <div className="analysis-info">
                      <strong>Поиск дубликатов в задачах отдела</strong>
                      <p>Поиск совпадений в активных задачах других пользователей отдела</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setShowDepartmentSearchConfirm(false)}
                className="btn btn-secondary"
              >
                Отмена
              </button>
              <button
                onClick={executeDepartmentTasksSearch}
                className="btn btn-primary"
              >
                Начать поиск
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно результатов поиска в задачах отдела */}
      {showDepartmentSearchResults && departmentSearchStats && (
        <div
          className="modal-overlay fullsearch-results-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowDepartmentSearchResults(false);
            }
          }}
        >
          <div
            className="modal-content fullsearch-results-modal-content modal-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>✅ Поиск завершен</h3>
              <button
                onClick={() => setShowDepartmentSearchResults(false)}
                className="close-modal-button"
               aria-label="Закрыть">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="results-grid">
                <div className="result-card">
                  <span className="result-icon">📊</span>
                  <div className="result-info">
                    <strong>Поиск в задачах отдела</strong>
                    <p>Дубликаты в активных задачах</p>
                  </div>
                </div>
                <div className="result-card">
                  <span className="result-icon">📁</span>
                  <div className="result-info">
                    <strong>{departmentSearchStats.totalTasks} задач</strong>
                    <p>Проанализировано задач</p>
                  </div>
                </div>
                <div className="result-card">
                  <span className="result-icon">🔍</span>
                  <div className="result-info">
                    <strong>{departmentSearchStats.totalProfiles} профилей</strong>
                    <p>Всего профилей</p>
                  </div>
                </div>
                <div className="result-card">
                  <span className="result-icon">✓</span>
                  <div className="result-info">
                    <strong>{departmentSearchStats.totalMatches} совпадений</strong>
                    <p>Найдено результатов</p>
                  </div>
                </div>
                <div className="result-card">
                  <span className="result-icon">⏱️</span>
                  <div className="result-info">
                    <strong>{departmentSearchStats.durationSeconds} сек</strong>
                    <p>Время выполнения</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setShowDepartmentSearchResults(false)}
                className="btn btn-primary modal-action-full"
              >
                Понятно
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно результатов поиска контаминаций */}
      {showContaminationResults && contaminationStats && (
        <div
          className="modal-overlay fullsearch-results-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowContaminationResults(false);
            }
          }}
        >
          <div
            className="modal-content fullsearch-results-modal-content modal-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>✅ Поиск контаминаций завершен</h3>
              <button
                onClick={() => setShowContaminationResults(false)}
                className="close-modal-button"
               aria-label="Закрыть">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="results-grid">
                <div className="result-card">
                  <span className="result-icon">👤</span>
                  <div className="result-info">
                    <strong>{contaminationStats.contaminationCases} случаев</strong>
                    <p>Найдено случаев контаминации сотрудниками</p>
                  </div>
                </div>
                <div className="result-card">
                  <span className="result-icon">🧬</span>
                  <div className="result-info">
                    <strong>Алгоритм v4.0</strong>
                    <p>Взвешенный анализ с критическими локусами</p>
                  </div>
                </div>
              </div>
              {contaminationStats.contaminationCases > 0 && (
                <div className="analysis-notice warning">
                  ?? Результаты добавлены во вкладки "История" и "?? Детали контаминации"
                </div>
              )}
              {contaminationStats.contaminationCases === 0 && (
                <div className="analysis-notice success">
                  ✅ Контаминация не обнаружена
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setShowContaminationResults(false)}
                className="btn btn-primary modal-action-full"
              >
                Понятно
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно комментариев */}
      <ProfileCommentModal
        isOpen={commentModalOpen}
        onClose={() => {
          setCommentModalOpen(false);
          setCommentModalProfile(null);
        }}
        profile={commentModalProfile}
        onSave={handleCommentSave}
      />

      {/* Модальное окно деактивации профиля */}
      {deactivateModalOpen && deactivateModalProfile && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setDeactivateModalOpen(false);
              setDeactivateModalProfile(null);
              setDeactivateReason('');
            }
          }}
        >
          <div
            className="modal-content modal-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>🚫 Деактивация профиля</h3>
              <button
                onClick={() => {
                  setDeactivateModalOpen(false);
                  setDeactivateModalProfile(null);
                  setDeactivateReason('');
                }}
                className="close-modal-button"
                disabled={deactivateLoading}
               aria-label="Закрыть">
                ×
              </button>
            </div>

            <div className="modal-body">
              <div className="modal-info-card">
                <div className="info-row">
                  <span className="info-label">{fieldLabel('sample_name', 'Образец')}:</span>
                  <span className="info-value">{deactivateModalProfile.sample_name}</span>
                </div>
                {deactivateModalProfile.internal_number && (
                  <div className="info-row">
                    <span className="info-label">{fieldLabel('internal_number', 'Внутренний номер')}:</span>
                    <span className="info-value">{deactivateModalProfile.internal_number}</span>
                  </div>
                )}
                {deactivateModalProfile.import_number && (
                  <div className="info-row">
                    <span className="info-label">Номер импорта:</span>
                    <span className="info-value">{deactivateModalProfile.import_number}</span>
                  </div>
                )}
              </div>

              <div className="modal-section">
                <h4>Причина деактивации (опционально):</h4>
                <textarea
                  value={deactivateReason}
                  onChange={(e) => setDeactivateReason(e.target.value)}
                  placeholder="Укажите причину деактивации профиля..."
                  disabled={deactivateLoading}
                  className="analysis-textarea form-textarea"
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                onClick={() => {
                  setDeactivateModalOpen(false);
                  setDeactivateModalProfile(null);
                  setDeactivateReason('');
                }}
                disabled={deactivateLoading}
                className="btn btn-secondary"
              >
                Отмена
              </button>
              <button
                onClick={handleConfirmDeactivate}
                disabled={deactivateLoading}
                className={`btn ${deactivateLoading ? 'btn-secondary' : 'btn-danger'}`}
              >
                {deactivateLoading ? '⏳ Деактивация...' : '🚫 Деактивировать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GenotypeAnalysisPage;
