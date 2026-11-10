BEGIN;

-- Reemplazar por el UUID de un usuario cuyo rol sea admin.
SET LOCAL request.jwt.claim.sub = 'a971ffaf-fb4f-484b-a9d9-b17689111668';

UPDATE public.visits
SET paid_at = NULL,
    paid_by = NULL
WHERE paid_at IS NOT NULL
   OR paid_by IS NOT NULL;

COMMIT;