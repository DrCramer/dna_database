-- Восстанавливаем автоматическое создание мастер-массивов отделений.
-- Существующие массивы и профили сохраняются.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_department_master_array()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    array_id uuid;
BEGIN
    INSERT INTO public.master_arrays (department_id, name, description)
    VALUES (NEW.id, NEW.name || ' Master Array', 'Automatically created master array for ' || NEW.name)
    RETURNING id INTO array_id;
    UPDATE public.departments SET master_array_id = array_id, updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_create_department_master_array ON public.departments;
CREATE TRIGGER trigger_create_department_master_array
    AFTER INSERT ON public.departments
    FOR EACH ROW WHEN (NEW.master_array_id IS NULL)
    EXECUTE FUNCTION public.create_department_master_array();

DO $$
DECLARE
    dept record;
    array_id uuid;
BEGIN
    FOR dept IN SELECT id, name FROM public.departments
                WHERE is_active AND master_array_id IS NULL FOR UPDATE LOOP
        SELECT id INTO array_id FROM public.master_arrays
        WHERE department_id = dept.id AND is_active
        ORDER BY created_at, id LIMIT 1;
        IF array_id IS NULL THEN
            INSERT INTO public.master_arrays (department_id, name, description)
            VALUES (dept.id, dept.name || ' Master Array', 'Automatically created master array for ' || dept.name)
            RETURNING id INTO array_id;
        END IF;
        UPDATE public.departments SET master_array_id = array_id, updated_at = CURRENT_TIMESTAMP
        WHERE id = dept.id;
    END LOOP;
END;
$$;
COMMIT;
