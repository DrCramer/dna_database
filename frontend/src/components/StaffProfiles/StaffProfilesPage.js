import React, { useState, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import './StaffProfilesPage.css';

// Фиксированный порядок отображения локусов
const LOCI_DISPLAY_ORDER = [
  'D3S1358', 'vWA', 'D16S539', 'CSF1PO', 'TPOX', 'Yindel', 'AMEL',
  'D8S1179', 'D21S11', 'D18S51', 'DYS391', 'D2S441', 'D19S433',
  'TH01', 'FGA', 'D22S1045', 'D5S818', 'D13S317', 'D7S820', 'SE33',
  'D10S1248', 'D1S1656', 'D12S391', 'D2S1338', 'D6S477', 'D6S1043',
  'D15S659', 'DXS6795', 'Penta E', 'D19S253', 'Penta D', 'D8S1132',
  'D3S3045', 'D10S1435', 'D4S2366', 'rs759551978', 'rs771783753',
  'rs199815934'
];

// Сортировка локусов по заданному порядку
function sortLociByOrder(loci) {
  const sortedLoci = {};
  
  // Сначала добавляем локусы в заданном порядке
  LOCI_DISPLAY_ORDER.forEach(locusName => {
    if (loci[locusName]) {
      sortedLoci[locusName] = loci[locusName];
    }
  });
  
  // Затем добавляем локусы, которых нет в списке (на случай новых)
  Object.keys(loci).forEach(locusName => {
    if (!sortedLoci[locusName]) {
      sortedLoci[locusName] = loci[locusName];
    }
  });
  
  return sortedLoci;
}

// Определение стиля карточки локуса по типу
function getLocusCardClass(locusName) {
  if (locusName === 'AMEL') return 'loci-card-amel';
  if (locusName.startsWith('DYS') || locusName === 'Yindel') return 'loci-card-y';
  if (locusName.startsWith('DXS')) return 'loci-card-x';
  if (locusName.startsWith('rs')) return 'loci-card-snp';
  if (locusName.includes('Penta')) return 'loci-card-penta';
  return 'loci-card-str';
}

// Компонент секции загрузки
function UploadSection({ onUploadSuccess }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(null);
  const [showExample, setShowExample] = useState(false);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setMessage(null);
  };

  const handleUpload = async () => {
    if (!file) {
      setMessage({ type: 'error', text: 'Пожалуйста, выберите файл' });
      return;
    }

    setUploading(true);
    setMessage(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/staff-profiles/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ 
          type: 'success', 
          text: `Успешно загружено ${data.profilesCount} профилей` 
        });
        setFile(null);
        onUploadSuccess();
      } else {
        setMessage({ 
          type: 'error', 
          text: data.error || 'Ошибка при загрузке файла' 
        });
      }
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: 'Ошибка соединения с сервером' 
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="upload-section">
      <h3>
        <span>📁</span>
        <span>Загрузить профили сотрудников</span>
      </h3>
      <div className="upload-controls">
        <div className="file-input-wrapper">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            disabled={uploading}
            id="staff-file-input"
            className="staff-hidden-file-input"
          />
          <button 
            className="choose-file-btn"
            onClick={() => document.getElementById('staff-file-input').click()}
            disabled={uploading}
          >
            <span>📁</span>
            <span>Выберите Excel файл</span>
          </button>
        </div>
        <div className="file-name-display">
          {file ? file.name : 'Файл не выбран'}
        </div>
        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="upload-btn"
        >
          <span>📤</span>
          <span>{uploading ? 'Загрузка...' : 'Загрузить профили'}</span>
        </button>
      </div>
      
      {message && (
        <div className={`message message-${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Кнопка показа примера */}
      <div className="staff-example-toggle">
        <button
          onClick={() => setShowExample(!showExample)}
          className="staff-example-toggle-btn"
        >
          {showExample ? '▼ Скрыть пример' : '▶ Показать пример формата файла'}
        </button>
      </div>

      {/* Пример формата файла */}
      {showExample && (
        <div className="staff-example-panel">
          <h4 className="staff-example-title">
            📋 Формат Excel файла
          </h4>
          <p className="staff-example-subtitle">
            Первая строка должна содержать заголовки столбцов:
          </p>
          <div className="staff-example-table-shell">
            <table className="staff-example-table">
              <thead>
                <tr>
                  <th>Sample Name</th>
                  <th>D3S1358</th>
                  <th>vWA</th>
                  <th>D16S539</th>
                  <th>AMEL</th>
                  <th>...</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Иванов Иван Иванович</td>
                  <td>15, 16</td>
                  <td>17, 18</td>
                  <td>11, 12</td>
                  <td>X, Y</td>
                  <td className="staff-example-muted">...</td>
                </tr>
                <tr>
                  <td>Петрова Мария Сергеевна</td>
                  <td>14, 17</td>
                  <td>16, 19</td>
                  <td>9, 13</td>
                  <td>X, X</td>
                  <td className="staff-example-muted">...</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="staff-example-notes">
            <p className="staff-example-note-label">
              <strong>Важно:</strong>
            </p>
            <ul className="staff-example-note-list">
              <li>Столбец "Sample Name" обязателен и должен содержать ФИО сотрудника</li>
              <li>Аллели указываются через запятую или пробел (например: "15, 16" или "15 16")</li>
              <li>Поддерживаемые локусы: D3S1358, vWA, D16S539, CSF1PO, TPOX, Yindel, AMEL, D8S1179, D21S11, D18S51, DYS391, D2S441, D19S433, TH01, FGA, D22S1045, D5S818, D13S317, D7S820, SE33, D10S1248, D1S1656, D12S391, D2S1338, D6S477, D6S1043, D15S659, DXS6795, Penta E, D19S253, Penta D, D8S1132, D3S3045, D10S1435, D4S2366, rs759551978, rs771783753, rs199815934</li>
              <li>Пустые ячейки, "0" и "-" игнорируются</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// Компонент списка профилей
function ProfileList({ profiles, onView, onDelete, loading }) {
  if (loading) {
    return <div className="loading">⏳ Загрузка профилей...</div>;
  }

  if (profiles.length === 0) {
    return (
      <div className="empty-state">
        <p>📋 Профили сотрудников не найдены</p>
        <p className="empty-hint">Загрузите Excel файл для добавления профилей</p>
      </div>
    );
  }

  return (
    <div className="staff-table-shell">
      <table className="profiles-table">
        <thead>
          <tr>
            <th>ФИО сотрудника</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map(profile => (
            <tr key={profile.id}>
              <td>{profile.full_name}</td>
              <td>
                <div className="staff-actions">
                  <button
                    onClick={() => onView(profile.id)}
                    className="staff-action-btn staff-action-view"
                    title="Просмотр"
                  >
                    <span>👁️</span>
                    <span>Просмотр</span>
                  </button>
                  <button
                    onClick={() => onDelete(profile.id)}
                    className="staff-action-btn staff-action-delete"
                    title="Удалить"
                  >
                    <span>🗑️</span>
                    <span>Удалить</span>
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Компонент модального окна просмотра профиля
function ProfileViewModal({ profile, onClose }) {
  if (!profile) return null;

  // Сортируем локусы по заданному порядку
  const sortedLoci = sortLociByOrder(profile.loci);
  const lociCount = Object.keys(sortedLoci).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-block">
            <p className="modal-kicker">ДНК-профиль сотрудника</p>
            <h2>{profile.full_name}</h2>
            <p className="modal-subtitle">Карточка профиля и все загруженные генетические локусы в удобном формате.</p>
          </div>
          <button onClick={onClose} className="close-button">✕</button>
        </div>

        <div className="modal-body">
          <div className="profile-overview">
            <div className="profile-overview-copy">
              <h3>Состав профиля</h3>
              <p>Данные ниже отображаются в фиксированном порядке локусов, чтобы профиль было удобно читать и сверять с другими образцами.</p>
            </div>
            <div className="profile-badges">
              <span className="profile-badge">🧬 {lociCount} {lociCount === 1 ? 'локус' : lociCount < 5 ? 'локуса' : 'локусов'}</span>
              <span className="profile-badge">📋 Формат просмотра увеличен</span>
            </div>
          </div>

          <div className="loci-section">
            <div className="loci-section-header">
              <h3>Генетические локусы</h3>
              <p>Каждая карточка показывает название локуса и значения аллелей без мелкого текста и лишнего сжатия.</p>
            </div>

            <div className="loci-grid">
              {Object.entries(sortedLoci).map(([locusName, alleles]) => {
                const cardClass = getLocusCardClass(locusName);
                const value = alleles.allele2
                  ? `${alleles.allele1}, ${alleles.allele2}`
                  : alleles.allele1;

                return (
                  <div key={locusName} className={`loci-card ${cardClass}`}>
                    <div className="locus-name">{locusName}</div>
                    <div className="locus-value">{value}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="close-modal-button">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

// Главный компонент страницы
function StaffProfilesPage({ onNavigate }) {
  const { effectiveTheme: theme } = useTheme();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [viewingProfile, setViewingProfile] = useState(false);

  // Загрузка списка профилей
  const loadProfiles = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/staff-profiles', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setProfiles(data);
      } else {
        console.error('Ошибка загрузки профилей');
      }
    } catch (error) {
      console.error('Ошибка соединения:', error);
    } finally {
      setLoading(false);
    }
  };

  // Загрузка при монтировании
  useEffect(() => {
    loadProfiles();
  }, []);

  // Просмотр профиля
  const handleView = async (profileId) => {
    setViewingProfile(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/staff-profiles/${profileId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setSelectedProfile(data);
      } else {
        console.error('Ошибка загрузки профиля');
      }
    } catch (error) {
      console.error('Ошибка соединения:', error);
    } finally {
      setViewingProfile(false);
    }
  };

  // Удаление профиля
  const handleDelete = async (profileId) => {
    if (!window.confirm('Вы уверены, что хотите удалить этот профиль?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/staff-profiles/${profileId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        loadProfiles(); // Перезагружаем список
      } else {
        alert('Ошибка при удалении профиля');
      }
    } catch (error) {
      console.error('Ошибка соединения:', error);
      alert('Ошибка соединения с сервером');
    }
  };

  // Закрытие модального окна
  const handleCloseModal = () => {
    setSelectedProfile(null);
  };

  return (
    <div className={`staff-profiles-page staff-page ${theme === 'dark' ? 'dark' : 'light'}`}>
      <div className="page-header">
        <div className="page-title-section">
          <h1 className="page-title">
            <span>👨‍🔬</span>
            <span>ДНК профили сотрудников</span>
          </h1>
          <p className="page-subtitle">Управление ДНК-профилями сотрудников в системе</p>
        </div>
        <div className="header-actions">
          <button
            onClick={() => onNavigate('/dashboard')}
            className="nav-button"
          >
            Назад к дашборду
          </button>
        </div>
      </div>

      <UploadSection onUploadSuccess={loadProfiles} />

      <ProfileList
        profiles={profiles}
        onView={handleView}
        onDelete={handleDelete}
        loading={loading}
      />

      {selectedProfile && (
        <ProfileViewModal
          profile={selectedProfile}
          onClose={handleCloseModal}
        />
      )}

      {viewingProfile && (
        <div className="loading-overlay">
          <div className="loading">⏳ Загрузка профиля...</div>
        </div>
      )}
    </div>
  );
}

export default StaffProfilesPage;
