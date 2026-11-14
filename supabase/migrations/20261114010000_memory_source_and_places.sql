-- Who wrote a memory: the coach ('coach') or the person ('person': added or edited by hand).
-- The coach's daily clean-up only ever deletes or changes its own notes.
alter table public.memories
  add column source text not null default 'person' check (source in ('person', 'coach'));

-- New category for places: trips, outings, training spots, where you regularly go.
alter table public.memories drop constraint if exists memories_category_check;
alter table public.memories add constraint memories_category_check
  check (category in ('person', 'arbeit', 'werte', 'rhythmus', 'ziel', 'termin', 'ort', 'natur', 'anderes'));
