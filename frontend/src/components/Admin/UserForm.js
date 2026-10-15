import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getProfileUploadPermissions } from '../../../../src/utils/profileUploadPermissions';

function departmentIds(user) {
  const ids = user?.accessible_departments?.length ? user.accessible_departments.map(item => item.id)
    : user?.department_id ? [user.department_id] : [];
  return [...ids.filter(id => id === user?.department_id), ...ids.filter(id => id !== user?.department_id).sort()];
}

export default function UserForm({ user, onSubmit, onCancel, roles, organizations, departments, canManageUploadPermissions }) {
  const id = useId();
  const dialogRef = useRef(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    username: user?.username || '', display_name: user?.display_name || '', email: user?.email || '', password: '',
    role: user?.role || 'user_analyst', organization_id: user?.organization_id || '',
    ...getProfileUploadPermissions(user),
    department_ids: departmentIds(user)
  }));
  const availableDepartments = departments.filter(item => item.organization_id === form.organization_id);
  const roleOptions = roles.some(item => item.value === form.role) ? roles : [
    ...roles, { value: form.role, label: { viewer: 'Наблюдатель', analyst: 'Аналитик', system_administrator: 'Системный администратор' }[form.role] || form.role,
      description: 'Текущая роль пользователя' }
  ];
  const update = (field, value) => setForm(previous => ({ ...previous, [field]: value }));

  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector('input')?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);

  function onKeyDown(event) {
    if (event.key === 'Escape' && !saving) onCancel();
    if (event.key !== 'Tab') return;
    const elements = [...dialogRef.current.querySelectorAll('button, input, select, [tabindex="0"]')].filter(item => !item.disabled && item.getClientRects().length);
    const first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setError('');
    if (!form.display_name.trim() || !form.username.trim() || (!user && !form.password)) {
      setError('Заполните Фамилию И.О., логин и пароль для нового пользователя.'); return;
    }
    if (!form.organization_id || !form.department_ids.length) { setError('Выберите организацию и хотя бы одно отделение.'); return; }
    const data = { ...form, display_name: form.display_name.trim(), username: form.username.trim(), email: form.email.trim() || null };
    if (user) {
      const previous = departmentIds(user);
      if (JSON.stringify(previous) === JSON.stringify(data.department_ids)) delete data.department_ids;
      for (const field of ['username', 'display_name', 'email', 'role', 'organization_id']) {
        if (data[field] === (user[field] || (field === 'email' ? null : ''))) delete data[field];
      }
    }
    if (!canManageUploadPermissions) {
      delete data.role; delete data.can_upload_with_task; delete data.can_upload_without_task;
    }
    // Пароль редактируется отдельным действием «Сбросить пароль».
    if (user) delete data.password;
    setSaving(true);
    try { await onSubmit(data); }
    catch (caught) { setError(caught.message || 'Не удалось сохранить пользователя.'); }
    finally { setSaving(false); }
  }

  return createPortal(
    <div className="user-management modal-overlay user-editor-overlay" onKeyDown={onKeyDown}>
      <section className="modal-content user-editor-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} ref={dialogRef}>
        <header className="user-editor-header">
          <div><p className="user-editor-eyebrow">Управление доступом</p>
            <h2 id={`${id}-title`}>{user ? 'Редактирование пользователя' : 'Новый пользователь'}</h2>
            <p>Имя для коллег, учётные данные и права работы в системе.</p></div>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Закрыть" disabled={saving} onClick={onCancel}>×</button>
        </header>
        <form className="user-editor-form" onSubmit={submit} aria-busy={saving}>
          <div className="user-editor-body">
            {error && <div className="user-error-message" role="alert">{error}</div>}
            <fieldset className="user-editor-section" disabled={saving}>
              <legend>Личные данные и вход</legend>
              <div className="user-editor-grid">
                <div className="form-group user-editor-full">
                  <label htmlFor={`${id}-name`} className="form-label required">Фамилия И.О.</label>
                  <input id={`${id}-name`} className="form-input" value={form.display_name} onChange={event => update('display_name', event.target.value)} placeholder="Иванов И.И." autoComplete="name" maxLength={150} required />
                  <p className="user-editor-hint">Это имя будет видно в правом верхнем углу приложения.</p>
                </div>
                <div className="form-group">
                  <label htmlFor={`${id}-login`} className="form-label required">Логин</label>
                  <input id={`${id}-login`} className="form-input" value={form.username} onChange={event => update('username', event.target.value)} autoComplete="off" minLength={3} maxLength={50} required />
                  <p className="user-editor-hint">Используется для входа в систему.</p>
                </div>
                <div className="form-group">
                  <label htmlFor={`${id}-email`} className="form-label">Электронная почта <span className="user-editor-optional">необязательно</span></label>
                  <input id={`${id}-email`} className="form-input" type="email" value={form.email} onChange={event => update('email', event.target.value)} autoComplete="email" maxLength={100} placeholder="Можно оставить пустым" />
                </div>
                {!user && <div className="form-group user-editor-full">
                  <label htmlFor={`${id}-password`} className="form-label required">Пароль</label>
                  <input id={`${id}-password`} className="form-input" type="password" value={form.password} onChange={event => update('password', event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required />
                  <p className="user-editor-hint">Не менее 8 символов. Передайте пароль пользователю лично.</p>
                </div>}
                {user && <p className="user-editor-hint user-editor-full">Для смены пароля используйте действие «Сбросить пароль» в списке пользователей.</p>}
              </div>
            </fieldset>
            <fieldset className="user-editor-section" disabled={saving}>
              <legend>Роль пользователя</legend>
              <div className="user-editor-roles">
                {roleOptions.map(role => <label key={role.value} className={`user-editor-role ${form.role === role.value ? 'is-selected' : ''}`}>
                  <input type="radio" name={`${id}-role`} checked={form.role === role.value} disabled={!canManageUploadPermissions} onChange={() => update('role', role.value)} />
                  <span><strong>{role.label}</strong><small>{role.description}</small></span>
                </label>)}
              </div>
            </fieldset>
            <fieldset className="user-editor-section" disabled={saving}>
              <legend>Организация и отделения</legend>
              <label htmlFor={`${id}-organization`} className="form-label required">Организация</label>
              <select id={`${id}-organization`} className="form-select" value={form.organization_id} required onChange={event => setForm(previous => ({ ...previous, organization_id: event.target.value, department_ids: [] }))}>
                <option value="">Выберите организацию</option>{organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <p className="user-editor-hint">Отметьте доступные отделения. Первое выбранное станет основным.</p>
              <div className="user-editor-departments">
                {availableDepartments.map(item => <label key={item.id} className={`user-editor-department ${form.department_ids.includes(item.id) ? 'is-selected' : ''}`}>
                  <input type="checkbox" checked={form.department_ids.includes(item.id)} onChange={event => update('department_ids', event.target.checked ? [...form.department_ids, item.id] : form.department_ids.filter(value => value !== item.id))} />
                  <span>{item.name}</span>{form.department_ids[0] === item.id && <small>Основное</small>}
                </label>)}
                {!availableDepartments.length && <p className="user-editor-hint">{form.organization_id ? 'В этой организации пока нет доступных отделений.' : 'Сначала выберите организацию.'}</p>}
              </div>
            </fieldset>
            <fieldset className="user-editor-section" disabled={saving || !canManageUploadPermissions}>
              <legend>Загрузка ДНК-профилей</legend>
              <label className="user-editor-permission"><input type="checkbox" checked={form.can_upload_with_task} onChange={event => update('can_upload_with_task', event.target.checked)} />
                <span><strong>В активную задачу</strong><small>Доступная задача в текущем отделении со статусом «В работе».</small></span></label>
              <label className="user-editor-permission"><input type="checkbox" checked={form.can_upload_without_task} onChange={event => update('can_upload_without_task', event.target.checked)} />
                <span><strong>Без задачи</strong><small>Профили сохраняются отдельно. По умолчанию это право выключено.</small></span></label>
            </fieldset>
          </div>
          <footer className="user-editor-footer"><span>Поля со звёздочкой обязательны</span><div>
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Отмена</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Сохранение…' : user ? 'Сохранить изменения' : 'Создать пользователя'}</button>
          </div></footer>
        </form>
      </section>
    </div>, document.body
  );
}
