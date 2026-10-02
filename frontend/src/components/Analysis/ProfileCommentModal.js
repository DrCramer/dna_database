import React, { useState, useEffect } from 'react';

const ProfileCommentModal = ({ isOpen, onClose, profile, onSave }) => {
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mouseDownTarget, setMouseDownTarget] = useState(null);

  useEffect(() => {
    if (isOpen && profile) {
      // Load existing comment
      setComment(profile.expert_comment || '');
      setError(null);
    }
  }, [isOpen, profile]);

  const handleSave = async () => {
    if (!profile) return;

    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/profiles/${profile.id}/comment`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ comment: comment.trim() || null })
      });

      if (!response.ok) {
        throw new Error('Не удалось сохранить комментарий');
      }

      // Вызываем onSave и передаём комментарий
      if (onSave) {
        await onSave(comment.trim() || null);
      }

      // Сбрасываем состояние загрузки
      setLoading(false);
    } catch (err) {
      console.error('Ошибка сохранения комментария:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
    }
  };

  // Обработчик для закрытия по клику на overlay
  const handleOverlayMouseDown = (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      setMouseDownTarget(e.target);
    }
  };

  const handleOverlayClick = (e) => {
    // Закрываем только если mouseDown и click были на overlay
    if (e.target.classList.contains('modal-overlay') &&
        mouseDownTarget === e.target) {
      handleClose();
    }
    setMouseDownTarget(null);
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onMouseDown={handleOverlayMouseDown}
      onClick={handleOverlayClick}
    >
      <div className="modal-content profile-comment-modal modal-md" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>💬 Комментарий к образцу</h3>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="close-button"
            aria-label="Закрыть окно"
          >
            ✕
          </button>
        </div>

        <div className="profile-comment-modal__body">
          {profile && (
            <div className="profile-comment-modal__sample">
              <strong>Образец:</strong> {profile.sample_name || profile.sampleName}
              {profile.year && profile.internal_number && (
                <span> ({profile.year}/{profile.internal_number})</span>
              )}
            </div>
          )}

          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Введите комментарий к образцу..."
            rows={6}
            disabled={loading}
            className="form-textarea profile-comment-modal__textarea"
          />

          {profile?.comment_updated_at && (
            <div className="profile-comment-modal__meta">
              Последнее изменение: {new Date(profile.comment_updated_at).toLocaleString('ru-RU')}
            </div>
          )}

          {error && (
            <div className="alert alert-danger">
              <div className="alert-content">
                <div className="alert-title">Ошибка</div>
                <p className="alert-message">{error}</p>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="btn btn-secondary"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="btn btn-primary"
          >
            {loading ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProfileCommentModal;
