import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { resolveProfileImportFormat } from '../../../../src/utils/profileImportFormat';


// Функция склонения слова "профиль"
const pluralizeProfiles = (n) => {
  if (n % 100 >= 11 && n % 100 <= 14) {
    return 'профилей';
  }
  switch (n % 10) {
    case 1: return 'профиль';
    case 2:
    case 3:
    case 4: return 'профиля';
    default: return 'профилей';
  }
};


// Компонент для отображения детальной информации об ошибках с группировкой
const ErrorDetailsSection = ({ errors }) => {
  const [expandedGroups, setExpandedGroups] = useState({});

  // Проверка на пустой массив
  if (!errors || errors.length === 0) {
    return null;
  }

  // Группируем ошибки по типу сообщения
  const groupedErrors = errors.reduce((acc, error) => {
    let errorMessage = error.error || 'Неизвестная ошибка';

    // Переводим сообщения об ошибках БД на русский с уточнением
    if (errorMessage.includes('duplicate key value violates unique constraint')) {
      errorMessage = 'Дубликат: Профиль с таким годом и номером образца уже существует в вашей базе данных. Каждый номер образца должен быть уникальным в пределах одного года. Возможно вы пытаетесь загрузить один и тот же файл повторно.';
    }

    if (!acc[errorMessage]) {
      acc[errorMessage] = [];
    }
    acc[errorMessage].push(error);
    return acc;
  }, {});

  const toggleGroup = (errorType) => {
    setExpandedGroups(prev => ({
      ...prev,
      [errorType]: !prev[errorType]
    }));
  };

  return (
    <div className="error-details-section">
      <div className="error-details-title">
        ❌ Детали ошибок валидации:
      </div>
      {Object.entries(groupedErrors).map(([errorType, errorList]) => (
        <details
          key={errorType}
          open={expandedGroups[errorType]}
          className="error-group"
        >
          <summary
            onClick={(e) => {
              e.preventDefault();
              toggleGroup(errorType);
            }}
            className="error-group-summary"
          >
            🔴 {errorType} ({errorList.length} {errorList.length === 1 ? 'профиль' : 'профилей'})
          </summary>
          {expandedGroups[errorType] && (
            <div className="error-group-content error-group-content-expanded">
              <div className="error-items-grid error-items-grid-wide">
                {errorList.map((error, index) => (
                  <div
                    key={index}
                    className="error-item error-item-card"
                    title={`Строка ${error.rowNumber ?? error.index + 2}: ${error.sampleName}`}
                  >
                    <div className="error-item-title">
                      {error.sampleName || `Строка ${error.rowNumber ?? error.index + 2}`}
                    </div>
                    <div className="error-item-meta">
                      <div>📍 Строка: {error.rowNumber ?? error.index + 2}</div>
                      {error.importFormat !== 'genetic' && error.internal_number && (
                        <div>🔢 Номер: {error.internal_number}</div>
                      )}
                      {error.importFormat !== 'genetic' && error.year && (
                        <div>📅 Год: {error.year}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="error-summary-info">
                💡 Всего затронуто профилей: {errorList.length}
              </div>
            </div>
          )}
        </details>
      ))}
    </div>
  );
};

const FileUploader = ({ onNavigate, onUploadSuccess, selectedActiveTask }) => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [showDnaLoading, setShowDnaLoading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, stage: '' });

  // Новые state для preview и замены
  const [previewData, setPreviewData] = useState(null);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [autoReplaceDeactivated, setAutoReplaceDeactivated] = useState(true);

  const { user, activeDepartment, activeDepartmentId } = useAuth();
  const isGenetic = resolveProfileImportFormat(activeDepartment) === 'genetic';
  const uploadDepartmentRef = React.useRef(activeDepartmentId);

  React.useEffect(() => {
    setFile(null);
    setPreviewData(null);
    setShowReplaceConfirm(false);
    setUploadResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [activeDepartmentId]);
  const fileInputRef = React.useRef(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setError(null);
    setUploadResult(null);
  };

  const handleUpload = async (e) => {
    e.preventDefault();

    if (!file) {
      setError('Выберите файл для загрузки');
      return;
    }

    uploadDepartmentRef.current = activeDepartmentId;
    setUploading(true);
    setShowDnaLoading(true);
    setError(null);
    setUploadResult(null);
    setUploadProgress({ current: 0, total: 0, stage: 'Анализ файла...' });

    try {
      // Get token from user context instead of localStorage
      const token = user?.accessToken || localStorage.getItem('token');

      if (!token) {
        throw new Error('Токен авторизации не найден. Войдите в систему повторно.');
      }

      // Check if token is expired before making the request
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const now = Math.floor(Date.now() / 1000);
        const isExpired = payload.exp < now;

        if (isExpired) {
          throw new Error('Срок действия токена истек. Войдите в систему повторно.');
        }
      } catch (tokenError) {
        if (tokenError.message.includes('expired')) {
          throw tokenError;
        }
      }

      const formData = new FormData();
      formData.append('file', file);

      // Добавить taskId если задача выбрана
      if (selectedActiveTask?.id) {
        formData.append('taskId', selectedActiveTask.id);
      }

      // ЭТАП 1: Preview - анализ файла без сохранения
      setUploadProgress({ current: 0, total: 0, stage: 'Проверка файла на дубликаты...' });

      const previewResponse = await fetch('/api/profiles/upload/preview', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Active-Department-Id': uploadDepartmentRef.current
        },
        body: formData
      });

      if (!previewResponse.ok) {
        const errorText = await previewResponse.text();
        console.error('Preview error response:', errorText);

        if (previewResponse.status === 401) {
          throw new Error('Authentication failed. Please login again.');
        }

        try {
          const errorData = JSON.parse(errorText);

          // Обработка специфичных ошибок с понятными сообщениями
          if (errorData.code === 'INTERNAL_DUPLICATES' && errorData.details?.internalDuplicates) {
            const duplicates = errorData.details.internalDuplicates;
            let message = `❌ Обнаружены дубликаты внутри файла!\n\n`;
            message += `Найдено ${duplicates.length} повторяющихся образцов:\n\n`;

            duplicates.forEach((dup, index) => {
              message += `${index + 1}. Образец: ${dup.sampleName || 'N/A'}\n`;
              if (!isGenetic) {
                message += `   Внутренний номер: ${dup.internalNumber || dup.key || 'N/A'}\n`;
                message += `   Год: ${dup.year || 'N/A'}\n`;
              }
              message += `   Первое упоминание: строка ${dup.firstRow}\n`;
              message += `   Повторяется в строке: ${dup.duplicateRow}\n\n`;
            });

            message += `\n📝 Пожалуйста, исправьте дубликаты в файле Excel и попробуйте загрузить снова.`;
            throw new Error(message);
          }

          const rowErrors = errorData.details?.validationErrors;
          throw new Error(rowErrors?.length ? rowErrors.map(item => item.message).join('\n') : (errorData.message || 'Ошибка при проверке файла'));
        } catch (parseError) {
          // Если не удалось распарсить JSON, показываем как есть
          if (parseError instanceof SyntaxError) throw new Error('Сервер вернул некорректный ответ при проверке файла.');
          if (parseError.message) {
            throw parseError; // Пробрасываем наше форматированное сообщение
          }
          throw new Error(`Ошибка при проверке файла: ${errorText}`);
        }
      }

      const previewResult = await previewResponse.json();
      // Проверяем есть ли профили для замены
      const hasReplaceable = previewResult.preview.breakdown.replace > 0;
      const hasConflicts = previewResult.preview.breakdown.conflict > 0;

      if (hasReplaceable && autoReplaceDeactivated) {
        // Есть профили для замены - показываем модальное окно
        setPreviewData(previewResult.preview);
        setShowReplaceConfirm(true);
        setUploading(false);
        setShowDnaLoading(false);
        return; // Ждём подтверждения пользователя
      }

      if (hasConflicts) {
        // Есть конфликты - показываем ошибку
        const conflictProfiles = previewResult.preview.profiles.filter(p => p.action === 'conflict');
        setError({
          message: `Найдены конфликты с активными профилями (${conflictProfiles.length} шт.)`,
          conflicts: conflictProfiles
        });
        setUploading(false);
        setShowDnaLoading(false);
        return;
      }

      // Нет конфликтов и замен - продолжаем загрузку
      await performActualUpload(token, formData);

    } catch (err) {
      console.error('Upload error:', err);

      // Сбрасываем выбранный файл при любой ошибке
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      setError(err.message || 'Не удалось загрузить файл. Повторите попытку.');
      setUploading(false);
      setShowDnaLoading(false);
    }
  };

  // ЭТАП 2: Фактическая загрузка с сохранением в БД
  const performActualUpload = async (token, formData) => {
    try {
      // Update progress: parsing file
      setUploadProgress({ current: 0, total: 0, stage: 'Чтение данных из файла...' });

      const response = await fetch('/api/profiles/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Active-Department-Id': uploadDepartmentRef.current
        },
        body: formData
      });

      // Update progress: processing data
      setUploadProgress({ current: 0, total: 0, stage: 'Обработка и валидация данных...' });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Server error response:', errorText);

        // Handle 401 Unauthorized with detailed token checking
        if (response.status === 401) {
          // Check if token exists and provide more specific error message
          const token = user?.accessToken || localStorage.getItem('token');
          if (!token) {
            throw new Error('Токен авторизации не найден. Войдите в систему повторно.');
          } else {
            // Try to decode token to check if it's expired
            try {
              const payload = JSON.parse(atob(token.split('.')[1]));
              const now = Math.floor(Date.now() / 1000);
              const isExpired = payload.exp < now;
              if (isExpired) {
                throw new Error('Срок действия токена истек. Войдите в систему повторно.');
              } else {
                throw new Error('Ошибка авторизации. Токен недействителен. Войдите в систему повторно.');
              }
            } catch (tokenError) {
              throw new Error('Ошибка авторизации. Неверный формат токена. Войдите в систему повторно.');
            }
          }
        }

        // Try to parse as JSON to get validation details
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (parseError) {
          // If not JSON, use the text as error message
          throw new Error(`Server error (${response.status}): ${errorText}`);
        }

        // Handle validation errors specially
        if (errorData.code === 'VALIDATION_FAILED' && errorData.validation) {
          const validationError = new Error(errorData.message || 'File validation failed');
          validationError.validation = errorData.validation;
          validationError.code = 'VALIDATION_FAILED';
          throw validationError;
        }

        // Handle Excel parsing errors
        if (errorData.error === 'Excel parsing failed' || errorData.code) {
          const parsingError = new Error(errorData.message || 'Excel parsing failed');
          parsingError.code = errorData.code;
          parsingError.details = errorData.details;
          parsingError.isExcelError = true;
          throw parsingError;
        }

        // Handle other errors
        throw new Error(`Server error (${response.status}): ${errorData.message || errorText}`);
      }

      // Update progress: saving to database
      setUploadProgress({ current: 0, total: 0, stage: 'Сохранение профилей в базу данных...' });

      const result = await response.json();

      window.lastUploadResult = result; // Сохраняем для отладки (можно удалить в продакшене)

      await completePerformActualUpload(result);

    } catch (err) {
      console.error('Actual upload error:', err);
      throw err; // Пробрасываем ошибку выше
    } finally {
      setUploading(false);
      setShowDnaLoading(false);
    }
  };

  // Завершение функции performActualUpload - обработка успешного ответа
  const completePerformActualUpload = async (result) => {
    if (result.success) {
      setUploadProgress({
        current: (result.processing?.created || 0) + (result.processing?.replaced || 0),
        total: (result.processing?.created || 0) + (result.processing?.replaced || 0),
        stage: 'Загрузка завершена!'
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      setUploadResult(result);
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Закрываем модальное окно если оно было открыто
      setShowReplaceConfirm(false);
      setPreviewData(null);

      if (onUploadSuccess) {
        onUploadSuccess(result);
      }
    } else {
      throw new Error(result.error?.message || result.message || 'Не удалось загрузить файл');
    }
  };

  // Обработчик подтверждения замены
  const handleConfirmReplace = async () => {
    try {
      setUploading(true);
      setShowDnaLoading(true);
      setShowReplaceConfirm(false);
      setUploadProgress({ current: 0, total: 0, stage: 'Загрузка с заменой профилей...' });

      const token = user?.accessToken || localStorage.getItem('token');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('replaceDeactivated', 'true');

      if (selectedActiveTask?.id) {
        formData.append('taskId', selectedActiveTask.id);
      }

      await performActualUpload(token, formData);

    } catch (err) {
      console.error('Replace confirmation error:', err);
      setError(err.message || 'Не удалось загрузить файл с заменой');
      setUploading(false);
      setShowDnaLoading(false);
    }
  };

  // Обработчик отмены замены
  const handleCancelReplace = () => {
    setShowReplaceConfirm(false);
    setPreviewData(null);
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Обработчик загрузки как нового профиля (без замены)
  const handleLoadAsNew = async () => {
    try {
      setUploading(true);
      setShowDnaLoading(true);
      setShowReplaceConfirm(false);
      setUploadProgress({ current: 0, total: 0, stage: 'Загрузка как новых профилей...' });

      const token = user?.accessToken || localStorage.getItem('token');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('replaceDeactivated', 'false'); // НЕ заменять деактивированные
      formData.append('allowDuplicates', 'true'); // Разрешить дубликаты (загрузить как новые)

      if (selectedActiveTask?.id) {
        formData.append('taskId', selectedActiveTask.id);
      }

      await performActualUpload(token, formData);

    } catch (err) {
      console.error('Load as new error:', err);
      setError(err.message || 'Не удалось загрузить профили как новые');
      setUploading(false);
      setShowDnaLoading(false);
    }
  };

  return (
    <div className="upload-page-container">
      {/* Left Column - Upload Section */}
      <div className="upload-section">
        {/* Header */}
        <div className="section-header">
          <div>
            <h2 className="section-title">📁 Загрузка ДНК профилей</h2>
            <p className="section-subtitle">
              Пользователь: <strong>{user?.username}</strong> ({user?.role})
            </p>
          </div>
          <div className="section-header-actions">
            <button
              onClick={() => onNavigate('/dashboard')}
              className="nav-button btn btn-secondary"
            >
              Назад к дашборду
            </button>
          </div>
        </div>

        {/* Индикатор активной задачи */}
        {selectedActiveTask && (
          <div className="upload-task-banner">
            <p className="upload-task-banner-label">
              📤 Загрузка профилей в задачу:
            </p>
            <p className="upload-task-banner-title">
              "{selectedActiveTask.title}" (Привоз: {selectedActiveTask.internal_number_start || 'не указан'})
            </p>
          </div>
        )}

        {/* Upload Area */}
        <form onSubmit={handleUpload}>
          <div className="upload-area">
            <div className="upload-icon">📁</div>
            <h3 className="upload-title">Выберите Excel файл</h3>
            <p className="upload-subtitle">
              Поддерживаемые форматы: .xlsx, .xls
            </p>
            <input
              id="file-input"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              disabled={uploading}
              hidden
              ref={fileInputRef}
            />
            <button
              type="button"
              className="browse-btn btn btn-secondary btn-lg"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? '⏳ Загрузка...' : '📂 Выбрать файл'}
            </button>
          </div>

          {/* File List */}
          {file && (
            <div className="file-list">
              <h4>Выбранный файл:</h4>
              <div className="file-item">
                <div className="file-info">
                  <div className="file-name">📄 {file.name}</div>
                  <div className="file-meta">{(file.size / 1024).toFixed(1)} KB</div>
                </div>
              </div>
            </div>
          )}

          {/* Upload Button */}
          <div className="upload-btn-container">
            <button
              type="submit"
              disabled={!file || uploading}
              className="upload-file-btn btn btn-primary btn-lg btn-block"
            >
              {uploading ? '⏳ Загрузка...' : '📤 Загрузить файл'}
            </button>
          </div>
        </form>

        {/* Error Display */}
        {error && (
          <div className="error-alert">
            <div className="error-header">
              <div className="error-icon">❌</div>
              <h3 className="error-title upload-error-title">
                Ошибка: {typeof error === 'string' ? error : error.message}
              </h3>
            </div>

            {/* Display multiple validation errors */}
            {error.validationErrors && error.validationErrors.length > 0 && (
              <details className="validation-errors-details upload-detail-block">
                <summary className="upload-detail-summary">
                  Показать все ошибки ({error.errorCount})
                </summary>
                <div className="upload-detail-content">
                  {error.validationErrors.map((validationError, index) => (
                    <div key={index} className="upload-detail-item upload-detail-item-danger">
                      <div className="upload-detail-item-title">
                        Строка {validationError.rowNumber}
                      </div>
                      <div className="upload-detail-item-text">
                        {validationError.message}
                      </div>
                      {validationError.details && (
                        <div className="upload-detail-item-meta">
                          {validationError.details.column && `Столбец: ${validationError.details.column}`}
                          {validationError.details.actualValue !== undefined && ` | Найдено: "${validationError.details.actualValue}"`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* Display internal duplicates within file */}
            {error.internalDuplicates && error.internalDuplicates.length > 0 && (
              <div className="upload-detail-block">
                <div className="upload-inline-alert upload-inline-alert-danger">
                  <strong>Внимание!</strong> В файле обнаружены дубликаты. Исправьте файл и загрузите заново.
                </div>
                <details className="internal-duplicates-details" open>
                  <summary className="upload-detail-summary">
                    Дубликаты в файле ({error.duplicateCount})
                  </summary>
                  <div className="upload-detail-content upload-detail-content-tall">
                    {error.internalDuplicates.map((dup, index) => (
                      <div key={index} className="upload-duplicate-card upload-duplicate-card-danger">
                        <div className="upload-duplicate-card-title">
                          {dup.sampleName}
                        </div>
                        <div className="upload-duplicate-card-grid">
                          <div>
                            <span className="upload-muted-label">Строка:</span> {dup.firstRow}
                          </div>
                          {isGenetic ? <div>Объект: {dup.sampleName}</div> : <>
                          <div>
                            <span className="upload-muted-label">Номер:</span> {dup.internalNumber}
                          </div>
                          <div>
                            <span className="upload-muted-label">Год:</span> {dup.year}
                          </div>
                          </>}
                          <div className="upload-danger-text">
                            Дубликат на строке: {dup.duplicateRow}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}

            {/* Display detailed validation errors */}
            {error.validation && (
              <>
                {/* Validation Summary */}
                <div className="validation-summary">
                  {error.validation.expertiseType && (
                    <div className="validation-row">
                      <span className="validation-label">Тип экспертизы:</span>
                      <span className="validation-value">
                        {error.validation.expertiseType === 'emergency'
                          ? 'ЧС (чрезвычайные ситуации)'
                          : 'Генетическая экспертиза'}
                      </span>
                    </div>
                  )}

                  {error.validation.summary && (
                    <div className="validation-row">
                      <span className="validation-label">Обработано строк:</span>
                      <span className={`validation-value ${error.validation.errors?.length > 0 ? 'error' : 'success'}`}>
                        {error.validation.summary.actualDataRows || 0}
                        {error.validation.summary.skippedEmptyRows > 0 &&
                          ` (пропущено ${error.validation.summary.skippedEmptyRows} пустых строк)`}
                      </span>
                    </div>
                  )}
                </div>

                <div className="error-details">
                  {/* Show errors */}
                  {error.validation.errors && error.validation.errors.length > 0 && (
                    <div className="error-section">
                      <h4 className="error-section-title">
                        Найденные ошибки ({error.validation.errors.length})
                      </h4>
                      <ul className="error-list">
                        {error.validation.errors.slice(0, 10).map((err, index) => (
                          <li key={index} className="error-item">
                            {err.message}
                            {err.details?.cellAddress && (
                              <span className="upload-muted-inline">
                                {' '}(ячейка {err.details.cellAddress})
                              </span>
                            )}
                          </li>
                        ))}
                        {error.validation.errors.length > 10 && (
                          <li className="error-item upload-list-tail">
                            ... и еще {error.validation.errors.length - 10} ошибок
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  {/* Show warnings */}
                  {error.validation.warnings && error.validation.warnings.length > 0 && (
                    <div className="warning-section">
                      <h4 className="warning-title">
                        Предупреждения ({error.validation.warnings.length})
                      </h4>
                      <ul className="warning-list">
                        {error.validation.warnings.slice(0, 5).map((warn, index) => (
                          <li key={index} className="warning-item">
                            {warn.message}
                          </li>
                        ))}
                        {error.validation.warnings.length > 5 && (
                          <li className="warning-item upload-list-tail">
                            ... и еще {error.validation.warnings.length - 5} предупреждений
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Display conflicts with active profiles */}
            {error.conflicts && error.conflicts.length > 0 && (
              <div className="upload-detail-block">
                <div className="upload-inline-alert upload-inline-alert-danger">
                  <strong>Внимание!</strong> Обнаружены конфликты с активными профилями. Деактивируйте существующие профили перед загрузкой новых.
                </div>
                <details className="conflicts-details" open>
                  <summary className="upload-detail-summary">
                    Конфликтующие профили ({error.conflicts.length})
                  </summary>
                  <div className="upload-detail-content upload-detail-content-tall">
                    {error.conflicts.map((conflict, index) => (
                      <div key={index} className="upload-duplicate-card upload-duplicate-card-danger">
                        <div className="upload-duplicate-card-title">
                          {conflict.sampleName}
                        </div>
                        <div className="upload-duplicate-card-grid">
                          {isGenetic ? <div>Объект: {conflict.sampleName}</div> : <>
                          <div>
                            <span className="upload-muted-label">Номер:</span> {conflict.internalNumber}
                          </div>
                          <div>
                            <span className="upload-muted-label">Год:</span> {conflict.year}
                          </div>
                          </>}
                          {conflict.existingProfile && (
                            <>
                              <div className="upload-existing-profile-divider">
                                <span className="upload-muted-label">Существующий профиль:</span>
                              </div>
                              <div>
                                <span className="upload-muted-label">ID:</span> {conflict.existingProfile.id}
                              </div>
                              <div>
                                <span className="upload-muted-label">Загружен:</span> {new Date(conflict.existingProfile.uploadDate).toLocaleDateString('ru-RU')}
                              </div>
                              {conflict.existingProfile.taskId && (
                                <div className="upload-existing-profile-full">
                                  <span className="upload-muted-label">Задача:</span> #{conflict.existingProfile.taskId.substring(0, 8)}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </div>
        )}

        {/* Success Display */}
        {uploadResult && (
          <div className="alert alert-success">
            <strong>✅ Загрузка успешна!</strong>
            <div className="upload-success-summary">
              <p><strong>Обработано:</strong> {uploadResult.processing?.summary?.totalProfiles || uploadResult.parsing?.totalParsed || 0} {pluralizeProfiles(uploadResult.processing?.summary?.totalProfiles || uploadResult.parsing?.totalParsed || 0)}</p>
              <p><strong>Валидных:</strong> {uploadResult.processing?.summary?.createdCount || uploadResult.processing?.created || 0} {pluralizeProfiles(uploadResult.processing?.summary?.createdCount || uploadResult.processing?.created || 0)}</p>
              {(uploadResult.processing?.summary?.replacedCount || uploadResult.processing?.replaced || 0) > 0 && (
                <p><strong>Заменено:</strong> {uploadResult.processing?.summary?.replacedCount || uploadResult.processing?.replaced || 0} {pluralizeProfiles(uploadResult.processing?.summary?.replacedCount || uploadResult.processing?.replaced || 0)}</p>
              )}
              <p><strong>Невалидных:</strong> {uploadResult.processing?.summary?.errorCount || uploadResult.processing?.errors || 0} {pluralizeProfiles(uploadResult.processing?.summary?.errorCount || uploadResult.processing?.errors || 0)}</p>
              {(() => {
                // Фильтруем только пропущенные дубликаты (исключая замененные)
                const skippedDuplicates = uploadResult.data?.duplicates?.filter(d => d.action !== 'replace') || [];
                return skippedDuplicates.length > 0 && (
                  <p><strong>Пропущено дубликатов:</strong> {skippedDuplicates.length} {pluralizeProfiles(skippedDuplicates.length)}</p>
                );
              })()}

              {/* Детальная информация об ошибках */}
              {uploadResult.data?.errors && uploadResult.data.errors.length > 0 && (
                <ErrorDetailsSection errors={uploadResult.data.errors} />
              )}

              {/* Информация о замененных профилях */}
              {(() => {
                const replacedProfiles = uploadResult.data?.duplicates?.filter(d => d.action === 'replace') || [];
                return replacedProfiles.length > 0 && (
                  <div className="upload-detail-block">
                    <details className="upload-detail-collapsible" open>
                      <summary className="duplicates-summary">
                        🔄 Заменено профилей: {replacedProfiles.length}
                      </summary>
                      <div className="upload-detail-content upload-detail-content-tall upload-result-list">
                        {replacedProfiles.map((dup, index) => (
                          <div
                            key={index}
                            className={`upload-result-row${index < replacedProfiles.length - 1 ? ' upload-result-row-bordered' : ''}`}
                          >
                            <div className="upload-result-row-title">
                              {dup.sampleName}
                            </div>
                            <div className="upload-result-row-subtitle">
                              {isGenetic ? `Объект: ${dup.sampleName}` : `Год: ${dup.year} | Номер: ${dup.internalNumber}`}
                            </div>
                            {dup.existingProfiles && dup.existingProfiles.length > 0 && (
                              <div className="upload-result-row-meta">
                                Заменён деактивированный профиль от {new Date(dup.existingProfiles[0].uploadDate).toLocaleDateString('ru-RU')}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                );
              })()}

              {uploadResult.importFormat === 'genetic' && uploadResult.data?.createdProfiles?.length > 0 && (
                <details className="upload-detail-collapsible">
                  <summary className="upload-detail-summary">Загруженные объекты ({uploadResult.data.createdProfiles.length})</summary>
                  <div className="upload-detail-content upload-detail-content-tall">
                    {uploadResult.data.createdProfiles.map(profile => (
                      <div key={profile.id} className="upload-result-row">
                        <div className="upload-result-row-title">Объект: {profile.sampleName}</div>
                        <div className="upload-result-row-subtitle">Локусов: {profile.lociCount} · Статус: загружен</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Информация о пропущенных дубликатах */}
              {(() => {
                const skippedDuplicates = uploadResult.data?.duplicates?.filter(d => d.action !== 'replace') || [];
                return skippedDuplicates.length > 0 && (
                  <div className="upload-detail-block">
                    <details className="upload-detail-collapsible">
                      <summary className="duplicates-summary">
                        ⚠️ Пропущено дубликатов: {skippedDuplicates.length}
                      </summary>
                      <div className="upload-detail-content upload-detail-content-tall">
                        {/* Заголовок таблицы */}
                        <div className="upload-duplicates-table-header">
                          <div>Образец</div>
                          <div>{isGenetic ? 'Локусов' : 'Год / Номер'}</div>
                          <div>Причина</div>
                        </div>

                        {/* Строки дубликатов */}
                        {skippedDuplicates.map((dup, index) => {
                        // Формируем понятное сообщение о дубликате
                        let message = '';

                        if (dup.existingProfiles && dup.existingProfiles.length > 0) {
                          const ex = dup.existingProfiles[0];
                          const isCurrentUser = ex.userId === user?.id;

                          // Базовая информация об образце
                          let sampleInfo = '';
                          if (ex.sampleName) {
                            sampleInfo = `"${ex.sampleName}"`;
                          }
                          if (ex.year && ex.internalNumber) {
                            sampleInfo += ` (${ex.year}/${ex.internalNumber})`;
                          }

                          // Формируем сообщение в зависимости от местоположения
                          if (ex.taskId) {
                            const taskName = `#${ex.taskId}`;

                            if (isCurrentUser) {
                              message = `Этот образец уже был загружен в вашей задаче: ${taskName}`;
                            } else {
                              message = `Этот образец уже загружен в задаче ${taskName} другого пользователя`;
                            }
                          } else {
                            if (isCurrentUser) {
                              message = `Этот образец уже есть в ваших личных профилях`;
                            } else {
                              message = `Этот образец уже есть в личных профилях другого пользователя`;
                            }
                          }

                          // Добавляем информацию об образце, если есть
                          if (sampleInfo) {
                            message += ` ${sampleInfo}`;
                          }
                        } else {
                          // Если нет информации о существующем профиле
                          message = 'Дубликат уже существует в базе данных';
                        }

                        return (
                          <div
                            key={index}
                            className={`upload-duplicates-table-row${index < skippedDuplicates.length - 1 ? ' upload-duplicates-table-row-bordered' : ''}${index % 2 === 0 ? ' is-even' : ' is-odd'}`}
                          >
                            <div className="upload-duplicates-sample">
                              {dup.sampleName}
                            </div>
                            <div className="upload-duplicates-meta">
                              {isGenetic ? dup.lociCount : (dup.year && dup.internalNumber ? `${dup.year} / ${dup.internalNumber}` : '—')}
                            </div>
                            <div className="upload-duplicates-reason">
                              {message}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Right Column - Requirements Section */}
      <div className="requirements-section">
        <div className="requirements-section-header">
          <div className="requirements-section-eyebrow">Справка по загрузке</div>
          <h2 className="requirements-section-title">Подготовка Excel файла</h2>
          <p className="requirements-section-description">
            Используйте пример ниже как ориентир для структуры файла, чтобы загрузка прошла без лишних ошибок и ручной доработки.
          </p>
        </div>

        {isGenetic ? (
        <div className="upload-example-card upload-example-card-accent">
          <h3 className="upload-example-title">📋 Формат для отделения «Генетические экспертизы»</h3>
          <p className="upload-example-description">Первый столбец — «Объект», остальные — поддерживаемые генетические локусы.</p>
          <div className="example-table-wrapper">
            <table className="example-table example-table-compact">
              <thead><tr>{['Объект', 'TH01', 'D5S818', 'D21S11', 'D18S51', 'AMEL', 'D3S1358', 'FGA', 'SE33'].map(name => <th key={name}>{name}</th>)}</tr></thead>
              <tbody><tr>{['110-1', '7,9', '11,12', '29,30', '12,15', 'XY', '15,16', '21,23', '18,19'].map((value, index) => <td key={index}>{value}</td>)}</tr></tbody>
            </table>
          </div>
          <div className="upload-requirements-box">
            <h4 className="upload-requirements-title">Важные требования:</h4>
            <ul className="upload-requirements-list-compact">
              <li>Первая строка файла содержит заголовки; первый столбец обязательно называется «Объект».</li>
              <li>После «Объект» нужны минимум 3 распознанных локуса. Набор зависит от используемой генетической системы.</li>
              <li>Порядок столбцов генетических локусов может отличаться в зависимости от используемой системы. Локусы определяются автоматически по названиям столбцов.</li>
              <li>Пустые значения отдельных локусов допускаются; полностью пустой генетический профиль не загружается.</li>
              <li>Год, привоз и старые служебные столбцы не требуются.</li>
              <li>Значение «Объект» обязательно и должно быть уникальным среди ваших профилей активного отделения.</li>
            </ul>
          </div>
        </div>
        ) : (<>
        {/* Блок с примером шапки Excel */}
        <div className="upload-example-card upload-example-card-accent">
          <h3 className="upload-example-title">
            <span className="upload-example-title-icon">📋</span>
            Пример правильной шапки Excel файла
          </h3>
          <p className="upload-example-description upload-example-description-tight">
            Ваш Excel файл должен иметь следующую структуру заголовков в первой строке:
          </p>

          {/* Таблица с примером */}
          <div className="example-table-wrapper">
            <table className="example-table example-table-compact">
              <thead>
                <tr>
                  <th className="example-col-id">присвоенный в в/ч № 522 ЦПООП Северо-Кавказского военного округа, г. Ростов-на-Дону</th>
                  <th className="example-col-import">ПРИВОЗ</th>
                  <th className="example-col-year">Год</th>
                  <th className="example-col-sample">Наименование образца</th>
                  <th>D3S1358</th>
                  <th>vWA</th>
                  <th>D16S539</th>
                  <th>CSF1PO</th>
                  <th>TPOX</th>
                  <th>Yindel</th>
                  <th>AMEL</th>
                  <th>D8S1179</th>
                  <th className="table-ellipsis">...</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Я9700</td>
                  <td>7</td>
                  <td>2024</td>
                  <td>110-1</td>
                  <td>15,18</td>
                  <td>18,18</td>
                  <td>9,11</td>
                  <td>10,12</td>
                  <td>8,8</td>
                  <td>2</td>
                  <td>XY</td>
                  <td>13,15</td>
                  <td className="table-ellipsis">...</td>
                </tr>
                <tr>
                  <td>Я9701</td>
                  <td>7</td>
                  <td>2024</td>
                  <td>110-2</td>
                  <td>14,16</td>
                  <td>17,19</td>
                  <td>11,12</td>
                  <td>11,13</td>
                  <td>8,9</td>
                  <td>1</td>
                  <td>XX</td>
                  <td>14,16</td>
                  <td className="table-ellipsis">...</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Важные замечания */}
          <div className="upload-requirements-box">
            <h4 className="upload-requirements-title">
              <span>⚠️</span> Важные требования:
            </h4>
            <ul className="upload-requirements-list-compact">
              <li><strong>Первая строка</strong> - обязательно заголовки столбцов</li>
              <li><strong>"присвоенный в в/ч № 522..."</strong> - уникальный идентификатор образца</li>
              <li><strong>"ПРИВОЗ"</strong> - номер привоза/партии</li>
              <li><strong>"Год"</strong> - год образца</li>
              <li><strong>"Наименование образца"</strong> - название образца</li>
              <li><strong>Формат аллелей</strong> - через запятую "15,18" или без запятой для гомозигот "8,8"</li>
              <li><strong>AMEL</strong> - XY (мужчина) или XX (женщина)</li>
              <li><strong>Yindel</strong> - 1 (женщина) или 2 (мужчина)</li>
            </ul>
          </div>

          {/* Подсказка */}
          <div className="upload-tip-box upload-tip-box-compact">
            <strong>💡 Совет:</strong> Скопируйте заголовки из примера выше и вставьте в первую строку вашего Excel файла.
          </div>
        </div>

        </>)}

        <div className="upload-format-card">
          <h3 className="upload-format-title">
            <span className="upload-format-title-icon">🗂️</span>
            Требования к файлу
          </h3>
          <div className="requirements-list">
            <div className="requirement-item">
              <div className="requirement-title">Формат файла</div>
              <div className="requirement-desc">Файлы Excel (.xlsx, .xls)</div>
            </div>

            <div className="requirement-item">
              <div className="requirement-title">Максимальный размер</div>
              <div className="requirement-desc">До 10 МБ</div>
            </div>

            <div className="requirement-item">
              <div className="requirement-title">Содержимое</div>
              <div className="requirement-desc">Данные генотипов и служебные поля образцов</div>
            </div>

            <div className="requirement-item">
              <div className="requirement-title">Структура</div>
              <div className="requirement-desc">Первая строка должна содержать заголовки столбцов без пропусков</div>
            </div>
          </div>
        </div>
      </div>

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
            <h2 className="dna-loading-title">🧬 Загрузка ДНК профилей</h2>
            <p className="dna-loading-message">
              {uploadProgress.stage || 'Обработка и валидация данных...'}
            </p>

            {/* Progress Bar */}
            {uploadProgress.total > 0 ? (
              <div className="upload-loading-progress">
                <div className="upload-loading-progress-track">
                  <div
                    className="upload-loading-upload-progress-bar"
                    style={{ width: `${(uploadProgress.current / uploadProgress.total * 100).toFixed(1)}%` }}
                  />
                </div>
                <div className="upload-loading-progress-meta">
                  <span>{uploadProgress.current} / {uploadProgress.total}</span>
                  <span>{((uploadProgress.current / uploadProgress.total) * 100).toFixed(1)}%</span>
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

      {/* Модальное окно подтверждения замены */}
      {showReplaceConfirm && previewData && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleCancelReplace();
            }
          }}
        >
          <div
            className="modal-content modal-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>🔄 Замена деактивированных профилей</h3>
              <button
                onClick={handleCancelReplace}
                className="close-modal-button"
               aria-label="Закрыть">
                ×
              </button>
            </div>

            <div className="modal-body">
              <div className="modal-info-card">
                <div className="info-row">
                  <span className="info-label">Всего профилей:</span>
                  <span className="info-value">{previewData.totalProfiles}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Новые:</span>
                  <span className="info-value info-value-success">
                    {previewData.breakdown.create}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-label">Для замены:</span>
                  <span className="info-value info-value-warning">
                    {previewData.breakdown.replace}
                  </span>
                </div>
                {previewData.breakdown.conflict > 0 && (
                  <div className="info-row">
                    <span className="info-label">Конфликты:</span>
                    <span className="info-value info-value-danger">
                      {previewData.breakdown.conflict}
                    </span>
                  </div>
                )}
              </div>

              <div className="modal-section">
                <h4>Профили для замены:</h4>
                <div className="upload-detail-content upload-detail-content-tall">
                  {previewData.profiles
                    .filter(p => p.action === 'replace')
                    .map((profile, index) => (
                      <div
                        key={index}
                        className="upload-duplicate-card upload-duplicate-card-warning"
                      >
                        <div className="upload-duplicate-card-title upload-duplicate-card-title-neutral">
                          {profile.sampleName}
                        </div>
                        <div className="upload-result-row-subtitle">
                          {isGenetic ? `Объект: ${profile.sampleName} | Локусов: ${profile.lociCount}` : `Внутренний номер: ${profile.internalNumber} | Год: ${profile.year}`}
                        </div>
                        {profile.existingProfile && (
                          <div className="upload-result-row-meta">
                            Заменит деактивированный профиль от {new Date(profile.existingProfile.uploadDate).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>

              <div className="upload-replace-preference">
                <label className="upload-replace-checkbox">
                  <input
                    type="checkbox"
                    checked={autoReplaceDeactivated}
                    onChange={(e) => setAutoReplaceDeactivated(e.target.checked)}
                    className="upload-replace-checkbox-input"
                  />
                  <span className="upload-replace-checkbox-text">
                    Автоматически заменять деактивированные профили в будущем
                  </span>
                </label>
              </div>
            </div>

            <div className="modal-footer upload-replace-footer">
              <button
                onClick={handleCancelReplace}
                className="btn btn-secondary upload-replace-btn"
              >
                ❌ Отмена
              </button>
              <button
                onClick={handleLoadAsNew}
                className="btn btn-info upload-replace-btn upload-replace-btn-wide"
                title="Загрузить профили как новые, не заменяя деактивированные"
              >
                📥 Загрузить как новый
              </button>
              <button
                onClick={handleConfirmReplace}
                className="btn btn-warning upload-replace-btn upload-replace-btn-xl"
              >
                🔄 Заменить и загрузить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


export default FileUploader;
