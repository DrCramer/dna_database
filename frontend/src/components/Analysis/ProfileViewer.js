import React, { useEffect, useState } from 'react';
import { dnaAnalysisService } from '../../services/dnaAnalysisService';
import { useProfileFieldLabel } from '../../hooks/useProfileFieldLabel';

const ProfileViewer = () => {
  const fieldLabel = useProfileFieldLabel();
  const isGenetic = fieldLabel('sample_name', '') === '№ Экспертизы';
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('upload_date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [profilesPerPage] = useState(10);

  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    try {
      setLoading(true);
      const data = await dnaAnalysisService.getProfiles();
      setProfiles(data);
    } catch (err) {
      setError('Не удалось загрузить ДНК-профили');
      console.error('Error loading profiles:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProfile = async (profileId) => {
    if (!window.confirm('Удалить этот профиль без возможности восстановления?')) {
      return;
    }

    try {
      await dnaAnalysisService.deleteProfile(profileId);
      await loadProfiles();
      if (selectedProfile?.id === profileId) {
        setSelectedProfile(null);
      }
    } catch (err) {
      setError('Не удалось удалить профиль');
      console.error('Error deleting profile:', err);
    }
  };

  const filteredProfiles = profiles.filter((profile) =>
    profile.sample_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    profile.file_source?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const sortedProfiles = [...filteredProfiles].sort((a, b) => {
    let aValue = a[sortBy];
    let bValue = b[sortBy];

    if (sortBy === 'upload_date') {
      aValue = new Date(aValue);
      bValue = new Date(bValue);
    }

    return sortOrder === 'asc' ? (aValue > bValue ? 1 : -1) : (aValue < bValue ? 1 : -1);
  });

  const indexOfLastProfile = currentPage * profilesPerPage;
  const indexOfFirstProfile = indexOfLastProfile - profilesPerPage;
  const currentProfiles = sortedProfiles.slice(indexOfFirstProfile, indexOfLastProfile);
  const totalPages = Math.ceil(sortedProfiles.length / profilesPerPage);

  const STR_SNP_LOCI = [
    'D3S1358', 'vWA', 'D16S539', 'CSF1PO', 'TPOX', 'D8S1179', 'D21S11', 'D18S51',
    'D2S441', 'D19S433', 'TH01', 'FGA', 'D22S1045', 'D5S818', 'D13S317', 'D7S820',
    'D6S1043', 'D10S1248', 'D1S1656', 'D12S391', 'D2S1338', 'AMEL', 'D9S1122',
    'D18S853', 'D17S906', 'D4S2408', 'D8S1132', 'D1S1677', 'D20S482', 'D14S1434',
    'D11S4463', 'D15S659', 'D3S4529', 'D16S753', 'D17S1301', 'D18S1364', 'D2S1776',
    'D4S2366', 'D1S1627', 'rs2032678'
  ];

  if (loading) {
    return (
      <div className="card">
        <div className="table-loading">Загрузка ДНК-профилей...</div>
      </div>
    );
  }

  return (
    <div className="card analysis-result-shell">
      <div className="analysis-toolbar">
        <h2 className="population-section-title">ДНК-профили</h2>
        <button className="btn btn-primary" onClick={loadProfiles}>Обновить</button>
      </div>

      {error && (
        <div className="alert alert-danger">
          <div className="alert-content">
            <div className="alert-title">Ошибка</div>
            <p className="alert-message">{error}</p>
          </div>
        </div>
      )}

      <div className="analysis-search-grid">
        <div className="form-group">
          <label className="form-label">Поиск профилей</label>
          <input
            type="text"
            className="form-input"
            placeholder={`Поиск по ${fieldLabel('sample_name', 'имени образца')} или источнику файла...`}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
        <div className="analysis-toolbar analysis-toolbar-split">
          <div className="form-group">
            <label className="form-label">Сортировка</label>
            <select className="form-select" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="upload_date">Дата загрузки</option>
              <option value="sample_name">{fieldLabel('sample_name', 'Имя образца')}</option>
              <option value="file_source">Источник файла</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Порядок</label>
            <select className="form-select" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
              <option value="desc">По убыванию</option>
              <option value="asc">По возрастанию</option>
            </select>
          </div>
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>{fieldLabel('sample_name', 'Имя образца')}</th>
              {isGenetic && <th>Панель</th>}<th>Дата загрузки</th>
              <th>Источник файла</th>
              <th>Число локусов STR/SNP</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {currentProfiles.map((profile) => (
              <tr key={profile.id}>
                <td><strong>{profile.sample_name}</strong></td>{isGenetic && <td>{profile.panel?.name || profile.panelName || 'Не указана'}</td>}
                <td>{new Date(profile.upload_date).toLocaleDateString('ru-RU')}</td>
                <td>{profile.file_source || 'Нет данных'}</td>
                <td>{Object.keys(profile.str_snp_data || profile.str_data || {}).length}</td>
                <td>
                  <div className="table-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => setSelectedProfile(profile)}>
                      Просмотр
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDeleteProfile(profile.id)}>
                      Удалить
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="analysis-toolbar">
          <button className="btn btn-secondary btn-sm" onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))} disabled={currentPage === 1}>
            Назад
          </button>
          <span className="analysis-subtle">Страница {currentPage} из {totalPages}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages}>
            Вперед
          </button>
        </div>
      )}

      {sortedProfiles.length === 0 && !loading && (
        <div className="analysis-empty">
          {searchTerm ? 'Нет профилей, соответствующих условиям поиска.' : 'Пока нет загруженных ДНК-профилей.'}
        </div>
      )}

      {selectedProfile && (
        <div className="modal-overlay">
          <div className="modal-content modal-lg">
            <div className="modal-header">
              <h3>ДНК-профиль: {selectedProfile.sample_name}</h3>
              <button type="button" className="close-button" onClick={() => setSelectedProfile(null)} aria-label="Закрыть окно">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="analysis-metrics-grid">
                {selectedProfile.panel && <div className="analysis-metric-card"><div className="analysis-mini-label">Панель</div><div className="analysis-main-value">{selectedProfile.panel.name}</div></div>}
                <div className="analysis-metric-card">
                  <div className="analysis-mini-label">Дата загрузки</div>
                  <div className="analysis-main-value">{new Date(selectedProfile.upload_date).toLocaleString('ru-RU')}</div>
                </div>
                <div className="analysis-metric-card">
                  <div className="analysis-mini-label">Источник файла</div>
                  <div className="analysis-main-value">{selectedProfile.file_source || 'Нет данных'}</div>
                </div>
                <div className="analysis-metric-card">
                  <div className="analysis-mini-label">Примечания</div>
                  <div className="analysis-main-value">{selectedProfile.notes || 'Нет'}</div>
                </div>
              </div>

              <h4 className="population-section-title">Данные по STR/SNP локусам (40 маркеров)</h4>
              <div className="analysis-loci-grid">
                {STR_SNP_LOCI.map((locus) => {
                  const locusData = selectedProfile.str_snp_data?.[locus] || selectedProfile.str_data?.[locus];
                  const isSnp = locus.startsWith('rs');
                  return (
                    <div key={locus} className={`analysis-locus-tile ${locusData ? '' : 'is-missing'}`}>
                      <div className={`analysis-locus-name ${isSnp ? 'is-snp' : ''}`}>
                        {locus} {isSnp ? '(SNP)' : ''}
                      </div>
                      <div className="analysis-code">
                        {locusData ? `${locusData.allele1 || 'Нет'} , ${locusData.allele2 || 'Нет'}` : 'Нет данных'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedProfile(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfileViewer;
