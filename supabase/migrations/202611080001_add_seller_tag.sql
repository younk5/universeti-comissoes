BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN tag text,
  ADD CONSTRAINT profiles_tag_check
    CHECK (tag IS NULL OR (tag = upper(tag) AND char_length(tag) BETWEEN 1 AND 5));

COMMIT;
