-- Настраиваемые права загрузки. Без задачи по умолчанию запрещено всем.
BEGIN;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_upload_with_task boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_upload_without_task boolean NOT NULL DEFAULT false;
COMMIT;
