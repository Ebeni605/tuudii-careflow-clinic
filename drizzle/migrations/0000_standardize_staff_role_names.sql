-- Standardize the four staff role identifiers.
-- Renaming enum labels keeps the same internal values, so existing role rows,
-- RLS policies and indexes keep working unchanged; only function bodies that
-- spell the old labels as text need rewriting.
ALTER TYPE public.app_role RENAME VALUE 'admin' TO 'administrator';
ALTER TYPE public.app_role RENAME VALUE 'clinician' TO 'opd_clinician';
ALTER TYPE public.app_role RENAME VALUE 'lab_tech' TO 'laboratory_technician';

DO $$
DECLARE
  f record;
  def text;
BEGIN
  FOR f IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prosrc ~ '''(admin|clinician|lab_tech)'''
  LOOP
    def := pg_get_functiondef(f.oid);
    def := replace(def, '''admin''', '''administrator''');
    def := replace(def, '''clinician''', '''opd_clinician''');
    def := replace(def, '''lab_tech''', '''laboratory_technician''');
    EXECUTE def;
  END LOOP;
END $$;